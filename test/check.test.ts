import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'csv-parse/sync';
import {
  berlinToUtc,
  buildSchedule,
  isoWeek,
  MAX_ATTEMPTS,
  runDue,
  selectDue,
  type Entry,
  type State,
} from '../src/core.ts';

const rows = parse(readFileSync('data/calendar-q4-2026.csv'), { columns: true, bom: true }) as Record<string, string>[];
const committed = JSON.parse(readFileSync('data/schedule.json', 'utf8')) as Entry[];

test('calendar parse: 161 rows in, drafts excluded, committed schedule is current', () => {
  assert.equal(rows.length, 161);
  const drafts = rows.filter((r) => r.Draft === 'TRUE').length;
  assert.equal(drafts, 4);
  const built = buildSchedule(rows);
  assert.equal(built.length, 161 - drafts);
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
  assert.deepEqual(ids(late.missed), ['sat'], 'over 6 h overdue is missed, never posted late');
  const edge = selectDue([before], {}, new Date('2026-10-24T16:00:00Z'));
  assert.deepEqual(ids(edge.due), ['sat'], 'exactly 6 h late still posts');
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
