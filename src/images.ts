// Flux Schnell via Cloudflare Workers AI (free tier). One image per post,
// uploaded to the existing Supabase public bucket → public URL for Meta/LI/YT APIs.
// ponytail: single-size gen (1024x1024) is Good Enough; per-channel crops skipped
// because Meta auto-crops uploaded images and LI/YT accept square. Upgrade to
// per-channel Sharp crops only if a channel visibly starves.

import { CONFIG, requireEnv } from './config.ts';

async function fluxSchnellPng(prompt: string): Promise<Buffer> {
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const token = requireEnv('CLOUDFLARE_API_TOKEN');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CONFIG.imageModel}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      prompt: prompt + CONFIG.imagePromptSuffix,
      steps: 4, // Flux Schnell is 1-4 steps
    }),
  });
  if (!r.ok) throw new Error(`Cloudflare AI ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { result?: { image?: string } };
  const b64 = data.result?.image;
  if (!b64) throw new Error('Cloudflare AI returned no image');
  return Buffer.from(b64, 'base64');
}

async function supabaseUpload(png: Buffer, key: string): Promise<string> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');
  const bucket = 'social-posts';
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${key}`;
  const r = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'image/png',
      'x-upsert': 'true',
    },
    body: png as any,
  });
  if (!r.ok) throw new Error(`Supabase upload ${r.status}: ${await r.text()}`);
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${key}`;
}

/**
 * Generate one image, upload it, return the public URL Meta/LI/YT can fetch.
 */
export async function generateImageUrl(prompt: string, slug: string): Promise<string> {
  const png = await fluxSchnellPng(prompt);
  const key = `${new Date().toISOString().slice(0, 10)}/${slug}.png`;
  return supabaseUpload(png, key);
}
