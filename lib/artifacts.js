// Deteksi blok kode / berkas dari output AI (gaya Claude Artifacts).
// Konvensi nama berkas di info string: ```html filename="index.html"  atau  ```js:app.js

const LANG_ALIASES = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  typescript: 'ts', tsx: 'ts',
  python: 'py', python3: 'py',
  markdown: 'md',
  text: 'txt', plaintext: 'txt', plain: 'txt',
  htm: 'html',
  shell: 'sh', bash: 'sh', zsh: 'sh', console: 'sh',
  yml: 'yaml',
  rust: 'rs', ruby: 'rb', csharp: 'cs',
};

const LABELS = {
  html: 'HTML', css: 'CSS', js: 'JavaScript', ts: 'TypeScript', py: 'Python',
  json: 'JSON', csv: 'CSV', md: 'Markdown', txt: 'Teks', sh: 'Shell',
  sql: 'SQL', svg: 'SVG', yaml: 'YAML', xml: 'XML',
};

const HLJS = {
  html: 'xml', svg: 'xml', xml: 'xml', js: 'javascript', ts: 'typescript',
  py: 'python', sh: 'bash', md: 'markdown', csv: 'plaintext', txt: 'plaintext',
  rs: 'rust', yaml: 'yaml',
};

const MIME = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json',
  csv: 'text/csv', md: 'text/markdown', txt: 'text/plain', svg: 'image/svg+xml',
  py: 'text/x-python', xml: 'application/xml',
};

export function normalizeLang(raw = '') {
  const l = raw.toLowerCase().replace(/^[{.]+|[}]+$/g, '').trim();
  return LANG_ALIASES[l] || l;
}

function extFor(lang) {
  if (!lang) return 'txt';
  return /^[a-z0-9]{1,5}$/.test(lang) ? lang : 'txt';
}

function sanitizeFilename(name) {
  return name
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.{2,}/g, '.')
    .replace(/[^\w.\-/]/g, '_')
    .slice(0, 120);
}

function parseInfo(info) {
  const out = { lang: '', filename: '' };
  if (!info) return out;

  const attr = info.match(/(?:filename|file|title|name|path)\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (attr) out.filename = attr[1] || attr[2] || attr[3];

  let first = (info.split(/\s+/)[0] || '').replace(/^\{/, '');
  if (first.includes('=')) first = '';

  const colon = first.indexOf(':');
  if (colon > 0) {
    if (!out.filename) out.filename = first.slice(colon + 1);
    first = first.slice(0, colon);
  } else if (!out.filename && /^[\w./-]+\.[a-z0-9]{1,5}$/i.test(first)) {
    out.filename = first;
    first = first.split('.').pop();
  }

  out.lang = normalizeLang(first);
  return out;
}

function makeBlock(info, code, index, closed, seen) {
  const parsed = parseInfo(info);
  let { lang, filename } = parsed;

  if (!filename) {
    const firstLine = code.split('\n', 1)[0];
    const m = firstLine.match(/(?:filename|file|path)\s*[:=]\s*([\w./-]+\.[A-Za-z0-9]{1,5})/i);
    if (m) filename = m[1];
  }

  filename = filename ? sanitizeFilename(filename) : '';
  const named = Boolean(filename);
  if (!lang && filename) lang = normalizeLang(filename.split('.').pop());

  const ext = extFor(lang);
  if (!filename) {
    seen[lang] = (seen[lang] || 0) + 1;
    filename =
      lang === 'html'
        ? seen.html === 1 ? 'index.html' : `halaman-${seen.html}.html`
        : `berkas-${index + 1}.${ext}`;
  } else if (!/\.[A-Za-z0-9]+$/.test(filename)) {
    filename += `.${ext}`;
  }

  return {
    type: 'code',
    index,
    lang,
    ext,
    filename,
    named,
    code,
    closed,
    lineCount: code ? code.split('\n').length : 0,
    label: LABELS[lang] || (lang ? lang.toUpperCase() : 'Teks'),
    hljsLang: HLJS[lang] || lang || 'plaintext',
    mime: MIME[ext] || 'text/plain',
  };
}

// Memecah teks pesan menjadi segmen { type: 'text' } dan { type: 'code' }.
// Blok yang belum ditutup (masih streaming) tetap dikenali dengan closed = false.
export function parseMessage(content = '') {
  const segments = [];
  const seen = {};
  let textBuf = [];
  let fence = null;
  let codeIndex = 0;

  const flushText = () => {
    if (textBuf.length) {
      segments.push({ type: 'text', content: textBuf.join('\n') });
      textBuf = [];
    }
  };
  const pushCode = (f, closed) => {
    segments.push(makeBlock(f.info, f.lines.join('\n'), codeIndex++, closed, seen));
  };

  for (const line of content.split('\n')) {
    if (!fence) {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/);
      if (open) {
        flushText();
        fence = { char: open[1][0], size: open[1].length, info: open[2].trim(), lines: [] };
      } else {
        textBuf.push(line);
      }
      continue;
    }
    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === fence.char && close[1].length >= fence.size) {
      pushCode(fence, true);
      fence = null;
    } else {
      fence.lines.push(line);
    }
  }

  if (fence) pushCode(fence, false);
  else flushText();
  return segments;
}

