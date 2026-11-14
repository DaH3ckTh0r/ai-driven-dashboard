import { DomainError } from "./errors.js";
import { requireActor } from "./model.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "executing" | "executed" | "failed";

export interface ApprovalRequest {
  id: string;
  findingId: string;
  integrationId: string;
  monitorId: string;
  actionId: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: string;
  result?: string;
}

export interface ProposalInput {
  findingId: string;
  integrationId: string;
  monitorId: string;
  actionId: string;
  reason: string;
}

export type ApprovalEvent =
  | { type: "approve"; by: string; at: Date }
  | { type: "reject"; by: string; at: Date; reason?: string }
  | { type: "expire"; at: Date }
  | { type: "execution-started"; at: Date }
  | { type: "execution-finished"; at: Date; ok: boolean; output: string };

export function isExpiredAt(request: ApprovalRequest, at: Date): boolean {
  return new Date(request.expiresAt) <= at;
}

/**
 * The approval state machine. Pure: returns the next state or throws.
 *   pending -> approved | rejected | expired
 *   approved -> executing -> executed | failed
 * Nothing executes unless it has passed through `approved`.
 */
export function applyApprovalEvent(request: ApprovalRequest, event: ApprovalEvent): ApprovalRequest {
  switch (event.type) {
    case "approve": {
      expectStatus(request, "pending", "approved");
      requireActor(event.by);
      rejectIfExpired(request, event.at);
      return { ...request, status: "approved", decidedBy: event.by, decidedAt: event.at.toISOString() };
    }
    case "reject": {
      expectStatus(request, "pending", "rejected");
      requireActor(event.by);
      rejectIfExpired(request, event.at);
      return {
        ...request,
        status: "rejected",
        decidedBy: event.by,
        decidedAt: event.at.toISOString(),
        result: event.reason,
      };
    }
    case "expire": {
      expectStatus(request, "pending", "expired");
      if (!isExpiredAt(request, event.at)) {
        throw new DomainError(`approval "${request.id}" has not expired yet`, "invalid-state");
      }
      return { ...request, status: "expired" };
    }
    case "execution-started": {
      expectStatus(request, "approved", "executing");
      return { ...request, status: "executing" };
    }
    case "execution-finished": {
      const to = event.ok ? "executed" : "failed";
      expectStatus(request, "executing", to);
      return { ...request, status: to, result: event.output };
    }
  }
}

/** The actor recorded in the audit log for an event. */
export function actorOf(event: ApprovalEvent): string {
  return "by" in event ? event.by : "system";
}

function expectStatus(request: ApprovalRequest, from: ApprovalStatus, to: ApprovalStatus): void {
  if (request.status !== from) {
    throw new DomainError(
      `approval "${request.id}" is ${request.status}; expected ${from} to move to ${to}`,
      "invalid-state",
    );
  }
}

function rejectIfExpired(request: ApprovalRequest, at: Date): void {
  if (isExpiredAt(request, at)) throw new DomainError(`approval "${request.id}" has expired`, "expired");
}
