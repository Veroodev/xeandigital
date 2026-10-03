export function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename, text, mime = 'text/plain') {
  triggerDownload(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

// files: [{ filename, code }]
export async function downloadZip(files, zipName = 'berkas.zip') {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set();

  for (const file of files) {
    let name = file.filename;
    let n = 1;
    while (used.has(name)) {
      n += 1;
      name = file.filename.replace(/(\.[^./]+)?$/, `-${n}$1`);
    }
    used.add(name);
    zip.file(name, file.code);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipName, blob);
}