export function extractArtifacts(content) {
  return parseMessage(content).filter((s) => s.type === 'code');
}

// Blok besar tampil sebagai kartu di chat; blok pendek tampil inline.
export function isLargeBlock(block) {
  if (block.lineCount >= 14) return true;
  if (['html', 'svg'].includes(block.lang) && block.lineCount >= 6) return true;
  return block.named && block.lineCount >= 4;
}

const PREVIEWABLE = ['html', 'svg', 'css', 'js', 'md', 'csv'];
export const FRAME_KINDS = ['html', 'svg', 'css', 'js'];

export function isPreviewable(artifact) {
  return PREVIEWABLE.includes(artifact.lang);
}

// ---------- Pratinjau web (iframe sandbox) ----------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const baseName = (f) => f.split('/').pop();
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

const CONSOLE_SHIM = `<script>(function(){
var o=document.getElementById('__out');
if(!o){o=document.createElement('pre');o.id='__out';document.body.appendChild(o);}
function w(t,c){var d=document.createElement('div');d.textContent=t;if(c)d.style.color=c;o.appendChild(d);}
['log','info','warn','error'].forEach(function(k){
  var orig=console[k];
  console[k]=function(){
    var text=[].slice.call(arguments).map(function(a){
      try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(e){return String(a);}
    }).join(' ');
    w(text,k==='error'?'#c00':k==='warn'?'#b45309':null);
    orig.apply(console,arguments);
  };
});
window.addEventListener('error',function(e){w(e.message,'#c00');});
})();</script>`;

const BLANK_JS_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>body{font-family:ui-monospace,Menlo,monospace;padding:16px;font-size:14px}</style></head>' +
  '<body><pre id="__out"></pre></body></html>';

const BLANK_CSS_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
  '<body><main><h1>Judul contoh</h1><p>Paragraf contoh dengan <a href="#">tautan</a>.</p>' +
  '<button>Tombol</button><ul><li>Satu</li><li>Dua</li></ul></main></body></html>';

function inlineSiblings(html, siblings) {
  let out = html;
  const used = new Set();
  for (const s of siblings) {
    if (s.lang !== 'css' && s.lang !== 'js') continue;
    const name = escapeRe(baseName(s.filename));
    if (s.lang === 'css') {
      const re = new RegExp(`<link[^>]*href=["'](?:[^"']*/)?${name}["'][^>]*>`, 'i');
      if (re.test(out)) {
        out = out.replace(re, () => `<style>${s.code}</style>`);
        used.add(s.index);
      }
    } else {
      const re = new RegExp(`<script[^>]*src=["'](?:[^"']*/)?${name}["'][^>]*>\\s*</script>`, 'i');
      if (re.test(out)) {
        out = out.replace(re, () => `<script>${safeScript(s.code)}</script>`);
        used.add(s.index);
      }
    }
  }
  return { html: out, used };
}

function injectHead(html, snippet) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${snippet}</head>`);
  return snippet + html;
}

function injectBodyEnd(html, snippet) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, () => `${snippet}</body>`);
  return html + snippet;
}

export function buildPreviewDoc(artifact, siblings = []) {
  if (artifact.lang === 'svg') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh}</style></head><body>${artifact.code}</body></html>`;
  }

  const htmlSibling = siblings.find((s) => s.lang === 'html');
  let html;
  if (artifact.lang === 'html') html = artifact.code;
  else if (htmlSibling) html = htmlSibling.code;
  else html = artifact.lang === 'css' ? BLANK_CSS_PAGE : BLANK_JS_PAGE;

  const { html: inlined, used } = inlineSiblings(html, siblings);
  html = inlined;

  if (artifact.lang === 'css' && !used.has(artifact.index)) {
    html = injectHead(html, `<style>${artifact.code}</style>`);
  }
  if (artifact.lang === 'js') {
    html = injectBodyEnd(html, CONSOLE_SHIM);
    if (!used.has(artifact.index)) {
      html = injectBodyEnd(html, `<script>${safeScript(artifact.code)}</script>`);
    }
  }
  return html;
}
