import type { Approvers } from "../domain/approvers.js";
import { evaluateCondition } from "../domain/evaluate.js";
import { DomainError } from "../domain/errors.js";
import type { ApprovalRequest, ProposalInput } from "../domain/approval.js";
import { requireActor, resolveFinding, type Finding, type Measurement, type MonitorDef, type SignalDef } from "../domain/model.js";
import { investigate, type Trigger } from "./investigation.js";
import type { ActionRunner, ApprovalRepository, AuditLog, Clock, FindingRepository, IdGenerator, IntegrationCatalog, IntegrationRecord, ModelClient, SignalReader, ThreadRepository, UnitOfWork } from "./ports.js";
import { SignalUnavailableError } from "./ports.js";
import { monitorKey, type MonitorStatusBook, type TickStatus } from "./monitor-status.js";

export interface MonitoringDeps {
  catalog: IntegrationCatalog;
  signals: SignalReader;
  model: ModelClient;
  actions: ActionRunner;
  findings: FindingRepository;
  approvals: ApprovalRepository;
  threads: ThreadRepository;
  audit: AuditLog;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  statuses: MonitorStatusBook;
  /** Records a write proposed by an agent. */
  propose: (input: ProposalInput) => ApprovalRequest;
  approvers: Approvers;
}

export interface TickResult {
  status: TickStatus;
  finding?: Finding;
}

/** What one reading of a signal found: nothing, or a trigger for the agent. */
type Observation = { kind: "healthy"; status: TickStatus } | Trigger;

/**
 * Runs monitors. A healthy tick is only recorded as a status. A breach or an unreadable
 * signal opens a finding, starts the agent, and writes the agent's thread.
 */
export class MonitoringService {
  constructor(private readonly deps: MonitoringDeps) {}

  async tick(integrationId: string, monitorId: string): Promise<TickResult> {
    const key = monitorKey(integrationId, monitorId);
    try {
      const result = await this.check(integrationId, monitorId);
      this.deps.statuses.set(key, result.status);
      return result;
    } catch (err) {
      const status: TickStatus = { lastRunAt: this.now().toISOString(), state: "error", error: (err as Error).message };
      this.deps.statuses.set(key, status);
      this.deps.audit.append({ at: status.lastRunAt, actor: "system", event: "monitor.error", subject: key, detail: { error: status.error } });
      throw err;
    }
  }

  /** Closes an issue. Its thread and audit trail stay in place. */
  resolve(findingId: string, user: string): Finding {
    requireActor(user);
    this.deps.approvers.require(user);
    return this.deps.uow.run(() => {
      const current = this.deps.findings.get(findingId);
      if (!current) throw new DomainError(`finding "${findingId}" not found`, "not-found");
      const next = resolveFinding(current);
      this.deps.findings.save(next);
      this.deps.audit.append({ at: this.now().toISOString(), actor: user, event: "finding.resolved", subject: findingId, detail: {} });
      return next;
    });
  }

  private async check(integrationId: string, monitorId: string): Promise<TickResult> {
    const record = this.deps.catalog.find(integrationId);
    const monitor = record?.integration.monitors.find((m) => m.id === monitorId);
    if (!record || !monitor) throw new DomainError(`unknown monitor "${integrationId}/${monitorId}"`, "not-found");
    const signal = record.integration.signals.find((s) => s.id === monitor.signal);
    if (!signal) throw new DomainError(`monitor "${monitor.id}" references unknown signal "${monitor.signal}"`, "bad-input");

    const started = this.now();
    const observation = await this.observe(signal, monitor, started);
    if (observation.kind === "healthy") return { status: observation.status };

    const findingId = this.deps.ids.next("fnd");
    const assessment = await investigate(
      { model: this.deps.model, signals: this.deps.signals, actions: this.deps.actions, propose: this.deps.propose },
      { findingId, record, monitor, trigger: observation },
    );

    const isBreach = observation.kind === "threshold-breach";
    const finding: Finding = {
      id: findingId,
      integrationId,
      monitorId,
      monitorName: monitor.name,
      kind: observation.kind,
      severity: assessment.severity,
      status: "open",
      observedAt: started.toISOString(),
      createdAt: this.now().toISOString(),
      error: observation.kind === "signal-unavailable" ? observation.error : undefined,
      evaluation: isBreach ? observation.evaluation : undefined,
      measurement: isBreach ? observation.measurement : undefined,
      assessment,
    };
    this.persist(finding, record, assessment.pendingApprovalIds);

    const status: TickStatus = {
      lastRunAt: started.toISOString(),
      state: isBreach ? "breached" : "unavailable",
      value: finding.evaluation?.value,
      metric: finding.evaluation?.metric,
      error: finding.error,
    };
    return { status, finding };
  }

  private async observe(signal: SignalDef, monitor: MonitorDef, started: Date): Promise<Observation> {
    try {
      const reading = await this.deps.signals.read(signal);
      const measurement: Measurement = {
        signalId: signal.id,
        signalType: signal.type,
        observedAt: started.toISOString(),
        durationMs: this.now().getTime() - started.getTime(),
        metrics: reading.metrics,
        details: reading.details,
      };
      const evaluation = evaluateCondition(monitor, measurement.metrics);
      if (!evaluation.breached) {
        return { kind: "healthy", status: { lastRunAt: started.toISOString(), state: "healthy", value: evaluation.value, metric: evaluation.metric } };
      }
      return { kind: "threshold-breach", evaluation, measurement };
    } catch (err) {
      if (!(err instanceof SignalUnavailableError)) throw err;
      return { kind: "signal-unavailable", error: err.message };
    }
  }

  private persist(finding: Finding, record: IntegrationRecord, pendingApprovalIds: string[]): void {
    this.deps.uow.run(() => {
      this.deps.findings.save(finding);
      this.deps.audit.append({
        at: finding.createdAt,
        actor: `monitor:${finding.monitorId}`,
        event: "finding.opened",
        subject: finding.id,
        detail: { kind: finding.kind, severity: finding.severity, integrationId: record.integration.id },
      });
    });

    const author = `agent:${finding.monitorId}`;
    const assessment = finding.assessment;
    const incomplete = assessment && !assessment.complete ? " (investigation stopped early)" : "";
    this.post(finding.id, `${assessment?.summary ?? finding.error ?? "issue detected"}${incomplete}`, author);
    for (const approvalId of pendingApprovalIds) {
      const request = this.deps.approvals.get(approvalId);
      if (!request) continue;
      this.post(
        finding.id,
        `Proposes running "${request.actionId}": ${request.reason}. Nothing has run; it waits for your approval.`,
        author,
        approvalId,
      );
    }
  }

  private post(findingId: string, text: string, author: string, approvalId?: string): void {
    this.deps.threads.append({ findingId, role: "agent", author, text, approvalId, at: this.now().toISOString() });
  }

  private now(): Date {
    return this.deps.clock.now();
  }
}
