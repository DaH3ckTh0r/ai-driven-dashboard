import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, type Harness } from "../support/harness.js";
import { DomainError } from "../../src/domain/errors.js";

const HEALTHY = { total: 100, serverErrors: 0, healthy: 1 };
const FIELDS = { name: "Checkout", owner: "payments", description: "Cart to confirmation", monitors: ["orders-api/orders-down"] };

let h: Harness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
});

async function refusalOf(action: () => unknown): Promise<string | undefined> {
  try {
    await action();
  } catch (err) {
    return err instanceof DomainError ? err.code : `other: ${String(err)}`;
  }
  return undefined;
}

describe("approvers manage groups in the database", () => {
  test("an approver creates a group, and the read model shows it with its members", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    const created = h.app.groups.create({ id: "checkout", ...FIELDS }, "hector");
    assert.equal(created.id, "checkout");
    const [entry] = h.app.reads.groups();
    assert.equal(entry.group.name, "Checkout");
    assert.equal(entry.group.owner, "payments");
    assert.deepEqual(entry.members.map((m) => `${m.record.integration.id}/${m.monitor.id}`), ["orders-api/orders-down"]);
  });

  test("an approver can change a group's name and members, and delete it", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    h.app.groups.create({ id: "checkout", ...FIELDS }, "hector");
    h.app.groups.update("checkout", { ...FIELDS, name: "Checkout v2", monitors: ["orders-api/orders-5xx-spike"] }, "hector");
    const [renamed] = h.app.reads.groups();
    assert.equal(renamed.group.name, "Checkout v2");
    assert.deepEqual(renamed.members.map((m) => m.monitor.id), ["orders-5xx-spike"]);
    h.app.groups.remove("checkout", "hector");
    assert.deepEqual(h.app.reads.groups(), []);
  });

  test("people who are not approvers cannot create, change or delete groups", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    assert.equal(await refusalOf(() => h!.app.groups.create({ id: "checkout", ...FIELDS }, "mallory")), "forbidden");
    h.app.groups.create({ id: "checkout", ...FIELDS }, "hector");
    assert.equal(await refusalOf(() => h!.app.groups.update("checkout", FIELDS, "mallory")), "forbidden");
    assert.equal(await refusalOf(() => h!.app.groups.remove("checkout", "mallory")), "forbidden");
    assert.equal(h.app.reads.groups().length, 1);
  });

  test("a group can only name monitors that exist, and the refusal names them", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    const refused = await refusalOf(() => h!.app.groups.create({ id: "checkout", ...FIELDS, monitors: ["orders-api/nope"] }, "hector"));
    assert.equal(refused, "bad-input");
    assert.throws(() => h!.app.groups.create({ id: "checkout", ...FIELDS, monitors: ["orders-api/nope"] }, "hector"), /orders-api\/nope/);
    assert.deepEqual(h.app.reads.groups(), []);
  });

  test("a group needs at least one monitor", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    assert.equal(await refusalOf(() => h!.app.groups.create({ id: "checkout", ...FIELDS, monitors: [] }, "hector")), "bad-input");
  });

  test("ids are well formed and unique", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    assert.equal(await refusalOf(() => h!.app.groups.create({ id: "Bad Id", ...FIELDS }, "hector")), "bad-input");
    h.app.groups.create({ id: "checkout", ...FIELDS }, "hector");
    assert.equal(await refusalOf(() => h!.app.groups.create({ id: "checkout", ...FIELDS }, "hector")), "conflict");
  });

  test("every change is audited with its actor", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    h.app.groups.create({ id: "checkout", ...FIELDS }, "hector");
    h.app.groups.update("checkout", { ...FIELDS, name: "Renamed" }, "hector");
    h.app.groups.remove("checkout", "hector");
    const events = h.persistence.audit.list({ subject: "checkout", limit: 10 });
    assert.deepEqual(events.map((e) => e.event).sort(), ["group.created", "group.deleted", "group.updated"]);
    assert.ok(events.every((e) => e.actor === "hector"));
  });
});

describe("groups.yaml seeds the database without overwriting edits", () => {
  test("seeding adds missing groups only, so a later edit in the UI is kept", async () => {
    h = await buildHarness({ metrics: HEALTHY, approvers: ["hector"] });
    h.app.groups.seedFromFile([{ id: "checkout", name: "From file", description: "", monitors: ["orders-api/orders-down"] }]);
    h.app.groups.update("checkout", { ...FIELDS, name: "Edited in the UI" }, "hector");
    h.app.groups.seedFromFile([{ id: "checkout", name: "From file again", description: "", monitors: ["orders-api/orders-down"] }]);
    assert.equal(h.app.reads.groups()[0].group.name, "Edited in the UI");
  });
});
