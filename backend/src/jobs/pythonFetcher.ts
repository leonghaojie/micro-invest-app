/**
 * Runs the yfinance fetch step (prisma/ingest-funds-yfinance.py) as a child
 * process and returns the directory it wrote its raw JSON to. The only part of
 * the update that touches the network; the rest is plain Node + Prisma.
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { env } from "../config/env";
import { DATA_DIR } from "../services/fundDataUpdate.service";

const SCRIPT = join(__dirname, "..", "..", "prisma", "ingest-funds-yfinance.py");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface FetchOptions {
  pythonBin?: string;
  script?: string;
  timeoutMs?: number;
}

export function fetchWithPython({ pythonBin = env.pythonBin, script = SCRIPT, timeoutMs = DEFAULT_TIMEOUT_MS }: FetchOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [script], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let tail = "";
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-600);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the fetch took longer than ${Math.round(timeoutMs / 1000)}s and was stopped`));
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new Error(`Python was not found ("${pythonBin}"). Install Python and run "pip install yfinance", or set PYTHON_BIN.`)
          : err
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const missingLib = /No module named ['"]?yfinance/.test(tail);
        reject(new Error(missingLib ? 'The Python package "yfinance" is not installed. Run: pip install yfinance' : `the fetch script exited with code ${code}: ${tail.trim()}`));
      } else if (!existsSync(join(DATA_DIR, "_manifest.json"))) {
        reject(new Error("the fetch script finished but wrote no data"));
      } else {
        resolve(DATA_DIR);
      }
    });
  });
}
