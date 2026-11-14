import { readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { GroupDef, IntegrationDef } from "../../domain/model.js";
import type { IntegrationRecord } from "../../application/ports.js";
import { interpolateEnv, MissingEnvError } from "./env.js";
import { GroupsFileSchema, IntegrationSchema } from "./schema.js";

export interface ConfigProblem {
  file: string;
  path: string;
  message: string;
}

export class ConfigValidationError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(
      `integration configuration is invalid (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
        problems.map((p) => `  - ${p.file} ${p.path || "(root)"}: ${p.message}`).join("\n"),
    );
    this.name = "ConfigValidationError";
  }
}

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  /** Verify that every action script exists inside its integration folder. Default true. */
  checkScripts?: boolean;
}

const SUPPORTED = new Set([".yaml", ".yml", ".json"]);

/**
 * Loads every integration in a root folder. Each integration lives in its own folder with
 * an integration.yaml (or .yml / .json), so its relative script paths have a clear home.
 */
export async function loadIntegrationRecords(root: string, options: LoadOptions = {}): Promise<IntegrationRecord[]> {
  const env = options.env ?? process.env;
  const problems: ConfigProblem[] = [];
  const records: IntegrationRecord[] = [];

  for (const file of await findIntegrationFiles(root)) {
    try {
      const raw = parseDocument(await readFile(file, "utf8"), file);
      const integration = validateIntegration(raw, file, env);
      const location = resolve(file, "..");
      if (options.checkScripts ?? true) problems.push(...(await checkScripts(integration, location, file)));
      records.push({ integration, location });
    } catch (err) {
      if (err instanceof ConfigValidationError) problems.push(...err.problems);
      else throw err;
    }
  }

  problems.push(...duplicateIds(records));
  if (problems.length > 0) throw new ConfigValidationError(problems);
  return records;
}

/**
 * Loads groups.yaml (or .yml / .json) from the integrations root, if present. Every member must name
 * a monitor that was loaded, so a typo fails at start-up instead of silently giving an empty group.
 */
export async function loadGroups(root: string, records: IntegrationRecord[]): Promise<GroupDef[]> {
  const candidates = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.startsWith("groups.") && SUPPORTED.has(extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) return [];
  if (candidates.length > 1) {
    throw new ConfigValidationError([{ file: root, path: "", message: "keep only one groups file (groups.yaml, .yml or .json)" }]);
  }
  const file = join(root, candidates[0]);
  const raw = parseDocument(await readFile(file, "utf8"), file);
  const result = GroupsFileSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => ({ file, path: issue.path.map(String).join("."), message: issue.message })),
    );
  }

  const known = new Set(records.flatMap(({ integration }) => integration.monitors.map((m) => `${integration.id}/${m.id}`)));
  const problems: ConfigProblem[] = [];
  const ids = new Set<string>();
  result.data.groups.forEach((group, i) => {
    if (ids.has(group.id)) problems.push({ file, path: `groups.${i}.id`, message: `duplicate group id "${group.id}"` });
    ids.add(group.id);
    group.monitors.forEach((ref, j) => {
      if (!known.has(ref)) problems.push({ file, path: `groups.${i}.monitors.${j}`, message: `"${ref}" is not a monitor in any integration` });
    });
  });
  if (problems.length > 0) throw new ConfigValidationError(problems);

  return result.data.groups.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description ?? "",
    owner: group.owner,
    monitors: group.monitors,
  }));
}

/** Parses a YAML or JSON document. Pure apart from the parser. */
export function parseDocument(text: string, file: string): unknown {
  try {
    return extname(file).toLowerCase() === ".json" ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    throw new ConfigValidationError([{ file, path: "", message: `could not parse: ${(err as Error).message}` }]);
  }
}

/** Interpolates env values, validates the shape and maps it to the domain type. */
export function validateIntegration(raw: unknown, file: string, env: NodeJS.ProcessEnv = process.env): IntegrationDef {
  let interpolated: unknown;
  try {
    interpolated = interpolateEnv(raw, env);
  } catch (err) {
    if (err instanceof MissingEnvError) throw new ConfigValidationError([{ file, path: "", message: err.message }]);
    throw err;
  }
  const result = IntegrationSchema.safeParse(interpolated);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => ({ file, path: issue.path.map(String).join("."), message: issue.message })),
    );
  }
  return result.data;
}

async function findIntegrationFiles(root: string): Promise<string[]> {
  const folders = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const files: string[] = [];
  for (const folder of folders) {
    const candidates = (await readdir(join(root, folder), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.startsWith("integration.") && SUPPORTED.has(extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort();
    if (candidates.length > 1) {
      throw new ConfigValidationError([{ file: join(root, folder), path: "", message: "folder has more than one integration file; keep only one" }]);
    }
    if (candidates[0]) files.push(join(root, folder, candidates[0]));
  }
  return files;
}

async function checkScripts(integration: IntegrationDef, location: string, file: string): Promise<ConfigProblem[]> {
  const problems: ConfigProblem[] = [];
  for (const [i, action] of integration.actions.entries()) {
    const target = resolveInside(location, action.script);
    if (!target) {
      problems.push({ file, path: `actions.${i}.script`, message: `script "${action.script}" must be a relative path inside the integration folder` });
      continue;
    }
    const exists = await stat(target).then((s) => s.isFile(), () => false);
    if (!exists) problems.push({ file, path: `actions.${i}.script`, message: `script "${action.script}" does not exist` });
  }
  return problems;
}

/** Resolves a relative path, returning undefined if it is absolute or escapes the folder. */
function resolveInside(location: string, script: string): string | undefined {
  if (isAbsolute(script)) return undefined;
  const target = resolve(location, normalize(script));
  const rel = relative(location, target);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? undefined : target;
}

function duplicateIds(records: IntegrationRecord[]): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const integrationIds = new Set<string>();
  const monitorIds = new Set<string>();
  for (const { integration, location } of records) {
    const file = join(location, "integration.yaml");
    if (integrationIds.has(integration.id)) {
      problems.push({ file, path: "id", message: `integration id "${integration.id}" is already used by another integration` });
    }
    integrationIds.add(integration.id);
    for (const monitor of integration.monitors) {
      if (monitorIds.has(monitor.id)) {
        problems.push({ file, path: "monitors", message: `monitor id "${monitor.id}" is already used by another monitor` });
      }
      monitorIds.add(monitor.id);
    }
  }
  return problems;
}
