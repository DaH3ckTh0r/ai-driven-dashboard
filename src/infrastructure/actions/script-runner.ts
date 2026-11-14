import { execFile } from "node:child_process";
import { resolve } from "node:path";
import type { ActionDef } from "../../domain/model.js";
import type { ActionOutput, ActionRunner } from "../../application/ports.js";
import { clip } from "../../application/text.js";

const OUTPUT_LIMIT = 8_000;

/**
 * Runs action scripts with Node's TypeScript loader, from the integration folder.
 * Scripts receive --dry-run when previewing.
 */
export class ScriptRunner implements ActionRunner {
  run(action: ActionDef, location: string, options: { dryRun: boolean }): Promise<ActionOutput> {
    const script = resolve(location, action.script);
    const args = ["--import", "tsx", script, ...(options.dryRun ? ["--dry-run"] : [])];
    return new Promise((done) => {
      execFile(process.execPath, args, { timeout: action.timeoutSec * 1000, maxBuffer: 1024 * 1024, cwd: location }, (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        done({ exitCode, stdout: clip(stdout, OUTPUT_LIMIT), stderr: clip(stderr, OUTPUT_LIMIT) });
      });
    });
  }
}
