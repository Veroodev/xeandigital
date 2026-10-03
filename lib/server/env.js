export const envStr = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;

export function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const envList = (name) =>
  envStr(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
