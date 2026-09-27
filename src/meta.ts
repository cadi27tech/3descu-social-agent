// Meta Graph API publishing for one schedule entry: Facebook Page + Instagram Business.
// Token goes in the Authorization header only, so it never appears in a URL or a log line.

import type { Entry } from './core.ts';

const VERSION = 'v24.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 9007]); // 9007 = IG media not ready yet

export interface MetaConfig {
  pageId: string;
  igUserId: string;
  pageToken: string;
  mediaBase: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alt = (key: string, text: string | undefined) => (text ? { [key]: text } : {});

/**
 * One Graph call with backoff. A reply that is 5xx, 429 or a transient Graph error code
 * is retried. A network exception is retried only when `safe` (the call creates nothing
 * visible), because a lost reply to a publish call may mean it went through.
 */
async function graph<T>(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  params: Record<string, string> = {},
  opts: { safe?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  for (let attempt = 1; ; attempt++) {
    let detail: string;
    let retry: boolean;
    try {
      const r = await fetch(method === 'GET' && query ? `${url}?${query}` : url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...opts.headers },
        body: method === 'POST' ? new URLSearchParams(params) : undefined,
      });
      const text = await r.text();
      if (r.ok) return JSON.parse(text) as T;
      let code = 0;
      try {
        code = (JSON.parse(text) as { error?: { code?: number } }).error?.code ?? 0;
      } catch {
        // non-JSON error body
      }
      detail = `${r.status} ${text.slice(0, 300)}`;
      retry = r.status >= 500 || r.status === 429 || TRANSIENT_CODES.has(code);
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
      retry = opts.safe === true;
    }
    if (!retry || attempt >= 5) throw new Error(`${method} ${url.replace(/\/\d{6,}/g, '/{id}')}: ${detail}`);
    await sleep(2000 * 2 ** attempt);
  }
}

/** Page access token for the Page the system user is assigned to. */
export async function getPageToken(pageId: string, systemUserToken: string): Promise<string> {
  const r = await graph<{ access_token?: string }>('GET', `${GRAPH}/${pageId}`, systemUserToken, {
    fields: 'access_token',
  }, { safe: true });
  if (!r.access_token) throw new Error('No Page access token: is the Page assigned to the system user?');
  return r.access_token;
}

export async function igUsername(igUserId: string, token: string): Promise<string> {
  const r = await graph<{ username?: string }>('GET', `${GRAPH}/${igUserId}`, token, { fields: 'username' }, { safe: true });
  return `@${r.username ?? '?'}`;
}

async function assertReachable(url: string): Promise<void> {
  const r = await fetch(url, { method: 'HEAD' });
  if (!r.ok) throw new Error(`Media not reachable (${r.status}): ${url}`);
}

// ---------- Facebook Page ----------

async function facebook(e: Entry, c: MetaConfig, urls: string[]): Promise<string[]> {
  const t = c.pageToken;
  const page = `${GRAPH}/${c.pageId}`;
  if (e.media_type === 'image') {
    const r = await graph<{ id: string; post_id?: string }>('POST', `${page}/photos`, t, {
      url: urls[0],
      message: e.caption,
      ...alt('alt_text_custom', e.alt[0]),
    });
    return [r.post_id ?? r.id];
  }
  if (e.media_type === 'carousel') {
    const ids: string[] = [];
    for (const [i, url] of urls.entries()) {
      const r = await graph<{ id: string }>('POST', `${page}/photos`, t, {
        url,
        published: 'false',
        ...alt('alt_text_custom', e.alt[i]),
      }, { safe: true });
      ids.push(r.id);
    }
    const r = await graph<{ id: string }>('POST', `${page}/feed`, t, {
      message: e.caption,
      attached_media: JSON.stringify(ids.map((media_fbid) => ({ media_fbid }))),
    });
    return [r.id];
  }
  if (e.media_type === 'reel') {
    const start = await graph<{ video_id: string; upload_url: string }>('POST', `${page}/video_reels`, t, {
      upload_phase: 'start',
    }, { safe: true });
    await graph('POST', start.upload_url, t, {}, {
      safe: true,
      headers: { authorization: `OAuth ${t}`, file_url: urls[0] },
    });
    await graph('POST', `${page}/video_reels`, t, {
      upload_phase: 'finish',
      video_id: start.video_id,
      video_state: 'PUBLISHED',
      description: e.caption,
    });
    return [start.video_id];
  }
  if (e.media_type === 'video') {
    const r = await graph<{ id: string }>('POST', `${page}/videos`, t, {
      file_url: urls[0],
      description: e.caption,
      ...(e.title ? { title: e.title } : {}),
    });
    return [r.id];
  }
  throw new Error(`Facebook cannot take media_type ${e.media_type}`);
}

// ---------- Instagram Business ----------

async function igContainer(c: MetaConfig, params: Record<string, string>): Promise<string> {
  const r = await graph<{ id: string }>('POST', `${GRAPH}/${c.igUserId}/media`, c.pageToken, params, { safe: true });
  return r.id;
}

async function igWaitReady(c: MetaConfig, id: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const r = await graph<{ status_code?: string }>('GET', `${GRAPH}/${id}`, c.pageToken, {
      fields: 'status_code',
    }, { safe: true });
    if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new Error(`IG container ${r.status_code} (media format or URL rejected)`);
    }
    await sleep(5000);
  }
  throw new Error('IG container not ready after 5 minutes');
}

async function igPublish(c: MetaConfig, creationId: string): Promise<string> {
  await igWaitReady(c, creationId);
  const r = await graph<{ id: string }>('POST', `${GRAPH}/${c.igUserId}/media_publish`, c.pageToken, {
    creation_id: creationId,
  });
  return r.id;
}

async function instagram(e: Entry, c: MetaConfig, urls: string[]): Promise<string[]> {
  const isVideo = urls[0].endsWith('.mp4');
  if (e.media_type === 'image') {
    return [await igPublish(c, await igContainer(c, { image_url: urls[0], caption: e.caption, ...alt('alt_text', e.alt[0]) }))];
  }
  if (e.media_type === 'carousel') {
    const children: string[] = [];
    for (const [i, url] of urls.entries()) {
      const id = await igContainer(c, { image_url: url, is_carousel_item: 'true', ...alt('alt_text', e.alt[i]) });
      await igWaitReady(c, id);
      children.push(id);
    }
    const parent = await igContainer(c, { media_type: 'CAROUSEL', children: children.join(','), caption: e.caption });
    return [await igPublish(c, parent)];
  }
  if (e.media_type === 'reel') {
    const id = await igContainer(c, { media_type: 'REELS', video_url: urls[0], caption: e.caption, share_to_feed: 'true' });
    return [await igPublish(c, id)];
  }
  if (e.media_type === 'story') {
    // Stories take no caption through the API; the calendar text is the on-image message.
    const id = await igContainer(c, { media_type: 'STORIES', [isVideo ? 'video_url' : 'image_url']: urls[0] });
    return [await igPublish(c, id)];
  }
  throw new Error(`Instagram cannot take media_type ${e.media_type}`);
}

export async function publishEntry(e: Entry, c: MetaConfig): Promise<string[]> {
  const urls = e.media.map((m) => `${c.mediaBase}/${m}`);
  for (const u of urls) await assertReachable(u);
  return e.channel === 'facebook' ? facebook(e, c, urls) : instagram(e, c, urls);
}
