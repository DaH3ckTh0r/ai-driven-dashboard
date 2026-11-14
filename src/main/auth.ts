import { createHash } from "node:crypto";
import { SignIn } from "../application/sign-in.js";
import type { AuditLog, Clock, SessionRepository } from "../application/ports.js";
import { EntraIdentityProvider } from "../infrastructure/auth/entra.js";
import { identifyFromEasyAuth, identifyLocal } from "../http/identity.js";
import { buildAuthRoutes, identifyFromSession, sessionCookieName } from "../http/auth-routes.js";
import { createRateLimiter } from "../http/rate-limit.js";
import type { PublicRoute } from "../http/server.js";
import type { Settings } from "./settings.js";

export interface AuthWiring {
  identify: (req: import("node:http").IncomingMessage) => string | null;
  publicRoutes: PublicRoute[];
}

/** Picks the identity source for the configured mode. The rest of the app only sees `identify`. */
export function buildAuth(
  settings: Settings,
  deps: { sessions: SessionRepository; audit: AuditLog; clock: Clock; newToken: () => string },
): AuthWiring {
  const auth = settings.auth;
  if (auth.kind === "easy-auth") return { identify: identifyFromEasyAuth(), publicRoutes: [] };
  if (auth.kind === "local") return { identify: identifyLocal(auth.user), publicRoutes: [] };

  const signIn = new SignIn({
    identity: new EntraIdentityProvider({
      tenantId: auth.tenantId,
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      authority: auth.authority,
    }),
    sessions: deps.sessions,
    audit: deps.audit,
    clock: deps.clock,
    newToken: deps.newToken,
    digest: (value) => createHash("sha256").update(value).digest("hex"),
    redirectUri: `${auth.publicBaseUrl}/auth/callback`,
  });
  const secureCookies = auth.publicBaseUrl.startsWith("https://");
  return {
    identify: identifyFromSession(signIn, sessionCookieName(secureCookies)),
    publicRoutes: buildAuthRoutes(signIn, {
      secureCookies,
      limiter: createRateLimiter({ limit: 20, windowMs: 60_000, now: () => deps.clock.now().getTime() }),
    }),
  };
}
