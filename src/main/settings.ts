import { resolve } from "node:path";

/** Who the server treats as signed in. Easy Auth for hosted use; a named local user for the desktop app. */
export type AuthSettings =
  | { kind: "easy-auth" }
  | { kind: "local"; user: string }
  | { kind: "entra"; tenantId: string; clientId: string; clientSecret?: string; authority?: string; publicBaseUrl: string };

export interface Settings {
  host: string;
  port: number;
  dbPath: string;
  apimChatUrl: string;
  apimSubscriptionKey?: string;
  auth: AuthSettings;
  /** Who may approve writes, dry-run them and close issues. Required; local mode defaults to LOCAL_USER. */
  approvers: string[];
  /** Exit when stdin closes. A desktop shell pipes stdin, so the server never outlives the app. */
  stopWhenStdinCloses: boolean;
}

export class SettingsError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid settings:\n  - ${problems.join("\n  - ")}`);
    this.name = "SettingsError";
  }
}

const AUTH_MODES = ["easy-auth", "local", "entra"] as const;

/** Reads and checks every setting at once, so one start-up shows all the problems. */
export function loadSettings(env: NodeJS.ProcessEnv): Settings {
  const problems: string[] = [];

  const apimChatUrl = (env.APIM_CHAT_URL ?? "").trim();
  if (!apimChatUrl) problems.push("APIM_CHAT_URL is required");

  const port = parsePort(env.PORT, problems);

  const mode = env.AUTH_MODE ?? "easy-auth";
  let auth: AuthSettings = { kind: "easy-auth" };
  if (!(AUTH_MODES as readonly string[]).includes(mode)) {
    problems.push(`AUTH_MODE must be one of ${AUTH_MODES.join(", ")} (got "${mode}")`);
  } else if (mode === "local") {
    const user = (env.LOCAL_USER ?? "").trim();
    if (!user) problems.push("AUTH_MODE=local needs LOCAL_USER, the name recorded in the audit log");
    else auth = { kind: "local", user };
  } else if (mode === "entra") {
    const tenantId = (env.ENTRA_TENANT_ID ?? "").trim();
    const clientId = (env.ENTRA_CLIENT_ID ?? "").trim();
    const publicBaseUrl = (env.PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
    if (!tenantId) problems.push("AUTH_MODE=entra needs ENTRA_TENANT_ID");
    if (!clientId) problems.push("AUTH_MODE=entra needs ENTRA_CLIENT_ID");
    if (!publicBaseUrl) problems.push("AUTH_MODE=entra needs PUBLIC_BASE_URL, the address users open (used for the sign-in return)");
    if (tenantId && clientId && publicBaseUrl) {
      auth = {
        kind: "entra",
        tenantId,
        clientId,
        clientSecret: env.ENTRA_CLIENT_SECRET || undefined,
        authority: env.ENTRA_AUTHORITY || undefined,
        publicBaseUrl,
      };
    }
  }

  let approvers = (env.APPROVERS ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  if (approvers.length === 0 && auth.kind === "local") approvers = [auth.user];
  if (approvers.length === 0) {
    problems.push("APPROVERS is required: a comma-separated list of the people allowed to approve writes, e.g. name@contoso.com");
  }

  if (problems.length > 0) throw new SettingsError(problems);
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    dbPath: env.DB_PATH ?? resolve("monitor.db"),
    apimChatUrl,
    apimSubscriptionKey: env.APIM_SUBSCRIPTION_KEY || undefined,
    auth,
    approvers,
    stopWhenStdinCloses: env.EXIT_WITH_PARENT === "1",
  };
}

function parsePort(raw: string | undefined, problems: string[]): number {
  if (raw === undefined) return 8080;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    problems.push(`PORT must be a whole number from 1 to 65535 (got "${raw}")`);
    return 8080;
  }
  return port;
}
