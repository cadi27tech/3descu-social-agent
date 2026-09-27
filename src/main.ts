// Cron entrypoint: publish every due calendar entry to the Facebook Page and Instagram,
// record it in data/published.json. Missing secrets or --dry-run = log only, exit 0.

import { readFileSync, writeFileSync } from 'node:fs';
import { runDue, selectDue, type Entry, type State } from './core.ts';
import { getPageToken, igUsername, publishEntry } from './meta.ts';

const SCHEDULE = 'data/schedule.json';
const STATE = 'data/published.json';
const SECRETS = ['META_PAGE_ID', 'META_IG_USER_ID', 'META_SYSTEM_USER_TOKEN'] as const;
const MEDIA_BASE = (
  process.env.MEDIA_BASE_URL || 'https://raw.githubusercontent.com/cadi27tech/3descu-social-agent/main/media'
).replace(/\/+$/, '');

const entries = JSON.parse(readFileSync(SCHEDULE, 'utf8')) as Entry[];
const state = JSON.parse(readFileSync(STATE, 'utf8')) as State;
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const missing = SECRETS.filter((k) => !process.env[k]);
const dry = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1' || missing.length > 0;

const line = (e: Entry) => `${e.id}  ${e.channel}/${e.media_type}  ${e.local}  ${e.media.join(', ')}`;

function save(s: State): void {
  const sorted = Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(STATE, JSON.stringify(sorted, null, 2) + '\n');
}

console.log(`3Descu calendar publisher  now=${now.toISOString()}  mode=${dry ? 'DRY RUN' : 'LIVE'}`);
if (missing.length) console.log(`Missing secrets (dry run): ${missing.join(', ')}`);

if (dry) {
  const { due, missed } = selectDue(entries, state, now);
  console.log(`\nDue now: ${due.length}`);
  for (const e of due) console.log(`  would post  ${line(e)}\n    caption: ${JSON.stringify(e.caption.slice(0, 80))}`);
  if (missed.length) console.log(`Too late to post (over 6 h overdue): ${missed.map((e) => e.id).join(', ')}`);

  const open = entries
    .filter((e) => e.mode === 'auto' && !state[e.id] && Date.parse(e.publish_at) > now.getTime())
    .sort((a, b) => a.publish_at.localeCompare(b.publish_at));
  const perChannel: Record<string, number> = {};
  for (const e of open) perChannel[e.channel] = (perChannel[e.channel] ?? 0) + 1;
  console.log(`\nUpcoming automated posts: ${open.length}  ${JSON.stringify(perChannel)}`);
  console.log(`Manual rows (scheduled elsewhere): ${entries.filter((e) => e.mode === 'manual').length}`);
  for (const e of open.slice(0, 5)) console.log(`  next  ${line(e)}  -> ${MEDIA_BASE}/${e.media[0]}`);
  if (!missing.length) {
    // Secrets present: prove they work with read-only calls, post nothing.
    const pageToken = await getPageToken(process.env.META_PAGE_ID as string, process.env.META_SYSTEM_USER_TOKEN as string);
    console.log(`\nCredentials OK: Page token obtained, Instagram account ${await igUsername(process.env.META_IG_USER_ID as string, pageToken)}`);
  }
  process.exit(0);
}

const pageId = process.env.META_PAGE_ID as string;
const cfg = {
  pageId,
  igUserId: process.env.META_IG_USER_ID as string,
  pageToken: await getPageToken(pageId, process.env.META_SYSTEM_USER_TOKEN as string),
  mediaBase: MEDIA_BASE,
};

const res = await runDue(entries, state, now, (e) => publishEntry(e, cfg), save);
for (const id of res.published) console.log(`published  ${id}  ${state[id].ids?.join(',')}`);
for (const id of res.failed) console.error(`FAILED     ${id}  attempt ${state[id].attempts}: ${state[id].error}`);
for (const id of res.missed) console.error(`MISSED     ${id}  (more than 6 h overdue, not posted)`);
console.log(`\n${res.published.length} published, ${res.failed.length} failed, ${res.missed.length} missed`);
process.exit(res.failed.length || res.missed.length ? 1 : 0);
