import type { IncomingMessage } from "node:http";

/**
 * Reads the signed-in user from the header Easy Auth (App Service / Static Web Apps) sets.
 * Trust this only when the app is reachable exclusively through Easy Auth.
 */
export function identifyFromEasyAuth(): (req: IncomingMessage) => string | null {
  return (req) => {
    const header = req.headers["x-ms-client-principal-name"];
    return typeof header === "string" && header.trim() ? header.trim() : null;
  };
}

/** Desktop mode: the one local user who started the app. Only the local process can reach the port. */
export function identifyLocal(user: string): (req: IncomingMessage) => string {
  return () => user;
}
