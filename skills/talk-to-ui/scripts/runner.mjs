#!/usr/bin/env node
/**
 * Talk-to-UI runner: does the AI work for one project when no terminal is open.
 *
 * Started by launcher.mjs in the project folder. It polls the project's helper
 * server for toolbar requests and hands each one to a headless AI run
 * (`claude -p` or `codex exec`) with the model and reasoning level picked in
 * the toolbar. The AI ends with a RESULT line; the runner sends the reply.
 *
 * Provider: ~/.talk-to-ui/config.json {"provider": "claude" | "codex"},
 * otherwise Claude Code when it is installed, else Codex.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(__dirname);
const PROJECT = process.cwd();
const LIVE_DIR = path.join(PROJECT, '.talk-to-ui', 'live');
const POLL_TIMEOUT_MS = 600000;
const AGENT_TIMEOUT_MS = 15 * 60 * 1000;
const SERVER_GONE_EXIT_MS = 60000;
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// The AI may run only the helper scripts its job needs, plus a type check.
const AGENT_SCRIPTS = ['live-wrap.mjs', 'live-complete.mjs', 'live-status.mjs', 'live-resume.mjs'];
const CLAUDE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npx tsc:*)',
  ...AGENT_SCRIPTS.map((f) => 'Bash(node ' + path.join(__dirname, f) + ':*)')];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function onPath(cmd) {
  try { execFileSync('/usr/bin/which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

function provider() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.talk-to-ui', 'config.json'), 'utf-8'));
    if (cfg.provider === 'claude' || cfg.provider === 'codex') return cfg.provider;
  } catch { /* no config: fall through */ }
  return onPath('claude') ? 'claude' : 'codex';
}

const children = new Set(); // killed when the runner stops, so no orphan keeps polling

/** Run a command; resolves {code, stdout, stderr}. Never rejects. */
function run(cmd, args, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: PROJECT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.on('exit', () => children.delete(child));
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGTERM'), timeoutMs) : null;
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const script = (name) => path.join(__dirname, name);

async function ensureModelList(prov) {
  if (fs.existsSync(path.join(LIVE_DIR, 'models.json'))) return;
  log('checking which models this account can run');
  const r = await run(process.execPath, [script('models.mjs'), '--provider', prov, '--terminal', 'none'], { timeoutMs: 120000 });
  log('model check:', r.code === 0 ? r.stdout.trim() : r.stderr.trim());
}

function reply(id, type, { file, message } = {}) {
  const args = [script('live-poll.mjs'), '--reply', id, type];
  if (file) args.push('--file', file);
  if (message) args.push(message);
  return run(process.execPath, args);
}

function brief(event) {
  const { token, ...shown } = event;
  return [
    "You are Talk-to-UI's worker, running headless in this project folder. The user is watching the page in their browser, so work fast.",
    "The toolbar is already running in the page: skip live.md's start, setup and poll-loop sections and go straight to handling this request.",
    'Skill folder: ' + SKILL_DIR + ' (scripts in ./scripts, guides in ./reference). Design rules: ' + SKILL_DIR + '/reference/design-laws.md',
    '',
    'Request from the toolbar:',
    JSON.stringify(shown, null, 2),
    '',
    'What to do:',
    '- A question rather than a change request, or no instruction at all (no freeformPrompt, no comments, action "ttui"): change nothing and answer briefly.',
    '- mode "direct": follow the section \'Handle `generate` with `mode: "direct"`\' in ' + SKILL_DIR + '/reference/live.md, steps 1-3.',
    '- Otherwise: follow "Handle `generate`" in ' + SKILL_DIR + '/reference/live.md, steps 1-7 (stop before "Signal done").',
    '',
    'Never run live-poll.mjs (no polling, no --reply): the reply is sent for you from your last line.',
    'End your final message with exactly one of these lines:',
    'RESULT: done <file relative to the project root>            (versions written)',
    'RESULT: complete <file> | <one short sentence: what changed> (direct mode)',
    'RESULT: answer <one or two sentences>                       (question or nothing to do)',
    'RESULT: error <short reason>',
  ].join('\n');
}

function carbonizeBrief(event) {
  return [
    "You are Talk-to-UI's worker, running headless in this project folder.",
    'Skill folder: ' + SKILL_DIR,
    'The user kept a version and it still has temporary preview styling. Follow "Required after accept (carbonize)" in ' + SKILL_DIR + '/reference/live.md for this accept:',
    JSON.stringify({ id: event.id, result: event._acceptResult }, null, 2),
    'Then run: node ' + script('live-complete.mjs') + ' --id ' + event.id,
    'Never run live-poll.mjs. End with: RESULT: complete <file> | cleaned up   or   RESULT: error <short reason>',
  ].join('\n');
}

async function runAgent(prov, prompt, event) {
  if (prov === 'claude') {
    const args = ['-p', prompt, '--setting-sources', 'project', '--permission-mode', 'acceptEdits',
      '--allowedTools', ...CLAUDE_TOOLS, '--output-format', 'json'];
    if (event.model) args.push('--model', event.model);
    if (CLAUDE_EFFORTS.includes(event.effort)) args.push('--effort', event.effort);
    const r = await run('claude', args, { timeoutMs: AGENT_TIMEOUT_MS });
    try { return JSON.parse(r.stdout).result || ''; } catch { return r.stdout + '\n' + r.stderr; }
  }
  const lastFile = path.join(LIVE_DIR, 'last-message.txt');
  const args = ['exec', '-C', PROJECT, '--sandbox', 'workspace-write', '--skip-git-repo-check', '-o', lastFile];
  if (event.model) args.push('-m', event.model);
  if (event.effort) args.push('-c', 'model_reasoning_effort=' + event.effort);
  args.push(prompt);
  const r = await run('codex', args, { timeoutMs: AGENT_TIMEOUT_MS });
  try { return fs.readFileSync(lastFile, 'utf-8'); } catch { return r.stdout + '\n' + r.stderr; }
}

/** Last "RESULT: <kind> <rest>" line of the agent's answer. */
function parseResult(text) {
  const line = String(text).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('RESULT:')).pop();
  if (!line) return { kind: 'error', rest: 'The AI finished without saying what it did.' };
  const m = line.match(/^RESULT:\s*(\w+)\s*(.*)$/);
  return { kind: m ? m[1].toLowerCase() : 'error', rest: m ? m[2].trim() : '' };
}

