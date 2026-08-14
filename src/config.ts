// Central config. All secrets from env, all knobs in one place.
// ponytail: single-file config, promote to typed schema only if it grows past ~50 keys.

export const CONFIG = {
  // Business identity — used in every prompt so captions stay on-brand
  brand: {
    name: '3Descu',
    legal: 'TREIDESCUPRINT SRL',
    location: 'Romania',
    site: 'https://www.3descu.com',
    booking: 'https://3descu.zohobookings.eu/#/263284000000037050',
    email: 'office@3descu.com',
    phone: '+40761760275',
    positioning:
      'ISO 9001-certified 3D printing factory. 190 FDM + 10 SLA printers. B2B for engineers, procurement, product designers. PA-CF, PA12, PETG, ABS, ASA, resins.',
    voice: 'confident, technical, no jargon abuse, no emojis in LinkedIn, tasteful 1-2 emojis in IG/FB max',
  },

  // Weekly cadence
  postsPerRun: 3,
  channels: ['facebook', 'instagram', 'linkedin', 'youtube'] as const,

  // Research seeds — a fresh Tavily query per topic each week
  // Industrial-reference sources per the adapted Tactic-1 playbook
  researchTopics: [
    '3D printing news 2026 OR additive manufacturing news 2026',
    'ISO 9001 3D printing OR certified 3D print supplier Europe',
    'PA-CF carbon fibre nylon industrial applications 2026',
    'FDM vs SLA vs CNC engineering decision case study',
    'industrial 3D printing Romania OR Eastern Europe manufacturing',
    'Formlabs OR Prusa OR Xometry 3D printing new release 2026',
  ],

  // Image gen model on Cloudflare Workers AI (free tier)
  imageModel: '@cf/black-forest-labs/flux-1-schnell',
  imagePromptSuffix:
    ', clean industrial product photography, dark studio background, sharp focus, engineering visualization, no text, no watermarks',

  // Per-channel copy length targets (chars)
  captionTargets: {
    facebook: { min: 200, max: 400, hashtags: 3, emoji: 'tasteful (1-2)', linkAllowed: true },
    instagram: { min: 120, max: 200, hashtags: 8, emoji: 'tasteful (1-2)', linkAllowed: false },
    linkedin: { min: 600, max: 1500, hashtags: 5, emoji: 'none', linkAllowed: true },
    youtube: { min: 300, max: 500, hashtags: 5, emoji: 'none', linkAllowed: true },
  },

  // Image aspect per channel
  imageSpecs: {
    facebook: { width: 1200, height: 630 },
    instagram: { width: 1080, height: 1080 },
    linkedin: { width: 1200, height: 627 },
    youtube: { width: 1080, height: 1080 },
  },
} as const;

export type Channel = (typeof CONFIG.channels)[number];

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}
