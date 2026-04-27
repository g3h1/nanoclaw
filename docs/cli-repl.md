# Terminal chat: the cli channel and `nclaw`

Always-on, zero-credential way to talk to your agent from a local
terminal. The host listens on a Unix socket; the `nclaw` client connects
and runs an interactive REPL. No bot tokens, no platform integrations,
no internet. The chmod-0600 socket file is the only access gate.

This is the doc for both the **operator** (you, running it) and the
**contributor** (anyone reading the code). User-facing material is up
top; the wire protocol and architecture are in the second half.

## When you'd use this

- Quick test that an agent is reachable and your wiring works.
- Operating an agent without setting up a chat-platform integration.
- Local debugging — type, see the reply, check the host log.
- One-shot scripts: `pnpm run chat "do the thing"` (the existing
  one-shot client) for non-interactive automation.

## Install

The host always exposes the socket if it's running — no setup there.
Two clients ship in this repo:

| Client | Style | Use it for |
|---|---|---|
| `pnpm run chat "msg"` | one-shot | scripts, pipes, single questions |
| `pnpm run chat-repl` *(or `nclaw`)* | interactive REPL | actual conversations |

To get `nclaw` on your `PATH`:

```bash
ln -sf "$(pwd)/scripts/nclaw" ~/.local/bin/nclaw
# make sure ~/.local/bin is on PATH
```

`scripts/nclaw` is a tiny bash shim that resolves the symlink, cd's
into the repo, and `exec`s `pnpm exec tsx scripts/chat-repl.ts`. You
can launch it from any cwd.

## Use

```
$ nclaw
Connecting to Terminal Agent…
[connected — chatting as Terminal Agent; /help or /quit]
Terminal Agent> hello
< Hi! How can I help?
Terminal Agent> /quit
[disconnected]
```

If multiple agent groups are wired to the cli channel, you'll get a
picker. If exactly one is wired, it auto-selects.

### Slash commands

| Command | Effect |
|---|---|
| `/help`, `/?` | Show the in-REPL help |
| `/agents` | Re-query the DB and list agent groups (the current one is marked) |
| `/switch [name\|n]` | Disconnect and re-pick. With no arg, runs the picker. With a name, fuzzy-matches against agent names; with a number, picks by 1-based index from `/agents` |
| `/clear` | Clear the agent's session memory (requires owner role — see below) |
| `/paste` | Alias for `:paste` |
| `/quit`, `/exit` | Close socket and leave |

`/clear` is a *server-side* admin command. It's gated by `command-gate`
(`src/command-gate.ts`) — see the "Owner setup" section.

### Multi-line input

Two ways to send a message that contains newlines:

