#!/usr/bin/env node
// Puente entre este repo y After Effects (Windows y macOS).
//
//  1. Hace `git pull` cada POLL_SECONDS.
//  2. Si commands/pending.jsx cambio, lo ejecuta en el After Effects abierto
//     (dentro de un grupo de deshacer: Ctrl+Z revierte todo el comando).
//  3. Exporta el estado a state/ae-state.json y el resultado a state/result.json.
//  4. Hace commit + push de state/.
//
// SEGURIDAD: ejecuta codigo del repo en tu maquina. Usa un repo PRIVADO y
// revisa los comandos con --confirm si quieres aprobar cada uno.
//
// Uso:  node bridge/watcher.js [--confirm] [--once] [--export-only]
// Config opcional en bridge/config.json:
//   { "pollSeconds": 5, "branch": "claude/compassionate-sagan-u21lk7",
//     "aeApp": "Adobe After Effects 2025",          // macOS: nombre de la app
//     "aeExe": "C:/Program Files/Adobe/Adobe After Effects 2025/Support Files/AfterFX.exe" } // Windows
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const ONCE = args.includes('--once');
const EXPORT_ONLY = args.includes('--export-only');

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (_) {}
const POLL = (cfg.pollSeconds || 5) * 1000;
const BRANCH = cfg.branch || 'claude/compassionate-sagan-u21lk7';

const PENDING = path.join(ROOT, 'commands', 'pending.jsx');
const STATE = path.join(ROOT, 'state', 'ae-state.json');
const RESULT = path.join(ROOT, 'state', 'result.json');
const LAST_HASH = path.join(__dirname, '.last-hash');
const EXPORT_JSX = path.join(ROOT, 'ae', 'export_state.jsx');
const WRAPPER = path.join(os.tmpdir(), 'ae-bridge-wrapper.jsx');

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fwd = p => p.replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findAEWindows() {
  if (cfg.aeExe) return cfg.aeExe;
  const base = 'C:/Program Files/Adobe';
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /After Effects/.test(d)).sort().reverse() : [];
  if (!dirs.length) throw new Error('No encontre AfterFX.exe. Define "aeExe" en bridge/config.json');
  return `${base}/${dirs[0]}/Support Files/AfterFX.exe`;
}
function findAEMac() {
  if (cfg.aeApp) return cfg.aeApp;
  const dirs = fs.readdirSync('/Applications').filter(d => /Adobe After Effects/.test(d)).sort().reverse();
  if (!dirs.length) throw new Error('No encontre After Effects. Define "aeApp" en bridge/config.json');
  return dirs[0];
}

// Ejecuta un .jsx en la instancia abierta de After Effects.
function runInAE(jsxPath) {
  if (process.platform === 'win32') {
    spawn(findAEWindows(), ['-r', jsxPath], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    const app = findAEMac();
    execFileSync('osascript', ['-e', `tell application "${app}" to DoScriptFile "${jsxPath}"`]);
  } else {
    throw new Error('Solo Windows y macOS');
  }
}

function buildWrapper(runCommand) {
  const resultPath = fwd(RESULT), statePath = fwd(STATE);
  const exportJsx = fwd(EXPORT_JSX), cmdPath = fwd(PENDING);
  return `
var __res = { ok: true, startedAt: new Date().toString(), error: null, output: null };
try {
  ${runCommand ? `
  app.beginUndoGroup("AE Bridge: comando");
  try { var __r = $.evalFile(new File(${JSON.stringify(cmdPath)})); __res.output = (__r === undefined || __r === null) ? null : String(__r); }
  finally { app.endUndoGroup(); }` : ''}
} catch (e) {
  __res.ok = false;
  __res.error = e.toString() + (e.line ? " (linea " + e.line + ")" : "");
}
try {
  $.global.AE_BRIDGE_OUT = ${JSON.stringify(statePath)};
  $.evalFile(new File(${JSON.stringify(exportJsx)}));
} catch (e2) { __res.ok = false; __res.error = (__res.error ? __res.error + " | " : "") + "export: " + e2.toString(); }
__res.finishedAt = new Date().toString();
var __f = new File(${JSON.stringify(resultPath)});
__f.encoding = "UTF-8"; __f.open("w");
__f.write('{"ok":' + __res.ok + ',"error":' + (__res.error ? '"' + __res.error.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, " ") + '"' : "null") +
  ',"output":' + (__res.output !== null ? '"' + __res.output.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, "\\\\n") + '"' : "null") +
  ',"startedAt":"' + __res.startedAt + '","finishedAt":"' + __res.finishedAt + '"}');
__f.close();
`;
}

async function execute(runCommand) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  try { fs.unlinkSync(RESULT); } catch (_) {}
  fs.writeFileSync(WRAPPER, buildWrapper(runCommand));
  runInAE(fwd(WRAPPER));
  for (let i = 0; i < 120; i++) {           // espera hasta 2 min
    await sleep(1000);
    if (fs.existsSync(RESULT)) { await sleep(300); return; }
  }
  log('Timeout esperando a After Effects (hay un dialogo abierto?)');
}

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(/^s|^y/i.test(a)); }));
}

function publish(msg) {
  try {
    git('add', 'state');
    if (!git('status', '--porcelain', 'state').trim()) return;
    git('commit', '-m', msg);
    git('push', 'origin', `HEAD:${BRANCH}`);
    log('Estado subido a', BRANCH);
  } catch (e) { log('git push fallo:', (e.stderr || e.message).toString().trim()); }
}

async function tick() {
  try { git('pull', '--rebase', '--autostash', 'origin', BRANCH); }
  catch (e) { log('git pull fallo:', (e.stderr || e.message).toString().trim()); return; }

  if (EXPORT_ONLY || !fs.existsSync(PENDING)) return;
  const code = fs.readFileSync(PENDING);
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  let last = ''; try { last = fs.readFileSync(LAST_HASH, 'utf8'); } catch (_) {}
  if (hash === last) return;

  log('Comando nuevo en commands/pending.jsx');
  if (CONFIRM) {
    console.log('\n----- comando -----\n' + code.toString() + '\n-------------------');
    if (!(await ask('Ejecutar en After Effects? (s/n) '))) { fs.writeFileSync(LAST_HASH, hash); log('Omitido'); return; }
  }
  fs.writeFileSync(LAST_HASH, hash);
  await execute(true);
  publish('bridge: resultado del comando ' + hash.slice(0, 8));
}

(async () => {
  log(`Puente activo en ${ROOT} (rama ${BRANCH}). Ctrl+C para salir.`);
  log('Exportando estado inicial...');
  try { await execute(false); publish('bridge: estado inicial'); } catch (e) { log('Error:', e.message); }
  if (EXPORT_ONLY) return;
  do { try { await tick(); } catch (e) { log('Error:', e.message); } if (!ONCE) await sleep(POLL); } while (!ONCE);
})();
