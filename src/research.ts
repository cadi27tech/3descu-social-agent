// Tavily research agent. Cheap, free tier is 1000 queries/mo (we use ~24/mo).
// ponytail: raw fetch, no SDK — the API is one POST endpoint.

import { CONFIG, requireEnv } from './config.ts';

export interface ResearchItem {
  topic: string;
  headline: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
  score: number;
}

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: requireEnv('TAVILY_API_KEY'),
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      days: 21, // only stories from the last 3 weeks
    }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { results: TavilyResult[] };
  return data.results ?? [];
}

/**
 * Rotate through the topic list; return `postsPerRun` items that are
 * distinct URLs and the top-scored result per topic.
 */
export async function research(): Promise<ResearchItem[]> {
  const shuffled = [...CONFIG.researchTopics].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, CONFIG.postsPerRun);
  const items: ResearchItem[] = [];
  const seenUrls = new Set<string>();

  for (const topic of picks) {
    try {
      const results = await tavilySearch(topic);
      const best = results.find((r) => !seenUrls.has(r.url));
      if (!best) continue;
      seenUrls.add(best.url);
      items.push({
        topic,
        headline: best.title,
        url: best.url,
        snippet: best.content.slice(0, 500),
        publishedDate: best.published_date,
      });
    } catch (e) {
      console.error(`[research] topic failed: ${topic}`, e);
    }
  }
  return items;
}

// Self-check: expects TAVILY_API_KEY in env.
if (import.meta.url === `file://${process.argv[1]}`) {
  research().then((items) => {
    console.log(`Found ${items.length} items:`);
    for (const i of items) console.log(` - [${i.topic.slice(0, 40)}...] ${i.headline}\n   ${i.url}`);
  });
}
