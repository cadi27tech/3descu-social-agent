// Weekly cron entrypoint. Research → captions → image → approval → publish.
// Runs from GH Actions Monday 09:00 UTC. Cost per run: ~€0.005.

import { CONFIG } from './config.ts';
import { research } from './research.ts';
import { generateCaptions } from './captions.ts';
import { generateImageUrl } from './images.ts';
import { publishTo } from './publish.ts';
import { requestApproval, notifyPublished, stopBot, isApprovalRequired } from './telegram.ts';

const DRY_RUN = process.env.DRY_RUN === '1';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function runOne(item: Awaited<ReturnType<typeof research>>[number]): Promise<void> {
  const slug = slugify(item.headline);
  console.log(`\n──── ${slug} ────`);
  console.log(`URL: ${item.url}`);

  const captions = await generateCaptions(item);
  console.log(`Captions generated (${Object.values(captions).map((v) => v.length).join('/')} chars)`);

  const imageUrl = DRY_RUN
    ? 'https://placehold.co/1024x1024/000/fff?text=DRY+RUN'
    : await generateImageUrl(captions.imagePrompt, slug);
  console.log(`Image: ${imageUrl}`);

  const decision = await requestApproval(slug, imageUrl, captions);
  if (!decision.approved) {
    console.log(`Skipped.`);
    return;
  }

  if (DRY_RUN) {
    console.log(`[DRY_RUN] would publish to: ${CONFIG.channels.join(', ')}`);
    return;
  }

  const results: { channel: string; url: string }[] = [];
  for (const ch of CONFIG.channels) {
    try {
      const url = await publishTo(ch, imageUrl, captions);
      results.push({ channel: ch, url });
      console.log(`  ${ch}: ${url}`);
    } catch (e) {
      console.error(`  ${ch}: FAILED`, e instanceof Error ? e.message : e);
    }
  }
  await notifyPublished(slug, results);
}

async function main() {
  console.log(`3Descu social autopilot — ${new Date().toISOString()}`);
  console.log(`  DRY_RUN=${DRY_RUN ? 'yes' : 'no'}  APPROVAL_LOOP=${isApprovalRequired() ? 'on' : 'off'}`);
  console.log(`  posts/run=${CONFIG.postsPerRun}  channels=${CONFIG.channels.join(', ')}\n`);

  const items = await research();
  console.log(`Research returned ${items.length} items.`);

  for (const item of items) {
    try {
      await runOne(item);
    } catch (e) {
      console.error(`Post pipeline failed:`, e);
    }
  }

  stopBot();
  console.log(`\nDone.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  stopBot();
  process.exit(1);
});
