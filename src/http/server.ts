import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { toErrorReply } from "./errors.js";
import { serveSite, type StaticSite } from "./static.js";
import { json, type Reply } from "./reply.js";
import type { Route } from "./routes.js";
import type { ErrorView } from "./contracts.js";

export interface ServerOptions {
  routes: Route[];
  /** Maps a request to the signed-in user, or null when unauthenticated. */
  identify: (req: IncomingMessage) => string | null;
  /** Routes outside /api, such as sign-in. Checked before the static site. */
  publicRoutes?: PublicRoute[];
  site: StaticSite;
  /** Send Strict-Transport-Security. Enable only when the site is served over https. */
  hsts?: boolean;
}

export interface PublicRoute {
  method: "GET" | "POST";
  pattern: RegExp;
  handle: (params: string[], request: IncomingMessage, url: URL) => Promise<Reply>;
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};
const HSTS_HEADER = { "strict-transport-security": "max-age=31536000; includeSubDomains" };

/** Builds the HTTP server. Authentication and routing happen here; behaviour lives in the use cases. */
export function createHttpServer(options: ServerOptions): Server {
  const headers = options.hsts ? { ...SECURITY_HEADERS, ...HSTS_HEADER } : SECURITY_HEADERS;
  return createServer(async (req, res) => {
    const reply = await dispatch(req, options).catch(toErrorReply);
    write(res, reply, headers);
  });
}

async function dispatch(req: IncomingMessage, options: ServerOptions): Promise<Reply> {
  const url = new URL(req.url ?? "/", "http://localhost");

  for (const route of options.publicRoutes ?? []) {
    if (route.method !== req.method) continue;
    const match = route.pattern.exec(url.pathname);
    if (match) return route.handle(match.slice(1), req, url);
  }

  if (!url.pathname.startsWith("/api/")) {
    return req.method === "GET" ? serveSite(options.site, url.pathname) : json<ErrorView>(404, { error: "not found" });
  }

  const user = options.identify(req);
  if (!user) return json<ErrorView>(401, { error: "sign in required" });

  for (const route of options.routes) {
    if (route.method !== req.method) continue;
    const match = route.pattern.exec(url.pathname);
    if (match) return route.handle(match.slice(1), { user, url, request: req });
  }
  return json<ErrorView>(404, { error: "not found" });
}

function write(res: ServerResponse, reply: Reply, headers: Record<string, string>): void {
  res.writeHead(reply.status, { ...headers, "content-type": reply.contentType, ...reply.headers });
  res.end(reply.body);
}
