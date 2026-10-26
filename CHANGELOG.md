# Changelog

Dates are merge dates on `main`. Content-only changes (new posts in the calendar) are listed briefly.

## 0.2.x, in production

- 2026-10-22: press coverage and Romania Journal posts scheduled (#14, #15).
- 2026-10-17: 17 Oct content pack scheduled (#13).
- 2026-10-15: Black Cat Escape Room case-study posts scheduled (#12).
- 2026-10-14: **fix** queued runs read the latest state, so a slot never posts twice (#11). A run queued behind another had checked out its trigger commit instead of the branch tip and re-posted the 14 Oct 11:00 Story.
- 2026-10-13: **feature** hand over to the next slot so posts go out on time, since the cron fires only a few times a day; **fix** miss window widened to 24 hours; actions moved to Node 24 (#10).
- 2026-10-08: material guidance corrected in scheduled captions (#9).
- 2026-10-07: payment posts released with one-price images (#8).
- 2026-10-04: 10 explainer videos scheduled as Facebook and Instagram Reels (#7).
- 2026-10-02: card payments launch posts (#6); 50/50 split offered by bank transfer only (#5).
- 2026-09-27: caption corrections before the first post (#2, #3, #4).

## 0.2.0, 2026-09-27

The calendar publisher (#1). Replaces the 0.1.0 autopilot: no generation at all. A Metricool CSV becomes a normalised UTC schedule, and GitHub Actions publishes due Facebook, Instagram and Story posts through the Meta Graph API, with publish state committed back to the repo, a 3-attempt retry cap and a never-backfill rule for missed posts.

## 0.1.0, 2026-08-14

Initial scaffold: a weekly autopilot that researched topics, drafted captions and images with AI models, and asked for approval in Telegram before posting. Retired in 0.2.0 in favour of a calendar written and reviewed by people.
