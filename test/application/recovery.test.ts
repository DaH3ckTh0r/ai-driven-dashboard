import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, type Harness } from "../support/harness.js";

const BREACH = { total: 100, serverErrors: 80, healthy: 1 };
let h: Harness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
});

describe("restart recovery", () => {
  test("an approval left executing by a crash is marked failed and never re-run", async () => {
    h = await buildHarness({ metrics: BREACH });
    await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    const [pending] = h.persistence.approvals.list({ status: "pending" });
    h.persistence.approvals.replace({ ...pending, status: "executing" }, "pending");

    const recovered = h.app.approvals.recoverStranded();

    assert.equal(recovered, 1);
    const after = h.persistence.approvals.get(pending.id);
    assert.equal(after?.status, "failed");
    assert.match(after?.result ?? "", /interrupted/);
    assert.deepEqual(h.runner.ran, []);
    assert.ok(h.app.reads.audit(50).some((e) => e.event === "approval.failed" && e.subject === pending.id));
  });

  test("recovery leaves pending and finished approvals alone", async () => {
    h = await buildHarness({ metrics: BREACH });
    await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    assert.equal(h.app.approvals.recoverStranded(), 0);
    assert.equal(h.persistence.approvals.list({ status: "pending" }).length, 1);
  });
});
