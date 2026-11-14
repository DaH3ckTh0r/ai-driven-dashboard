import { resolve } from "node:path";
import { loadGroups, loadIntegrationRecords, ConfigValidationError } from "../infrastructure/config/loader.js";

/** Checks every integration and the groups file in a folder: schema, environment variables, script paths and group members. */
try {
  const root = resolve(process.argv[2] ?? "integrations");
  const records = await loadIntegrationRecords(root);
  const groups = await loadGroups(root, records);
  for (const { integration } of records) {
    const tags = new Set(integration.monitors.flatMap((m) => m.tags));
    console.log(
      `ok  ${integration.id}: ${integration.signals.length} signals, ${integration.actions.length} actions, ${integration.monitors.length} monitors, ${tags.size} tags`,
    );
  }
  for (const group of groups) console.log(`ok  group ${group.id}: ${group.monitors.length} monitors`);
  console.log(`\n${records.length} integration(s) and ${groups.length} group(s) valid`);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
