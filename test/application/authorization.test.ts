import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, proposeThenFinish, type Harness } from "../support/harness.js";
import { Approvers } from "../../src/domain/approvers.js";
import { DomainError } from "../../src/domain/errors.js";

const BREACH = { total: 100, serverErrors: 80, healthy: 1 };
let h: Harness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
});

async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return err instanceof DomainError ? err.code : "other";
  }
  return undefined;
}

describe("only listed approvers can change state", () => {
  test("a signed-in user who is not an approver cannot approve a write", async () => {
    h = await buildHarness({ metrics: BREACH, approvers: ["hector"] });
    await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    const [pending] = h.persistence.approvals.list({ status: "pending" });
    assert.equal(await refusalOf(h.app.approvals.approve(pending.id, "mallory")), "forbidden");
    assert.equal(h.persistence.approvals.get(pending.id)?.status, "pending");
    assert.deepEqual(h.runner.ran, []);
  });

  test("rejecting, dry-running and resolving are also limited to approvers", async () => {
    h = await buildHarness({ metrics: BREACH, approvers: ["hector"] });
    const { finding } = await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    const [pending] = h.persistence.approvals.list({ status: "pending" });
    assert.equal(await refusalOf(Promise.resolve().then(() => h!.app.approvals.reject(pending.id, "mallory"))), "forbidden");
    assert.equal(await refusalOf(h.app.approvals.dryRun(pending.id, "mallory")), "forbidden");
    assert.equal(await refusalOf(Promise.resolve().then(() => h!.app.monitoring.resolve(finding!.id, "mallory"))), "forbidden");
    assert.deepEqual(h.runner.ran, []);
  });

  test("viewing is open to any signed-in user", async () => {
    h = await buildHarness({ metrics: BREACH, approvers: ["hector"] });
    await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    assert.equal(h.app.reads.findings().length, 1);
  });

  test("approver names match regardless of letter case", () => {
    assert.equal(new Approvers(["Hector@Contoso.com"]).allows("hector@contoso.com"), true);
    assert.equal(new Approvers(["hector@contoso.com"]).allows("mallory@contoso.com"), false);
  });
});
