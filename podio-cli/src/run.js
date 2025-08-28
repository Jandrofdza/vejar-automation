import { cfg, hasSupabase, hasOpenAI } from './config.js';
import { appAuth, getItem, getItemFiles, downloadFileBytes, setItemValues } from './podio.js';
import { supaClient, uploadBuffer, makeKey, ensureContentType } from './supabase.js';
import { classifyInputs } from './openai.js';
import { extractPdfText } from './pdf.js';

const FIELDS = {
  nombre_corto: 272822428,       // text: "Nombre corto"
  imagen: 272822641,             // image (we do not write via API)
  descripcion: 273178651,        // text: "Descripción del producto"
  requ_id_app: 272822635,        // app (skip)
  fecha: 272822636,              // date: "Fecha"
  fraccion_app: 272822637,       // app (skip)
  fraccion_text: 273289906,      // text: "Fracción" (write here)
  justificacion: 272822638,      // text
  alternativas: 272822639,       // text
  notas_clasificador: 272822640, // text
  regulacion: 273305150,         // text
  arbol: 272834870,              // text
  dudas_cliente: 272834930,      // text
  accion_category: 272834929     // category (skip for now)
};

function asDataUrl(buffer, mimetype) {
  const b64 = buffer.toString('base64');
  return `data:${mimetype || 'application/octet-stream'};base64,${b64}`;
}

export async function ensureAccessToken() {
  if (cfg.podio.accessToken) return cfg.podio.accessToken;
  const json = await appAuth({
    clientId: cfg.podio.clientId,
    clientSecret: cfg.podio.clientSecret,
    appId: cfg.podio.appId,
    appToken: cfg.podio.appToken,
  });
  return json.access_token;
}

export async function runOnce(itemId) {
  const token = await ensureAccessToken();

  // 1) Load item & files (process images first)
  const item = await getItem(itemId, token);
  const files = (getItemFiles(item) || []).sort((a,b)=>{
    const ai = ((a?.mimetype)||'').startsWith('image/') ? 0 : 1;
    const bi = ((b?.mimetype)||'').startsWith('image/') ? 0 : 1;
    return ai - bi;
  });
  if (!files.length) {
    console.log('Item has no files.');
    return;
  }

  // 2) Download files; prep inputs for GPT
  const imageInputs = [];   // Supabase URLs or data URLs
  const pdfTexts = [];
  const supa = hasSupabase ? supaClient(cfg.supabase) : null;

  let i = 0;
  for (const f of files) {
    console.log('→ file', { id: f.file_id, name: f.name, mimetype: f.mimetype });
    const typeHint = ensureContentType(f);
    const { buf: buffer, contentType } = await downloadFileBytes(f.file_id, token, typeHint);
    const type = contentType || typeHint;
    console.log('  downloaded', { bytes: buffer.byteLength, contentType: type });

    if (type.startsWith('image/')) {
      if (supa) {
        const key = makeKey(itemId, f, i++);
        const publicUrl = await uploadBuffer(supa, cfg.supabase.bucket, key, buffer, type);
        imageInputs.push(publicUrl);
      } else {
        imageInputs.push(asDataUrl(buffer, type));
      }
    } else if (type === 'application/pdf') {
      // optionally store PDF even if we only use text
      if (supa) {
        const key = makeKey(itemId, f, i++);
        await uploadBuffer(supa, cfg.supabase.bucket, key, buffer, type);
      }
      let text = '';
      console.log('  pdf-parse start');
      try {
        text = await extractPdfText(buffer, { maxPages: 3, timeoutMs: 10000 });
      } catch (e) {
        console.warn('PDF parse failed:', e?.message || String(e));
      }
      console.log('  pdf-parse done', { chars: (text||'').length });
      if (text) pdfTexts.push(text);
    }
  }

  if (!hasOpenAI) throw new Error('Missing OPENAI_API_KEY');
  if (imageInputs.length === 0 && pdfTexts.length === 0) {
    console.log('No usable inputs (no images and PDF had no extractable text).');
    return;
  }

  // 3) GPT classify
  const result = await classifyInputs({ imageUrls: imageInputs, texts: pdfTexts }, cfg.openai.apiKey);
  console.log('GPT result:', result);

  // 4) Build a SAFE values payload (text + date only; skip app/category)
  const date = null;
  const values = {
    [FIELDS.nombre_corto]:       [{ value: result?.nombre_corto ?? '' }],
    [FIELDS.descripcion]:        [{ value: result?.descripcion ?? '' }],
    [FIELDS.fraccion_text]:      [{ value: result?.fraccion ?? '' }],
    [FIELDS.justificacion]:      [{ value: result?.justificacion ?? '' }],
    [FIELDS.arbol]:              [{ value: Array.isArray(result?.arbol) ? result.arbol.join('\n- ') : String(result?.arbol ?? '') }],
    [FIELDS.alternativas]:       [{ value: Array.isArray(result?.alternativas) ? result.alternativas.map(a => `- ${a.fraccion}: ${a.motivo}`).join('\n') : String(result?.alternativas ?? '') }],
    [FIELDS.dudas_cliente]:      [{ value: result?.dudas_cliente ?? '' }],
    [FIELDS.regulacion]:         [{ value: result?.regulacion ?? '' }],
    [FIELDS.notas_clasificador]: [{ value: result?.notas_clasificador ?? '' }],
    ...(date ? { [FIELDS.fecha]: [{ start: date }] } : {})
  };

  console.log('will update field ids:', Object.keys(values));
  await setItemValues(itemId, values, token);
  console.log('Podio updated OK');
}
