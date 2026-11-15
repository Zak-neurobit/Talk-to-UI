#!/usr/bin/env node
/**
 * Talk-to-UI launcher: the always-on piece.
 *
 * Runs in the background (installed as a login service). The browser
 * extension asks it, for every localhost page, "is there a project behind
 * port N?". The launcher finds the folder the dev server runs from, starts
 * that project's helper server + runner if they aren't running, and answers
 * with the helper's port so the extension can load the toolbar.
 *
 *   node launcher.mjs            # listen on 127.0.0.1:8399
 *   node launcher.mjs --port=N
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER_PORT = Number((process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 8399;
const HOME = os.homedir();
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const START_TIMEOUT_MS = 15000;

/** project dir -> { server, runner } child processes this launcher started */
const projects = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/** Folder the process listening on `port` runs from, or null. */
function dirListeningOn(port) {
  let pids;
  try {
    pids = execFileSync('lsof', ['-nP', '-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
  } catch { return null; }
  for (const pid of pids) {
    try {
      const out = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf-8' });
      const line = out.split('\n').find((l) => l.startsWith('n'));
      if (line) return line.slice(1);
    } catch { /* process gone: try the next one */ }
  }
  return null;
}

/** Nearest folder at or above `dir` that looks like a web project, or null. */
function projectRoot(dir) {
  let cur = dir;
  while (cur && cur !== path.dirname(cur)) {
    if (cur === HOME) return null;
    if (fs.existsSync(path.join(cur, 'package.json')) || fs.existsSync(path.join(cur, 'index.html'))) return cur;
    cur = path.dirname(cur);
  }
  return null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function serverHealthy(port) {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

/** Keep the project's .talk-to-ui/ folder out of git without touching .gitignore. */
function excludeFromGit(dir) {
  try {
    const exclude = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { encoding: 'utf-8' }).trim();
    const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf-8') : '';
    if (!text.split('\n').includes('.talk-to-ui/')) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, (text && !text.endsWith('\n') ? '\n' : '') + '.talk-to-ui/\n');
    }
  } catch { /* not a git repo */ }
}

function startChild(dir, script, name) {
  const logFile = path.join(dir, '.talk-to-ui', 'live', name + '.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(__dirname, script)], {
    cwd: dir, stdio: ['ignore', out, out], env: process.env,
  });
  child.on('exit', (code) => log(name, 'exited', code, dir));
  return child;
}

const starting = new Map(); // dir -> in-flight ensureProject promise

function ensureProjectOnce(dir) {
  if (!starting.has(dir)) starting.set(dir, ensureProject(dir).finally(() => starting.delete(dir)));
  return starting.get(dir);
}

/** Make sure `dir` has a running helper server + runner; returns the server port. */
async function ensureProject(dir) {
  const liveDir = path.join(dir, '.talk-to-ui', 'live');
  const entry = projects.get(dir) || {};
  let info = readJson(path.join(liveDir, 'server.json'));

  if (!(info && pidAlive(info.pid) && await serverHealthy(info.port))) {
    excludeFromGit(dir);
    try { fs.unlinkSync(path.join(liveDir, 'server.json')); } catch { /* none */ }
    entry.server = startChild(dir, 'live-server.mjs', 'server');
    log('started helper for', dir);
    const deadline = Date.now() + START_TIMEOUT_MS;
    info = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const candidate = readJson(path.join(liveDir, 'server.json'));
      if (candidate && await serverHealthy(candidate.port)) { info = candidate; break; }
    }
    if (!info) throw new Error('helper did not start for ' + dir);
  }

  const runnerPid = Number(readJson(path.join(liveDir, 'runner.json'))?.pid);
  if (!pidAlive(runnerPid)) {
    entry.runner = startChild(dir, 'runner.mjs', 'runner');
    log('started runner for', dir);
  }
  projects.set(dir, entry);
  return info.port;
}

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin && LOCAL_ORIGIN.test(origin)) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  // Only pages on this machine may ask; a website on the internet may not.
  if (origin ? !LOCAL_ORIGIN.test(origin) : req.headers['sec-fetch-site'] === 'cross-site') {
    return send(res, 403, { ok: false, error: 'local pages only' });
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return send(res, 200, { ok: true, projects: [...projects.keys()] }, origin);
  if (url.pathname !== '/attach') return send(res, 404, { ok: false }, origin);

  const port = Number(url.searchParams.get('port'));
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === LAUNCHER_PORT) {
    return send(res, 400, { ok: false, error: 'bad port' }, origin);
  }
  const cwd = dirListeningOn(port);
  const dir = cwd && projectRoot(cwd);
  if (!dir) return send(res, 200, { ok: false, reason: 'no project behind this port' }, origin);
  try {
    const serverPort = await ensureProjectOnce(dir);
    if (serverPort === port) return send(res, 200, { ok: false, reason: 'this is the helper itself' }, origin);
    send(res, 200, { ok: true, serverPort, project: path.basename(dir) }, origin);
  } catch (err) {
    log('attach failed:', err.message);
    send(res, 500, { ok: false, error: err.message }, origin);
  }
});

server.listen(LAUNCHER_PORT, '127.0.0.1', () => log('Talk-to-UI launcher on http://127.0.0.1:' + LAUNCHER_PORT));
