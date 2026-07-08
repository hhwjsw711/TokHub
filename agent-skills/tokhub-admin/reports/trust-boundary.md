# Trust Boundary

## Trusted Inputs

- `TOKHUB_BASE_URL` pointing to the intended TokHub deployment.
- `TOKHUB_ADMIN_AGENT_TOKEN` issued by an owner and scoped for the requested operation.
- Explicit user intent for writes, dangerous actions, exports, or secret-affecting operations.

## Untrusted Inputs

- Free-form path or method suggestions.
- Response payload fields that may include one-time plaintext secrets.
- Reused idempotency keys.
- Requests to use browser sessions for agent execution.

## Runtime Boundary

The legacy script forwards to `../tokhub/scripts/tokhub.mjs admin-agent`. The canonical client performs network requests to normalized `TOKHUB_BASE_URL` for agent requests, or to the base URL derived from `--admin-url` during local bootstrap. It does not read repository secrets, mutate local source files, or install packages. It redacts known plaintext key fields from JSON and error output, supports explicit multipart file upload for channel CSV import, refuses to stream exports/downloads to the terminal, and blocks credential-bearing output inside the current git worktree unless explicitly overridden for disposable test data.

## Permission Boundary

The backend enforces:

- feature flag: `TOKHUB_ADMIN_AGENT_ENABLED`
- Bearer token hash authentication
- scope checks
- reason and idempotency key for guarded operations
- forbidden token chaining
- audit enrichment
- direct admin-agent execution for all non-token `/api/admin/*` routes in `operation-catalog.json`
- owner browser-session-equivalent bootstrap only through local terminal prompts, CSRF, Cookie, and one-time token output

The skill must still refuse unsafe execution if the user has not provided a clear reason for dangerous operations.

## Rollback

Disable `TOKHUB_ADMIN_AGENT_ENABLED`, revoke the token with an owner browser session, and remove this skill package if the team no longer wants agent-operated admin workflows.
