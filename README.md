# Trip Splitter — Minneapolis edition (Google Sheets)

A GitHub-Pages-hostable expense splitter for a Minneapolis trip. Same UI and
balance math as [split-app](../split-app) / [split-app2](../split-app2), but
the "database" is a Google Sheet and the "server" is a Google Apps Script Web
App — so the whole thing is a static site you can host for free.

It's the same app as split-app2, re-skinned for the City of Lakes: a
Minneapolis skyline banner (Foshay Tower, the IDS Center, Capella's crown, and
the Stone Arch Bridge over the Mississippi), and two hidden Minnesota
mini-games (see below).

## Why it's different from split-app

split-app runs on a laptop on your wifi — the Express server is the only thing
that can read/write `db.json`, so it can safely allow deleting people and
expenses (soft-delete, with backups).

This version is a fully static site (just HTML/CSS/JS) that anyone in the world
can view the source of once it's on GitHub Pages. Two things to keep in mind:

- **Deleting is trust-based.** Expenses (and settlements) have a 🗑 Delete
  button with an "are you sure?" confirm. Because the site is static, anyone who
  can open the page can also delete rows — the same is already true for adding
  expenses. There's no per-user permission; it relies on the group being
  trusted. People still can't be deleted from the app (removing someone would
  break the math for any expense they're part of) — do that in the Google Sheet.
- **The "shared key" is not real security.** It's a shared secret sitting in
  plain text in `app.js`, which anyone can view via "View Source". It stops
  casual/accidental writes from other scripts hitting your endpoint, not a
  determined person. Don't put anything sensitive in the sheet.

Everything else — adding people, adding/deleting expenses, balances, the
simplified "who pays who" settle-up list, marking a settlement as paid, and an
activity log — works the same way it does in split-app.

## The hidden mini-games 🏎️🎣🎸

Three easter-egg games, all backed by the sheet (per person) so scores and
progress follow you across devices and everyone shares a leaderboard. All the
boards live in one place: the **🏆 Top scores** badge in the header.

- **🏎️ Pothole Dodge** — tap the 🏎️ badge in the header. A three-lane racing
  dodger: swerve (◀ ▶ buttons, arrow keys, or tap either half of the track) to
  clear 🕳️ potholes, 🚧 cones and 🦌 deer. Every hazard cleared is a point and
  the road keeps speeding up; one hit ends the run. **This one costs $0.01 a
  play** — see below.
- **🎣 Set the Hook** — the "🎣 Set the Hook" button on the People tab. A
  go/no-go ice-fishing game: wait for a bite, then read what's on the line
  before you yank (you get ~1.4s). 🐟 Panfish score normally and a 🏆 **trophy
  walleye** (Minnesota's state fish) is worth **double** — hook those fast. A 🥾
  **old boot is a trap**: leave it alone for +0, or hook it for -3. Jigging
  before the bite is -6. Every run deals the **same six catches** (3 panfish,
  2 walleye, 1 boot) in a shuffled order, so composition is identical for
  everyone and only speed/judgement separates scores.
- **🎸 Bob Dylan Clicker** — tap the 🎸 badge in the header. A Cookie-Clicker
  idle game starring Minnesota's own Bob Dylan: click Bob to earn **Dylans**,
  then spend them on gear and gigs (harmonica → electric guitar → Nobel Prize →
  Never Ending Tour…) that auto-earn Dylans per second. Your count and upgrades
  save to the sheet under your name — one running total per person, not a
  best-of — so it keeps counting across visits and devices (with capped "while
  you were away" idle progress).

### Pothole Dodge costs a penny 🪙

Every play bills a **real $0.01 expense** to the trip ledger — description
`🏎️ Pothole Dodge play`, paid by whoever played and split across everyone. So
the arcade genuinely shows up in Expenses/Balances, and the game shows a running
"the machine has taken $X.XX over N plays" total that climbs as people play.
It's a normal expense row, so 🗑 Delete it (or edit the sheet) to undo. If
nobody's signed in, there's no one to bill and the play is free.

On the Balances tab, **🏆 Award Mini-Game Prizes** drops two real $2 credits
into the ledger — one each to the Pothole Dodge and Set the Hook champions,
funded by everyone else (ties split evenly). The Dylan Clicker is just for
bragging rights and isn't part of the prize payout. Prizes are just normal
expense rows, so undo them in the sheet like any other mistake.

## Setup

### 1. Create the Google Sheet + Apps Script backend

1. Create a new Google Sheet (sheets.new). Name it whatever you like.
2. In the Sheet, go to **Extensions > Apps Script**.
3. Delete the placeholder code and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs).
4. At the top of the script, change `SHARED_KEY` to your own random string
   (e.g. mash the keyboard for 20 characters). It ships as `minneapolis-ope`.
5. Click **Deploy > New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Execute as: **Me**.
   - Who has access: **Anyone**.
   - Click **Deploy**, and authorize it when prompted (you'll see an
     "unverified app" warning since this is your own script — click
     **Advanced > Go to (project name)** to proceed).
6. Copy the **Web app URL** it gives you (ends in `/exec`). You'll need it in
   step 2.
7. The first time someone adds a person, expense, or mini-game score, the script
   will auto-create the `People`, `Expenses`, `Log`, `GameScores`,
   `ReactionScores`, and `DylanClicker` tabs with the right headers — you don't
   need to set those up by hand.

### 2. Point the frontend at it

Open `app.js` in this folder and edit the top two constants:

```js
const API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec'; // your URL from step 1.6
const SHARED_KEY = 'minneapolis-ope'; // must match Code.gs exactly
```

Until you replace the placeholder `API_URL`, the app shows a setup banner and
skips the "who are you?" prompt.

### 3. Host it on GitHub Pages

Push this folder (`index.html`, `style.css`, `app.js`) to a GitHub repo, then
in the repo's **Settings > Pages**, set the source to the branch/folder you
pushed to. GitHub will give you a `https://<user>.github.io/<repo>/` URL — that's
the link to share with your group.

## If you ever redeploy the Apps Script

Editing `Code.gs` after the fact requires a **new deployment** (or "Manage
deployments > Edit > New version") for the changes to actually go live — just
saving the script doesn't update the running `/exec` endpoint.

## Backups

Unlike split-app, there's no custom backup system here — Google Sheets keeps
automatic version history (**File > Version history > See version history**)
covering the same "undo an accidental change" need. For anything longer-term,
File > Make a copy periodically, or File > Download as .xlsx.

## Limitations to know about

- **Latency**: every read/write is a real network call to Apps Script, which is
  noticeably slower than split-app's local file access (expect anywhere from a
  few hundred ms to a couple seconds per action).
- **No real-time sync**: like split-app, other people's changes only show up
  when you switch tabs (which re-fetches). There's no push/websocket.
- **Apps Script quotas**: consumer Google accounts get roughly 90 minutes of
  script execution per day and per-minute call limits. Fine for a trip-sized
  group; not meant for heavy traffic.
- **Concurrent writes**: the script uses `LockService` to serialize writes so
  two people saving at the exact same moment can't corrupt a row, but under
  heavy simultaneous use you may occasionally see a "Server busy, try again"
  error — just retry.
