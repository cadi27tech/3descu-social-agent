// Telegram approval bot. Sends preview → waits for 👍/👎 per post.
// Auto-skips when APPROVAL_LOOP=0 (full-auto mode).
// ponytail: polling API, no webhook infra. One process per run, dies when done.

import TelegramBot from 'node-telegram-bot-api';
import { CaptionSet } from './captions.ts';
import { requireEnv } from './config.ts';

let bot: TelegramBot | null = null;
function getBot(): TelegramBot {
  if (bot) return bot;
  bot = new TelegramBot(requireEnv('TELEGRAM_BOT_TOKEN'), { polling: true });
  return bot;
}

export function isApprovalRequired(): boolean {
  return process.env.APPROVAL_LOOP === '1';
}

export interface ApprovalDecision {
  approved: boolean;
  editedCaptions?: Partial<CaptionSet>;
}

/**
 * Show a preview of the post (all 4 channels) + the image, then wait for
 * the operator to reply APPROVE / SKIP / EDIT. 15-minute timeout defaults to SKIP.
 */
export async function requestApproval(
  slug: string,
  imageUrl: string,
  captions: CaptionSet,
): Promise<ApprovalDecision> {
  if (!isApprovalRequired()) return { approved: true };

  const chatId = requireEnv('TELEGRAM_CHAT_ID');
  const b = getBot();
  const preview =
    `*Post ready: ${slug}*\n\n` +
    `*FB* (${captions.facebook.length}c):\n${captions.facebook}\n\n` +
    `*IG* (${captions.instagram.length}c):\n${captions.instagram}\n\n` +
    `*LI* (${captions.linkedin.length}c):\n${captions.linkedin.slice(0, 400)}...\n\n` +
    `*YT* (${captions.youtube.length}c):\n${captions.youtube}\n\n` +
    `Reply: APPROVE / SKIP`;

  await b.sendPhoto(chatId, imageUrl);
  const msg = await b.sendMessage(chatId, preview, { parse_mode: 'Markdown' });

  return new Promise<ApprovalDecision>((resolve) => {
    const timeout = setTimeout(() => {
      b.removeAllListeners('message');
      resolve({ approved: false });
    }, 15 * 60 * 1000);

    b.on('message', (m) => {
      if (m.reply_to_message?.message_id !== msg.message_id) return;
      const text = (m.text ?? '').trim().toUpperCase();
      if (text === 'APPROVE') {
        clearTimeout(timeout);
        b.removeAllListeners('message');
        resolve({ approved: true });
      } else if (text === 'SKIP') {
        clearTimeout(timeout);
        b.removeAllListeners('message');
        resolve({ approved: false });
      }
    });
  });
}

/**
 * Post-publish notification with the live URLs.
 */
export async function notifyPublished(
  slug: string,
  urls: { channel: string; url: string }[],
): Promise<void> {
  const chatId = requireEnv('TELEGRAM_CHAT_ID');
  const b = getBot();
  const lines = urls.map((u) => `${u.channel}: ${u.url}`).join('\n');
  await b.sendMessage(chatId, `✅ *${slug}* published:\n${lines}`, { parse_mode: 'Markdown' });
}

export function stopBot(): void {
  if (bot) {
    bot.stopPolling().catch(() => {});
    bot = null;
  }
}
