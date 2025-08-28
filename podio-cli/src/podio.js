import { request } from 'undici';

const BASE = 'https://api.podio.com';

// POST JSON helper
async function postJson(path, body) {
  const { statusCode, body: resBody } = await request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resBody.text();
  if (statusCode < 200 || statusCode >= 300) throw new Error(`${path} -> ${statusCode} ${text}`);
  return text ? JSON.parse(text) : {};
}

// Podio App OAuth (gets an access token bound to the app)
export async function appAuth({ clientId, clientSecret, appId, appToken }) {
  if (!clientId || !clientSecret || !appId || !appToken) throw new Error('Missing Podio app credentials');
  return postJson('/oauth/token/v2', {
    grant_type: 'app',
    client_id: clientId,
    client_secret: clientSecret,
    app_id: appId,
    app_token: appToken,
  });
}

// GET JSON helper
async function getJson(pathWithQuery) {
  const { statusCode, body } = await request(`${BASE}${pathWithQuery}`);
  const text = await body.text();
  if (statusCode < 200 || statusCode >= 300) throw new Error(`${pathWithQuery} -> ${statusCode} ${text}`);
  return text ? JSON.parse(text) : {};
}

export async function getItem(itemId, token) {
  return getJson(`/item/${itemId}?oauth_token=${encodeURIComponent(token)}`);
}
export function getItemFiles(item) {
  return Array.isArray(item?.files) ? item.files : [];
}
export async function getFileMeta(fileId, token) {
  return getJson(`/file/${fileId}?oauth_token=${encodeURIComponent(token)}`);
}

// Follow redirects when downloading bytes
export async function downloadFromLink(link, accept) {
  const res = await fetch(link, { redirect: 'follow', headers: accept ? { accept } : {} });
  if (!res.ok) throw new Error(`download ${link} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  return { buf, contentType };
}

// Prefer Podio raw API; if empty, fall back to link?download=1
export async function downloadFileBytes(fileId, token, accept) {
  const rawUrl = `${BASE}/file/${fileId}/raw?oauth_token=${encodeURIComponent(token)}`;
  let res = await fetch(rawUrl, { redirect: 'follow', headers: accept ? { accept } : {} });
  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
    if (buf.byteLength > 0) return { buf, contentType };
  }
  const meta = await getFileMeta(fileId, token);
  const alt = meta?.link ? (meta.link.includes('?') ? `${meta.link}&download=1` : `${meta.link}?download=1`) : '';
  if (!alt) throw new Error(`No download link for file ${fileId}`);
  const res2 = await fetch(alt, { redirect: 'follow', headers: accept ? { accept } : {} });
  if (!res2.ok) throw new Error(`download alt ${alt} -> ${res2.status}`);
  const buf2 = Buffer.from(await res2.arrayBuffer());
  const contentType2 = res2.headers.get('content-type') || '';
  return { buf: buf2, contentType: contentType2 };
}

// Write back values to the item
export async function setItemValues(itemId, values, token) {
  const url = BASE + '/item/' + itemId + '/value?oauth_token=' + encodeURIComponent(token);
  const { statusCode, body } = await request(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  });
  if (statusCode < 200 || statusCode >= 300) {
    const text = await body.text();
    throw new Error('update values -> ' + statusCode + ' ' + text);
  }
}
