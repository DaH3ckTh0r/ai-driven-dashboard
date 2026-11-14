import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, type Harness } from "../support/harness.js";
import type { GroupDef } from "../../src/domain/model.js";

const BREACH = { total: 100, serverErrors: 80, healthy: 1 };
const HEALTHY = { total: 100, serverErrors: 0, healthy: 1 };
const CHECKOUT: GroupDef = {
  id: "checkout",
  name: "Checkout",
  description: "",
  owner: "payments",
  monitors: ["orders-api/orders-down", "orders-api/orders-5xx-spike"],
};

let h: Harness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
});

describe("groups roll up their monitors", () => {
  test("a group lists its members, with no open issues while they are healthy", async () => {
    h = await buildHarness({ metrics: HEALTHY, groups: [CHECKOUT] });
    await h.app.monitoring.tick("orders-api", "orders-down");
    await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    const [group] = h.app.reads.groups();
    assert.equal(group.group.id, "checkout");
    assert.equal(group.group.name, "Checkout");
    assert.equal(group.group.owner, "payments");
    assert.deepEqual(group.members.map((m) => m.monitor.id).sort(), ["orders-5xx-spike", "orders-down"]);
    assert.equal(group.openIssues, 0);
    assert.equal(group.worstSeverity, null);
  });

  test("an open issue in a member raises the count and the worst severity of the group", async () => {
    h = await buildHarness({ metrics: BREACH, groups: [CHECKOUT] });
    await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    const [group] = h.app.reads.groups();
    assert.equal(group.openIssues, 1);
    assert.equal(group.worstSeverity, "high");
  });

  test("resolving the issue clears the group again", async () => {
    h = await buildHarness({ metrics: BREACH, groups: [CHECKOUT] });
    const { finding } = await h.app.monitoring.tick("orders-api", "orders-5xx-spike");
    h.app.monitoring.resolve(finding!.id, "hector");
    const [group] = h.app.reads.groups();
    assert.equal(group.openIssues, 0);
    assert.equal(group.worstSeverity, null);
  });

  test("groups are empty when none are configured", async () => {
    h = await buildHarness({ metrics: HEALTHY });
    assert.deepEqual(h.app.reads.groups(), []);
  });
});

describe("monitor tags", () => {
  test("monitors can be filtered by tag", async () => {
    h = await buildHarness({ metrics: HEALTHY });
    const critical = h.app.reads.monitors("critical-path").map((e) => e.monitor.id);
    assert.deepEqual(critical, ["orders-down"]);
  });

  test("without a tag every monitor is returned", async () => {
    h = await buildHarness({ metrics: HEALTHY });
    assert.equal(h.app.reads.monitors().length, 3);
  });

  test("an unknown tag returns no monitors", async () => {
    h = await buildHarness({ metrics: HEALTHY });
    assert.deepEqual(h.app.reads.monitors("no-such-tag"), []);
  });
});
