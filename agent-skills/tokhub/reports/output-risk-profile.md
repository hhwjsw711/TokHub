# Output Risk Profile

## Likely Mistakes

- Treating ordinary users as platform admins because they can log in.
- Printing cookies, CSRF tokens, gateway keys, provider keys, site keys, or admin-agent tokens.
- Running a write, export, delete, revoke, reset, import, sync, or package operation without explicit reason and idempotency.
- Using `/api/admin/*` when the user's role only allows `/api/console/*`.
- Hand-writing curl for guarded operations and bypassing the bundled client redaction.
- Claiming audit verification for session writes; only admin-agent writes have agent audit metadata.
- Saving session profiles, admin-agent env files, or exports into the repository where they may be committed later.

## Mitigations

- Run `whoami` or `preflight` before role-sensitive operations.
- Inspect `references/operation-catalog.json` and `references/permission-model.md` before writes.
- Use `scripts/tokhub.mjs`; do not hand-roll mutating requests.
- Require `--output` for exports and downloads.
- Keep outputs outside the git worktree by default; use `--overwrite` only when intentionally replacing a local artifact.
- Report 403 responses as permission boundaries, not as errors to work around.
- After admin-agent writes, run `admin-agent audit-verify`.
