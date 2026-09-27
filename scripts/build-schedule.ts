// Regenerates data/schedule.json from data/calendar-q4-2026.csv (Metricool 94-column export).
// --copy-media also copies the files the bot publishes (Facebook, Instagram, Stories) into media/.
// Refresh the CSV first: copy marketing/strategy-2026-10/09-social-calendar-q4-2026.csv over it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { buildSchedule } from '../src/core.ts';

const GFX_DIR = process.env.GFX_DIR ?? '../marketing/strategy-2026-10/social-gfx';
const VIDEO_DIR = process.env.VIDEO_DIR ?? 'A:/Adi/3Descu/Social Upload 2026Q4/video';

const rows = parse(readFileSync('data/calendar-q4-2026.csv'), { columns: true, bom: true }) as Record<string, string>[];
const entries = buildSchedule(rows);
writeFileSync('data/schedule.json', JSON.stringify(entries, null, 2) + '\n');
console.log(`${rows.length} rows in, ${rows.length - entries.length} drafts dropped, ${entries.length} entries written`);

if (process.argv.includes('--copy-media')) {
  const files = new Set(entries.filter((e) => e.mode === 'auto').flatMap((e) => e.media));
  let bytes = 0;
  for (const f of [...files].sort()) {
    const src = f.startsWith('gfx/') ? join(GFX_DIR, f.slice(4)) : f.startsWith('video/') ? join(VIDEO_DIR, f.slice(6)) : '';
    if (!src || !existsSync(src)) throw new Error(`No source for ${f} (looked at ${src || 'nowhere'})`);
    const dest = join('media', f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    bytes += statSync(dest).size;
  }
  console.log(`${files.size} media files copied to media/, ${(bytes / 1e6).toFixed(1)} MB`);
}
