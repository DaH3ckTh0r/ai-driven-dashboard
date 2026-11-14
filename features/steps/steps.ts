import { Before, After, Given, When, Then, setWorldConstructor, World } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { buildHarness, type Harness } from "../../test/support/harness.js";
import { DomainError } from "../../src/domain/errors.js";
import type { Finding } from "../../src/domain/model.js";

const BREACH = { total: 100, serverErrors: 80, healthy: 1 };
const HEALTHY = { total: 100, serverErrors: 3, healthy: 1 };
const MONITOR = ["orders-api", "orders-5xx-spike"] as const;

export class MonitorWorld extends World {
  h!: Harness;
  finding?: Finding;
  approvalId?: string;
  refusal?: string;
}
setWorldConstructor(MonitorWorld);

Before(async function (this: MonitorWorld) {
  this.h = await buildHarness({ metrics: BREACH });
});

After(function (this: MonitorWorld) {
  this.h.close();
});

async function attempt(world: MonitorWorld, fn: () => Promise<unknown> | unknown): Promise<void> {
  world.refusal = undefined;
  try {
    await fn();
  } catch (err) {
    world.refusal = err instanceof DomainError ? err.code : "other";
  }
}

// Given: signals
Given("the orders-5xx-spike signal is breaching", function (this: MonitorWorld) {
  this.h.signals.set({ metrics: BREACH });
});
Given("the signal reads healthy", function (this: MonitorWorld) {
  this.h.signals.set({ metrics: HEALTHY });
});
Given("the signal cannot be read", function (this: MonitorWorld) {
  this.h.signals.set(new Error("connection refused"));
});

// Given: approvals
Given("the monitor has run and proposed a write", async function (this: MonitorWorld) {
  this.finding = (await this.h.app.monitoring.tick(...MONITOR)).finding;
  this.approvalId = this.h.persistence.approvals.list({ status: "pending" })[0]?.id;
  assert.ok(this.approvalId, "expected a pending proposal");
});
Given("{string} has approved the proposal", async function (this: MonitorWorld, user: string) {
  await this.h.app.approvals.approve(this.approvalId!, user);
});
Given("the approval was interrupted mid-run", function (this: MonitorWorld) {
  const current = this.h.persistence.approvals.get(this.approvalId!)!;
  this.h.persistence.approvals.replace({ ...current, status: "executing" }, "pending");
});

// When
When("the monitor runs", async function (this: MonitorWorld) {
  this.finding = (await this.h.app.monitoring.tick(...MONITOR)).finding;
});
When("{string} approves the proposal", async function (this: MonitorWorld, user: string) {
  await attempt(this, () => this.h.app.approvals.approve(this.approvalId!, user));
});
When("{string} rejects the proposal", function (this: MonitorWorld, user: string) {
  this.h.app.approvals.reject(this.approvalId!, user);
});
When("the request is past its 24-hour window", function (this: MonitorWorld) {
  this.h.clock.advance(25 * 3_600_000);
});
When("the service restarts", function (this: MonitorWorld) {
  this.h.app.approvals.recoverStranded();
});

// Then: monitoring
Then("no finding is opened", function (this: MonitorWorld) {
  assert.equal(this.h.app.reads.findings().length, 0);
});
Then("a finding is opened", function (this: MonitorWorld) {
  assert.ok(this.finding);
  assert.equal(this.h.app.reads.findings().length, 1);
});
Then("the agent is called", function (this: MonitorWorld) {
  assert.ok(this.h.model.calls > 0);
});
Then("the agent is not called", function (this: MonitorWorld) {
  assert.equal(this.h.model.calls, 0);
});
Then("the finding is an unavailable signal", function (this: MonitorWorld) {
  assert.equal(this.finding?.kind, "signal-unavailable");
});

// Then: approvals
Then("a write proposal for {string} is pending", function (this: MonitorWorld, actionId: string) {
  const pending = this.h.persistence.approvals.list({ status: "pending" });
  assert.ok(pending.some((p) => p.actionId === actionId), `no pending proposal for ${actionId}`);
  this.approvalId = pending.find((p) => p.actionId === actionId)!.id;
});
Then("nothing has run", function (this: MonitorWorld) {
  assert.deepEqual(this.h.runner.ran, []);
});
Then("the write {string} has run once", function (this: MonitorWorld, actionId: string) {
  assert.deepEqual(this.h.runner.ran, [actionId]);
});
Then("the approval status is {string}", function (this: MonitorWorld, status: string) {
  assert.equal(this.h.persistence.approvals.get(this.approvalId!)?.status, status);
});
Then("the attempt is refused as {string}", function (this: MonitorWorld, code: string) {
  assert.equal(this.refusal, code);
});
Then("the audit log records {string} by {string}", function (this: MonitorWorld, event: string, actor: string) {
  assert.ok(this.h.app.reads.audit(100).some((e) => e.event === event && e.actor === actor));
});
