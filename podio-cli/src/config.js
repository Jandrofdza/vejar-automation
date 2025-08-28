import 'dotenv/config';

export const cfg = {
  podio: {
    clientId: process.env.PODIO_CLIENT_ID,
    clientSecret: process.env.PODIO_CLIENT_SECRET,
    appId: process.env.PODIO_APP_ID ? Number(process.env.PODIO_APP_ID) : undefined,
    appToken: process.env.PODIO_APP_TOKEN,
    accessToken: process.env.PODIO_OAUTH_ACCESS_TOKEN, // optional
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: process.env.SUPABASE_BUCKET || 'podio-files',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
};

export const hasSupabase = !!(cfg.supabase.url && cfg.supabase.serviceKey);
export const hasOpenAI = !!cfg.openai.apiKey;
