// scripts/check-deps.js
// Scan every .js file under server/ for require('X') and fail loudly if
// any X is missing from node_modules. Runs before start via npm prestart.
const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server');

const BUILTIN = new Set([
  'fs','path','os','http','https','url','util','crypto','stream','events',
  'child_process','zlib','net','tty','assert','buffer','querystring','readline',
  'worker_threads','perf_hooks','dns','tls','cluster','v8','vm','repl','module'
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function extractRequires(src) {
  const found = new Set();
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) found.add(m[1]);
  return found;
}

const allFiles = walk(SERVER);
const needed   = new Set();
for (const f of allFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const req of extractRequires(src)) {
    if (req.startsWith('.')) continue;
    if (req.startsWith('node:')) continue;
    if (BUILTIN.has(req)) continue;
    // handle scoped packages like @foo/bar -> @foo/bar
    needed.add(req);
  }
}

const missing = [];
for (const name of needed) {
  try {
    require.resolve(name, { paths: [ROOT] });
  } catch {
    missing.push(name);
  }
}

if (missing.length) {
  console.error('');
  console.error('==============================================================');
  console.error('  MISSING NODE MODULES');
  console.error('==============================================================');
  console.error('');
  for (const m of missing) console.error('  x  ' + m);
  console.error('');
  console.error('  Run:  npm install');
  console.error('  Or:   npm install ' + missing.join(' '));
  console.error('');
  process.exit(1);
}
