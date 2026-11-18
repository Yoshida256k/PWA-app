# Bedtime RTA

A speedrun-style (RTA) timer PWA for evening routines, with a LiveSplit-like UI ported from the private repository task_ver4.

## Features
- **Start the moment you get home.** The two tasks can be done in either order (choose on the home screen)
- LiveSplit-style split table (PB delta, cumulative time, best segments shown in gold)
- Sound and vibration alert when a task goes over its target; the screen stays awake while timing
- **Estimated finish time** is always shown, colored by whether it meets your target
- The second task runs until the end of the night; its goal time is recorded as the finish time, with a short note and a result screen (start and goal times included)
- **Calendar** view of each day's rank and finish time; tap a day to see its result and note (until 4 a.m. counts as the previous day)
- **PBs for this month, this year, and all time.** Home and timing screens compare against this month's PB; the calendar shows the month/year PBs. The result screen shows a badge for the largest period you beat
- **📊 Analysis**: aggregates by period (last 7 days / 30 days / this month / all time). Stat tiles (average finish time, target hit rate, etc.), a breakdown of what causes delays (late start / overrun of each task), a nightly timeline, finish-time trend (7-day average), split trends, order comparison, and day-of-week stats. Every chart can also be viewed as a table
- **All-time leaderboard**: rankings for total time and each task, finish-time trend chart, sortable list of all records
- Ranks use the same thresholds as task_ver4 (S: 30%+ faster than target, A: 15%+, B: faster, C: otherwise)
- Pause, run survives reloads, works offline, JSON export/import

Records are stored in the browser (localStorage). Export them from the settings screen before switching devices.

## Using it on a phone
It is just static files, so it can be hosted as-is on GitHub Pages or similar.

1. GitHub repository → Settings → Pages → choose the branch to publish and `/ (root)`
2. Open the shown URL on your phone
3. Android (Chrome): menu → "Add to Home screen" / iPhone (Safari): Share → "Add to Home Screen"

To try it locally: run `python3 -m http.server` and open http://localhost:8000.

## When you update files
Bump `VERSION` in `sw.js`, `APP_VERSION` (and `APP_UPDATED`) in `app.js`, and the `style.css?v=` `app.js?v=` `analysis.js?v=` numbers in `index.html` to the same value. The version is shown on the home and settings screens, and a warning appears if the page and JS versions differ. This prevents a new HTML page from running with old JS.

## TEMPO (separate app)
**TEMPO**, a timer that measures average time per page/problem by pressing NEXT, has moved to its own repository, [PWA-TEMPO](https://github.com/Yoshida256k/PWA-TEMPO) (URL: https://yoshida256k.github.io/PWA-TEMPO/).
Inside this app's scope (`/PWA-app/`) it could not be installed on its own.
`tempo/` only keeps a redirect page for the old URL and a `sw.js` that cleans up the old Service Worker.

## Claude Code skill
- `.claude/skills/progressive-web-app/` — PWA skill from [secondsky/claude-skills](https://github.com/secondsky/claude-skills) (MIT)
