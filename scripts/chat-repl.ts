/**
 * chat-repl — interactive terminal chat with a NanoClaw agent.
 *
 * Lists agent groups wired to the cli/local channel, lets you pick one,
 * then opens a single long-lived connection to data/cli.sock and runs a
 * readline loop. Same wire protocol as scripts/chat.ts, just persistent.
 *
 * Usage: pnpm run chat-repl   (or via the scripts/nclaw shim)
 *
 * Slash commands:
 *   /help, /?         — show available commands
 *   /agents           — re-query the DB and list agent groups
 *   /switch [arg]     — disconnect and re-pick (no arg = interactive picker;
 *                       with arg, pick by name match or 1-based index)
 *   /clear            — clear the agent's session memory (requires owner)
 *   /quit, /exit      — close socket and exit
 *   /paste            — alias for `:paste`
 *
 * Multi-line input:
 *   - line ending in `\` continues with prompt `… `
 *   - `:paste` enters paste mode; lines accumulate verbatim until either an
 *     empty line or `:end` on its own; the whole block is sent as one msg
 *
 * Out of scope (intentional, see docs/cli-repl-followups.md):
 *   - Raw-mode line editor with Alt+Enter for inline newline. Requires
 *     dropping readline and hand-rolling cursor math + history-through-
 *     multi-line + async-safe redraw.
 *   - Cross-channel admin transport (`{to, reply_to}`). The cli adapter
 *     only delivers replies to the connected socket once a chat slot has
 *     been claimed, and only plain `{text}` lines claim it
 *     (src/channels/cli.ts).
 *   - Scroll-back of outbound messages missed while no client was
 *     connected (src/channels/cli.ts header note).
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import readline from 'readline';

import * as p from '@clack/prompts';
import kleur from 'kleur';

import { DATA_DIR } from '../src/config.js';

interface AgentRow {
  id: string;
  name: string;
  folder: string;
  cli_wired: number; // 0/1 from sqlite
}

const HISTORY_DIR = path.join(os.homedir(), '.cache', 'nanoclaw');
const HISTORY_FILE = path.join(HISTORY_DIR, 'repl-history');
const HISTORY_MAX = 1000;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

const c = kleur;

function dbPath(): string {
  return path.join(DATA_DIR, 'v2.db');
}

function socketPath(): string {
  return path.join(DATA_DIR, 'cli.sock');
}

function loadAgents(): AgentRow[] {
  const db = new Database(dbPath(), { readonly: true });
  try {
    return db
      .prepare(
        `SELECT ag.id, ag.name, ag.folder,
                COALESCE((
                  SELECT 1
                    FROM messaging_group_agents mga
                    JOIN messaging_groups mg ON mg.id = mga.messaging_group_id
                   WHERE mga.agent_group_id = ag.id
                     AND mg.channel_type = 'cli'
                     AND mg.platform_id = 'local'
                   LIMIT 1
                ), 0) AS cli_wired
           FROM agent_groups ag
          ORDER BY ag.name COLLATE NOCASE`,
      )
      .all() as AgentRow[];
  } finally {
    db.close();
  }
}

async function pickAgent(agents: AgentRow[], opts?: { quiet?: boolean }): Promise<AgentRow> {
  if (agents.length === 0) {
    console.error(c.red('No agent groups registered. Run /init-first-agent.'));
    process.exit(1);
  }
  const wired = agents.filter((a) => a.cli_wired);
  if (wired.length === 1 && agents.length === 1) {
    if (!opts?.quiet) console.log(c.dim(`Connecting to ${c.cyan(wired[0].name)}…`));
    return wired[0];
  }
  const choice = await p.select({
    message: 'Which agent group?',
    options: agents.map((a) => ({
      value: a.id,
      label: a.cli_wired ? a.name : `${a.name} (not wired to cli/local)`,
      hint: a.folder,
    })),
  });
  if (p.isCancel(choice)) {
    console.error(c.dim('Cancelled.'));
    process.exit(0);
  }
  const picked = agents.find((a) => a.id === choice)!;
  if (!picked.cli_wired) {
    console.error(
      c.red(
        `${picked.name} is not wired to the cli/local channel — run /manage-channels and wire the CLI channel to it, then retry.`,
      ),
    );
    process.exit(1);
  }
  return picked;
}

function findAgentByQuery(agents: AgentRow[], query: string): AgentRow | undefined {
  const idx = parseInt(query, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= agents.length) return agents[idx - 1];
  const q = query.toLowerCase();
  const wired = agents.filter((a) => a.cli_wired);
  // exact match within wired
  const exact = wired.find((a) => a.name.toLowerCase() === q || a.folder.toLowerCase() === q);
  if (exact) return exact;
  // partial within wired
  const partial = wired.filter((a) => a.name.toLowerCase().includes(q) || a.folder.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  return undefined;
}

function loadHistory(): string[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    // Trim if it grew past the cap (e.g. between runs).
    if (lines.length > HISTORY_MAX) {
      const trimmed = lines.slice(-HISTORY_MAX);
      writeHistoryAtomic(trimmed);
      return trimmed.reverse();
    }
    return lines.reverse(); // Node readline expects most-recent-first
  } catch {
    return [];
  }
}

function writeHistoryAtomic(lines: string[]): void {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const tmp = `${HISTORY_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n') + (lines.length ? '\n' : ''));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch {
    // history is best-effort; never fail the REPL because of it
  }
}

function appendHistory(line: string): void {
  if (!line.trim()) return;
  if (line.startsWith('/') || line.startsWith(':')) return; // skip slash + paste commands
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.appendFileSync(HISTORY_FILE, line + '\n');
  } catch {
    // best-effort
  }
}

function makePrompt(agentName: string): string {
  return c.cyan(agentName) + c.dim('> ');
}

interface Spinner {
  start(): void;
  stop(): void;
}

function makeSpinner(): Spinner {
  let timer: NodeJS.Timeout | null = null;
  let frame = 0;
  return {
    start(): void {
      if (timer || !process.stdout.isTTY) return;
      const tick = (): void => {
        process.stdout.write('\r\x1b[2K' + c.dim(`${SPINNER_FRAMES[frame]} thinking…`));
        frame = (frame + 1) % SPINNER_FRAMES.length;
      };
      tick();
      timer = setInterval(tick, SPINNER_INTERVAL_MS);
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
    },
  };
}

function printHelp(): void {
  const lines = [
    c.dim('commands:'),
    `  ${c.cyan('/help, /?')}        show this help`,
    `  ${c.cyan('/agents')}          list agent groups`,
    `  ${c.cyan('/switch [name|n]')} switch agent (interactive picker if no arg)`,
    `  ${c.cyan('/clear')}           clear the agent's session memory (requires owner role)`,
    `  ${c.cyan('/paste')}           same as :paste — start a multi-line paste block`,
    `  ${c.cyan('/quit, /exit')}     leave`,
    c.dim('multi-line:'),
    `  end a line with ${c.cyan('\\')} to continue on the next line`,
    `  ${c.cyan(':paste')} starts a paste block; ${c.cyan(':end')} (or empty line) sends it`,
    c.dim('note:'),
    `  Switching agents supersedes the previous chat slot — the host`,
    `  closes the prior connection. /switch reconnects automatically.`,
  ];
  process.stdout.write('\r\x1b[2K' + lines.join('\n') + '\n');
}

interface ReplState {
  agent: AgentRow;
  socket: net.Socket;
  rl: readline.Interface;
  spinner: Spinner;
  pendingLines: string[]; // backslash continuation buffer
  pasteMode: boolean;
  pasteLines: string[];
  reconnecting: boolean;
  sigintCount: number;
}

function printAbovePrompt(state: ReplState, line: string): void {
  process.stdout.write(`\r\x1b[2K${line}\n`);
  state.rl.prompt(true);
  if (state.rl.line) process.stdout.write(state.rl.line);
}

function setPrompt(state: ReplState, prompt: string): void {
  state.rl.setPrompt(prompt);
}

function sendMessage(state: ReplState, text: string): void {
  if (!text) return;
  appendHistory(text);
  try {
    state.socket.write(JSON.stringify({ text }) + '\n');
    state.spinner.start();
  } catch (err) {
    console.error(c.red('Failed to write to socket:'), err);
  }
}

function handleInputLine(state: ReplState, agents: AgentRow[], rawLine: string): void {
  const line = rawLine; // do NOT trim — paste mode wants verbatim

  // Paste mode: collect verbatim until :end / empty line.
  if (state.pasteMode) {
    if (line.trim() === ':end' || line === '') {
      const block = state.pasteLines.join('\n');
      state.pasteMode = false;
      state.pasteLines = [];
      setPrompt(state, makePrompt(state.agent.name));
      if (block.trim()) sendMessage(state, block);
      state.rl.prompt();
      return;
    }
    state.pasteLines.push(line);
    state.rl.prompt();
    return;
  }

  // Slash commands (operate on trimmed view)
  const trimmed = line.trim();
  if (trimmed === '') {
    state.rl.prompt();
    return;
  }

  // Backslash continuation has priority over slash dispatch — a trailing
  // `\` means "continue this line", regardless of whether the line started
  // with `/`. (Slash commands are short; not a real conflict.)
  if (line.endsWith('\\')) {
    state.pendingLines.push(line.slice(0, -1));
    setPrompt(state, c.dim('… '));
    state.rl.prompt();
    return;
  }

  // If we have pending continuation lines, this is the final line.
  if (state.pendingLines.length > 0) {
    const full = state.pendingLines.concat(line).join('\n');
    state.pendingLines = [];
    setPrompt(state, makePrompt(state.agent.name));
    sendMessage(state, full);
    state.rl.prompt();
    return;
  }

  // Slash commands
  if (trimmed.startsWith('/') || trimmed === ':paste') {
    const [cmdRaw, ...rest] = trimmed.split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(' ').trim();

    if (cmd === '/quit' || cmd === '/exit') {
      state.socket.end();
      return;
    }
    if (cmd === '/help' || cmd === '/?') {
      printHelp();
      state.rl.prompt(true);
      return;
    }
    if (cmd === '/agents') {
      const fresh = loadAgents();
      const lines = fresh.map((a, i) => {
        const tag = a.cli_wired ? c.cyan('[cli]') : c.dim('[----]');
        const cur = a.id === state.agent.id ? c.green(' ← current') : '';
        return `  ${i + 1}. ${tag} ${a.name} ${c.dim('(' + a.folder + ')')}${cur}`;
      });
      process.stdout.write('\r\x1b[2K' + lines.join('\n') + '\n');
      state.rl.prompt(true);
      return;
    }
    if (cmd === '/switch') {
      void switchAgent(state, agents, arg);
      return;
    }
    if (cmd === '/paste' || cmd === ':paste') {
      state.pasteMode = true;
      state.pasteLines = [];
      setPrompt(state, c.dim('paste> '));
      process.stdout.write(c.dim('(paste mode — end with `:end` or an empty line)\n'));
      state.rl.prompt();
      return;
    }
    // /clear and any other slash command falls through to the server. The
    // command-gate decides what to do with it.
  }

  // Plain message
  sendMessage(state, line);
  state.rl.prompt();
}

async function switchAgent(state: ReplState, agents: AgentRow[], arg: string): Promise<void> {
  let target: AgentRow | undefined;
  if (arg) {
    target = findAgentByQuery(agents, arg);
    if (!target) {
      printAbovePrompt(state, c.red(`No unique cli-wired agent matched "${arg}".`));
      return;
    }
    if (!target.cli_wired) {
      printAbovePrompt(
        state,
        c.red(`${target.name} is not wired to cli/local — wire it via /manage-channels.`),
      );
      return;
    }
  } else {
    state.rl.pause();
    const fresh = loadAgents();
    try {
      target = await pickAgent(fresh, { quiet: true });
    } catch (err) {
      printAbovePrompt(state, c.red('Switch cancelled: ' + String(err)));
      state.rl.resume();
      state.rl.prompt(true);
      return;
    }
    state.rl.resume();
  }

  if (target.id === state.agent.id) {
    printAbovePrompt(state, c.dim(`Already on ${target.name}.`));
    return;
  }

  printAbovePrompt(state, c.dim(`Switching to ${c.cyan(target.name)}…`));
  state.reconnecting = true;
  state.spinner.stop();
  // Closing our socket releases our chat slot. We then reconnect; the host
  // treats the new socket as a fresh chat slot (and supersedes whatever's
  // there). state.reconnecting suppresses the [disconnected] message.
  state.socket.end();
  // Wait for close, then connect a new socket and rebind handlers.
  state.socket.once('close', () => {
    if (target) reconnectTo(state, target);
  });
}

function reconnectTo(state: ReplState, target: AgentRow): void {
  state.agent = target;
  setPrompt(state, makePrompt(target.name));
  const sock = socketPath();
  const socket = net.connect(sock);
  state.socket = socket;
  state.reconnecting = false;
  bindSocketHandlers(state);
}

function bindSocketHandlers(state: ReplState): void {
  const { socket } = state;

  socket.on('error', (err) => {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
      console.error(c.red(`NanoClaw daemon not reachable at ${socketPath()}.`));
      console.error(c.dim('Start the service (launchctl/systemd) before running chat-repl.'));
    } else {
      console.error(c.red('CLI socket error:'), err);
    }
    process.exit(2);
  });

  socket.on('connect', () => {
    process.stdout.write(
      '\r\x1b[2K' +
        c.dim(`[connected — chatting as ${c.cyan(state.agent.name)}; /help or /quit]`) +
        '\n',
    );
    state.rl.prompt(true);
  });

  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!raw) continue;
      // First byte of any reply ends the spinner.
      state.spinner.stop();
      try {
        const msg = JSON.parse(raw);
        if (typeof msg.text === 'string') {
          const agent = typeof msg.agent === 'string' ? msg.agent : null;
          let line: string;
          if (agent && agent !== state.agent.name) {
            line = c.cyan(`[${agent}]`) + ' ' + msg.text;
          } else {
            line = c.dim('< ') + msg.text;
          }
          printAbovePrompt(state, line);
        }
      } catch {
        // forward-compat: ignore non-JSON
      }
    }
  });

  socket.on('close', () => {
    state.spinner.stop();
    if (state.reconnecting) return; // /switch handles its own continuation
    process.stdout.write('\r\x1b[2K' + c.dim('[disconnected]') + '\n');
    state.rl.close();
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const agents = loadAgents();
  const picked = await pickAgent(agents);

  const sock = socketPath();
  const socket = net.connect(sock);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: makePrompt(picked.name),
    terminal: true,
    history: loadHistory(),
    historySize: HISTORY_MAX,
    removeHistoryDuplicates: true,
  });

  const state: ReplState = {
    agent: picked,
    socket,
    rl,
    spinner: makeSpinner(),
    pendingLines: [],
    pasteMode: false,
    pasteLines: [],
    reconnecting: false,
    sigintCount: 0,
  };

  bindSocketHandlers(state);

  rl.on('line', (line) => handleInputLine(state, agents, line));

  rl.on('SIGINT', () => {
    // First Ctrl+C: clear any in-progress buffer or, if none, warn. Second
    // forces quit. This matches the MVP semantics with the addition of
    // multi-line buffer cancellation.
    if (state.pendingLines.length > 0 || state.pasteMode) {
      state.pendingLines = [];
      state.pasteMode = false;
      state.pasteLines = [];
      setPrompt(state, makePrompt(state.agent.name));
      process.stdout.write('\n' + c.dim('(buffer cleared)') + '\n');
      state.sigintCount = 0;
      rl.prompt();
      return;
    }
    state.sigintCount += 1;
    if (state.sigintCount >= 2) process.exit(130);
    process.stdout.write('\n' + c.dim('[Ctrl+C again to force quit, or type /quit]') + '\n');
    state.socket.end();
  });
}

void main();
