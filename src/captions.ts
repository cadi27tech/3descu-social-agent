// Per-channel caption generator. One Claude Haiku call per post covers all 4 channels.
// ponytail: Haiku 4.5 is €0.001/1k input, €0.005/1k output — 12 posts/mo ≈ €0.02/mo.

import Anthropic from '@anthropic-ai/sdk';
import { CONFIG, Channel, requireEnv } from './config.ts';
import { ResearchItem } from './research.ts';

export interface CaptionSet {
  facebook: string;
  instagram: string;
  linkedin: string;
  youtube: string;
  imagePrompt: string; // used by Cloudflare Flux Schnell
}

const client = () => new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });

function buildPrompt(item: ResearchItem): string {
  const { brand, captionTargets } = CONFIG;
  return `You are the content lead for ${brand.name} (${brand.legal}), a ${brand.positioning}
Voice: ${brand.voice}. Never use em-dash or en-dash (only plain hyphen). Never invent facts.
Never name competitor marketplaces (Craftcloud, Xometry, Protolabs) in outbound copy.

Source article for this post:
Title: ${item.headline}
URL: ${item.url}
Snippet: ${item.snippet}
Topic: ${item.topic}

Write 4 platform-native captions AND one image-generation prompt.

Facebook (${captionTargets.facebook.min}-${captionTargets.facebook.max} chars, ${captionTargets.facebook.hashtags} hashtags, 1-2 emojis OK):
  Warm narrative, connect the news to what ${brand.name} does for customers.
  Include a soft CTA: link to ${brand.site} or booking ${brand.booking}.

Instagram (${captionTargets.instagram.min}-${captionTargets.instagram.max} chars, ${captionTargets.instagram.hashtags} hashtags, 1-2 emojis OK):
  Punchy hook, visual angle, no URL (IG doesn't linkify).
  End with a scroll-stopping stat or question.

LinkedIn (${captionTargets.linkedin.min}-${captionTargets.linkedin.max} chars, ${captionTargets.linkedin.hashtags} hashtags, ZERO emojis):
  Thought-leadership take. Personal insight from ${brand.name}'s ISO 9001 factory perspective.
  Use blank lines every 2-3 sentences for mobile readability.
  End with a question that invites engineer/procurement engagement.
  Include the source URL naturally.

YouTube Community post (${captionTargets.youtube.min}-${captionTargets.youtube.max} chars, ${captionTargets.youtube.hashtags} hashtags, ZERO emojis):
  Positions the news + teases a related video from the ${brand.name} channel.

Image prompt (for Flux Schnell text-to-image):
  Concrete visual description. No people faces. No text overlay.
  Style: clean industrial photography, dark studio, sharp macro focus.

Return STRICT JSON only, no markdown fence:
{
  "facebook": "...",
  "instagram": "...",
  "linkedin": "...",
  "youtube": "...",
  "imagePrompt": "..."
}`;
}

export async function generateCaptions(item: ResearchItem): Promise<CaptionSet> {
  const resp = await client().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildPrompt(item) }],
  });
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as CaptionSet;
  return parsed;
}

export function channelFor(_c: Channel, set: CaptionSet): string {
  const m: Record<Channel, string> = {
    facebook: set.facebook,
    instagram: set.instagram,
    linkedin: set.linkedin,
    youtube: set.youtube,
  };
  return m[_c];
}
