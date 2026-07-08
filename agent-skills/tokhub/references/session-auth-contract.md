# Session Auth Contract

TokHub session mode uses the same browser-equivalent authentication surface as the website:

- `GET /api/auth/csrf`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

The script prompts for password only in the terminal or reads it from `TOKHUB_PASSWORD` for non-interactive local automation. Ordinary `login` does not read `TOKHUB_ADMIN_PASSWORD`; admin bootstrap may read `TOKHUB_ADMIN_PASSWORD` only in the explicit `admin-agent bootstrap` branch. It must never ask the user to paste a password into chat.

## Local Profile Storage

`scripts/tokhub.mjs login` stores a local profile file under:

```text
${TOKHUB_SESSION_DIR:-~/.tokhub/sessions}/<profile>.json
```

The file contains the base URL, session cookies, CSRF token, current user summary, and selected workspace ID. It is written with `0600` permissions. Newly created profile directories use `0700`; existing directories should already be private and must not be symlinks.

This profile file is local credential material. Do not commit it, quote it, upload it, or print cookie values in final responses.

The client refuses to write session profiles inside the current git worktree by default. If a disposable test fixture really needs repo-local output, the operator must set `TOKHUB_ALLOW_REPO_OUTPUT=1`.

## URL Handling

The login URL may be a root URL, an admin URL, or a console URL. The client normalizes it to the origin. URLs containing username or password are rejected.

Request paths must remain same-origin API paths. Dot segments, encoded dot segments, backslashes, control characters, and `/gateway/v1/*` model calls are rejected.

## CSRF Handling

Session writes must send `X-CSRF-Token`. If the server returns `csrf_invalid`, the client may refresh CSRF once through `/api/auth/csrf` and retry the same request.

Admin-agent bearer requests are a separate auth mode. They intentionally bypass CSRF only on `/api/admin/*` because the server enforces bearer scopes, reason, idempotency, and audit metadata.

## Logout

`logout` calls `/api/auth/logout` when possible and removes the local profile file even if the remote session is already expired.
