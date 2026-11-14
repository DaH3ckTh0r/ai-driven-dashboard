import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, proposeThenFinish, toolCall, type Harness } from "../support/harness.js";
import { DomainError } from "../../src/domain/errors.js";

const BREACH = { total: 100, serverErrors: 80, healthy: 1 };
const HEALTHY = { total: 100, serverErrors: 3, healthy: 1 };
const MONITOR = ["orders-api", "orders-5xx-spike"] as const;

let h: Harness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
});

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return err instanceof DomainError ? err.code : "other";
  }
  return undefined;
}

describe("monitoring", () => {
  test("a healthy reading records status only and never calls the agent", async () => {
    h = await buildHarness({ metrics: HEALTHY });
    const result = await h.app.monitoring.tick(...MONITOR);
    assert.equal(result.finding, undefined);
    assert.equal(result.status.state, "healthy");
    assert.equal(h.model.calls, 0);
    assert.equal(h.app.reads.findings().length, 0);
  });

  test("a breach opens a finding with the agent's assessment and a pending write, but runs nothing", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { finding } = await h.app.monitoring.tick(...MONITOR);
    assert.ok(finding);
    assert.equal(finding.assessment?.decision, "needs_approval");
    assert.equal(h.app.reads.findings()[0].id, finding.id);
    assert.equal(h.persistence.approvals.list({ status: "pending" }).length, 1);
    assert.deepEqual(h.runner.ran, []);
  });

  test("an unreadable signal opens a finding instead of crashing the monitor", async () => {
    h = await buildHarness({ signals: new Error("connection refused") });
    const { finding } = await h.app.monitoring.tick(...MONITOR);
    assert.ok(finding);
    assert.equal(finding.kind, "signal-unavailable");
    assert.match(finding.error ?? "", /connection refused/);
  });

  test("an act_now decision is downgraded to needs_approval when a write is pending", async () => {
    h = await buildHarness({
      metrics: BREACH,
      replies: [
        toolCall("propose_write_action", { action_id: "reprocess-dlq", reason: "replay" }),
        toolCall("finish", { summary: "spike", decision: "act_now" }),
      ],
    });
    const { finding } = await h.app.monitoring.tick(...MONITOR);
    assert.equal(finding?.assessment?.decision, "needs_approval");
  });

  test("a failed tick is recorded as an error and rethrown", async () => {
    h = await buildHarness({ metrics: BREACH });
    assert.equal(await codeOf(h.app.monitoring.tick("orders-api", "no-such-monitor")), "not-found");
    const audit = h.app.reads.audit(20);
    assert.ok(audit.some((e) => e.event === "monitor.error"));
  });
});

describe("approvals", () => {
  async function withPendingWrite(): Promise<{ approvalId: string }> {
    const { finding } = await h!.app.monitoring.tick(...MONITOR);
    const [pending] = h!.persistence.approvals.list({ status: "pending" });
    assert.equal(pending.findingId, finding?.id);
    return { approvalId: pending.id };
  }

  test("nothing runs until a named user approves, then the write runs once", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { approvalId } = await withPendingWrite();
    assert.deepEqual(h.runner.ran, []);
    const done = await h.app.approvals.approve(approvalId, "hector");
    assert.equal(done.status, "executed");
    assert.equal(done.decidedBy, "hector");
    assert.deepEqual(h.runner.ran, ["reprocess-dlq"]);
    assert.ok(h.app.reads.audit(50).some((e) => e.event === "approval.approved" && e.actor === "hector"));
  });

  test("a second approval of the same request is refused and does not run the write again", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { approvalId } = await withPendingWrite();
    await h.app.approvals.approve(approvalId, "hector");
    assert.equal(await codeOf(h.app.approvals.approve(approvalId, "hector")), "invalid-state");
    assert.deepEqual(h.runner.ran, ["reprocess-dlq"]);
  });

  test("approval needs a named user", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { approvalId } = await withPendingWrite();
    assert.equal(await codeOf(h.app.approvals.approve(approvalId, "  ")), "bad-input");
    assert.deepEqual(h.runner.ran, []);
  });

  test("a rejected request never runs", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { approvalId } = await withPendingWrite();
    h.app.approvals.reject(approvalId, "hector", "not now");
    assert.equal(h.persistence.approvals.get(approvalId)?.status, "rejected");
    assert.equal(await codeOf(h.app.approvals.approve(approvalId, "hector")), "invalid-state");
    assert.deepEqual(h.runner.ran, []);
  });

  test("a request past its deadline expires and cannot be approved", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { approvalId } = await withPendingWrite();
    h.clock.advance(25 * 3_600_000);
    assert.equal(await codeOf(h.app.approvals.approve(approvalId, "hector")), "expired");
    assert.equal(h.persistence.approvals.get(approvalId)?.status, "expired");
    assert.deepEqual(h.runner.ran, []);
  });

  test("a dry run executes in dry mode and leaves the request pending", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { approvalId } = await withPendingWrite();
    await h.app.approvals.dryRun(approvalId, "hector");
    assert.deepEqual(h.runner.ran, ["reprocess-dlq:dry"]);
    assert.equal(h.persistence.approvals.get(approvalId)?.status, "pending");
  });

  test("a write action that is not in the agent's list cannot be proposed", async () => {
    h = await buildHarness({
      metrics: BREACH,
      replies: [
        toolCall("propose_write_action", { action_id: "fetch-failed-sample", reason: "try" }),
        toolCall("finish", { summary: "s", decision: "needs_approval" }),
      ],
    });
    await h.app.monitoring.tick(...MONITOR);
    assert.equal(h.persistence.approvals.list().length, 0);
    assert.deepEqual(h.runner.ran, []);
  });
});

describe("persistence", () => {
  test("a unit of work that fails part-way leaves no partial writes", async () => {
    h = await buildHarness({ metrics: BREACH });
    const { finding } = await h.app.monitoring.tick(...MONITOR);
    assert.ok(finding);
    assert.throws(() =>
      h!.persistence.uow.run(() => {
        h!.persistence.findings.save({ ...finding, status: "resolved" });
        throw new Error("boom");
      }),
    );
    assert.equal(h.persistence.findings.get(finding.id)?.status, "open");
  });

  test("a stale approval update is rejected when another writer already moved it", async () => {
    h = await buildHarness({ metrics: BREACH });
    await h.app.monitoring.tick(...MONITOR);
    const [pending] = h.persistence.approvals.list({ status: "pending" });
    const won = h.persistence.approvals.replace({ ...pending, status: "rejected", decidedBy: "a" }, "pending");
    const lost = h.persistence.approvals.replace({ ...pending, status: "rejected", decidedBy: "b" }, "pending");
    assert.equal(won, true);
    assert.equal(lost, false);
  });

  test("the audit log is append-only from the application's point of view", async () => {
    h = await buildHarness({ metrics: BREACH });
    await h.app.monitoring.tick(...MONITOR);
    const before = h.app.reads.audit(100).length;
    h.app.monitoring.resolve(h.app.reads.findings()[0].id, "hector");
    assert.equal(h.app.reads.audit(100).length, before + 1);
  });
});
