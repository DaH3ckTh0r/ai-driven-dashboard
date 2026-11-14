import type { IncomingMessage } from "node:http";
import type { SignIn } from "../application/sign-in.js";
import type { PublicRoute } from "./server.js";
import { redirect, text } from "./reply.js";

export const SESSION_COOKIE = "im_session";

/** On https the cookie gets the __Host- prefix: Secure, Path=/, and no Domain, so it cannot be overwritten by a subdomain. */
export function sessionCookieName(secure: boolean): string {
  return secure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}
const TWELVE_HOURS_SECONDS = 12 * 3600;

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Identifies the caller from the session cookie. Easy Auth and local modes do not use this. */
export function identifyFromSession(signIn: SignIn, cookieName: string = SESSION_COOKIE): (req: IncomingMessage) => string | null {
  return (req) => signIn.currentUser(readCookie(req, cookieName));
}

/**
 * Sign-in endpoints. The session cookie is HttpOnly and SameSite=Lax. It is Secure on https
 * addresses. Its lifetime matches the session, so a returning user stays signed in across restarts.
 */
export function buildAuthRoutes(
  signIn: SignIn,
  options: { secureCookies: boolean; maxAgeSeconds?: number; limiter?: { hit: (key: string) => boolean } },
): PublicRoute[] {
  const maxAge = options.maxAgeSeconds ?? TWELVE_HOURS_SECONDS;
  const name = sessionCookieName(options.secureCookies);
  const attributes = `Path=/; HttpOnly; SameSite=Lax${options.secureCookies ? "; Secure" : ""}`;
  // Sign-in is the brute-force and abuse surface, so each client address gets a fixed budget.
  const limited = (req: IncomingMessage) => (options.limiter?.hit(req.socket.remoteAddress ?? "unknown") ?? true);
  const tooMany = () => text(429, "text/plain; charset=utf-8", "too many sign-in attempts; wait a minute and try again");
  return [
    {
      method: "GET",
      pattern: /^\/auth\/login$/,
      handle: async (_params, request) => (limited(request) ? redirect(await signIn.begin()) : tooMany()),
    },
    {
      method: "GET",
      pattern: /^\/auth\/callback$/,
      handle: async (_params, request, url) => {
        if (!limited(request)) return tooMany();
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return text(400, "text/plain; charset=utf-8", "the sign-in response is incomplete; try again");
        const session = await signIn.complete({ code, state });
        return redirect("/", { "set-cookie": `${name}=${encodeURIComponent(session.id)}; ${attributes}; Max-Age=${maxAge}` });
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/logout$/,
      handle: async (_params, request) => {
        signIn.end(readCookie(request, name));
        return redirect("/", { "set-cookie": `${name}=; ${attributes}; Max-Age=0` });
      },
    },
  ];
}
