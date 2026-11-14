import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigValidationError, loadGroups, loadIntegrationRecords, validateIntegration } from "../../src/infrastructure/config/loader.js";

/** Writes a temporary integrations root from a map of relative path to file content. */
async function integrationsRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "groups-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

function integrationYaml(id: string, monitorId: string, tags: string[] = []): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    "owner: team",
    "signals:",
    "  - id: probe",
    "    type: http-health",
    "    url: https://example.com/health",
    "monitors:",
    `  - id: ${monitorId}`,
    `    name: ${monitorId}`,
    "    signal: probe",
    "    metric: healthy",
    "    operator: eq",
    "    threshold: 0",
    "    severity: critical",
    `    tags: [${tags.join(", ")}]`,
    "",
  ].join("\n");
}

describe("groups.yaml", () => {
  test("groups can name monitors from several integrations", async () => {
    const root = await integrationsRoot({
      "a-api/integration.yaml": integrationYaml("a-api", "m1"),
      "b-api/integration.yaml": integrationYaml("b-api", "m2"),
      "groups.yaml": [
        "groups:",
        "  - id: checkout",
        "    name: Checkout",
        "    owner: payments",
        "    monitors: [a-api/m1, b-api/m2]",
        "",
      ].join("\n"),
    });
    const records = await loadIntegrationRecords(root);
    const groups = await loadGroups(root, records);
    assert.deepEqual(groups, [
      { id: "checkout", name: "Checkout", description: "", owner: "payments", monitors: ["a-api/m1", "b-api/m2"] },
    ]);
  });

  test("groups are optional", async () => {
    const root = await integrationsRoot({ "a-api/integration.yaml": integrationYaml("a-api", "m1") });
    assert.deepEqual(await loadGroups(root, await loadIntegrationRecords(root)), []);
  });

  test("a group that names an unknown monitor is refused and the problem names it", async () => {
    const root = await integrationsRoot({
      "a-api/integration.yaml": integrationYaml("a-api", "m1"),
      "groups.yaml": "groups:\n  - id: checkout\n    name: Checkout\n    monitors: [a-api/missing]\n",
    });
    const records = await loadIntegrationRecords(root);
    await assert.rejects(loadGroups(root, records), (err: unknown) => {
      assert.ok(err instanceof ConfigValidationError);
      assert.match(err.message, /a-api\/missing/);
      return true;
    });
  });

  test("group ids must be unique", async () => {
    const root = await integrationsRoot({
      "a-api/integration.yaml": integrationYaml("a-api", "m1"),
      "groups.yaml": "groups:\n  - id: checkout\n    name: One\n    monitors: [a-api/m1]\n  - id: checkout\n    name: Two\n    monitors: [a-api/m1]\n",
    });
    await assert.rejects(loadGroups(root, await loadIntegrationRecords(root)), /duplicate group id "checkout"/);
  });

  test("a group needs at least one monitor and a reference in integration/monitor form", async () => {
    const root = await integrationsRoot({
      "a-api/integration.yaml": integrationYaml("a-api", "m1"),
      "groups.yaml": "groups:\n  - id: empty\n    name: Empty\n    monitors: []\n",
    });
    await assert.rejects(loadGroups(root, await loadIntegrationRecords(root)), ConfigValidationError);
  });
});

describe("monitor tags", () => {
  const monitorWith = (tags: unknown) => ({
    id: "demo-api",
    name: "Demo",
    owner: "team",
    signals: [{ id: "probe", type: "http-health", url: "https://example.com/health" }],
    monitors: [{ id: "demo-down", name: "Down", signal: "probe", metric: "healthy", operator: "eq", threshold: 0, severity: "critical", tags }],
  });

  test("tags are kept as written", () => {
    const integration = validateIntegration(monitorWith(["orders", "critical-path"]), "f.yaml");
    assert.deepEqual(integration.monitors[0].tags, ["orders", "critical-path"]);
  });

  test("monitors without tags have none", () => {
    const raw = monitorWith(undefined);
    delete (raw.monitors[0] as Record<string, unknown>).tags;
    assert.deepEqual(validateIntegration(raw, "f.yaml").monitors[0].tags, []);
  });

  test("tags must be lowercase letters, digits and dashes", () => {
    assert.throws(() => validateIntegration(monitorWith(["Has Spaces"]), "f.yaml"), ConfigValidationError);
  });

  test("a monitor can have at most ten tags", () => {
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
    assert.throws(() => validateIntegration(monitorWith(tags), "f.yaml"), ConfigValidationError);
  });
});
