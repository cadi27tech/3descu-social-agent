import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const BLOCKED = new Set(['e2af5ae350356721', 'e7542f24f23ec30c', 'a7805dd0db8159ef']);
import { parse } from 'csv-parse/sync';
import {
  berlinToUtc,
  buildSchedule,
  isoWeek,
  MAX_ATTEMPTS,
  nextSlot,
  runDue,
  selectDue,
  type Entry,
  type State,
} from '../src/core.ts';

const rows = parse(readFileSync('data/calendar-q4-2026.csv'), { columns: true, bom: true }) as Record<string, string>[];
const committed = JSON.parse(readFileSync('data/schedule.json', 'utf8')) as Entry[];

test('calendar parse: 228 rows in, drafts excluded, committed schedule is current', () => {
  assert.equal(rows.length, 228);
  const drafts = rows.filter((r) => r.Draft === 'TRUE').length;
  assert.equal(drafts, 4);
  const built = buildSchedule(rows);
  assert.equal(built.length, 228 - drafts);
  assert.ok(built.every((e) => e.draft === false));
  assert.deepEqual(committed, built, 'data/schedule.json is stale or hand-edited: run npm run build:schedule');
  assert.equal(new Set(committed.map((e) => e.id)).size, committed.length, 'ids unique');
});

test('captions are the CSV text, byte for byte', () => {
  const live = rows.filter((r) => r.Draft !== 'TRUE');
  assert.equal(live.length, committed.length);
  committed.forEach((e, i) => assert.equal(e.caption, live[i].Text, e.id));
});

test('channel modes and media', () => {
  for (const e of committed) {
    const auto = ['facebook', 'instagram', 'story'].includes(e.channel);
    assert.equal(e.mode, auto ? 'auto' : 'manual', e.id);
    if (!auto) continue;
    assert.ok(e.media.length >= 1, e.id);
    for (const m of e.media) assert.ok(existsSync(`media/${m}`), `missing media/${m}`);
    if (e.media_type === 'reel') assert.ok(e.media[0].endsWith('.mp4'), e.id);
    if (e.media_type === 'carousel') assert.ok(e.media.length >= 2 && e.media.length <= 10, e.id);
    if (e.channel === 'story') assert.equal(e.media_type, 'story');
  }
});

test('every ISO week has at least 3 facebook, 3 instagram feed, 1 story', () => {
  const weeks = new Map<string, { facebook: number; instagram: number; story: number }>();
  for (const e of committed) {
    const { year, week } = isoWeek(e.local.slice(0, 10));
    const k = `${year}-W${week}`;
    const w = weeks.get(k) ?? { facebook: 0, instagram: 0, story: 0 };
    if (e.channel === 'facebook' || e.channel === 'instagram' || e.channel === 'story') w[e.channel]++;
    weeks.set(k, w);
  }
  assert.equal(weeks.size, 14, [...weeks.keys()].join(' ')); // 2026-W40 .. 2026-W53
  for (const [k, w] of weeks) {
    assert.ok(w.facebook >= 3, `${k} facebook ${w.facebook}`);
    assert.ok(w.instagram >= 3, `${k} instagram ${w.instagram}`);
    assert.ok(w.story >= 1, `${k} story ${w.story}`);
  }
});

test('Europe/Berlin to UTC across the 2026-10-25 DST switch', () => {
  assert.equal(berlinToUtc('2026-10-24', '12:00:00'), '2026-10-24T10:00:00.000Z'); // CEST +2
  assert.equal(berlinToUtc('2026-10-25', '01:30:00'), '2026-10-24T23:30:00.000Z'); // still CEST
  assert.equal(berlinToUtc('2026-10-25', '12:00:00'), '2026-10-25T11:00:00.000Z'); // CET +1
  assert.equal(berlinToUtc('2026-10-26', '12:00:00'), '2026-10-26T11:00:00.000Z');
  assert.equal(berlinToUtc('2026-12-29', '13:00:00'), '2026-12-29T12:00:00.000Z');
  assert.equal(isoWeek('2026-12-29').week, 53);
  assert.equal(isoWeek('2026-10-01').week, 40);
  for (const e of committed) {
    const hours = Number(e.local.slice(11, 13)) - Number(e.publish_at.slice(11, 13));
    assert.equal(hours, e.local < '2026-10-25' ? 2 : 1, e.id);
  }
});

const mk = (id: string, date: string, time: string, mode: 'auto' | 'manual' = 'auto'): Entry => ({
  id,
  channel: 'facebook',
  mode,
  publish_at: berlinToUtc(date, time),
  local: `${date} ${time} Europe/Berlin`,
  caption: 'x',
  media_type: 'image',
  media: ['gfx/x.jpg'],
  alt: [''],
  draft: false,
});
const ids = (xs: Entry[]) => xs.map((e) => e.id);

