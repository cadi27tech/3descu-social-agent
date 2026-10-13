// Prints the seconds until the next automated post that is not yet handled (nothing if none).
// The workflow sleeps that long, then starts a fresh run so the post goes out on time.

import { readFileSync } from 'node:fs';
import { nextSlot, type Entry, type State } from './core.ts';

const read = <T>(f: string) => JSON.parse(readFileSync(f, 'utf8')) as T;
const now = new Date();
const at = nextSlot(read<Entry[]>('data/schedule.json'), read<State>('data/published.json'), now);
if (at !== null) console.log(Math.ceil((at - now.getTime()) / 1000));
