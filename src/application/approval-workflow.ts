import { applyApprovalEvent, actorOf, isExpiredAt, type ApprovalEvent, type ApprovalRequest, type ProposalInput } from "../domain/approval.js";
import type { Approvers } from "../domain/approvers.js";
import { DomainError } from "../domain/errors.js";
import { requireActor } from "../domain/model.js";
import type { ActionDef } from "../domain/model.js";
import type { ActionOutput, ActionRunner, ApprovalRepository, AuditLog, Clock, IdGenerator, IntegrationCatalog, IntegrationRecord, ThreadRepository, UnitOfWork } from "./ports.js";
import { clip } from "./text.js";

const APPROVAL_TTL_HOURS = 24;

export interface ApprovalWorkflowDeps {
  uow: UnitOfWork;
  approvals: ApprovalRepository;
  threads: ThreadRepository;
  audit: AuditLog;
  catalog: IntegrationCatalog;
  actions: ActionRunner;
  clock: Clock;
  ids: IdGenerator;
  approvers: Approvers;
}

/**
 * Owns every approval state change. Proposals wait here; only approve() can start a write,
 * and each transition is written with its audit entry in one unit of work.
 */
export class ApprovalWorkflow {
  constructor(private readonly deps: ApprovalWorkflowDeps) {}

  propose(input: ProposalInput): ApprovalRequest {
    return this.deps.uow.run(() => {
      const at = this.deps.clock.now();
      const request: ApprovalRequest = {
        ...input,
        id: this.deps.ids.next("apr"),
        status: "pending",
        requestedAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + APPROVAL_TTL_HOURS * 3_600_000).toISOString(),
      };
      this.deps.approvals.insert(request);
      this.audit("approval.requested", "agent", request.id, { actionId: input.actionId, reason: input.reason });
      return request;
    });
  }

  /** The user's yes. The action is checked before approval, so an approved request is always runnable. */
  async approve(approvalId: string, user: string): Promise<ApprovalRequest> {
    requireActor(user);
    this.deps.approvers.require(user);
    this.expireStale();
    const pending = this.require(approvalId);
    if (pending.status === "expired") throw new DomainError(`approval "${approvalId}" has expired`, "expired");
    const { record, action } = this.writeActionFor(pending);

    this.transition(approvalId, { type: "approve", by: user, at: this.now() });
    this.post(pending, "user", user, "Approved.");

    this.transition(approvalId, { type: "execution-started", at: this.now() });
    const output = await this.run(action, record, false);
    const done = this.transition(approvalId, {
      type: "execution-finished",
      at: this.now(),
      ok: output.exitCode === 0,
      output: outputText(output),
    });
    this.post(done, "system", "system", `"${done.actionId}" ${done.status}: ${clip(done.result ?? "")}`);
    return done;
  }

  reject(approvalId: string, user: string, reason?: string): ApprovalRequest {
    requireActor(user);
    this.deps.approvers.require(user);
    this.expireStale();
    const done = this.transition(approvalId, { type: "reject", by: user, at: this.now(), reason });
    this.post(done, "user", user, `Rejected${reason ? `: ${reason}` : "."} Nothing was run.`);
    return done;
  }

  /** Previews the action with dryRun. Does not approve anything. */
  async dryRun(approvalId: string, user: string): Promise<ActionOutput> {
    requireActor(user);
    this.deps.approvers.require(user);
    this.expireStale();
    const request = this.require(approvalId);
    if (request.status !== "pending") {
      throw new DomainError("dry-run is only available while the approval is pending", "invalid-state");
    }
    const { record, action } = this.writeActionFor(request);
    const output = await this.run(action, record, true);
    this.audit("approval.dry_run", user, approvalId, { exitCode: output.exitCode });
    this.post(request, "system", user, `Dry run of "${request.actionId}" (exit ${output.exitCode}): ${clip(output.stdout || output.stderr)}`);
    return output;
  }

  /** Moves pending requests past their expiry to expired. Runs before every decision. */
  /**
   * Run once at startup. An approval still "executing" was interrupted by a crash, so whether the
   * write ran is unknown. It is failed for review and never retried automatically.
   */
  recoverStranded(): number {
    return this.deps.uow.run(() => {
      const at = this.now();
      const stranded = this.deps.approvals.list({ status: "executing" });
      for (const request of stranded) {
        const next = applyApprovalEvent(request, {
          type: "execution-finished",
          at,
          ok: false,
          output: "interrupted before completion; review before retrying",
        });
        this.deps.approvals.replace(next, "executing");
        this.post(next, "system", "system", `"${next.actionId}" was interrupted by a restart; check the target before retrying.`);
        this.audit("approval.failed", "system", request.id, { reason: "interrupted" });
      }
      return stranded.length;
    });
  }

  expireStale(): number {
    return this.deps.uow.run(() => {
      const at = this.now();
      const stale = this.deps.approvals.list({ status: "pending" }).filter((r) => isExpiredAt(r, at));
      for (const request of stale) {
        const next = applyApprovalEvent(request, { type: "expire", at });
        this.deps.approvals.replace(next, request.status);
        this.audit("approval.expired", "system", request.id, {});
      }
      return stale.length;
    });
  }

  private transition(approvalId: string, event: ApprovalEvent): ApprovalRequest {
    return this.deps.uow.run(() => {
      const current = this.require(approvalId);
      const next = applyApprovalEvent(current, event);
      if (!this.deps.approvals.replace(next, current.status)) {
        throw new DomainError(`approval "${approvalId}" changed while being updated`, "conflict");
      }
      this.audit(`approval.${next.status}`, actorOf(event), approvalId, { actionId: next.actionId, result: next.result });
      return next;
    });
  }

  private async run(action: ActionDef, record: IntegrationRecord, dryRun: boolean): Promise<ActionOutput> {
    try {
      return await this.deps.actions.run(action, record.location, { dryRun });
    } catch (err) {
      return { exitCode: -1, stdout: "", stderr: (err as Error).message };
    }
  }

  private writeActionFor(request: ApprovalRequest): { record: IntegrationRecord; action: ActionDef } {
    const record = this.deps.catalog.find(request.integrationId);
    const action = record?.integration.actions.find((a) => a.id === request.actionId);
    if (!record || !action) {
      throw new DomainError(`approval "${request.id}" refers to an unknown action`, "not-found");
    }
    if (action.risk !== "write") {
      throw new DomainError(`approval "${request.id}" refers to an action that is not a write action`, "bad-input");
    }
    return { record, action };
  }

  private require(approvalId: string): ApprovalRequest {
    const request = this.deps.approvals.get(approvalId);
    if (!request) throw new DomainError(`approval "${approvalId}" not found`, "not-found");
    return request;
  }

  private post(request: ApprovalRequest, role: "user" | "system", author: string, text: string): void {
    this.deps.threads.append({
      findingId: request.findingId,
      role,
      author,
      text,
      approvalId: request.id,
      at: this.now().toISOString(),
    });
  }

  private audit(event: string, actor: string, subject: string, detail: unknown): void {
    this.deps.audit.append({ at: this.now().toISOString(), actor, event, subject, detail });
  }

  private now(): Date {
    return this.deps.clock.now();
  }
}

function outputText(output: ActionOutput): string {
  return output.exitCode === 0 ? output.stdout : `exit ${output.exitCode}: ${output.stderr || output.stdout}`;
}