test('due selection around DST', () => {
  const before = mk('sat', '2026-10-24', '12:00'); // 10:00Z
  const after = mk('mon', '2026-10-26', '12:00'); // 11:00Z, not 10:00Z
  const manual = mk('li', '2026-10-24', '08:30', 'manual');
  const all = [after, before, manual];
  assert.deepEqual(ids(selectDue(all, {}, new Date('2026-10-24T09:59:00Z')).due), []);
  assert.deepEqual(ids(selectDue(all, {}, new Date('2026-10-24T10:05:00Z')).due), ['sat']);
  assert.deepEqual(ids(selectDue(all, {}, new Date('2026-10-26T10:30:00Z')).due), [], 'post-switch slot is 11:00Z');
  const late = selectDue(all, {}, new Date('2026-10-26T11:05:00Z'));
  assert.deepEqual(ids(late.due), ['mon']);
  assert.deepEqual(ids(late.missed), ['sat'], 'over 24 h overdue is missed, never posted late');
  const edge = selectDue([before], {}, new Date('2026-10-25T10:00:00Z'));
  assert.deepEqual(ids(edge.due), ['sat'], 'exactly 24 h late still posts');
});

test('next slot: earliest future auto entry not yet handled', () => {
  const a = mk('a', '2026-11-02', '12:00'); // 11:00Z
  const b = mk('b', '2026-11-02', '12:30'); // 11:30Z
  const m = mk('m', '2026-11-02', '09:00', 'manual');
  const at = (s: State, now: string) => nextSlot([b, m, a], s, new Date(now));
  assert.equal(at({}, '2026-11-02T07:00:00Z'), Date.parse('2026-11-02T11:00:00Z'), 'manual rows are not waited for');
  assert.equal(at({ a: { status: 'published', at: 'x' } }, '2026-11-02T07:00:00Z'), Date.parse('2026-11-02T11:30:00Z'));
  assert.equal(at({}, '2026-11-02T11:00:00Z'), Date.parse('2026-11-02T11:30:00Z'), 'a slot due now is posted, not waited for');
  assert.equal(at({}, '2026-11-02T12:00:00Z'), null);
});

test('idempotency: a second run publishes nothing, failures retry up to the cap', async () => {
  const a = mk('a', '2026-11-02', '12:00');
  const b = mk('b', '2026-11-02', '12:30');
  const now = new Date('2026-11-02T12:00:00Z');
  const state: State = {};
  const posted: string[] = [];
  let saves = 0;
  const save = () => void saves++;
  let failB = true;
  const publish = async (e: Entry) => {
    if (e.id === 'b' && failB) throw new Error('boom');
    posted.push(e.id);
    return [`post-${e.id}`];
  };

  const r1 = await runDue([a, b], state, now, publish, save);
  assert.deepEqual(r1.published, ['a']);
  assert.deepEqual(r1.failed, ['b']);
  assert.equal(state.a.status, 'published');
  assert.deepEqual(state.a.ids, ['post-a']);
  assert.equal(saves, 2, 'state saved after every entry');

  const r2 = await runDue([a, b], state, now, publish, save);
  assert.deepEqual(r2.published, []);
  assert.equal(state.b.attempts, 2);
  await runDue([a, b], state, now, publish, save);
  assert.equal(state.b.attempts, MAX_ATTEMPTS);
  failB = false;
  const r4 = await runDue([a, b], state, now, publish, save);
  assert.deepEqual(r4.published, [], 'gives up after MAX_ATTEMPTS');
  assert.deepEqual(posted, ['a'], 'a posted exactly once');

  // Round-trip through JSON, as the committed data/published.json does.
  const reloaded = JSON.parse(JSON.stringify(state)) as State;
  assert.deepEqual(selectDue([a, b], reloaded, now).due, []);
});