- **Backslash continuation.** End any line with `\` and the prompt
  becomes `… ` until you submit a line that doesn't end in `\`. The
  whole accumulated buffer is sent as one message.
  ```
  Terminal Agent> draft a haiku about \
  … octopuses \
  … please.
  < ...
  ```
- **`:paste` block.** Type `:paste` to enter paste mode (prompt becomes
  `paste> `). Lines accumulate verbatim. Send with `:end` or an empty
  line.
  ```
  Terminal Agent> :paste
  (paste mode — end with `:end` or an empty line)
  paste> first line
  paste> second line
  paste> :end
  ```

Single Ctrl+C while a multi-line buffer is open clears the buffer.
Ctrl+C twice on an empty prompt force-quits.

There's a deliberate gap here: **Alt+Enter for inline newline** is *not*
implemented. See [`docs/cli-repl-followups.md`](cli-repl-followups.md)
for why and what it would take.

### History

Submitted messages persist to `~/.cache/nanoclaw/repl-history` (capped at
1000 lines). Up/Down arrow recall. Slash commands and the literal
`:paste` keyword aren't recorded.

Caveat: a multi-line message currently lands as multiple physical lines
in the history file, so it shows up as separate Up-arrow entries. Tracked
in the followups doc.

### Replies and labels

Replies print prefixed with `< `. If a reply originates from an agent
group *other* than the one you picked (because multiple agents are wired
to `cli/local` and the router fanned out), it renders with a bracketed
label:

```
Terminal Agent> ping
< pong from main agent
[Sidekick Agent] also pong from me
```

This requires the host to be running a build that includes the
`agentGroupId` plumbing in `src/channels/cli.ts` and `src/delivery.ts`.
If the host is older and only sends `{text}`, replies are unlabeled —
graceful degradation, no errors.

### Thinking spinner

Between sending a message and the first byte of reply, the REPL renders
a small `⠋ thinking…` spinner. It clears the moment a reply lands. The
spinner is suppressed when stdout isn't a TTY.

## Owner setup (required for `/clear` and other admin commands)

The cli socket is `chmod 0600`, so by file-system permission you are
already "the operator". The REPL takes the next step and binds the
connection to a real `user_id`:

1. On chat-slot claim, `src/channels/cli.ts` calls
   `getOwners()` from `src/modules/permissions/db/user-roles.ts`.
2. If at least one owner exists, the first (by `granted_at`) is used as
   the `senderId` for plain-chat messages.
3. `src/command-gate.ts:49-63` looks up that `user_id` in `user_roles`
   and accepts `/clear`, `/compact`, `/context`, `/cost`, `/files`.

If **no** owner is configured, the senderId falls back to the synthetic
`cli:local` and admin commands are denied. Granting yourself owner is a
one-time SQL insert against `data/v2.db`:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/v2.db');
db.prepare(\`
  INSERT INTO user_roles (user_id, role, agent_group_id, granted_by, granted_at)
  VALUES ('cli:local', 'owner', NULL, 'cli:local', ?)
\`).run(new Date().toISOString());
"
```

That binds ownership to the synthetic `cli:local` user (display name "h"
in your install) — effectively saying "anyone with file-perm to talk to
`data/cli.sock` is owner". Since the socket is 0600, that's only you.

Alternatively, grant a real-channel identity (`telegram:123…`,
`discord:456…`) — the cli socket will use that user_id as senderId. See
the chat history transcript for the recipe; the schema is the same.

