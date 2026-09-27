// Pure logic: calendar CSV rows -> schedule entries, Europe/Berlin -> UTC,
// due selection and the idempotent publish loop. No network, no fs.

export type Channel = 'facebook' | 'instagram' | 'story' | 'linkedin' | 'youtube' | 'gbp';
export type MediaType = 'image' | 'carousel' | 'reel' | 'story' | 'video';

export interface Entry {
  id: string;
  channel: Channel;
  // auto = published by this bot; manual = scheduled natively elsewhere (LinkedIn, YouTube, GBP)
  mode: 'auto' | 'manual';
  publish_at: string; // UTC ISO
  local: string; // calendar time, Europe/Berlin
  caption: string;
  media_type: MediaType;
  media: string[]; // paths relative to the media root, e.g. gfx/45/NEW-0015.jpg
  alt: string[]; // aligned with media, '' for videos
  title?: string;
  draft: boolean;
}

export interface StateRecord {
  status: 'published' | 'missed' | 'failed';
  at: string;
  ids?: string[];
  attempts?: number;
  error?: string;
}
export type State = Record<string, StateRecord>;

export const AUTO_CHANNELS: readonly Channel[] = ['facebook', 'instagram', 'story'];
export const MAX_LATE_MS = 6 * 3600_000; // older than this = missed, never posted late
export const MAX_ATTEMPTS = 3;
export const MEDIA_URL_PREFIX =
  'https://zzamnvhadwibvafqcfpd.supabase.co/storage/v1/object/public/social-media/';

const NETWORKS: Record<string, Channel | null> = {
  Facebook: 'facebook',
  Instagram: 'instagram',
  LinkedIn: 'linkedin',
  YouTube: 'youtube',
  GBP: 'gbp',
  'Twitter/X': null,
  Pinterest: null,
  TikTok: null,
  Threads: null,
  Bluesky: null,
};
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function berlinOffsetMs(t: number): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' })
    .formatToParts(t)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/** Wall-clock Europe/Berlin date + time to a UTC ISO string (DST aware). */
export function berlinToUtc(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Second pass settles instants next to the DST switch.
  const t = wall - berlinOffsetMs(wall - berlinOffsetMs(wall));
  return new Date(t).toISOString();
}

/** ISO 8601 week, e.g. { year: 2026, week: 53 } for 2026-12-29. */
export function isoWeek(date: string): { year: number; week: number } {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // Thursday of this week
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t.getTime() - Date.UTC(year, 0, 1)) / (7 * 86400_000));
  return { year, week };
}

function mediaType(channel: Channel, row: Record<string, string>, media: string[]): MediaType {
  if (channel === 'story') return 'story';
  if (media.some((m) => m.endsWith('.mp4'))) {
    const reel =
      (channel === 'facebook' && row['Facebook Post Type'] === 'REEL') ||
      (channel === 'instagram' && row['Instagram Post Type'] === 'REEL');
    return reel ? 'reel' : 'video';
  }
  return media.length > 1 ? 'carousel' : 'image';
}

/** Metricool-format calendar rows (header-keyed) to schedule entries. Drafts are dropped. */
export function buildSchedule(rows: Record<string, string>[]): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.Draft === 'TRUE') continue;
    const on = Object.keys(NETWORKS).filter((n) => row[n] === 'TRUE');
    const net = on.length === 1 ? NETWORKS[on[0]] : null;
    if (!net) throw new Error(`Row ${row.Date} ${row.Time}: expected one supported network, got [${on.join(',')}]`);
    const channel: Channel = net === 'instagram' && row['Instagram Post Type'] === 'STORY' ? 'story' : net;

    const media: string[] = [];
    const alt: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const url = row[`Picture Url ${i}`];
      if (!url) continue;
      if (!url.startsWith(MEDIA_URL_PREFIX)) throw new Error(`Unexpected media URL: ${url}`);
      media.push(url.slice(MEDIA_URL_PREFIX.length));
      alt.push(row[`Alt text picture ${i}`] ?? '');
    }

    const { week } = isoWeek(row.Date);
    const dow = DOW[new Date(`${row.Date}T12:00:00Z`).getUTCDay()];
    const id = `q4w${week}-${dow}-${channel}`;
    if (seen.has(id)) throw new Error(`Duplicate id ${id}`);
    seen.add(id);

    const title = row['Facebook Title'] || row['YouTube Video Title'];
    out.push({
      id,
      channel,
      mode: AUTO_CHANNELS.includes(channel) ? 'auto' : 'manual',
      publish_at: berlinToUtc(row.Date, row.Time),
      local: `${row.Date} ${row.Time.slice(0, 5)} Europe/Berlin`,
      caption: row.Text,
      media_type: mediaType(channel, row, media),
      media,
      alt,
      ...(title ? { title } : {}),
      draft: false,
    });
  }
  return out;
}

/** Auto entries that are due now and not yet handled, plus those too late to post. */
export function selectDue(
  entries: Entry[],
  state: State,
  now: Date,
  maxLateMs = MAX_LATE_MS,
): { due: Entry[]; missed: Entry[] } {
  const due: Entry[] = [];
  const missed: Entry[] = [];
  for (const e of entries) {
    if (e.mode !== 'auto') continue;
    const s = state[e.id];
    if (s && (s.status !== 'failed' || (s.attempts ?? 0) >= MAX_ATTEMPTS)) continue;
    const late = now.getTime() - Date.parse(e.publish_at);
    if (late < 0) continue;
    (late > maxLateMs ? missed : due).push(e);
  }
  due.sort((a, b) => a.publish_at.localeCompare(b.publish_at));
  return { due, missed };
}

/**
 * Publish every due entry once. State is mutated and handed to save() after each
 * entry, so a crash mid-run never loses a recorded post.
 */
export async function runDue(
  entries: Entry[],
  state: State,
  now: Date,
  publish: (e: Entry) => Promise<string[]>,
  save: (s: State) => void,
): Promise<{ published: string[]; failed: string[]; missed: string[] }> {
  const { due, missed } = selectDue(entries, state, now);
  const res = { published: [] as string[], failed: [] as string[], missed: missed.map((e) => e.id) };
  for (const e of missed) state[e.id] = { status: 'missed', at: now.toISOString() };
  if (missed.length) save(state);
  for (const e of due) {
    try {
      const ids = await publish(e);
      state[e.id] = { status: 'published', at: new Date().toISOString(), ids };
      res.published.push(e.id);
    } catch (err) {
      const attempts = (state[e.id]?.attempts ?? 0) + 1;
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      state[e.id] = { status: 'failed', at: new Date().toISOString(), attempts, error };
      res.failed.push(e.id);
    }
    save(state);
  }
  return res;
}