// Adrian 2026-10-02: the 50/50 split (orders over €500) is bank transfer only; card and PayPal are paid in full upfront.
// Every sentence that offers the split must name the bank transfer in the same sentence (captions and alt text).
const SPLIT = /50\s*\/\s*50|half to start|Hälfte zum Start|moitié au (démarrage|lancement)|helft bij de start/i;
const BANK = /bank transfer|Überweisung|virement|overboeking/i;
const bareSplit = (s: string) => s.split(/(?<=[.!?]["”»]?)\s+|\n/).filter((x) => SPLIT.test(x) && !BANK.test(x));

test('50/50 is only ever offered by bank transfer', () => {
  assert.equal(bareSplit('Orders over €500 can be paid 50/50.').length, 1, 'guard catches the bare split');
  assert.equal(bareSplit('Pay 50/50. Bank transfer only.').length, 1, 'guard needs the same sentence');
  assert.equal(bareSplit('Card with the heading "Pay 50/50." and the line "Pay by bank transfer."').length, 1, 'quoted heading');
  assert.equal(bareSplit('Orders over €500 paid by bank transfer can be split 50/50: half to start, half before shipping.').length, 0);
  for (const e of committed) for (const t of [e.caption, ...e.alt]) assert.deepEqual(bareSplit(t), [], e.id);
});

// Card payments launch (2026-10): the bank transfer price is the headline and card is the standard price. Card is never
// described as costing extra, and no payment post is due on a day that already has a post on the same channel.
const PAY = committed.filter((e) => e.media.some((m) => m.startsWith('gfx/payments/')));
const CARD_COST = /\b(fees?|surcharges?)\b|Gebühr|Aufpreis|\bfrais\b|supplément|toeslag|\bkosten\b/i;

test('card payments posts: 10 posts, no card-cost wording, one post per channel per day', () => {
  assert.equal(PAY.length, 10);
  assert.deepEqual(PAY.map((e) => e.channel).sort().join(), 'facebook,facebook,facebook,facebook,instagram,instagram,instagram,instagram,linkedin,linkedin');
  // One price for every payment method since 2026-10-07: nothing still to publish may describe two prices.
  const TWO_PRICES = /bank transfer price|standard price|Überweisungspreis|Standardpreis|prix virement|prix standard|overboekingsprijs|standaardprijs/i;
  for (const e of committed.filter((x) => x.mode === 'auto' && x.local >= '2026-10-08')) {
    for (const t of [e.caption, ...e.alt]) assert.ok(!TWO_PRICES.test(t), `${e.id}: ${t.match(TWO_PRICES)?.[0]}`);
  }
  for (const e of PAY) {
    for (const t of [e.caption, ...e.alt]) assert.ok(!CARD_COST.test(t), `${e.id}: ${t.match(CARD_COST)?.[0]}`);
    const sameDay = committed.filter((x) => x.channel === e.channel && x.local.slice(0, 10) === e.local.slice(0, 10));
    assert.equal(sameDay.length, 1, `${e.id} shares its day with another ${e.channel} post`);
  }
});

// Explainer videos (2026-10): ten reels, each on Facebook and Instagram, from the approved 9:16 EN files. Links are clean
// (no tracking parameters in a caption) and Instagram says "link in bio", because its captions do not link.
const EXPLAINERS = committed.filter((e) => e.media.some((m) => m.startsWith('video/explainer-')));

test('explainer video posts: 20 reels, clean links, files present, no other post on the channel within 4 hours', () => {
  assert.equal(EXPLAINERS.length, 20);
  assert.equal(new Set(EXPLAINERS.map((e) => e.media[0])).size, 10, 'ten different videos');
  for (const e of EXPLAINERS) {
    assert.equal(e.media_type, 'reel', e.id);
    assert.ok(existsSync(`media/${e.media[0]}`), `${e.id}: media/${e.media[0]} is not committed`);
    assert.ok(!/utm_|https?:\/\/\S*\?/.test(e.caption), `${e.id}: the caption carries a tracking link`);
    if (e.channel === 'instagram') assert.ok(!/https?:\/\//.test(e.caption) && /link in bio/.test(e.caption), `${e.id}: Instagram needs "link in bio" and no URL`);
    else assert.ok(/https:\/\/quote\.3descu\.com/.test(e.caption), `${e.id}: Facebook needs the quote link`);
    assert.ok((e.caption.match(/#\w+/g) ?? []).length <= 3, `${e.id}: more than 3 hashtags`);
    // Was one post per channel per day; since the press posts (2026-10) an evening post may follow a noon reel.
    const near = committed.filter((x) => x.channel === e.channel && Math.abs(Date.parse(x.publish_at) - Date.parse(e.publish_at)) < 4 * 3600_000);
    assert.equal(near.length, 1, `${e.id} is within 4 hours of another ${e.channel} post`);
  }
});

// Press coverage, 21 Oct 2026 (Profit.ro, Observator, Click!, Gorjul Azi, Romania Journal): EN Facebook + Instagram on
// Tue 27 Oct, RO on Wed 28 Oct, 18:30 and 19:00 Bucharest. Both days already carry a noon post, so the ids get a time suffix.
test('press coverage posts: slots, Profit.ro link on Facebook only, JPG media, no dashes', () => {
  const press = committed.filter((e) => e.media.some((m) => m.startsWith('gfx/press/')));
  assert.deepEqual(press.map((e) => `${e.id} ${e.publish_at}`).sort(), [
    'q4w44-tue-facebook-1730 2026-10-27T16:30:00.000Z',
    'q4w44-tue-instagram-1800 2026-10-27T17:00:00.000Z',
    'q4w44-wed-facebook-1730 2026-10-28T16:30:00.000Z',
    'q4w44-wed-instagram-1800 2026-10-28T17:00:00.000Z',
  ]);
  for (const e of press) {
    const all = [e.caption, ...e.alt].join(' ');
    assert.ok(!/[\u2012-\u2015]|4[.,]66|\bEUR\b/i.test(all), `${e.id}: dash, 4.66 or EUR`);
    // Marketplace names are never published, so the blocklist holds hashes, not the names.
    const words = all.toLowerCase().split(/[^a-z0-9]+/);
    assert.ok(!words.some((w) => BLOCKED.has(createHash('sha256').update(w).digest('hex').slice(0, 16))), `${e.id}: a marketplace name`);
    if (e.channel === 'instagram') assert.ok(!/https?:\/\//.test(e.caption) && /link (in|\u00een) bio/.test(e.caption), `${e.id}: Instagram needs "link in bio" and no URL`);
    else assert.ok(/https:\/\/www\.profit\.ro\/\S+-22863423/.test(e.caption), `${e.id}: Facebook needs the Profit.ro link`);
    assert.ok(e.alt.length === 1 && e.alt[0].length > 50, `${e.id}: alt text`);
    for (const m of e.media) assert.ok(existsSync(`media/${m}`) && m.endsWith('.jpg'), `${e.id}: media/${m} missing or not JPG`);
  }
});

test('workflow: one run at a time, each reads the latest state (no double post)', () => {
  const wf = readFileSync('.github/workflows/publish.yml', 'utf8');
  assert.match(wf, /^concurrency:\s*\n\s*group: social-publisher\s*\n\s*cancel-in-progress: false$/m);
  const checkout = wf.slice(wf.indexOf('uses: actions/checkout'), wf.indexOf('uses: actions/setup-node'));
  assert.match(checkout, /ref: \$\{\{ github\.ref_name \}\}/, 'queued runs must check out the branch tip, not the trigger SHA');
});

// Content pack 17 Oct 2026: 11 company posts adapted for Facebook and Instagram (LI-05 is the Black Cat story, already
// run under its own name). Instagram says "link in bio" and carries no URL; Facebook keeps a clean link. 1080x1350 media.
test('content pack 17 Oct: clean links, link in bio on Instagram, no dashes', () => {
  // The pack runs at its LinkedIn slot times (09:30, 10:00, 15:00), which no other auto entry from 22 Oct uses.
  const pack = committed.filter((e) => e.mode === 'auto' && e.local >= '2026-10-22' && ['09:30', '10:00', '15:00'].includes(e.local.slice(11, 16)));
  assert.equal(pack.length, 22, pack.map((e) => e.id).join(' '));
  for (const e of pack) {
    assert.ok(!/utm_|[\u2012-\u2015]|€|4[.,]66/.test(e.caption), `${e.id}: tracking link, dash, euro sign or 4.66`);
    if (e.channel === 'instagram') assert.ok(!/https?:\/\//.test(e.caption) && /link in bio/.test(e.caption), `${e.id}: Instagram needs "link in bio" and no URL`);
    else assert.ok(/https:\/\/(quote\.3descu\.com|3descu\.zohobookings\.eu)/.test(e.caption), `${e.id}: Facebook needs the link`);
    assert.ok((e.caption.match(/(^|\s)#\w+/g) ?? []).length <= 5, `${e.id}: more than 5 hashtags`);
    for (const m of e.media) assert.ok(existsSync(`media/${m}`), `${e.id}: media/${m} is not committed`);
  }
});

// Romania Journal feature, 21 Oct 2026: FB + IG on Sun 25 Oct, Romanian FB on Sun 1 Nov. Article link on Facebook only.
test('Romania Journal posts: slots, article link on Facebook, media committed, no dashes', () => {
  const rj = committed.filter((e) => e.media.some((m) => m.startsWith('gfx/rj/')));
  assert.deepEqual(rj.map((e) => `${e.id} ${e.publish_at}`), [
    'q4w43-sun-facebook 2026-10-25T09:30:00.000Z',
    'q4w43-sun-instagram 2026-10-25T17:00:00.000Z',
    'q4w44-sun-facebook 2026-11-01T09:30:00.000Z',
  ]);
  for (const e of rj) {
    assert.ok(!/[\u2012-\u2015]/.test(e.caption), `${e.id}: dash`);
    assert.equal(/romaniajournal\.ro\/business\//.test(e.caption), e.channel === 'facebook', `${e.id}: article URL on Facebook only`);
    for (const m of e.media) assert.ok(existsSync(`media/${m}`) && m.endsWith('.jpg'), `${e.id}: media/${m} missing or not JPG`);
  }
});
