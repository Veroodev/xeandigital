export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeTitle(text) {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 48 ? `${line.slice(0, 48)}...` : line || 'Percakapan baru';
}
