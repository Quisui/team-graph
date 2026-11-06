# Team Graph

A Claude Code plugin with a live terminal graph of your session's agents.
The orchestrator sits in the middle, agent boxes surround it, and a message
bus shows their communication and recent activity.

## Screenshots

Screenshots of the classic and retro themes are coming soon.

## Features

- Claude Code teams and subagents, including live tmux teammate activity.
- Codex jobs and other AI CLIs launched through Bash: Gemini, OpenCode, Amp,
  Kimi, Copilot, and `claude -p`.
- Classic and retro themes; retro includes an animated robot head and gradient progress bar.
- Message flights, completion flashes, per-agent timers, and an activity sparkline.
- A 400 ms graph sweep, a 600 ms completion colour fade, and flowing hue on running lines.
- Persisted visibility, theme, robot style, motion, and graph height. Idle effects stop updating.
- Resize controls with `k` / `j` in the docked view; automatic layout sizing.
- Job discovery in `$TMPDIR`, `/private/tmp`, and `/tmp` on macOS and Linux.

## Requirements

- Claude Code with hooks modules enabled. This API is experimental and may be
  gated or unavailable in your build/account.
- Optional: tmux for split teammates and live pane activity.
- Optional: the Codex plugin for Codex background job logs. Foreground AI CLI
  launches also appear without it.

## Install

Load this folder directly:

```sh
claude --plugin-dir <path>
```

Or merge this environment setting into `~/.claude/settings.json`, using an
absolute path to this folder:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/team-graph"
  }
}
```

## Use

```text
/team-graph
/team-graph --theme classic
/team-graph --theme retro
/team-graph --robot head
/team-graph --robot plain
/team-graph --rows 17
/team-graph --motion off
/team-graph --motion on
```

The pane opens by default in a new session. `/team-graph` toggles it, and a
hidden pane stays hidden across sessions. Theme selection also shows a hidden pane.
`--rows` sets docked graph height (11 to 40); automatic height remains the default.
`--motion` persists your preference without toggling visibility. Motion is on
by default. Motion automatically stops when the pane viewport has fewer than
20 rows or `NO_MOTION` is set in the environment (read once at startup).
`--motion on` restores the preference; automatic reduction still takes priority.
With motion disabled, sweep-in, completion fades, hue flow, spinners, message
movement, and robot animation stop. Working eyes stay static (`●   ●` for
`head`, `[•_•]` for `plain`); completed eyes remain `^   ^`. Agent activity and
status still update. Below 70 columns, labels shorten, names truncate with `…`,
and the head's eyes move closer (`● ●`). Below 40 columns or 9 rows, the head
uses a single-line fallback such as `[● ●] 2 running` (the plain robot has no
track). Agent statuses use `●` running, `✓` done, `✗` failed/killed, and `○`
pending or idle before starting. A Codex or other AI CLI job that was killed or
interrupted ends as `stopped`, not failed. A run with failures ends with
`Done · N failed` instead of `All done`. Message age uses
three brightness levels: newest normal, middle dim, oldest dimmer.

`retro` is the default theme (state colours, gradient progress bar, robot head); `classic` colours each agent instead.

`--robot head|plain` selects and persists the retro robot without toggling
visibility; `--robot=head` also works. `head` is the default: a rounded white
outline with two mint-green eyes beside the progress bar and running count.
Working eyes (`●   ●`) glance slowly and blink every few seconds; a message
landing on Main or Orchestrator triggers a quick double blink. Completed eyes
are `^   ^`, idle/no-agent eyes are dim grey `−   −`, and a failed agent with
nothing running gives red `×   ×` eyes. Motion reduction disables glancing and
blinking. `plain` keeps the original `[•_•]` walking track and `\[^_^]/ All done`
cheer. Classic rendering is unaffected.

Theme aliases: `-t retro`, `--theme=retro`, or a bare `retro` / `classic`.
Use `k` to shrink the graph and `j` to grow it when the resize divider appears.
The fullscreen layout puts the bus beside the graph; narrower layouts put it below.

## Checks

Run from this folder:

```sh
claude plugin validate .
claude plugin test .
```

If the test runner reports hooks modules are turned off, enable them in a
supported Claude Code environment before relying on test results.

MIT licensed. See [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md).
