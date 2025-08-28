import { createClient } from '@supabase/supabase-js';
import { extname } from 'node:path';
import mime from 'mime';

export function supaClient({ url, serviceKey }) {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function uploadBuffer(client, bucket, key, buffer, contentType) {
  const { data, error } = await client.storage.from(bucket).upload(key, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw error;

  // If bucket is public, make a public URL:
  const { data: pub } = client.storage.from(bucket).getPublicUrl(key);
  return pub.publicUrl;
}

export function makeKey(itemId, file, i = 0) {
  const ext = extname(file.name || '') || '';
  const safe = (file.name || `file_${i}${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `podio/${itemId}/${Date.now()}_${i}_${safe}`;
}

export function ensureContentType(file) {
  return typeof file?.mimetype === 'string'
    ? file.mimetype
    : mime.getType(file?.name || '') || 'application/octet-stream';
}
