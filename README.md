# opencode-telemetry

Local-first historical telemetry for opencode sessions. Track where your tokens go in agent orchestration chains — without external infrastructure.

[![npm](https://img.shields.io/npm/v/opencode-telemetry?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/opencode-telemetry)

## Requirements

- **Bun >=1.3.13**, available on `PATH`. The plugin and CLI use `bun:sqlite`;
  installing the package with npm does **not** install Bun, and Node's SQLite
  support is not a replacement.
- **Node >=22.5** for the CLI launcher/configuration helper, and npm or Bun to install.

Install Bun ([official instructions](https://bun.sh/docs/installation)):

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Services such as systemd often have a reduced PATH that does not include
`~/.bun/bin`. Configure the service PATH, or expose Bun in a directory it searches:

```bash
sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
```

Ensure `/usr/local/bin` is on the **service's** PATH and restart the service.
Use the Bun installation belonging to the service user. `octm` now reports
installation/PATH instructions if Bun cannot be started, even after an npm install.

## What it does

- Logs every opencode session to a local SQLite database automatically
- Aggregates costs across orchestration chains (conductor + all child sessions), showing the true total rather than just the parent's share
- Forensic per-session inspection: full token trajectory, turn-by-turn context growth, identified delta drivers ("turn 32 grew by 20k tokens — likely a 41KB bash result entered history")
- CLI binary (`octm`) generates and saves reports to disk without consuming model tokens to re-emit them
- No external services — your data stays on your machine, no collectors required

## When to use this plugin

The opencode ecosystem has several telemetry plugins with different scopes. Pick the one that matches your need:

| Need | Plugin |
|------|--------|
| Inspect a live session interactively to see how tokens are split right now | [Opencode-Context-Analysis-Plugin](https://github.com/IgorWarzocha/Opencode-Context-Analysis-Plugin) by Igor Warzocha |
| Deep on-demand breakdown of a single session (context composition, tool-schema sizing, cache efficiency) via a slash command | [Tokenscope](https://github.com/ramtinJ95/opencode-tokenscope) by ramtinJ95 |
| Stream telemetry to an existing observability backend (Datadog, Honeycomb, Grafana Cloud) | [opencode-plugin-otel](https://github.com/DEVtheOPS/opencode-plugin-otel) by DEVtheOPS |
| Analyze sessions historically, forensically, locally, across runs, with no infrastructure | **opencode-telemetry** (this plugin) |

The distinction that matters: Tokenscope and Igor's plugin run on demand against the session you point them at — they answer "what does *this* session look like right now?". opencode-telemetry runs passively and persists every session to SQLite, so it answers "what happened across all my sessions last week, and which orchestration chains cost the most?". They are complementary: use Tokenscope for a deep one-shot autopsy, use this plugin for cross-session history and orchestration-chain rollups.

These plugins are complementary, not competing. You can install more than one.

This plugin is built for users who:
- Run complex orchestration chains (e.g. agent swarms with parent/child session dispatch)
- Want to analyze sessions days or weeks after they ran
- Don't have or want an OpenTelemetry collector running
- Need turn-by-turn forensics to understand "where did those tokens actually go?"

We owe a debt of inspiration to the projects above — the live-decomposition approach (Igor), the deep per-session context breakdown (Tokenscope), and the streaming-export model (DEVtheOPS). This plugin fills the remaining corner: persistent, local, forensic, cross-session.

## Installation

```bash
npm install -g opencode-telemetry
# or
bun add -g opencode-telemetry
```

Add to your opencode config (`~/.config/opencode/opencode.json` or `opencode.jsonc`):

```json
{
  "plugins": [
    "opencode-telemetry"
  ]
}
```

The plugin starts logging automatically. No configuration required.

### OpenCode V1 → V2 / npm release 0.3.0

Version 0.3.0 supports OpenCode 2.1.3 and V1 >=1.18.29 (including 1.19.4).
The entrypoint has independent V1 `server` and V2 `setup` implementations.
After **0.3.0 is available on npm**, install the CLI and package while still on
OpenCode 1.19.4 (Node >=22.5, npm, and write access to your global npm prefix):

```bash
npm view opencode-telemetry@0.3.0 version
npm install --global opencode-telemetry@0.3.0
octm help
node "$(npm root -g)/opencode-telemetry/scripts/configure-plugin.js" v1
```

V1 uses `"plugin": ["opencode-telemetry@0.3.0"]`, which downloads its own copy
from npm. The script preserves unrelated settings/plugins, replaces old telemetry
entries in both arrays, and saves the original file once as
`<config-file>.before-octm-<installed-version>`.

The helper uses `opencode.json` if present, otherwise `opencode.jsonc`; if neither
exists it creates `opencode.json` with `$schema` and the plugin entry. It honors
`XDG_CONFIG_HOME`. Both files support `//` comments, `/* */` comments and trailing
commas. Targeted edits via `jsonc-parser` preserve comments and unrelated settings
instead of reserializing the document. If an edit would remove a comment attached
to a replaced telemetry entry, the helper stops without writing and asks you to
move the comment outside that entry. Existing backups are never overwritten;
new configurations have no original to back up.

If **both** files exist the helper stops with a clear error and changes neither.
The [V1 config docs](https://opencode.ai/docs/config/) and
[V2 config docs](https://opencode.ai/v2/docs/config) describe JSON/JSONC and
precedence across configuration locations, but do not specify an unambiguous
same-directory `opencode.json` versus `opencode.jsonc` precedence. Consolidate
them into one file before using this helper rather than guessing which to edit.

Pause agent jobs before upgrading OpenCode with your normal V2 installation
procedure. After installing V2, configure the plugin **before starting sessions
or restarting the shared service**:

```bash
opencode --version  # expected: v2.x; tested with v2.1.3
node "$(npm root -g)/opencode-telemetry/scripts/configure-plugin.js" v2
opencode service restart
opencode service status
opencode run --model openai/gpt-5.6-luna --format json 'Reply only OK. Do not use tools.'
octm sql 'select session_id,total_turns,total_input_tokens,total_output_tokens,total_cached_read,est_cost_usd from sessions order by started_at desc limit 3'
```

V2 uses the **absolute directory of the npm-installed package**, not the checkout
or an individual file. Example for a system npm prefix:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/usr/lib/node_modules/opencode-telemetry"]
}
```

OpenCode 2.1.3 local-directory discovery needs the shipped root `index.ts`;
`main`/`exports` alone are insufficient in that release. This installed-directory
form was tested with a globally installed tarball in a temporary npm prefix,
outside the source checkout. V2 also recognizes npm specifications in `plugins`
(and the legacy `plugin` alias), but the directory form avoids a second download
and is the verified deployment path for 2.1.3.

Do not run V1 against OpenCode's internal DB after V2 migrated it; the plugin's
separate telemetry DB remains schema 5 and can be read by both versions.
Keep the same runtime user, `XDG_DATA_HOME`, and global npm prefix used by Loom;
`TelemetryPath = octm` needs no change. The final query must include the session ID
printed by `opencode run`, with at least one turn and nonzero output tokens.

V2 records `session.step.started`/`ended` (and failed steps with usage), tool hooks,
parent links, and completion. The public stream is server-wide; events are filtered
by plugin location/workspace. `est_cost_usd` uses the cost reported by V2, including
zero for subscription-backed calls; this is **not** an equivalent pay-as-you-go price.
Auxiliary title/generate calls are not agent turns and are not included. V1 keeps
static pricing estimates; unknown models remain NULL. No schema change is needed.
Optional `octm inspect --content`/content cache still use the V1 server API and
are not ported to V2; SQL and token/cost reports read the independent telemetry DB.

The release workflow publishes automatically on pushes to `main`. It uses the
`package.json` version when it is greater than the latest stable `vX.Y.Z` tag;
otherwise it increments that tag's patch. Prerelease tags are ignored. With no
stable tags, it retains the previous fallback of incrementing the package patch.
With the latest stable tag `v0.3.3` and the unchanged package version `0.3.0`,
the next release will be **0.3.4** (tag `v0.3.4`). Wait for
`npm view opencode-telemetry@0.3.4 version` to succeed before installing these fixes.
The configuration helper
reads the installed package version for the V1 npm reference and backup name;
V2 continues to use the installed package directory.

## Quickstart

### Pattern 1 — Just install and forget

The plugin starts logging automatically. Nothing to configure. Sessions land in `~/.local/share/opencode-telemetry/data.db`.

### Pattern 2 — Get a 7-day report

From terminal (no model token cost):
```bash
octm report
```

Or from inside opencode (saves to file, returns the path):
```
/telemetry-report
```

### Pattern 3 — Forensic inspect of a specific session

```bash
octm inspect ses_2073813f
```

Add `--content` to fetch and analyze the full prompt content for every turn (requires opencode server running; results are cached locally):

```bash
octm inspect ses_2073813f --content
```

This produces a report with:
- Token trajectory chart across all turns
- Top turn deltas with identified causes
- Agent chain breakdown
- Child session rollup with aggregated costs

## Commands reference

### `octm` CLI

```
octm report [--days N] [--save] [--no-save] [--format md|json]
  Generate a report for the last N days (default: 7).
  Saves to ~/.local/share/opencode-telemetry/reports/ by default.
  --no-save: print to stdout only.
  --format json: output structured JSON.

octm inspect <session_id> [--content] [--save] [--no-save]
  Deep-dive into a session. Supports ID prefix matching.
  --content: fetch and analyze full prompt content (lazy, cached).
  Saves to ~/.local/share/opencode-telemetry/reports/ by default.

octm config show
octm config get <key>
octm config set <key> <value>
octm config reset
  Manage ~/.config/opencode-telemetry/config.json.
  Keys use dot notation: content_cache.enabled, sdk_bridge.enabled, deployment_mode.

octm cache stats
octm cache clear [--older-than <N>d]
octm cache prefetch <session_id>
  Manage the content cache.

octm sql "<query>"
octm sql --file <path>
  Run a read-only SQL query against the telemetry DB.

octm help
```

### Slash commands

| Command | What it does |
|---------|-------------|
| `/telemetry-report` | Runs `octm report --save`, returns the saved file path |
| `/telemetry-inspect <session_id>` | Runs `octm inspect --save`, returns the saved file path |
| `/telemetry-db-analyst` | Opens a SQL skill for direct DB access |

Slash commands return only the file path — they do not re-emit report contents through the model.

## Configuration

Config file: `~/.config/opencode-telemetry/config.json`

```json
{
  "version": 1,
  "content_cache": {
    "enabled": true,
    "path": "~/.local/share/opencode-telemetry/content-cache"
  },
  "sdk_bridge": {
    "enabled": true
  },
  "deployment_mode": "auto"
}
```

| Key | Values | Description |
|-----|--------|-------------|
| `content_cache.enabled` | `true` / `false` | Whether fetched prompt content is cached to disk |
| `content_cache.path` | path string | Where to store the cache |
| `sdk_bridge.enabled` | `true` / `false` | Whether `--content` fetching is active |
| `deployment_mode` | `auto` / `single_user` / `server` | In `server` mode, content cache is disabled by default |

## Privacy and storage

This plugin stores data locally. Two locations matter:

- **Metrics database** (`~/.local/share/opencode-telemetry/data.db`): contains token counts, byte sizes, durations, session metadata. Never contains prompt content.
- **Content cache** (`~/.local/share/opencode-telemetry/content-cache/`): populated only when you run `octm inspect --content`. Caches the prompt content fetched via opencode SDK so re-running analyses is fast.

Disable the content cache persistently:

```bash
octm config set content_cache.enabled false
```

In server-mode opencode deployments, the content cache is disabled by default. No data is sent off your machine. There is no telemetry-of-the-telemetry.

## Known limitations

- **Subagent attribution** requires opencode to populate `Session.parentID` when spawning child sessions. This is structurally correct in v0.2 but cannot be empirically verified without a live Conductor session. If parent-child costs still show a discrepancy, check `docs/v0.2-investigation.md` for the diagnostic queries.
- **Token composition percentages** are byte-based (±15% on absolutes, <5% on ratios). For exact tokenizer counts use [Opencode-Context-Analysis-Plugin](https://github.com/IgorWarzocha/Opencode-Context-Analysis-Plugin).
- **`--content` requires opencode server** to be running. Without it, only cached content is available.
- **Server deployments**: content cache disabled by default for privacy.
- **No real-time export** — for streaming to observability backends, see [opencode-plugin-otel](https://github.com/DEVtheOPS/opencode-plugin-otel).

## Contributing

Issues and PRs welcome at [github.com/agostinilabsrl/opencode-telemetry](https://github.com/agostinilabsrl/opencode-telemetry).

## License

MIT