To revoke:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/v2.db');
db.prepare(\"DELETE FROM user_roles WHERE user_id=? AND role='owner' AND agent_group_id IS NULL\").run('cli:local');
"
```

## Troubleshooting

- **`NanoClaw daemon not reachable at .../cli.sock`** — the host isn't
  running (or just crashed). Restart it. On Linux:
  `systemctl --user restart nanoclaw-v2-<install-id>` (your unit name
  has the install-id suffix; `systemctl --user list-units '*nano*'` to
  find it). On macOS: `launchctl kickstart -k gui/$(id -u) com.nanoclaw`.

- **`No agent groups registered. Run /init-first-agent.`** — the
  central DB has no `agent_groups` rows yet. Run `/init-first-agent`
  from a Claude Code session inside this repo.

- **Picked an agent and got "is not wired to the cli/local channel"** —
  the agent group exists but isn't reachable via the cli channel. Run
  `/manage-channels` and wire the cli channel to it.

- **`/clear` returns "Permission denied"** — no owner is configured (or
  the configured owner doesn't match the cli socket's resolved
  senderId). See the Owner setup section. Check the host log
  (`logs/nanoclaw.log`) for `CLI client connected operator=…` to see
  what user_id was resolved.

- **`[superseded by a newer client]` and the REPL exited** — another
  client (a second `nclaw`, a dashboard, anything connecting to the
  cli socket as a "plain chat" client) claimed the slot. Single-client
  semantics are intentional. Reconnect to take it back.

- **No reply but no error either** — the agent might be working on it;
  watch the spinner. If the spinner clears with no reply, check
  `logs/nanoclaw.log` and `logs/nanoclaw.error.log` for delivery errors.

## Architecture / wire protocol

This section is for readers of the code.

### The socket

`src/channels/cli.ts` registers a `cli` channel with `channelType=cli`
and `platformId=local`. On `setup()`:

1. Removes any stale socket file at `data/cli.sock`.
2. `net.createServer(...)` listens on the path.
3. `chmod 0600` the socket file (the access gate).

Single-client chat semantics: at most one socket may hold the *chat
slot* at a time. Connecting and sending a plain-chat line claims the
slot and supersedes any prior holder with a `[superseded by a newer
client]` notice on the way out.

### Wire format

JSON-per-line over the socket. Two client→server forms:

```jsonc
// Plain chat — claims the chat slot, routes via the messaging_group
// wired to (cli, local). senderId is set by the adapter to the global
// owner's user_id (or 'cli:local' when no owner exists).
{ "text": "hello" }

// Routed admin transport — DOES NOT claim the chat slot. Builds an
// InboundEvent targeting `to`'s channel/platform and (optionally)
// redirects replies via reply_to. Used by bootstrap scripts (e.g.
// scripts/init-first-agent.ts) to inject messages targeting any wired
// channel from the operator-trusted socket.
{
  "text": "...",
  "to":       { "channelType": "discord", "platformId": "...", "threadId": null },
  "reply_to": { "channelType": "cli",     "platformId": "local", "threadId": null }
}
```

One server→client form:

```jsonc
{ "text": "agent reply", "agent": "Terminal Agent" }
// `agent` is included when the host knows which agent_group produced
// the message. Older host builds emit `{text}` only — clients should
// ignore unknown fields.
```

### Reply delivery

`adapter.deliver()` (line ~119) is called by the delivery loop when the
container writes an outbound message. It writes to the connected socket
*only if* the chat slot is claimed (`if (!client) return undefined;`).
This means a routed admin-transport-only client never receives replies
through the socket — replies come back to whatever `reply_to` resolved
to (typically still cli/local — but the chat slot must have been claimed
by *some* client for the line to actually print).

`agentGroupId` is plumbed from `delivery.ts` (where the `Session` is in
scope and carries `agent_group_id`), through the bridge in
`src/index.ts`, into `OutboundMessage.agentGroupId`. The cli adapter
resolves it to a name via `getAgentGroup()` and adds the `agent` field
to the JSON.

### Identity at chat-slot claim

When a client claims the chat slot (first plain-chat line on the
connection), the adapter resolves the global owner's `user_id` from
`user_roles` once per connection and uses it as the `senderId` of the
inbound event. This lets `command-gate` (`src/command-gate.ts:49-63`)
match the user against `user_roles` and accept admin commands.

If no owner is configured, the synthetic `cli:local` is used as
senderId — admin commands are denied (no row in `user_roles`), but
plain chat works.

### Files

| Path | Purpose |
|---|---|
| `src/channels/cli.ts` | The channel adapter — server, deliver, wire format |
| `src/channels/adapter.ts` | `OutboundMessage` interface (incl. `agentGroupId`) |
| `src/delivery.ts` | `ChannelDeliveryAdapter` interface + delivery loop |
| `src/index.ts` | Bridge that constructs `OutboundMessage` from `messages_out` rows |
| `src/command-gate.ts` | Slash-command classification (filter / admin / pass) |
| `src/modules/permissions/db/user-roles.ts` | `getOwners`, `isOwner`, `hasAdminPrivilege`, etc. |
| `scripts/chat-repl.ts` | The REPL client |
| `scripts/chat.ts` | The original one-shot client |
| `scripts/nclaw` | bash shim — symlink target |
| `docs/cli-repl-followups.md` | Deferred work (Alt+Enter, history fix, smaller ideas) |

## See also

- [`docs/cli-repl-followups.md`](cli-repl-followups.md) — what's
  intentionally not implemented yet, and why.
- [`docs/architecture.md`](architecture.md) — the full architecture;
  read this if you want to understand how channels in general fit in.
- [`docs/db-central.md`](db-central.md), [`docs/db-session.md`](db-session.md)
  — DB shape for `user_roles`, `messaging_group_agents`, etc.
- `CLAUDE.md` (root) — project-level pointers; "Key Files" table is the
  fast index into the code.
