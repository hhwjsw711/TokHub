# Trust Boundary

## Local Secrets

The skill may create local session profiles under `~/.tokhub/sessions` or `TOKHUB_SESSION_DIR`. These files contain session cookies and CSRF tokens. They must stay local, use `0600` file permissions, and never be committed.

The admin-agent branch may create `.env` files containing `TOKHUB_ADMIN_AGENT_TOKEN`. Those files are token material and must also stay local with `0600` permissions.

The client refuses to write session profiles, admin-agent env files, exports, downloads, or package outputs inside the current git worktree by default. `--allow-repo-output` or `TOKHUB_ALLOW_REPO_OUTPUT=1` is reserved for disposable test data.

## Network Boundary

The user supplies the TokHub base URL. The script rejects URLs containing embedded credentials and normalizes the URL to the origin. Admin-agent `TOKHUB_BASE_URL` uses the same normalization.

The client only allows these API prefixes:

- `/api/public/*`
- `/v1/status/*`
- `/api/me/*`
- `/api/console/*`
- `/api/admin/*`

It does not call `/gateway/v1/*`.

`/v1/status/*` requires a local Site Key environment variable passed through `--site-key-env`; the skill must not accept Site Key plaintext in chat or as a raw command value.

## Permission Boundary

Session mode follows the same server-side role checks as the website. The server is authoritative. A 401 or 403 is a final permission result unless the user logs in with a different account.

Admin-agent mode uses scoped bearer tokens and must include reason and idempotency for guarded operations. It cannot manage `/api/admin/agent-tokens` with bearer auth.

## Output Boundary

All JSON output is recursively redacted for known secret fields, and error output is redacted before printing. This reduces but does not replace human judgment. Final answers must still omit plaintext keys and local credential paths unless the path itself is needed as an operational result.
