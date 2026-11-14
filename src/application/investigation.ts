import type { ApprovalRequest, ProposalInput } from "../domain/approval.js";
import type { ActionDef, Assessment, Decision, Evaluation, Measurement, MonitorDef, Severity } from "../domain/model.js";
import type { ActionRunner, ChatMessage, IntegrationRecord, ModelClient, SignalReader, ToolCall, ToolSpec } from "./ports.js";
import { SignalUnavailableError } from "./ports.js";
import { clip } from "./text.js";

export type Trigger =
  | { kind: "threshold-breach"; evaluation: Evaluation; measurement: Measurement }
  | { kind: "signal-unavailable"; error: string };

export interface InvestigationDeps {
  model: ModelClient;
  signals: SignalReader;
  actions: ActionRunner;
  /** Records a proposed write. The agent cannot run writes, only propose them. */
  propose: (input: ProposalInput) => ApprovalRequest;
}

export interface InvestigationInput {
  findingId: string;
  record: IntegrationRecord;
  monitor: MonitorDef;
  trigger: Trigger;
}

const OUTPUT_LIMIT = 4_000;
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const DECISIONS: Decision[] = ["informational", "act_now", "needs_approval"];

const TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "recollect_signal",
      description: "Read this monitor's signal again and return its current metrics.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "run_read_action",
      description: "Run an allowed read-only action to gather evidence. Makes no changes.",
      parameters: {
        type: "object",
        properties: { action_id: { type: "string" } },
        required: ["action_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_write_action",
      description: "Propose a write action. It is NOT executed; it waits for the logged-in user to approve it.",
      parameters: {
        type: "object",
        properties: {
          action_id: { type: "string" },
          reason: { type: "string", description: "Why this change should happen and what it will affect." },
        },
        required: ["action_id", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "End the investigation with your assessment. Call exactly once.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          cause: { type: "string" },
          severity: { type: "string", enum: SEVERITIES },
          decision: { type: "string", enum: DECISIONS },
        },
        required: ["summary", "decision"],
        additionalProperties: false,
      },
    },
  },
];

const NUDGE = "Call one of the tools. Use finish when you are done.";

/**
 * Runs one monitor's agent: a bounded loop of tool calls. The agent may read evidence and
 * propose writes. It cannot execute a write; approval is a separate use case.
 */
export async function investigate(deps: InvestigationDeps, input: InvestigationInput): Promise<Assessment> {
  const session = new Session(deps, input);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input) },
    { role: "user", content: describeTrigger(input.trigger) },
  ];

  for (let step = 0; step < input.monitor.agent.maxSteps; step++) {
    const reply = await deps.model.complete(messages, TOOLS);
    messages.push(reply);

    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      messages.push({ role: "user", content: NUDGE });
      continue;
    }
    for (const call of calls) {
      const outcome = await session.handle(call);
      if ("finish" in outcome) return session.assessment(outcome.finish);
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.output });
    }
  }
  return session.incomplete();
}

interface FinishArgs {
  summary: string;
  cause?: string;
  severity?: Severity;
  decision?: Decision;
}

/** Holds the state of one investigation and dispatches tool calls to the allowed operations. */
class Session {
  private readonly pendingApprovalIds: string[] = [];
  private readonly actionsRun: string[] = [];
  private readonly allowed: Set<string>;

  constructor(
    private readonly deps: InvestigationDeps,
    private readonly input: InvestigationInput,
  ) {
    this.allowed = new Set(input.monitor.agent.actions);
  }

  async handle(call: ToolCall): Promise<{ finish: FinishArgs } | { output: string }> {
    const args = parseArgs(call.function.arguments);
    if (!args) return { output: "error: arguments were not valid JSON" };

    switch (call.function.name) {
      case "finish":
        return { finish: toFinish(args) };
      case "recollect_signal":
        return { output: await this.recollect() };
      case "run_read_action":
        return { output: await this.runRead(text(args.action_id)) };
      case "propose_write_action":
        return { output: this.propose(text(args.action_id), text(args.reason)) };
      default:
        return { output: `error: unknown tool "${call.function.name}"` };
    }
  }

