# TokHub Admin Legacy Contract

`tokhub-admin` is a compatibility package. The maintained admin-agent contract now lives in:

```text
../tokhub/references/admin-agent-contract.md
```

Use:

```bash
node agent-skills/tokhub/scripts/tokhub.mjs admin-agent <command>
```

The legacy script `scripts/tokhub-admin.mjs` is only a wrapper that forwards to the canonical `tokhub.mjs admin-agent` branch. It inherits the newer safety defaults:

- `TOKHUB_BASE_URL` is normalized like a normal TokHub URL and cannot include embedded credentials.
- Exports, downloads, and package artifacts require `--output`.
- Session, env, export, and package files are written with `0600` permissions.
- Existing output files are not overwritten unless `--overwrite` is passed.
- Credential-bearing outputs are blocked inside the current git worktree unless `--allow-repo-output` or `TOKHUB_ALLOW_REPO_OUTPUT=1` is explicitly used for disposable test data.
- Bearer admin-agent tokens cannot manage `/api/admin/agent-tokens`.
