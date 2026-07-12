---
name: tokhub
description: Connect a local agent to any TokHub instance with website-equivalent login, CSRF, workspace, role, admin-agent, and legacy tokhub-admin permissions. Use for public status, profile, favorites, private channels, console gateways, keys, members, usage, alerts, audit, incidents, governance, or admin operations. Do not use for TokHub source-code work, UI debugging, docs-only tasks, or /gateway/v1/* model calls.
---

# TokHub

## When To Use

- The user wants to connect Codex or another agent to a local or remote TokHub URL.
- The user needs website-equivalent access to `/api/public/*`, `/api/me/*`, `/api/console/*`, `/api/admin/*`, or site-key-scoped `/v1/status/*`.
- The task must respect the logged-in user's platform and workspace roles.
- An owner/admin needs scoped `/api/admin/*` admin-agent automation.
- The user names retired `tokhub-admin`; handle it here through admin-agent mode.

## Do Not Use

- Editing, debugging, reviewing, or building TokHub source code.
- Calling `/gateway/v1/*` model inference endpoints.
- Bypassing TokHub website permissions or reading admin-only data as an ordinary user.
- Asking the user to paste passwords, cookies, keys, session files, or admin-agent tokens into chat.

## Workflow

1. Read `references/session-auth-contract.md` before login, profile, workspace, or session work.
2. Read `references/permission-model.md` before any write, export, delete, bulk, revoke, reset, credential, or admin operation.
3. Inspect `references/operation-catalog.json`; for admin-agent automation, inspect `references/admin-agent-operation-catalog.json` and `references/admin-agent-contract.md`.
4. If the profile is not logged in, run `node agent-skills/tokhub/scripts/tokhub.mjs login --url https://host --profile default` and let the user enter credentials in the terminal.
5. Run `node agent-skills/tokhub/scripts/tokhub.mjs preflight --profile default`.
6. For reads, run `node agent-skills/tokhub/scripts/tokhub.mjs request GET /api/... --profile default`. For `/v1/status/*`, require a local Site Key environment variable and pass `--site-key-env ENV_VAR`.
7. For writes, exports, downloads, deletes, bulk, reset, revoke, credential, package, or key actions, require `--execute --reason "..." --idempotency-key "..."`.
8. For owner/admin scoped bearer automation, use `node agent-skills/tokhub/scripts/tokhub.mjs admin-agent ...` and keep the existing audit verification workflow.
9. Map `$tokhub-admin` wording to `tokhub` admin-agent mode; the standalone package is retired.
10. Treat JSON as redacted. Exports/downloads require `--output`; key material is not written inside the current git worktree unless `--allow-repo-output` is passed.

## Output Contract

Return:

- profile, base URL, auth mode, and target path
- role/workspace context, risk, guard status, execution status, important fields
- admin-agent audit verification for writes
- blocked precondition, missing role/scope/env, or refusal reason

## Reference Map

- `references/session-auth-contract.md`: login, profiles, CSRF, cookies, local secrets.
- `references/permission-model.md`: public, user, workspace, admin, admin-agent boundaries.
- `references/operation-catalog.json`: session operation catalog.
- `references/admin-agent-contract.md`: scoped bearer, idempotency, audit, secret rules.
- `references/admin-agent-operation-catalog.json`: admin-agent operation catalog.
- `scripts/tokhub.mjs`: deterministic TokHub client.
- `evals/trigger_cases.json`: trigger boundary cases.
- `reports/output-risk-profile.md`: likely output mistakes and mitigations.
- `reports/trust-boundary.md`: credential, network, and local session trust boundary.
- `reports/output_quality_scorecard.md`: governed package evidence summary.
