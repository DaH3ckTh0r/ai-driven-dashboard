export class MissingEnvError extends Error {
  constructor(readonly variables: string[]) {
    super(`missing environment variables: ${variables.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

const PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Replaces ${VAR} placeholders in every string of a parsed document. Secrets never live in
 * config files; they are referenced by name. Missing variables are reported together.
 */
export function interpolateEnv<T>(value: T, env: NodeJS.ProcessEnv): T {
  const missing = new Set<string>();
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return node.replace(PLACEHOLDER, (_match, name: string) => {
        const resolved = env[name];
        if (!resolved) {
          missing.add(name);
          return "";
        }
        return resolved;
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  const result = walk(value) as T;
  if (missing.size > 0) throw new MissingEnvError([...missing].sort());
  return result;
}
