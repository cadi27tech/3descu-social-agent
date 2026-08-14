# 3Descu social autopilot

Self-hosted €0/mo social publishing agent. Every Monday 09:00, GitHub Actions
runs a pipeline that:

1. Searches recent 3D-print / AM news via **Tavily** (free tier).
2. Writes one platform-native caption for each of **Facebook, Instagram, LinkedIn, YouTube** via **Claude Haiku 4.5**.
3. Generates one square image via **Cloudflare Workers AI Flux Schnell** (free tier).
4. Uploads image to the existing **Supabase** public bucket for hosting.
5. Sends a preview to your **Telegram** for APPROVE/SKIP (first two weeks).
6. Publishes to **Meta Graph API** (FB + IG), **LinkedIn UGC API** (personal profile), **YouTube Data API v3** — all free.

Expected monthly cost at 3 posts/week: **~€0.02/mo** (Claude Haiku only; everything else is free tier).

## Local run

```bash
npm install
cp .env.example .env   # fill in secrets from the walkthrough below
npm run run:dry        # generates captions + placeholder image, prints, no publish
npm run run            # for real (respects APPROVAL_LOOP)
```

## OAuth walkthrough — one-time setup (est. 90 min)

Do these in this order. Each block ends with the exact env var to paste into GitHub Actions secrets.

### 1. Tavily (research) — 2 min

- Sign up at https://tavily.com (free: 1000 queries/mo — we use ~24/mo).
- Dashboard → API Keys → copy `tvly-...`.
- **Secret:** `TAVILY_API_KEY`.

### 2. Anthropic API (captions) — 2 min

- Get a key at https://console.anthropic.com.
- **Secret:** `ANTHROPIC_API_KEY`.

### 3. Cloudflare Workers AI (image gen) — 3 min

- Sign up at https://cloudflare.com (free).
- Dashboard → **Workers & Pages → Workers AI**.
- Copy your **Account ID** (right sidebar of any Workers page).
- **My Profile → API Tokens → Create Token → "Workers AI"** template → create → copy.
- **Secrets:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.

### 4. Supabase bucket for image hosting — 2 min

- In your existing 3descu Supabase project: **Storage → New bucket → `social-posts` → make PUBLIC**.
- Copy the project URL and **service_role** key from Project Settings → API.
- **Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

### 5. Meta Business (Facebook Page + Instagram Business) — 25 min

- Go to https://business.facebook.com → make sure your `3Descu` Facebook Page is under the Business account, and IG Business is linked to it (Meta Business Suite → Settings → Accounts → Instagram accounts).
- Go to **https://developers.facebook.com** → create an app → type "Business".
- Add product **Facebook Login for Business** and **Instagram** and **Marketing API**.
- Meta Business Settings → **Users → System Users → Add → System user name `autopilot`**, role Admin.
- Assign your `3Descu` FB Page to that system user (Assets → Pages → assign → full control).
- **Generate token** for the system user with these permissions:
  - `pages_show_list`
  - `pages_manage_posts`
  - `pages_read_engagement`
  - `instagram_basic`
  - `instagram_content_publish`
  - `business_management`
