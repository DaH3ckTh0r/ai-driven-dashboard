import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigValidationError, loadIntegrationRecords, parseDocument, validateIntegration } from "../../src/infrastructure/config/loader.js";
import { EXAMPLES, ENV } from "../support/harness.js";

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "demo-api",
    name: "Demo",
    owner: "team",
    signals: [{ id: "probe", type: "http-health", url: "https://example.com/health" }],
    actions: [],
    monitors: [{ id: "demo-down", name: "Down", signal: "probe", metric: "healthy", operator: "eq", threshold: 0, severity: "critical" }],
    ...overrides,
  };
}

function problemsOf(raw: unknown, env: NodeJS.ProcessEnv = {}): string[] {
  try {
    validateIntegration(raw, "f.yaml", env);
  } catch (err) {
    if (err instanceof ConfigValidationError) return err.problems.map((p) => `${p.path}: ${p.message}`);
    throw err;
  }
  return [];
}

test("the example integration loads, applies defaults and maps to the domain shape", async () => {
  const [record] = await loadIntegrationRecords(EXAMPLES, { env: ENV });
  const { integration } = record;
  assert.equal(integration.id, "orders-api");
  assert.equal(integration.monitors[0].agent.maxSteps, 8);
  const probe = integration.signals.find((s) => s.id === "orders-health");
  assert.ok(probe && probe.type === "http-health");
  assert.deepEqual(probe.expectStatus, [200]);
  assert.equal(integration.actions.find((a) => a.id === "fetch-failed-sample")?.requiresConfirmation, false);
});

test("missing environment variables are reported together", () => {
  const raw = parseDocument(
    `id: x-api
name: X
owner: t
signals:
  - id: a
    type: service-bus
    namespace: \${MISSING_ONE}
    queueName: q
  - id: b
    type: log-analytics
    workspaceId: \${MISSING_TWO}
    kql: "print 1"
`,
    "x.yaml",
  );
  const problems = problemsOf(raw, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MISSING_ONE, MISSING_TWO/);
});

test("write actions must require confirmation", () => {
  const problems = problemsOf(base({ actions: [{ id: "fix", description: "d", risk: "write", script: "s.ts", requiresConfirmation: false }] }));
  assert.ok(problems.some((p) => p.startsWith("actions.0.requiresConfirmation")), problems.join("\n"));
});

test("monitors must reference an existing signal and existing actions", () => {
  const problems = problemsOf(
    base({
      monitors: [
        { id: "m1", name: "m", signal: "nope", metric: "x", operator: "gt", threshold: 1, severity: "low", agent: { actions: ["ghost"] } },
      ],
    }),
  );
  assert.ok(problems.some((p) => p.includes("unknown signal")));
  assert.ok(problems.some((p) => p.includes("unknown action")));
});

test("duplicate ids within an integration are rejected", () => {
  const problems = problemsOf(
    base({
      signals: [
        { id: "probe", type: "http-health", url: "https://a.example.com" },
        { id: "probe", type: "http-health", url: "https://b.example.com" },
      ],
    }),
  );
  assert.ok(problems.some((p) => p.includes('duplicate signal id "probe"')));
});

test("unknown fields and unsupported signal types are rejected", () => {
  assert.ok(problemsOf(base({ signals: [{ id: "probe", type: "carrier-pigeon", url: "https://a.example.com", extra: 1 }] })).length > 0);
});

test("scripts outside the integration folder and missing scripts are reported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "im-"));
  try {
    await mkdir(join(dir, "bad-api"));
    await writeFile(
      join(dir, "bad-api", "integration.yaml"),
      `id: bad-api
name: Bad
owner: t
signals:
  - id: probe
    type: http-health
    url: https://example.com
actions:
  - id: up
    description: up
    risk: read
    script: ../outside.ts
  - id: gone
    description: gone
    risk: read
    script: scripts/missing.ts
`,
    );
    await assert.rejects(loadIntegrationRecords(dir, { env: ENV }), (err: unknown) => {
      assert.ok(err instanceof ConfigValidationError);
      const messages = err.problems.map((p) => p.message).join("\n");
      assert.match(messages, /inside the integration folder/);
      assert.match(messages, /does not exist/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("integration and monitor ids must be unique across folders", async () => {
  const dir = await mkdtemp(join(tmpdir(), "im-"));
  try {
    const doc = `id: same-api
name: Same
owner: t
signals:
  - id: probe
    type: http-health
    url: https://example.com
monitors:
  - id: shared-monitor
    name: m
    signal: probe
    metric: healthy
    operator: eq
    threshold: 0
    severity: low
`;
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    await writeFile(join(dir, "a", "integration.yaml"), doc);
    await writeFile(join(dir, "b", "integration.yaml"), doc);
    await assert.rejects(loadIntegrationRecords(dir, { env: ENV }), (err: unknown) => {
      assert.ok(err instanceof ConfigValidationError);
      const messages = err.problems.map((p) => p.message).join("\n");
      assert.match(messages, /integration id "same-api" is already used/);
      assert.match(messages, /monitor id "shared-monitor" is already used/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed YAML is reported as a config problem", () => {
  assert.throws(() => parseDocument("id: [unclosed", "broken.yaml"), ConfigValidationError);
});
