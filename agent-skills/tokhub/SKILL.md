---
name: tokhub
description: Connect a local agent session to any TokHub instance through the same login, CSRF, workspace, and role permissions used by the website. Use when a TokHub user or administrator asks an agent to inspect public status data, manage their own profile, favorites, private channels, console workspace gateways, keys, members, usage, alerts, audit logs, incidents, governance summaries, or high-permission admin operations. Do not use for TokHub source-code development, UI debugging, prose-only docs, or direct model calls through /gateway/v1/*.
---

# TokHub

## When To Use

- The user wants to connect Codex or another agent to a local or remote TokHub URL.
- The user needs website-equivalent access to `/api/public/*`, `/api/me/*`, `/api/console/*`, `/api/admin/*`, or site-key-scoped `/v1/status/*`.
- The task must respect the logged-in user's platform role and workspace role.
- An owner/admin needs the existing admin-agent automation branch for scoped `/api/admin/*` operations.

## Do Not Use

- Editing, debugging, reviewing, or building TokHub source code.
- Calling `/gateway/v1/*` model inference endpoints.
- Bypassing TokHub website permissions or reading admin-only data as an ordinary user.
- Asking the user to paste passwords, cookies, session files, gateway keys, provider keys, site keys, or admin-agent tokens into chat.

## Workflow

1. Read `references/session-auth-contract.md` before login, profile, workspace, or session work.
2. Read `references/permission-model.md` before any write, export, delete, bulk, revoke, reset, credential, or admin operation.
3. Inspect `references/operation-catalog.json` for session-based public, me, console, and admin paths. For admin-agent token automation, inspect `references/admin-agent-operation-catalog.json` and `references/admin-agent-contract.md`.
4. If the profile is not logged in, run `node agent-skills/tokhub/scripts/tokhub.mjs login --url https://host --profile default` and let the user enter credentials in the terminal.
5. Run `node agent-skills/tokhub/scripts/tokhub.mjs preflight --profile default`.
6. For reads, run `node agent-skills/tokhub/scripts/tokhub.mjs request GET /api/... --profile default`. For `/v1/status/*`, require a local Site Key environment variable and pass `--site-key-env ENV_VAR`.
7. For writes, exports, downloads, deletes, bulk, reset, revoke, credential, package, or key actions, require explicit user intent and pass `--execute --reason "..." --idempotency-key "..."`.
8. For owner/admin scoped bearer automation, use `node agent-skills/tokhub/scripts/tokhub.mjs admin-agent ...` and keep the existing audit verification workflow.
9. Treat script JSON output as redacted by default. Exports, downloads, and package artifacts require `--output`; credential-bearing artifacts must be handled as key material and are not written inside the current git worktree unless `--allow-repo-output` is explicitly passed.

## Output Contract

Return:

- profile, base URL, auth mode, and target path
- role and workspace context used for the operation
- risk class and guard status from the catalog
- execution status and important response fields
- audit verification result for admin-agent writes
- any blocked precondition, missing role, missing scope, missing env var, or refusal reason

## Reference Map

- `references/session-auth-contract.md`: login, profile storage, CSRF, cookies, logout, and local secret handling.
- `references/permission-model.md`: public, user, workspace, admin, and admin-agent permission boundaries.
- `references/operation-catalog.json`: session-based public/me/console/admin operation catalog.
- `references/admin-agent-contract.md`: scoped bearer token, idempotency, audit, and secret rules for owner/admin automation.
- `references/admin-agent-operation-catalog.json`: complete admin-agent `/api/admin/*` operation catalog.
- `scripts/tokhub.mjs`: deterministic TokHub client.
- `evals/trigger_cases.json`: trigger boundary cases.
- `reports/output-risk-profile.md`: likely output mistakes and mitigations.
- `reports/trust-boundary.md`: credential, network, and local session trust boundary.
- `reports/output_quality_scorecard.md`: governed package evidence summary.