async function handleGenerate(prov, event) {
  const started = Date.now();
  const out = await runAgent(prov, brief(event), event);
  const { kind, rest } = parseResult(out);
  log('generate', event.id, kind, rest.slice(0, 160), Math.round((Date.now() - started) / 1000) + 's');
  if (kind === 'done') return reply(event.id, 'done', { file: rest.split(/\s/)[0] || undefined });
  if (kind === 'complete') {
    const [file, summary] = rest.split('|').map((s) => s.trim());
    return reply(event.id, 'complete', { file: file || undefined, message: summary || undefined });
  }
  if (kind === 'answer') return reply(event.id, 'answer', { message: rest || 'Nothing to change.' });
  return reply(event.id, 'error', { message: rest || 'Something went wrong.' });
}

async function handleCarbonize(prov, event) {
  const out = await runAgent(prov, carbonizeBrief(event), {});
  log('carbonize', event.id, parseResult(out).kind);
}

function parseEvent(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const end = text.lastIndexOf('}');
  try { return JSON.parse(text.slice(text.indexOf('{'), end + 1)); } catch { return null; }
}

async function main() {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  fs.writeFileSync(path.join(LIVE_DIR, 'runner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
  const clear = () => {
    for (const child of children) child.kill('SIGTERM');
    try { fs.unlinkSync(path.join(LIVE_DIR, 'runner.json')); } catch { /* gone */ }
  };
  process.on('exit', clear);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  const prov = provider();
  log('runner for', PROJECT, 'using', prov);
  await ensureModelList(prov);

  let downSince = null;
  for (;;) {
    const r = await run(process.execPath, [script('live-poll.mjs'), '--timeout=' + POLL_TIMEOUT_MS]);
    if (r.code !== 0) {
      downSince = downSince || Date.now();
      if (Date.now() - downSince > SERVER_GONE_EXIT_MS) { log('helper gone; runner stopping'); process.exit(0); }
      await new Promise((res) => setTimeout(res, 2000));
      continue;
    }
    downSince = null;
    const event = parseEvent(r.stdout);
    if (!event) continue;
    try {
      if (event.type === 'generate') await handleGenerate(prov, event);
      else if (event.type === 'accept' && event._acceptResult?.carbonize === true) await handleCarbonize(prov, event);
      // accept/discard without cleanup are finished by the poll itself; timeout/prefetch/exit need nothing.
    } catch (err) {
      log('failed on', event.type, event.id, err.message);
      if (event.type === 'generate') await reply(event.id, 'error', { message: 'The runner failed: ' + err.message });
    }
  }
}

main();
