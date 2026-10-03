const THREADS_KEY = 'xean-digital-ai:threads:v1';

export function loadThreads() {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveThreads(threads) {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, 100)));
  } catch {
    /* penyimpanan penuh atau diblokir: abaikan */
  }
}
