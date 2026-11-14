import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { text, type Reply } from "./reply.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

export interface StaticSite {
  /** Folder with the built web app. */
  root?: string;
  /** Page served when no build is present. */
  fallbackHtml: string;
}

/**
 * Serves a file from the built app. Anything outside the folder, or missing, gets the app
 * shell so client-side routes work. Paths that escape the folder are never read.
 */
export async function serveSite(site: StaticSite, pathname: string): Promise<Reply> {
  if (site.root) {
    const root = resolve(site.root);
    const file = resolve(root, `.${decodePath(pathname)}`);
    if (file.startsWith(root + sep) && (await isFile(file))) {
      return text(200, CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", await readFile(file));
    }
    const shell = await readFile(join(root, "index.html")).catch(() => undefined);
    if (shell) return text(200, CONTENT_TYPES[".html"], shell);
  }
  return text(200, CONTENT_TYPES[".html"], site.fallbackHtml);
}

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "/";
  }
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isFile(), () => false);
}