- Choose **NEVER expires** (system-user tokens don't rotate).
- Get IDs:
  - FB Page ID: your Page → About → scroll to bottom
  - IG Business Account ID: run `curl "https://graph.facebook.com/v20.0/{PAGE_ID}?fields=instagram_business_account&access_token={TOKEN}"`
- **Secrets:** `META_PAGE_ACCESS_TOKEN`, `META_FB_PAGE_ID`, `META_IG_BUSINESS_ACCOUNT_ID`.

### 6. LinkedIn personal profile — 15 min (no approval needed)

- Go to https://developer.linkedin.com/ → **Create app** → link it to your `3Descu` Company Page (needed as owner even if we only post to personal).
- Products → request **Share on LinkedIn** (auto-approved instantly).
- **Auth tab** → add redirect URI `https://localhost:8080/callback`.
- Copy Client ID and Secret.
- Run the OAuth dance manually (once) to get an access token:
  ```
  https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=w_member_social
  ```
  Approve → copy `code=...` from URL → exchange:
  ```
  curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
    -d grant_type=authorization_code \
    -d code=THE_CODE \
    -d client_id=YOUR_CLIENT_ID \
    -d client_secret=YOUR_CLIENT_SECRET \
    -d redirect_uri=https://localhost:8080/callback
  ```
- Get your personal URN:
  ```
  curl -H "Authorization: Bearer YOUR_TOKEN" https://api.linkedin.com/v2/userinfo
  ```
- **Secrets:** `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_PERSON_URN` (format: `urn:li:person:xxxx`).
- **Token lifespan:** 60 days. Renew via refresh-token flow (Products → Sign In With LinkedIn using OpenID Connect if you want automatic; MVP is manual re-run every 2 months).

### 7. LinkedIn Company Page — apply in parallel (2-6 wk wait)

- developer.linkedin.com → your app → Products → request **Community Management API**.
- LinkedIn will email a form: legal entity, business email, screencast, use case.
- Once approved for Development Tier: fill `LINKEDIN_ORG_URN` and add a Company post channel to `main.ts`. Do NOT block MVP on this.

### 8. YouTube Data API v3 — 15 min

- Google Cloud Console → new project `3descu-social`.
- APIs & Services → Library → enable **YouTube Data API v3**.
- Credentials → Create Credentials → **OAuth client ID** (Web app) → redirect URI `https://localhost:8080/callback`.
- Copy Client ID + Secret.
- Run the OAuth dance:
  ```
  https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_ID&redirect_uri=https%3A%2F%2Flocalhost%3A8080%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube&access_type=offline&prompt=consent
  ```
  Approve with the Google account that owns the 3Descu YouTube channel → grab `code=` from URL → exchange:
  ```
  curl -X POST https://oauth2.googleapis.com/token \
    -d grant_type=authorization_code \
    -d code=THE_CODE \
    -d client_id=YOUR_ID \
    -d client_secret=YOUR_SECRET \
    -d redirect_uri=https://localhost:8080/callback
  ```
- Save the `refresh_token` (permanent).
- **Secrets:** `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_CHANNEL_ID` (from your channel URL).
- **Note:** YouTube Community posts API is gated to channels with 500+ subs. Until then, `publishYouTube()` logs and skips; the pipeline still publishes to FB/IG/LI.

### 9. Telegram approval bot — 5 min

- Telegram → search **@BotFather** → `/newbot` → follow prompts → copy the token.
- Message your new bot once (anything).
- Get your chat ID: visit `https://api.telegram.org/bot{TOKEN}/getUpdates` → find `"chat":{"id":123456...}`.
- **Secrets:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### 10. GitHub Actions secrets — 10 min

- github.com/cadi27tech/3descu-social-agent → Settings → Secrets and variables → Actions.
- Paste every secret from steps 1-9 above.
- Add **Variables** (not secrets): `APPROVAL_LOOP=1` (flip to `0` after 2 weeks of proven quality).

Test it: **Actions tab → Weekly social autopilot → Run workflow → dry_run = true** → check the logs.

## Skipped (add later)

- **TikTok** — Content Posting API requires app approval (2-4 wk); channel dropped from ICP for now anyway.
- **Twitter/X, Threads, Reddit, Pinterest** — wrong audience for B2B industrial.
- **Per-channel image crops** — Flux gives 1024x1024, all platforms auto-crop. Add Sharp resizes only if a channel visibly starves.
- **Post history / dashboard** — GH Actions log is enough for MVP. Add Postiz self-hosted if a dashboard becomes actually useful.

## Kill switch

- Disable the workflow: github.com/cadi27tech/3descu-social-agent/actions → weekly-cron → ⋯ → Disable workflow.
- Or set variable `APPROVAL_LOOP=1` and stop replying to Telegram — every post times out to SKIP after 15 min.
