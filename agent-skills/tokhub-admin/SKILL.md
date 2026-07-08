---
name: tokhub-admin
description: Legacy alias for TokHub administrator automation. Use only when a user explicitly asks for the old tokhub-admin skill or admin-agent token workflows. Prefer the general tokhub skill for ordinary users, console workspaces, public status data, and website-equivalent admin-session operations.
---

# TokHub Admin Legacy Alias

`tokhub-admin` is retained for compatibility. The canonical skill is now `tokhub`.

## When To Use

- The user explicitly names `$tokhub-admin`.
- The user already has `TOKHUB_BASE_URL` and `TOKHUB_ADMIN_AGENT_TOKEN`.
- The task is an owner/admin admin-agent operation on `/api/admin/*`.

## Prefer `$tokhub`

Use `$tokhub` instead when:

- a user needs to log in with a normal TokHub account
- the task involves `/api/public/*`, `/v1/status/*`, `/api/me/*`, or `/api/console/*`
- the task should use website-equivalent session permissions
- the user is not definitely a platform owner/admin

## Do Not Use

- TokHub source-code development, debugging, code review, or UI work.
- Browser-click workflows that use a normal admin session instead of admin-agent automation.
- Creating, listing, revoking, or chaining admin-agent tokens with an existing bearer token.
- Gateway model calls under `/gateway/v1/*`.

## Workflow

1. Read `../tokhub/references/admin-agent-contract.md` and `../tokhub/references/admin-agent-operation-catalog.json`.
2. Run `node agent-skills/tokhub/scripts/tokhub.mjs admin-agent preflight`.
3. For reads, run `node agent-skills/tokhub/scripts/tokhub.mjs admin-agent request GET /api/admin/...`.
4. For writes, exports, downloads, deletes, bulk, reset, revoke, disable, credential, import, sync, package build/download, or key actions, require explicit user intent and pass `--execute --reason "..." --idempotency-key "..."`.
5. After any admin-agent write, run `node agent-skills/tokhub/scripts/tokhub.mjs admin-agent audit-verify --idempotency-key "..."`.

## Output Contract

Return the same fields as `$tokhub` admin-agent mode:

- target path and auth mode
- scopes and risk from the admin-agent catalog
- execution status and redacted response fields
- audit verification result for writes
- blocked precondition, missing env var, missing scope, or refusal reason

## Reference Map

- `../tokhub/references/admin-agent-contract.md`: maintained admin-agent auth, scope, idempotency, audit, and secret rules.
- `../tokhub/references/admin-agent-operation-catalog.json`: maintained `/api/admin/*` operation catalog.
- `references/admin-agent-contract.md`: legacy compatibility pointer for existing readers.
- `references/operation-catalog.json`: legacy catalog copy kept for old package consumers.
- `scripts/tokhub-admin.mjs`: compatibility wrapper around `../tokhub/scripts/tokhub.mjs admin-agent`.
- `evals/trigger_cases.json`: legacy alias trigger boundary cases.
- `reports/output-risk-profile.md`: output-risk notes for the legacy alias.
- `reports/trust-boundary.md`: token, network, and audit trust boundary for compatibility mode.
