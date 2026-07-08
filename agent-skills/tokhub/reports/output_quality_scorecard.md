# Output Quality Scorecard

Governed package evidence status:

| Gate | Status | Evidence |
| --- | --- | --- |
| file-backed fixture | present | `input_files` in `manifest.json` |
| output contract | present | `manifest.json` and `SKILL.md` |
| rollback boundary | present | `manifest.json` |
| trust report | present | `reports/trust-boundary.md` |
| route eval | present | `evals/trigger_cases.json`, `evals/semantic_config.json` |
| deterministic client | present | `scripts/tokhub.mjs` |
| local runtime smoke | present | `node agent-skills/tokhub/scripts/tokhub.mjs --help`, `redact-self-test`, `catalog-check` |
| install simulation | missing evidence | Not packaged in this iteration |
| external telemetry | missing evidence | Not needed for local skill execution |

Reviewer note: the package intentionally separates the session operation catalog from the complete admin-agent catalog to keep ordinary user routing readable while preserving existing admin automation coverage.
