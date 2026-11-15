#!/usr/bin/env node
/**
 * Talk-to-UI model check: finds the models THIS user's account can run and
 * writes them to .talk-to-ui/live/models.json for the toolbar's model menu.
 *
 *   node models.mjs --provider claude --terminal opus
 *   node models.mjs --provider codex  --terminal gpt-6.1-sol
 *
 * Claude Code has no "list models" command, so each alias gets one tiny
 * headless call; the exact version is read from the CLI's JSON output
 * (modelUsage), never from the model's own words. An alias the account can't
 * run fails and is left out.
 * Codex keeps the account's model list in ~/.codex/models_cache.json (with
 * per-model reasoning levels); that file is read directly. It is internal to
 * Codex, so if its shape changes we fail loudly rather than guess.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLiveDir } from './ttui-paths.mjs';

const CLAUDE_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PROBE_TIMEOUT_MS = 90_000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') out.provider = argv[++i];
    else if (a === '--terminal') out.terminal = argv[++i];
  }
  return out;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout || '') });
    });
  });
}

// claude-opus-5-5 -> "Opus 5.5"; claude-fable-5-1 -> "Fable 5.1"
function claudeLabel(id) {
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!m) return id;
  return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
}

async function probeClaude(alias) {
  const { ok, stdout } = await run('claude', ['-p', '--model', alias, '--output-format', 'json', 'Reply with only: ok']);
  if (!ok) return null;
  try {
    const data = JSON.parse(stdout);
    const ids = Object.keys(data.modelUsage || {}).filter((k) => k.includes(alias));
    if (!ids.length) return null;
    return { id: alias, label: claudeLabel(ids[0]), resolved: ids[0], efforts: CLAUDE_EFFORTS };
  } catch {
    return null;
  }
}

async function claudeModels() {
  const results = await Promise.all(CLAUDE_ALIASES.map(probeClaude));
  return results.filter(Boolean);
}

// gpt-6.1-sol -> "GPT-6.1 Sol"
function codexLabel(slug) {
  return slug
    .split('-')
    .map((part, i) => (i === 0 && part === 'gpt' ? 'GPT' : part[0].toUpperCase() + part.slice(1)))
    .join(' ')
    .replace(/^GPT (\d)/, 'GPT-$1');
}

function codexModels() {
  const file = path.join(os.homedir(), '.codex', 'models_cache.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!raw || !Array.isArray(raw.models)) {
    throw new Error('Unexpected format in ' + file + ' (no "models" array). Codex may have changed it.');
  }
  return raw.models
    .filter((m) => m && typeof m.slug === 'string' && m.visibility === 'list')
    .map((m) => {
      const levels = (m.supported_reasoning_levels || [])
        .map((l) => (typeof l === 'string' ? l : l && l.effort))
        .filter(Boolean);
      return { id: m.slug, label: codexLabel(m.slug), efforts: levels.length ? levels : undefined };
    });
}

async function main() {
  const { provider, terminal } = parseArgs(process.argv.slice(2));
  if (provider !== 'claude' && provider !== 'codex') {
    console.error('Usage: node models.mjs --provider claude|codex --terminal <model id the terminal is running>');
    process.exit(2);
  }
  const models = provider === 'claude' ? await claudeModels() : codexModels();
  if (!models.length) {
    console.error(JSON.stringify({ ok: false, error: 'no_models', provider }));
    process.exit(1);
  }
  // The terminal's own model goes first: it is the no-extra-wait option.
  const termId = models.some((m) => m.id === terminal) ? terminal : models[0].id;
  models.sort((a, b) => (a.id === termId ? -1 : b.id === termId ? 1 : 0));
  const out = {
    provider: provider === 'claude' ? 'Claude' : 'Codex',
    terminal: termId,
    checkedAt: new Date().toISOString(),
    models,
  };
  const dir = getLiveDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, path: path.join(dir, 'models.json'), terminal: termId, models: models.map((m) => m.label) }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
  process.exit(1);
});
