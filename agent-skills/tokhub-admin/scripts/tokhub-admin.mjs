#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOKHUB_SCRIPT = join(SCRIPT_DIR, "..", "..", "tokhub", "scripts", "tokhub.mjs");

function usage() {
  console.log(`Usage:
  tokhub-admin.mjs bootstrap [--admin-url https://host/admin] [--identifier user@example.com] [--token-name codex-local] [--scopes admin:*] [--ttl-hours 24] [--save-env ~/.tokhub/admin-agent.env] [--overwrite] [--allow-repo-output]
  tokhub-admin.mjs preflight
  tokhub-admin.mjs request METHOD /api/admin/path [--execute] [--reason "..."] [--idempotency-key "..."] [--json '{"ok":true}'] [--body file.json] [--form key=value] [--form-file field=path] [--output file] [--overwrite] [--allow-repo-output]
  tokhub-admin.mjs audit-verify [--token-id aat_...] [--idempotency-key key] [--limit 500]

Legacy compatibility wrapper. Prefer:
  tokhub.mjs admin-agent <command>
`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  usage();
  process.exit(0);
}

const child = spawn(process.execPath, [TOKHUB_SCRIPT, "admin-agent", ...args], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`FAIL: could not execute tokhub admin-agent wrapper: ${error.message}`);
  process.exit(1);
});