  assessment(finish: FinishArgs): Assessment {
    const decision = finish.decision ?? "informational";
    // A pending write still needs approval, so it cannot be reported as act_now.
    const effective: Decision = decision === "act_now" && this.pendingApprovalIds.length > 0 ? "needs_approval" : decision;
    return {
      summary: finish.summary,
      cause: finish.cause,
      severity: finish.severity ?? this.input.monitor.severity,
      decision: effective,
      complete: true,
      pendingApprovalIds: [...this.pendingApprovalIds],
      actionsRun: [...this.actionsRun],
    };
  }

  incomplete(): Assessment {
    return {
      summary: "investigation stopped after reaching the step limit",
      severity: this.input.monitor.severity,
      decision: "informational",
      complete: false,
      pendingApprovalIds: [...this.pendingApprovalIds],
      actionsRun: [...this.actionsRun],
    };
  }

  private async recollect(): Promise<string> {
    const signal = this.input.record.integration.signals.find((s) => s.id === this.input.monitor.signal);
    if (!signal) return "error: monitor signal not found";
    try {
      return clip(JSON.stringify(await this.deps.signals.read(signal)), OUTPUT_LIMIT);
    } catch (err) {
      return err instanceof SignalUnavailableError ? `error: ${err.message}` : `error: ${(err as Error).message}`;
    }
  }

  private async runRead(actionId: string): Promise<string> {
    const action = this.allowedAction(actionId, "read");
    if (!action) return `error: "${actionId}" is not an allowed read action for this monitor`;
    const result = await this.deps.actions.run(action, this.input.record.location, { dryRun: false });
    this.actionsRun.push(actionId);
    return clip(JSON.stringify(result), OUTPUT_LIMIT);
  }

  private propose(actionId: string, reason: string): string {
    const action = this.allowedAction(actionId, "write");
    if (!action) return `error: "${actionId}" is not an allowed write action for this monitor`;
    const request = this.deps.propose({
      findingId: this.input.findingId,
      integrationId: this.input.record.integration.id,
      monitorId: this.input.monitor.id,
      actionId,
      reason,
    });
    this.pendingApprovalIds.push(request.id);
    return `proposed as ${request.id}; it has NOT run and waits for user approval`;
  }

  private allowedAction(actionId: string, risk: ActionDef["risk"]): ActionDef | undefined {
    if (!this.allowed.has(actionId)) return undefined;
    const action = this.input.record.integration.actions.find((a) => a.id === actionId);
    return action?.risk === risk ? action : undefined;
  }
}

function systemPrompt(input: InvestigationInput): string {
  const { integration, monitor } = { integration: input.record.integration, monitor: input.monitor };
  const actions = monitor.agent.actions
    .map((id) => integration.actions.find((a) => a.id === id))
    .filter((a): a is ActionDef => a !== undefined)
    .map((a) => `- ${a.id} [${a.risk}]: ${a.description}`)
    .join("\n");
  return [
    `You are the monitoring agent for integration "${integration.name}" (owner: ${integration.owner}).`,
    `Your monitor: "${monitor.name}" (severity ${monitor.severity}).`,
    "Investigate the trigger using only the tools provided. Gather evidence before deciding.",
    "Rules:",
    "- Never say a change was made. Write actions are only proposed; the user must approve them.",
    "- Use propose_write_action for any change, reprocess or resubmission.",
    "- decision: 'informational' if no action is needed; 'act_now' only for conclusions drawn from read-only evidence; 'needs_approval' whenever a change is recommended.",
    "- Call finish exactly once when done.",
    "Allowed actions:",
    actions || "(none)",
  ].join("\n");
}

function describeTrigger(trigger: Trigger): string {
  if (trigger.kind === "signal-unavailable") {
    return `Trigger: the signal could not be read.\nError: ${trigger.error}`;
  }
  const { evaluation, measurement } = trigger;
  return [
    `Trigger: threshold breached. ${evaluation.metric} = ${evaluation.value} (condition: ${evaluation.operator} ${evaluation.threshold}).`,
    `Measurement: ${JSON.stringify(measurement)}`,
  ].join("\n");
}

function parseArgs(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return undefined;
  }
}

function toFinish(args: Record<string, unknown>): FinishArgs {
  return {
    summary: text(args.summary),
    cause: args.cause ? text(args.cause) : undefined,
    severity: pick(args.severity, SEVERITIES),
    decision: pick(args.decision, DECISIONS),
  };
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
