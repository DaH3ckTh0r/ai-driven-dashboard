import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition } from "../../src/domain/evaluate.js";
import { applyApprovalEvent, actorOf, type ApprovalRequest } from "../../src/domain/approval.js";
import { DomainError } from "../../src/domain/errors.js";
import { requireActor, resolveFinding, type Finding } from "../../src/domain/model.js";

const at = new Date("2026-11-13T12:00:00Z");
const pending: ApprovalRequest = {
  id: "apr-1",
  findingId: "fnd-1",
  integrationId: "orders-api",
  monitorId: "orders-5xx-spike",
  actionId: "reprocess-dlq",
  reason: "replay",
  requestedAt: at.toISOString(),
  expiresAt: new Date(at.getTime() + 24 * 3_600_000).toISOString(),
  status: "pending",
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : "other";
  }
  return undefined;
}

describe("evaluateCondition", () => {
  const monitor = { id: "m", metric: "serverErrors", operator: "gt" as const, threshold: 50 };

  test("compares the metric with the condition", () => {
    assert.equal(evaluateCondition(monitor, { serverErrors: 51 }).breached, true);
    assert.equal(evaluateCondition(monitor, { serverErrors: 50 }).breached, false);
  });

  test("a missing metric is a bad-input error that names what was produced", () => {
    assert.equal(codeOf(() => evaluateCondition(monitor, { total: 1 })), "bad-input");
  });
});

describe("approval state machine", () => {
  test("approve then execute is the only path to executed", () => {
    const approved = applyApprovalEvent(pending, { type: "approve", by: "hector", at });
    assert.equal(approved.status, "approved");
    const executing = applyApprovalEvent(approved, { type: "execution-started", at });
    const done = applyApprovalEvent(executing, { type: "execution-finished", at, ok: true, output: "ok" });
    assert.equal(done.status, "executed");
    assert.equal(done.decidedBy, "hector");
  });

  test("cannot execute without approval", () => {
    assert.equal(codeOf(() => applyApprovalEvent(pending, { type: "execution-started", at })), "invalid-state");
  });

  test("cannot approve twice", () => {
    const approved = applyApprovalEvent(pending, { type: "approve", by: "hector", at });
    assert.equal(codeOf(() => applyApprovalEvent(approved, { type: "approve", by: "hector", at })), "invalid-state");
  });

  test("an expired request cannot be approved", () => {
    const late = new Date(at.getTime() + 25 * 3_600_000);
    assert.equal(codeOf(() => applyApprovalEvent(pending, { type: "approve", by: "hector", at: late })), "expired");
  });

  test("expiry only applies once the deadline has passed", () => {
    assert.equal(codeOf(() => applyApprovalEvent(pending, { type: "expire", at })), "invalid-state");
    const late = new Date(at.getTime() + 25 * 3_600_000);
    assert.equal(applyApprovalEvent(pending, { type: "expire", at: late }).status, "expired");
  });

  test("approval needs a named user", () => {
    assert.equal(codeOf(() => applyApprovalEvent(pending, { type: "approve", by: " ", at })), "bad-input");
  });

  test("the audit actor is the user for decisions and the system otherwise", () => {
    assert.equal(actorOf({ type: "approve", by: "hector", at }), "hector");
    assert.equal(actorOf({ type: "execution-started", at }), "system");
  });
});

describe("finding and actor rules", () => {
  const finding = { id: "f", status: "open" } as Finding;

  test("a finding resolves once", () => {
    const resolved = resolveFinding(finding);
    assert.equal(resolved.status, "resolved");
    assert.equal(codeOf(() => resolveFinding(resolved)), "invalid-state");
  });

  test("requireActor rejects blank users", () => {
    assert.equal(requireActor("hector"), "hector");
    assert.equal(codeOf(() => requireActor("")), "bad-input");
  });
});
