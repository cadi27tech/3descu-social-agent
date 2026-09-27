# 3Descu calendar publisher

Publishes the pre-written Q4 2026 social calendar to the **3Descu Facebook Page** and **Instagram Business** account. No content is generated: every caption, image and video comes from the calendar exactly as written. Cost: EUR 0 (GitHub Actions on a public repo, Meta Graph API, media served from this repo).

## How it works

| Piece | Where |
|---|---|
| Calendar source (Metricool 94-column CSV, 167 rows) | [data/calendar-q4-2026.csv](data/calendar-q4-2026.csv) |
| Normalised schedule (163 entries, drafts dropped) | [data/schedule.json](data/schedule.json), built by [scripts/build-schedule.ts](scripts/build-schedule.ts) |
| Publish state (what is already posted) | [data/published.json](data/published.json), committed back by the workflow |
| Media (72 files, 44 MB: 67 JPG + 5 MP4) | [media/](media/), served at `https://raw.githubusercontent.com/cadi27tech/3descu-social-agent/main/media/<path>` |
| Publisher | [src/main.ts](src/main.ts), [src/core.ts](src/core.ts), [src/meta.ts](src/meta.ts) |
| Cron | [.github/workflows/publish.yml](.github/workflows/publish.yml), every 15 min at :05/:20/:35/:50 |

- **Automated channels:** `facebook` (image, multi-photo, Reel), `instagram` (image, carousel, Reel), `story` (Instagram Story, image or video). 104 posts, 1 Oct to 29 Dec 2026.
- **Manual channels:** `linkedin`, `youtube`, `gbp` stay in the schedule with `"mode": "manual"`. They are scheduled natively elsewhere; this bot never touches them.
- **Times:** the calendar is in Europe/Berlin wall-clock time; `publish_at` is UTC and already accounts for the 25 Oct 2026 DST switch.
- **Due rule:** an entry is posted on the first run after `publish_at`. If it is more than 6 hours overdue it is recorded as `missed` and never posted late (so switching the bot on mid-quarter does not dump a backlog).
- **Idempotent:** every success is written to `data/published.json` straight away and committed even when another post in the same run failed. A recorded id is never posted again. A failed post is retried on the next runs, at most 3 attempts.
- **Failure alerts:** a failed or missed post makes the run fail, and GitHub emails the repo owner. No Telegram, no personal data in logs.
- **Dry run:** if any of the three secrets is missing, or the workflow is started with `dry_run`, it only logs what is due and exits 0. With secrets present, a dry run also checks them read-only (gets the Page token and the Instagram username).

## One-time setup (about 20 min)

Business portfolio: **3Descu BUN**, id `1356982691502838`.

### 1. Meta app (the system user token is issued for an app)

1. Go to developers.facebook.com → **My Apps** → **Create app**.
2. Use case **Other** → app type **Business** → name `3Descu Calendar Publisher` → Business portfolio **3Descu BUN** → **Create app**.
3. In the app: **App settings → Basic** → fill **Privacy Policy URL** with the privacy page on www.3descu.com, pick a **Category** → **Save changes**.
4. Top bar **App Mode** → switch to **Live**. (Posts made by an app in Development mode are visible only to people with a role on the app.)

### 2. System user

1. Open business.facebook.com/latest/settings/?business_id=1356982691502838 → **Users → System users** → **Add**.
2. Name `calendar-publisher`, role **Admin** → **Create system user**.
3. With it selected → **Assign assets**:
   - **Pages** → tick **3Descu** → toggle **Full control (Everything)** → **Assign**.
   - **Instagram accounts** → tick the 3Descu account → **Full control** → **Assign**.
   - **Apps** → tick **3Descu Calendar Publisher** → **Full control (Manage app)** → **Assign**.

### 3. Token

1. Same system user → **Generate token** → app **3Descu Calendar Publisher**.
2. **Token expiration: Never**.
3. Tick exactly: `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `business_management`, plus `pages_show_list` (read-only; lets the bot swap the system user token for the Page token).
4. **Generate token** → copy it now (it is shown once).

### 4. IDs

- **Page ID:** Business settings → **Accounts → Pages** → 3Descu → the numeric ID under the name.
- **Instagram user ID:** replace the two placeholders and run:

```bash
curl -s -H "Authorization: Bearer PASTE_TOKEN" "https://graph.facebook.com/v24.0/PASTE_PAGE_ID?fields=instagram_business_account"
```

The `instagram_business_account.id` value (starts with `1784`) is the Instagram user ID.

### 5. GitHub secrets

github.com/cadi27tech/3descu-social-agent → **Settings → Secrets and variables → Actions → New repository secret**, three times:

| Secret | Value |
|---|---|
| `META_PAGE_ID` | Page ID from step 4 |
| `META_IG_USER_ID` | Instagram user ID from step 4 |
| `META_SYSTEM_USER_TOKEN` | token from step 3 |

Then **Actions → Publish social calendar → Run workflow → tick dry_run → Run**. The log must end with `Credentials OK`. The first real post is Thu 1 Oct 2026 12:00 Berlin; secrets must be in place before 18:00 Berlin that day or that post is recorded as missed.

## Media hosting

The repo is public, so media is committed under `media/` and Meta fetches it from `raw.githubusercontent.com`. Images are served as `image/jpeg`. Videos are served as `application/octet-stream`; Meta reads the file itself, but if the first Reel fails with a media format or fetch error, switch the host without touching code:

1. **Settings → Pages** → Source **Deploy from a branch** → `main` / `(root)` → **Save**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable** `MEDIA_BASE_URL` = `https://cadi27tech.github.io/3descu-social-agent/media`.

GitHub Pages serves `video/mp4`. Every URL is checked with a HEAD request before posting, so a broken link fails loudly instead of posting without media.

## Changing the calendar

1. Copy the new `09-social-calendar-q4-2026.csv` over [data/calendar-q4-2026.csv](data/calendar-q4-2026.csv).
2. `npm run build:media` (rebuilds the schedule and copies any new media from `marketing/strategy-2026-10/social-gfx` and `A:/Adi/3Descu/Social Upload 2026Q4/video`).
3. `npm run check` (typecheck, lint, tests). Commit and merge.

Captions are copied byte for byte; the tests fail if `data/schedule.json` does not match the CSV.

## Local commands

```bash
npm ci && npm run check
```

```bash
npm run publish:dry
```

Node 22.18+ runs the TypeScript directly (type stripping); no build step.

## Kill switch

**Actions → Publish social calendar → ⋯ → Disable workflow.** To skip a single post, add its id to `data/published.json` with `"status": "missed"`.
