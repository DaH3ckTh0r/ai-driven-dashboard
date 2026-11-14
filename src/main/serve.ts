import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigValidationError } from "../infrastructure/config/loader.js";
import { buildRuntime } from "./production.js";
import { MonitorScheduler } from "../application/scheduler.js";
import { createHttpServer } from "../http/server.js";
import { buildRoutes } from "../http/routes.js";
import { Approvers } from "../domain/approvers.js";
import { SystemClock } from "../infrastructure/system/clock-and-ids.js";
import { newToken } from "../infrastructure/auth/pkce.js";
import { buildAuth } from "./auth.js";
import { loadSettings, SettingsError } from "./settings.js";

/**
 * Runs the scheduler and the web app in one process.
 * Env: see src/main/settings.ts (APIM_CHAT_URL, AUTH_MODE, LOCAL_USER, DB_PATH, HOST, PORT, ...).
 */
const root = resolve(process.argv[2] ?? "integrations");
let settings;
try {
  settings = loadSettings(process.env);
} catch (err) {
  if (err instanceof SettingsError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");

try {
  const runtime = await buildRuntime({
    integrationsRoot: root,
    apimChatUrl: settings.apimChatUrl,
    apimSubscriptionKey: settings.apimSubscriptionKey,
    dbPath: settings.dbPath,
    approvers: settings.approvers,
  });

  const auth = buildAuth(settings, {
    sessions: runtime.persistence.sessions,
    audit: runtime.persistence.audit,
    clock: new SystemClock(),
    newToken,
  });
  const server = createHttpServer({
    routes: buildRoutes({
      reads: runtime.app.reads,
      approvals: runtime.app.approvals,
      monitoring: runtime.app.monitoring,
      groups: runtime.app.groups,
      approvers: new Approvers(settings.approvers),
    }),
    identify: auth.identify,
    publicRoutes: auth.publicRoutes,
    site: {
      root: join(projectRoot, "web", "dist"),
      fallbackHtml: await readFile(join(projectRoot, "public", "index.html"), "utf8"),
    },
  });

  const scheduler = new MonitorScheduler({
    monitoring: runtime.app.monitoring,
    catalog: runtime.catalog,
    schedule: (task, everyMs) => {
      const timer = setInterval(task, everyMs);
      return () => clearInterval(timer);
    },
    onError: (err, where) => console.error(`monitor ${where} failed:`, (err as Error).message),
  });

  server.listen(settings.port, settings.host, () => console.log(`monitor listening on http://${settings.host}:${settings.port}`));
  const recovered = runtime.app.approvals.recoverStranded();
  if (recovered > 0) console.warn(`marked ${recovered} interrupted approval(s) as failed`);
  if (settings.stopWhenStdinCloses) {
    process.stdin.resume();
    process.stdin.on("end", () => process.exit(0));
  }
  scheduler.start();

  const shutdown = () => {
    scheduler.stop();
    server.close(() => {
      runtime.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  console.error(err instanceof ConfigValidationError ? err.message : (err as Error).message);
  process.exit(2);
}
