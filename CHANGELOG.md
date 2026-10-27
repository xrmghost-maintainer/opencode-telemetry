# Changelog

## [0.3.4] — Unreleased

### Fixes

- Configure existing JSON or JSONC files (comments and trailing commas supported),
  create a schema-bearing config when absent, and refuse ambiguous dual configs.
  Preserve comments with targeted edits and retain versioned original backups;
  refuse edits that would remove comments.
- Declare Bun >=1.3.13 and Node >=22.5 requirements. Launch the Bun CLI through a
  small Node wrapper with actionable installation and service-PATH diagnostics
  when Bun is missing, including for npm installations (fixes #55).

## [0.2.0] — 2026-05-06

### New features

- **`octm` CLI binary** — `opencode-telemetry` and `octm` are now available as terminal commands after install. Subcommands: `report`, `inspect`, `config`, `cache`, `sql`. Run `octm help` for usage.
- **Report persistence** — `octm report` and `octm inspect` save output to `~/.local/share/opencode-telemetry/reports/` by default. Slash commands return only the file path, eliminating model token waste.
- **Orchestration cost rollup** — the 7-day report now includes an "Orchestration Cost Rollup" section showing parent + child session costs aggregated via recursive CTE, exposing the true billed total for conductor sessions.
- **Token trajectory** — `octm inspect` now shows a Unicode block chart of context size per turn and a "Top Turn Deltas" table with Δ% per turn.
- **Config system** — `~/.config/opencode-telemetry/config.json` with dot-notation `octm config get/set/reset`. Supports `content_cache`, `sdk_bridge`, and `deployment_mode` keys.
- **Content cache** — disk-backed gzip cache for fetched message content at `~/.local/share/opencode-telemetry/content-cache/`. Managed via `octm cache stats/clear/prefetch`.
- **SDK bridge** (`src/sdk-bridge.ts`) — lazy on-demand content fetching via opencode SDK client for `octm inspect --content`. Requires opencode server to be running; falls back to cache.
- **Composition analyzer** (`src/analyzer/composition.ts`) — byte-based prompt breakdown into system / history / tool_outputs / user / assistant categories. Provider token counts are authoritative; percentages are proportional mappings.
- **Delta analyzer** (`src/analyzer/deltas.ts`) — turn-to-turn context growth computation with inferred likely causes from preceding tool call sizes.
- **`queries/subagent-tree.sql`** — pre-canned recursive CTE for full session tree cost rollup.
- **Test suite** — 23 tests covering config, composition analyzer, delta analyzer, and CLI arg parser.

### Schema changes (additive only)

- `turns.parent_tool_call_id TEXT` — links a turn's originating session to the tool call that spawned it
- `tool_calls.tool_call_id TEXT` — SDK call ID for turn-to-tool correlation
- `tool_calls.spawned_session_id TEXT` — session spawned by a `task`-type tool call
- `sessions.server_url TEXT` — stored by the plugin so the CLI can reconstruct the SDK client

All new columns are NULL by default; existing data is unaffected.

### Migration path for existing users

New columns are added automatically via `ALTER TABLE` migrations on plugin startup. No manual action required.

> **Retroactive correction**: the original v0.2 migration used bare `try/catch` around each
> `ALTER TABLE` which could silently swallow errors, leaving columns missing while
> `schema_version` was still bumped — an unrecoverable state. This was fixed in subsequent
> migrations (v4 and v5) which use `PRAGMA table_info` guards. See NOTES.md §17.

### Bug fixes / improvements

- Smoke test now verifies parent-child session attribution end-to-end
- `docs/v0.2-investigation.md` documents the Phase 0 subagent attribution investigation findings
- NOTES.md §15 records attribution verification status and diagnostic queries

### Known limitations

- `Session.parentID` is optional in the opencode SDK type; empirical verification requires a live Conductor session. See `docs/v0.2-investigation.md`.
- `octm inspect --content` requires the opencode server to be running.

---

## [0.1.0] — 2026-04-26

Initial release. Passive per-turn telemetry logging to SQLite. Token counts, tool calls, skill usage, cost estimates. Slash commands `/telemetry-report` and `/telemetry-inspect`.
# 0.3.0

- Add an OpenCode V2 lifecycle, public step-event subscription and tool-hook adapter;
  retain the independent V1 implementation for >=1.18.29, including 1.19.4.
- Record V2's reported costs (including subscription zero), step tokens, model,
  agent, parent sessions, failed calls and session completion without storing bodies.
- Filter server-wide events by location/workspace, abort subscriptions and close
  SQLite on cleanup, and fail silently on initialization errors.
- Ship a root directory entrypoint for OpenCode 2.1.3 and build Git installs via
  `prepare`, enabling tagged GitHub distribution without npm publishing.
- Add V2 regression tests and make npm releases manual-only.
- Minor bump for the additional plugin API/runtime support; CLI and telemetry DB
  remain compatible (schema 5). Optional content inspection remains V1-only.
