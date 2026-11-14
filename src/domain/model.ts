import { DomainError } from "./errors.js";

export type Severity = "low" | "medium" | "high" | "critical";
export type Operator = "gt" | "gte" | "lt" | "lte" | "eq" | "ne";
export type Decision = "informational" | "act_now" | "needs_approval";
export type FindingKind = "threshold-breach" | "signal-unavailable";
export type FindingStatus = "open" | "resolved";

/** Where a monitor reads its data from. Each variant carries only what its reader needs. */
export type SignalDef =
  | { id: string; type: "log-analytics" | "app-insights"; workspaceId: string; kql: string; windowMinutes: number; intervalSec: number }
  | { id: string; type: "http-health"; url: string; method: "GET" | "HEAD"; expectStatus: number[]; timeoutMs: number; intervalSec: number }
  | { id: string; type: "storage-queue"; accountUrl: string; queueName: string; intervalSec: number }
  | { id: string; type: "service-bus"; namespace: string; queueName: string; intervalSec: number };

export type SignalType = SignalDef["type"];

/** Read actions run to gather evidence. Write actions always need approval. */
export type ActionDef =
  | { id: string; description: string; risk: "read"; script: string; requiresConfirmation: boolean; timeoutSec: number }
  | { id: string; description: string; risk: "write"; script: string; requiresConfirmation: true; timeoutSec: number };

export interface MonitorDef {
  id: string;
  name: string;
  signal: string;
  metric: string;
  operator: Operator;
  threshold: number;
  severity: Severity;
  enabled: boolean;
  tags: string[];
  agent: { maxSteps: number; actions: string[] };
}

/** A named set of monitors, possibly from several integrations. Members are "integration-id/monitor-id". */
export interface GroupDef {
  id: string;
  name: string;
  description: string;
  owner?: string;
  monitors: string[];
}

export interface IntegrationDef {
  id: string;
  name: string;
  owner: string;
  description?: string;
  signals: SignalDef[];
  actions: ActionDef[];
  monitors: MonitorDef[];
}

export interface Measurement {
  signalId: string;
  signalType: SignalType;
  observedAt: string;
  durationMs: number;
  metrics: Record<string, number>;
  details?: Record<string, unknown>;
}

export interface Evaluation {
  breached: boolean;
  metric: string;
  value: number;
  operator: Operator;
  threshold: number;
}

export interface Assessment {
  summary: string;
  severity: Severity;
  decision: Decision;
  cause?: string;
  /** False when the agent ran out of steps before finishing. */
  complete: boolean;
  pendingApprovalIds: string[];
  actionsRun: string[];
}

export interface Finding {
  id: string;
  integrationId: string;
  monitorId: string;
  monitorName: string;
  kind: FindingKind;
  severity: Severity;
  status: FindingStatus;
  observedAt: string;
  createdAt: string;
  error?: string;
  evaluation?: Evaluation;
  measurement?: Measurement;
  assessment?: Assessment;
}

export interface ThreadMessage {
  id: number;
  findingId: string;
  role: "agent" | "user" | "system";
  author: string;
  text: string;
  approvalId?: string;
  at: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  event: string;
  subject: string;
  detail: unknown;
}

export function resolveFinding(finding: Finding): Finding {
  if (finding.status === "resolved") {
    throw new DomainError(`finding "${finding.id}" is already resolved`, "invalid-state");
  }
  return { ...finding, status: "resolved" };
}

export function requireActor(user: string): string {
  if (!user || !user.trim()) throw new DomainError("an authenticated user is required", "bad-input");
  return user;
}
