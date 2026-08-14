// Publishers per channel. Meta covers FB + IG (one token), LinkedIn UGC,
// YouTube Data API. Each returns the public post URL or throws.
// ponytail: minimal fetch calls, no SDK bloat.

import { google } from 'googleapis';
import { CaptionSet } from './captions.ts';
import { requireEnv } from './config.ts';

// ─── Facebook Page post ─────────────────────────────────────────────────────
export async function publishFacebook(imageUrl: string, caption: string): Promise<string> {
  const token = requireEnv('META_PAGE_ACCESS_TOKEN');
  const pageId = requireEnv('META_FB_PAGE_ID');
  const url = `https://graph.facebook.com/v20.0/${pageId}/photos`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      url: imageUrl,
      caption,
      access_token: token,
    }),
  });
  if (!r.ok) throw new Error(`FB publish ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { id: string; post_id?: string };
  return `https://facebook.com/${data.post_id ?? data.id}`;
}

// ─── Instagram feed post (2-step: create container, then publish) ───────────
export async function publishInstagram(imageUrl: string, caption: string): Promise<string> {
  const token = requireEnv('META_PAGE_ACCESS_TOKEN');
  const igId = requireEnv('META_IG_BUSINESS_ACCOUNT_ID');

  // Step 1: create media container
  const createR = await fetch(`https://graph.facebook.com/v20.0/${igId}/media`, {
    method: 'POST',
    body: new URLSearchParams({ image_url: imageUrl, caption, access_token: token }),
  });
  if (!createR.ok) throw new Error(`IG create ${createR.status}: ${await createR.text()}`);
  const { id: creationId } = (await createR.json()) as { id: string };

  // Step 2: publish (may need a brief delay for Meta to fetch the image; retry once)
  const publish = async () => {
    const r = await fetch(`https://graph.facebook.com/v20.0/${igId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: creationId, access_token: token }),
    });
    return r;
  };
  let r = await publish();
  if (!r.ok) {
    await new Promise((res) => setTimeout(res, 5000));
    r = await publish();
  }
  if (!r.ok) throw new Error(`IG publish ${r.status}: ${await r.text()}`);
  const { id } = (await r.json()) as { id: string };
  return `https://instagram.com/p/${id}`;
}

// ─── LinkedIn UGC (personal profile) ────────────────────────────────────────
export async function publishLinkedIn(imageUrl: string, caption: string): Promise<string> {
  const token = requireEnv('LINKEDIN_ACCESS_TOKEN');
  const author = requireEnv('LINKEDIN_PERSON_URN');

  // Register upload
  const regR = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: author,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
        ],
      },
    }),
  });
  if (!regR.ok) throw new Error(`LI register ${regR.status}: ${await regR.text()}`);
  const reg = (await regR.json()) as any;
  const uploadUrl: string =
    reg.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']
      .uploadUrl;
  const asset: string = reg.value.asset;

  // Fetch image bytes and PUT to LinkedIn's upload URL
  const imgResp = await fetch(imageUrl);
  const imgBytes = Buffer.from(await imgResp.arrayBuffer());
  const upR = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: imgBytes as any,
  });
  if (!upR.ok) throw new Error(`LI upload ${upR.status}: ${await upR.text()}`);

  // Create the UGC post
  const postR = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-restli-protocol-version': '2.0.0',
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: caption },
          shareMediaCategory: 'IMAGE',
          media: [{ status: 'READY', media: asset }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  if (!postR.ok) throw new Error(`LI post ${postR.status}: ${await postR.text()}`);
  const { id } = (await postR.json()) as { id: string };
  return `https://linkedin.com/feed/update/${id}`;
}

// ─── YouTube Community post ─────────────────────────────────────────────────
// Note: the YouTube Data API v3 has a `channelSections` and `activities` endpoint
// but Community posts specifically use the `youtube.commentThreads` / `communityPosts`
// which is still gated to channels with 500+ subs. Fallback: post a Channel
// activity update. For a fresh channel, skip YouTube until 500 subs and post to
// FB+IG+LI only. Handled gracefully below.
export async function publishYouTube(imageUrl: string, caption: string): Promise<string> {
  const oauth = new google.auth.OAuth2(
    requireEnv('YOUTUBE_CLIENT_ID'),
    requireEnv('YOUTUBE_CLIENT_SECRET'),
  );
  oauth.setCredentials({ refresh_token: requireEnv('YOUTUBE_REFRESH_TOKEN') });
  const yt = google.youtube({ version: 'v3', auth: oauth });

  // Community posts API is not yet public in v3. Skip for now, log the intent.
  // Once your channel hits 500 subs (Community tab eligibility), swap this to
  // the private v1 endpoint or the third-party `youtube-community-post` lib.
  console.log(
    `[youtube] Community posts API is gated. Would post: ${caption.slice(0, 80)}...\n  Image: ${imageUrl}`,
  );
  void yt;
  return `SKIPPED (channel needs 500+ subs for Community posts API)`;
}

// ─── Router ─────────────────────────────────────────────────────────────────
export async function publishTo(
  channel: 'facebook' | 'instagram' | 'linkedin' | 'youtube',
  imageUrl: string,
  captions: CaptionSet,
): Promise<string> {
  switch (channel) {
    case 'facebook':
      return publishFacebook(imageUrl, captions.facebook);
    case 'instagram':
      return publishInstagram(imageUrl, captions.instagram);
    case 'linkedin':
      return publishLinkedIn(imageUrl, captions.linkedin);
    case 'youtube':
      return publishYouTube(imageUrl, captions.youtube);
  }
}
