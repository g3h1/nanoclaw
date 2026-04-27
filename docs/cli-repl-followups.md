# CLI REPL — follow-ups

Tracks deferred work on the CLI REPL (`scripts/chat-repl.ts`,
`scripts/nclaw`). Parent doc: [`cli-repl.md`](cli-repl.md).

## Raw-mode line editor with Alt+Enter for inline newline

**Status:** open.

**Goal.** Let the user insert a literal newline mid-prompt by pressing
Alt+Enter (a.k.a. Meta+Enter) instead of having to use backslash
continuation or `:paste` mode. This is the keybinding that IPython,
prompt_toolkit, fish's multiline edit, and most chat REPLs converge on.

**Why not Shift+Enter.** Most terminal emulators do not distinguish
Shift+Enter from Enter — both produce a single `\r` byte. Detecting
Shift+Enter requires the terminal AND the app to negotiate an extended
keyboard protocol (xterm `modifyOtherKeys`, kitty CSI-u, etc.). That's
brittle across terminals; Alt+Enter works portably because Alt is sent
as an Esc prefix, which Node's `readline.emitKeypressEvents` exposes
as `{name: 'return', meta: true}`.

**Why deferred.** Node's `readline.createInterface` accepts any `\r`
as line submit and exposes no "preventDefault" — by the time we hear
the keypress event, the line has already fired. The only way to support
Alt+Enter cleanly is to drop `readline.createInterface` and roll our
own raw-mode line editor. That editor must handle, at minimum:

- printable chars, Backspace, Delete, Left/Right cursor movement
- Home/End and Ctrl+A / Ctrl+E
- Ctrl+W (word delete), Ctrl+U (line delete)
- history (Up/Down) navigation through multi-line buffers
- multi-line: Alt+Enter inserts `\n`, Enter submits, continuation
  prompt `… ` on subsequent lines, cursor math across wrapped lines
- async-safe redraw when an inbound reply lands while the user is typing
- terminal width changes (SIGWINCH)
- Ctrl+C / Ctrl+D semantics

That's roughly 250–350 lines of careful work, with cursor math being the
bit that's easy to get wrong. The current REPL is ~300 lines including
all the slash commands and history; doubling that for a feature that
backslash-continuation already approximates didn't make sense at the
time we shipped.

**What we shipped instead.**

- backslash continuation (`foo \` <Enter> → continuation prompt `… `;
  send the buffer when a line doesn't end in `\`)
- explicit `:paste` block (lines accumulate verbatim until `:end` or an
  empty line)

**Suggested approach if/when picked up.**

1. Spike a minimal raw-mode reader using `process.stdin.setRawMode(true)`
   + `readline.emitKeypressEvents(process.stdin)`; verify Alt+Enter
   arrives as `{name: 'return', meta: true}` across the terminals you
   actually use.
2. Build the editor as its own module (`scripts/lib/line-editor.ts` or
   similar) with a small interface — `read(prompt): Promise<string>`,
   plus history hooks — so the REPL itself doesn't grow.
3. Re-use the existing history file at `~/.cache/nanoclaw/repl-history`
   and the spinner/printAbovePrompt patterns already in chat-repl.ts.
4. Keep backslash continuation and `:paste` as-is for users who prefer
   them or whose terminal doesn't pass Alt through.

## Multi-line entries in flat-file history

**Status:** open.

The history file (`~/.cache/nanoclaw/repl-history`) is a flat one-entry-per-line
format. Multi-line messages (sent via `\` continuation or `:paste`) contain
embedded `\n`, so they end up split across physical lines and get recalled
by Up-arrow as separate entries instead of one block.

Fix is either an escape-on-write (e.g. `\\n` for embedded newlines) or
moving to a JSONL format (`{"text": "..."}` per line). Either change must
be paired with a one-time migration on read for existing history files, or
just accept that pre-fix history is read literally (each line a separate
entry).

## Other ideas (smaller, lower priority)

- `/save <file>` to dump a transcript of the current session.
- `/last` to repeat-edit the last sent message (re-open it in the
  editor for tweaking).
- Tab completion on agent names for `/switch`.
- Render markdown bold/italic/code-fence in replies (kleur is already a
  dep).
- Show approval-pending notifications inline in the REPL when the host
  fires a credentialed-action approval.
