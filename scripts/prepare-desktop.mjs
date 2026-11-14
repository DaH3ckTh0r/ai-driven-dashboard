// Stages the desktop runtime: the same compiled server the container runs, plus a Node binary.
// Output: desktop/runtime/{node, app/...}. Tauri bundles that folder as a resource.
import { chmod, copyFile, cp, mkdir, rm, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "desktop", "runtime");
const app = join(out, "app");

for (const required of ["dist/main/serve.js", "web/dist/index.html"]) {
  await access(join(root, required)).catch(() => {
    throw new Error(`${required} is missing; run "npm run build:all" first`);
  });
}

await rm(out, { recursive: true, force: true });
await mkdir(app, { recursive: true });

const nodeName = process.platform === "win32" ? "node.exe" : "node";
await copyFile(process.execPath, join(out, nodeName));
await chmod(join(out, nodeName), 0o755);

await cp(join(root, "dist"), join(app, "dist"), { recursive: true });
await cp(join(root, "web", "dist"), join(app, "web", "dist"), { recursive: true });
await cp(join(root, "public"), join(app, "public"), { recursive: true });
await cp(join(root, "examples", "integrations"), join(app, "integrations"), { recursive: true });
await copyFile(join(root, "package.json"), join(app, "package.json"));
await copyFile(join(root, "package-lock.json"), join(app, "package-lock.json"));
execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: app, stdio: "inherit" });
console.log(`desktop runtime staged in ${out}`);
