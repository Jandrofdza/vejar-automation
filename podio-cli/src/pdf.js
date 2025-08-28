import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPdfText(buffer, { maxChars = 20000, maxPages = 3, timeoutMs = 10000 } = {}) {
  let data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
    data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else if (buffer instanceof Uint8Array) {
    data = buffer;
  } else {
    data = new Uint8Array(buffer);
  }

  const work = (async () => {
    const loadingTask = getDocument({ data, isEvalSupported: false });
    const pdf = await loadingTask.promise;

    let text = '';
    const pages = Math.min(pdf.numPages, Math.max(1, maxPages));
    for (let p = 1; p <= pages && text.length < maxChars + 1000; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items
        .map(it => (typeof it?.str === 'string' ? it.str : (it?.text ?? '')))
        .join(' ');
      text += pageText + '\n';
    }
    await pdf.destroy();

    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > maxChars) text = text.slice(0, maxChars) + ' ...(truncated)...';
    return text;
  })();

  // Hard timeout
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('pdf-timeout')), timeoutMs));
  return Promise.race([work, timeout]);
}
