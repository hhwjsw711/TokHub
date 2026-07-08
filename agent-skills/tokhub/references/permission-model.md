# Permission Model

TokHub skill permissions are exactly website-equivalent. The skill does not create a second authorization model.

## Auth Modes

| Mode | Surface | Credential | Boundary |
| --- | --- | --- | --- |
| public | `/api/public/*` | none or logged-in profile | public read data only |
| status-api | `/v1/status/*` | local Site Key env var via `--site-key-env` | Open API site-scoped status data |
| user | `/api/me/*` | session cookie + CSRF | current user's own profile, favorites, and private channel workspace context |
| console | `/api/console/*` | session cookie + CSRF | current workspace membership |
| admin-session | `/api/admin/*` | session cookie + CSRF | platform `owner` or `admin` users |
| admin-agent | `/api/admin/*` | `TOKHUB_ADMIN_AGENT_TOKEN` | scoped owner/admin automation |

## Workspace Roles

- `viewer`: read workspace data.
- `operator`: operate gateways, private channels, probes, alerts, and incidents.
- `admin`: operator permissions plus workspace settings and members.
- `owner`: workspace admin plus protected owner status.

The server remains authoritative. If a role is insufficient, report the 403 instead of attempting a workaround.

## Guarded Operations

These require explicit user intent and the client flags `--execute --reason --idempotency-key`:

- every non-read request
- CSV or JSON export
- package download
- delete, disable, revoke, reset, bulk, import, sync
- credential, key, token, site key, provider key, or package build actions

The `reason` is a human explanation. Do not invent it when the user's intent is unclear.

## Secret Handling

Never print or summarize plaintext:

- provider API keys
- user private channel API keys
- gateway key plaintext
- Open API site key plaintext
- channel-site package secrets
- cookies, CSRF tokens, session files, or admin-agent tokens

Never pass a Site Key as a raw command argument. Store it in a local environment variable and use `--site-key-env ENV_VAR`.

Exports and downloads must use `--output`. Output files are written with `0600` permissions, do not overwrite existing files unless `--overwrite` is passed, and are blocked inside the current git worktree unless `--allow-repo-output` or `TOKHUB_ALLOW_REPO_OUTPUT=1` is used for disposable test data. Treat secret-bearing output paths as key material.
