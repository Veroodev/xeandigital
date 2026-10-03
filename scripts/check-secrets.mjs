// Memastikan API key tidak bisa sampai ke browser.
//   node scripts/check-secrets.mjs            -> periksa kode sumber
//   node scripts/check-secrets.mjs --bundle   -> periksa juga hasil build (.next/static), dipanggil otomatis setelah `next build`
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const withBundle = process.argv.includes('--bundle');
const problems = [];

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// Nilai rahasia = variabel environment yang namanya mengandung KEY/SECRET/TOKEN/PASSWORD.
const env = { ...readEnvFile(path.join(root, '.env')), ...readEnvFile(path.join(root, '.env.local')), ...process.env };
const secrets = Object.entries(env)
  .filter(([name, value]) => /(KEY|SECRET|TOKEN|PASSWORD)/.test(name) && typeof value === 'string' && value.length >= 12)
  .filter(([name]) => !/^(npm_|VERCEL_(GIT|ENV|URL|REGION|DEPLOYMENT)|GITHUB_|CI|NEXT_RUNTIME)/.test(name))
  .map(([name, value]) => ({ name, value }));

const KEY_PATTERN = /\b(?:apx_live|sk-xt|xk_live)_[A-Za-z0-9_-]{16,}/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'tests', 'scripts']);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(jsx?|mjs|cjs|css|html|json|md)$/.test(entry.name)) yield full;
  }
}

const rel = (f) => path.relative(root, f);
const isServerOnly = (f) => /^(lib[\\/]server|app[\\/]api)[\\/]/.test(rel(f));

for (const file of walk(root)) {
  const text = fs.readFileSync(file, 'utf8');
  if (KEY_PATTERN.test(text)) problems.push(`${rel(file)}: ada string yang menyerupai API key`);
  for (const s of secrets) if (text.includes(s.value)) problems.push(`${rel(file)}: berisi nilai ${s.name}`);
  if (/NEXT_PUBLIC_\w*(KEY|SECRET|TOKEN)/.test(text)) problems.push(`${rel(file)}: memakai NEXT_PUBLIC_ untuk secret`);
  if (/(VITE|PUBLIC)_\w*(API_KEY|SECRET)/.test(text)) problems.push(`${rel(file)}: nama env publik untuk secret`);
  // Kode klien tidak boleh membaca env sama sekali.
  if (/\.(jsx?|mjs)$/.test(file) && !isServerOnly(file) && /process\.env/.test(text) && !/next\.config|tailwind|postcss/.test(file)) {
    problems.push(`${rel(file)}: kode non-server membaca process.env`);
  }
}

if (withBundle) {
  const staticDir = path.join(root, '.next', 'static');
  if (fs.existsSync(staticDir)) {
    let scanned = 0;
    for (const file of walk2(staticDir)) {
      scanned++;
      const text = fs.readFileSync(file, 'utf8');
      if (KEY_PATTERN.test(text)) problems.push(`bundle ${rel(file)}: ada string yang menyerupai API key`);
      for (const s of secrets) if (text.includes(s.value)) problems.push(`bundle ${rel(file)}: berisi nilai ${s.name}`);
    }
    console.log(`Bundle browser diperiksa: ${scanned} berkas.`);
  } else {
    console.log('Folder .next/static tidak ditemukan, pemeriksaan bundle dilewati.');
  }
}

function* walk2(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk2(full);
    else if (/\.(js|css|html|json|map)$/.test(entry.name)) yield full;
  }
}

if (problems.length) {
  console.error('\nPEMERIKSAAN KEAMANAN GAGAL:');
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Aman: tidak ada secret di kode sumber${withBundle ? ' maupun bundle browser' : ''}.`);
