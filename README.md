# ExiThreat

ExiThreat is an installable web app (PWA) for disclosing workplace abuse safely. A complaint is
never public: it is shown to one small group at a time, each member sees the unredacted text
only once, and it moves on to another group when enough members vote to pass it on. How far it
travels becomes a measure of how many people found it credible.

It also carries two links to **ProMic**, a separate personal-safety app: a ProMic user can open
their own backup recordings here, and police officers sign in here to reach ProMic recordings,
alerts and live streams.

| | |
|---|---|
| Website | https://exithreat.fly.dev |
| API | https://exithreat-api.fly.dev/api |
| Officer sign in | https://exithreat.fly.dev/law-enforcement |
| Local | website http://localhost:3000, API http://localhost:4000/api |

Current work is on the branch `feature/promic-backups`; the hosted site is deployed from it.

## Repository layout

| Path | What it is |
|---|---|
| `frontend/` | Next.js 14 (App Router), React 18, Tailwind, next-pwa |
| `frontend/public/` | Web app manifest and icons. The service worker files are built, not kept in git |
| `backend/` | Express API in TypeScript, Prisma, PostgreSQL, JWT auth |
| `backend/prisma/schema.prisma`, `backend/prisma/migrations/` | Database schema and its history |
| `backend/src/tests/` | Unit tests and the API test |
| `backend/scripts/start.js` | Hosted start-up: apply migrations, then start the API |
| `.github/workflows/ci.yml` | Tests and builds on every push |
| `docker-compose.yml` | Postgres, backend and frontend together |
| `frontend/fly.toml`, `backend/fly.toml` | Fly.io hosting |

## How ExiThreat works

1. **Account.** Register with a username (3 to 30 letters, digits, dots, dashes or
   underscores) and a password of 8 to 72 characters; no email or phone is asked for, so there
   is no password reset. Passwords are hashed with bcrypt, and sign-in returns a token valid
   for 7 days. The Account page signs out, signs out on all devices, and changes the password
   (which also signs every other device out). Ten wrong passwords for one account from one
   network address block further tries for 15 minutes.
2. **Groups.** Nobody chooses or creates a group. The server places each user in one group at
   random (emptier groups are more likely), at sign-up, or at the next sign-in for older
   accounts. A group holds at most 25 members; new groups are opened as needed and get a
   generated name. A user sees only their own group: its posts, its chat (which never leaves
   it) and its member names. One network address can create 5 accounts a day.
3. **Disclosure.** The author (the "Original Complainant") writes at least 20 characters. The
   server makes a redacted copy, replacing emails, phone numbers, names, companies, addresses,
   URLs, dates and ID numbers (Indian and US formats) with labels such as `[NAME REDACTED]`.
   The author must look at that redacted version before submitting ("Preview redaction"), and
   finds their posts again under "Mine". The server places the post in a random group
   that has at least 5 members and that the author is not in. If there is no such group yet,
   the post is refused and nothing is saved.
   A post, its comments, votes and weightage can be read only by members of the group it is
   in now and by its author. Nobody is told who the author is; the author's own page says
   "Your Post".
4. **First look.** A member of the post's current group can see the unredacted text once,
   served as an image strip rather than text. The look ends when the reader taps "Done
   reading" or leaves the page; afterwards only the redacted version is available. The server
   keeps the record, so it is the same on every device. A look that was opened but never
   closed (lost connection) can be reopened for 10 minutes.
5. **Push.** Members of the current group vote to push the post on, once they have opened its
   first look. The author cannot vote on their own post, and a vote can be withdrawn.
6. **Move.** Every 10 seconds the server checks the votes. They are measured against the
   members who used the group in the last 14 days (never against fewer than 5). At 50%, the
   post moves to another random group of at least 5 members that the author is not in,
   preferring groups it has not been through; the vote percentage is saved to its history and
   voting starts again.
7. **Manual push.** The author may move their own post once every 24 hours. It clears the
   current votes and adds nothing to the post's weight.
8. **Weightage.** A post's weight is the sum of the vote percentages from the groups it left by
   vote. Each group counts once, with at most 100, so going round the same groups adds nothing.
9. **Comments** travel with a post from group to group. Group chat does not.

### Installing it as an app

The site can be installed from the browser ("Install app" or "Add to Home screen"). A service
worker (`frontend/src/components/ServiceWorker.tsx` registers the one next-pwa builds) keeps
the pages and scripts on the device, so the app opens without a connection and shows an
"offline" page instead of the browser's error. It keeps no answers from the API: groups,
posts and the first-look image always come from the server. There is no service worker when
running `npm run dev`.

### Pages

| Route | Purpose |
|---|---|
| `/` | Home |
| `/auth/register`, `/auth/login`, `/account` | Sign up, sign in; sign out and change password |
| `/groups`, `/group/[id]` | Groups, a group's posts and chat |
| `/disclosures` | The user's own posts ("Mine") |
| `/offline` | Shown by the service worker when there is no connection |
| `/post/new`, `/post/[id]` | Write a disclosure; view one, vote and comment |
| `/promic` | A ProMic user's own backups |
| `/law-enforcement` | Officer sign in (separate from ExiThreat accounts) |

### API

All routes are under `/api` and, except register and login, need `Authorization: Bearer <token>`.

| Route | Purpose |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/password`, `POST /auth/signout-all` | Account |
| `GET /groups`, `GET /groups/:id`, `POST /groups/:id/heartbeat` | The user's own group and activity |
| `GET /groups/:id/chat`, `POST /groups/:id/chat` | Group chat |
| `POST /posts`, `GET /posts/:id`, `GET /posts/:id/strip`, `POST /posts/:id/strip/done` | Create a post, read it, the one-time image strip, close the first look |
| `POST /posts/preview`, `GET /posts/mine` | The redacted version of a text before it is posted; the caller's own posts |
| `GET /posts/:id/comments`, `POST /posts/:id/comments` | Comments |
| `POST /push/:postId/vote`, `DELETE /push/:postId/vote`, `POST /push/:postId/manual`, `GET /push/:postId/status` | Voting and manual push |
| `GET /weightage/:postId`, `POST /weightage/:postId/recalculate` | Weightage |
| `GET /promic/link`, `POST /promic/link`, `DELETE /promic/link`, `GET /promic/backups`, `GET /promic/backups/{audio\|video}/:id` | ProMic backups |
| `GET /health` | Health check |

### Database

`User`, `Group`, `GroupMember`, `Post`, `PushVote`, `PostHistory`, `Comment`, `ViewRecord`,
`ChatMessage`, `ProMicLink`. The tables are changed only through the migrations in
`backend/prisma/migrations` (see [Changing the database](#changing-the-database)).

## ProMic: a user's own backups (`/promic`)

A ProMic Host links their ExiThreat account once:

1. In the ProMic app, **Settings → Link ExiThreat Account** shows a one-time code valid for 10
   minutes.
2. The user enters it on `/promic`. The backend redeems it from ProMic's database and stores
   the link (`ProMicLink`).
3. The backend then lists that Host's audio and video backups and decrypts them on request with
   a ProMic service account (`backend/src/services/promicService.ts`). The browser receives WAV
   or MP4 and never the key.

Without the `PROMIC_*` settings these routes answer 503 and the rest of the app is unaffected.

## ProMic: law enforcement (`/law-enforcement`)

Officers are **not** ExiThreat users. A ProMic administrator creates their account and they
receive the credentials by email. This page talks directly to ProMic's backend (Cloud Functions
in the ProMic repository, `functions/le.js`) and never uses the ExiThreat token or API, so an
officer has no access to groups, posts or chat.

Files: `frontend/src/app/law-enforcement/page.tsx` (sign in and recording access),
`AreaDashboard.tsx` (map, alerts, live list), `liveAudio.ts` (live playback).

### Recording access
1. Sign in with the emailed email and password.
2. Enter the ProMic user's mobile number.
3. Enter the 6-digit code that user sees in their ProMic app. They can refuse. The app names
   the officer's branch (station or unit), never their email.
4. Enter the second 6-digit code emailed to the officer.
5. Play that user's most recent audio backup, listen-only, for 30 minutes.

If the phone cannot be reached (15 minutes without an answer, or at once during an SOS), the
officer gives a reason and can ask a Connected User the ProMic user trusts with their backups,
and after that a ProMic administrator with a case reference. The page waits for the
administrator's decision by itself. Whether this is allowed is the ProMic user's own setting.

### Station map, AI alerts and live streams
Shown on the Request Access screen after sign in.

- **Map.** Click to mark the police station. Choose the area: within 15 km of the station (or
  where it is the nearest station), the entire district, or the entire state. It can be changed
  at any time.
- **AI Alerts.** AI threat and SOS alerts from the last 24 hours in that area, grouped by user
  with name, mobile number and GPS position. An SOS shows "active now" while it is running and
  the time it ended afterwards. Clicking shows the location on the map. A blinking green dot
  marks a user who is live streaming; if they shared the stream with law enforcement, clicking
  jumps to them in the live list. "Download CSV" saves the whole list.
- **Live Streaming.** Users in the area who ticked "Law Enforcement" in ProMic when starting
  their stream. Click **Listen** to hear it; while an officer listens, the user's app shows
  "Law enforcement is listening". An officer can stop their own listening but never the stream.
- **Only police listening.** A stream is marked when no Connected User of that person is
  listening to it, so the officer knows nobody else is.
- **Remote area, weak signal, connection lost.** Badges on alerts and streams. "Remote area"
  means OpenStreetMap names no village, town or city at that point. "Weak signal" comes from
  the phone itself. "Connection lost" appears when the phone has reported nothing for 90
  seconds, with its last known position and the time of it.
- **Are you OK? and talk-back.** While listening, the officer can ask the user "Are you OK?".
  The user answers in the app with their passcode ("I'm safe" or "Send help", which starts an
  SOS). With no answer in 15 seconds the officer can speak through the user's phone.
- **Filters.** Alerts: All, Active SOS, Ended SOS, AI threats, Remote area. Live streams: All,
  Only police listening, With other listeners, Remote area, Weak or lost signal. Filters change
  only what is listed; the map and the CSV keep everything.

The lists refresh every 15 seconds. Which users fall in an officer's area, and every badge
above, is decided by ProMic's backend, not by this page.

### How live playback works
`liveAudio.ts` connects to ProMic's relay over WebSocket and decrypts each frame in the browser
with the Web Crypto API, using a session key ProMic hands over only for a shared stream. It
must stay in step with ProMic's formats: a 60-byte frame header, then
`IV(12) || ciphertext || tag(16)` holding 16 kHz mono 16-bit PCM. Talk-back sends the
officer's microphone the other way in the same frame format, and the relay passes it to the
user's phone only.

## Running locally

### With Docker
```bash
docker compose up
```
Website on port 3000, API on 4000, Postgres on 5432.

### Without Docker
Needs Node 20 and a PostgreSQL database.

```bash
# backend
cd backend
cp .env.example .env          # then edit it
npm install
npx prisma migrate deploy     # creates or updates the tables
npm run dev                   # http://localhost:4000

# frontend
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

### Configuration

Backend (`backend/.env`, not in git):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs sign-in tokens. Required: the server does not start without it, and when hosted it refuses the example value or one under 32 characters |
| `FRONTEND_ORIGIN` | The website's address, for CORS |
| `PORT` | Defaults to 4000 |
| `TRUST_PROXY` | Set to `1` behind a hosting proxy so rate limits apply per visitor |
| `PROMIC_DATABASE_URL`, `PROMIC_STORAGE_BUCKET` | ProMic's Firebase project (optional) |
| `PROMIC_SERVICE_ACCOUNT_PATH` or `PROMIC_SERVICE_ACCOUNT_JSON` | ProMic service-account key (optional). Never commit it |
| `GROUP_MIN_MEMBERS`, `GROUP_MAX_MEMBERS` | Group sizes (optional; 5 and 25) |
| `REGISTER_LIMIT_PER_DAY`, `LOGIN_ATTEMPTS` | Accounts per network address a day, and wrong passwords per 15 minutes (optional; 5 and 10) |

Frontend (`frontend/.env.local`, or build arguments):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | The API's address. Compiled into the pages at build time |
| `NEXT_PUBLIC_PROMIC_LE_URL` | ProMic's law-enforcement endpoints. Has a built-in default |

### Commands

| Where | Command |
|---|---|
| `backend` | `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`, `npm test`, `npm run test:api`, `npm run db:migrate`, `npm run db:deploy`, `npm run db:generate`, `npm run db:studio` |
| `frontend` | `npm run dev`, `npm run build`, `npm start`, `npm run lint` |

### Tests

| Command (in `backend`) | What it checks |
|---|---|
| `npm test` | Unit tests, no database needed: redaction, the strip's line wrapping, weight, size checks |
| `npm run test:api` | Starts the real server on an empty, throwaway PostgreSQL schema and walks through reading rules, the first look, voting and moving, and account limits. Needs `DATABASE_URL`; it builds the schema from the migrations and removes it afterwards |

GitHub Actions (`.github/workflows/ci.yml`) runs both, the type checks and the website build
on every push and pull request.

### Changing the database

1. Edit `backend/prisma/schema.prisma`.
2. `npm run db:migrate -- --name what_changed` creates a folder in `backend/prisma/migrations`
   and applies it to your local database. Commit the folder.
3. On the next deploy the server applies it by itself before starting
   (`backend/scripts/start.js`). If a migration fails, the server does not start.

Do not use `prisma db push` any more: it changes tables without leaving a migration behind.

## Hosting (Fly.io)

| App | Role |
|---|---|
| `exithreat` | Website (`frontend/fly.toml`). Sleeps when idle and wakes on the first request |
| `exithreat-api` | API (`backend/fly.toml`). Kept running, because the push observer polls votes |
| `exithreat-db` | Fly Postgres, attached to `exithreat-api` as `DATABASE_URL` |

```bash
cd backend  && fly deploy --ha=false     # first: the website may need the new API
cd frontend && fly deploy --ha=false
```

Secrets on `exithreat-api` (`fly secrets set`): `JWT_SECRET`, `PROMIC_SERVICE_ACCOUNT_JSON`.
The backend image applies any new migrations each time it starts, then starts the API.
`GET /api/health` also asks the database, so Fly's check fails if the API cannot reach it.

## Maps

The officer map uses **Leaflet** with **OpenStreetMap** tiles, so no API key is needed.
District and state names come from OpenStreetMap's Nominatim, looked up by ProMic's backend.
These public servers are meant for light use.

## Security notes

- The unredacted text of a post is never sent as text; it is rendered to an image on the
  server and served once per member. This slows copying down; it cannot stop a screenshot. The
  text is not encrypted in the database.
- Reading is limited to a group's members, and membership is assigned at random
  (`backend/src/services/groupService.ts`). Someone who opens many accounts still ends up in
  many groups: accounts need no email or phone, and the limit per network address only slows
  this down.
- For a trial with only a few accounts, lower `GROUP_MIN_MEMBERS` on the backend
  (`fly secrets set` or `[env]` in `backend/fly.toml`). Smaller groups are easier to fill
  with one person's accounts, so put it back before real use.
- The strip is drawn with fonts installed in the backend's image (`backend/Dockerfile`):
  DejaVu for Latin text, Noto for Tamil and Devanagari. Other scripts need their font added.
- Sign-in tokens are kept in the browser's local storage, where a script injected into the
  page could read them. A cookie the page cannot read is not possible while the website and
  the API are on different `fly.dev` addresses; it needs both on one domain. The officer's
  session is kept in session storage and ends when the tab is closed.
- Every request checks that the account still exists and that the token is not older than
  the last password change or "sign out on all devices" (`User.tokensValidFrom`).
- Post, comment, chat, username and password sizes are checked on the server
  (`backend/src/services/validation.ts`), and a request body may be 100 kB at most.
- Route errors are caught (`backend/src/middleware/handle.ts`) and answered as JSON without
  details; the details go to the server log.
- The ProMic service-account key gives the backend wide access to ProMic's data. Keep it out of
  the repository and limit who can read the hosting secrets.
- `helmet`, CORS limited to `FRONTEND_ORIGIN`, and rate limiting are enabled on the API:
  1,500 requests per address in 15 minutes overall, with lower limits on sign-up and sign-in.
  The counts are kept in memory, so they assume a single backend machine.

## Known limitations

- The group trust score (`weightageService.ts`: how many members read posts through and how
  active they are) is recalculated as members use their group and is shown on the group
  pages, but nothing depends on it.
- There is no admin role in ExiThreat, and no way to leave or change group.
- A forgotten password cannot be recovered, and an account cannot be deleted by its owner.
- Until two groups have 5 members each, nobody can post; with three groups it takes at least
  15 accounts before a post can also move on.
- Redaction is pattern-based, for English text with Indian and US formats. It misses names in
  lower case, a single name with nothing around it to mark it as one, and other languages. It
  redacts place names along with personal names. Posts made before a rule was added keep the
  redaction they got at the time.
- A post cannot be edited or deleted, and there is no moderation, reporting, terms of use or
  privacy policy on the site yet.
- The author is not notified when a post moves or gets a comment; "Mine" shows the current
  counts.
- The move to the next group runs by polling every 10 seconds.
- The officer page's lists, badges and filters have been checked in a browser against
  ProMic's backend. Live listening and talk-back have been checked against ProMic's formats
  but not yet clicked through end to end with a real stream.
- The whole ExiThreat flow (sign-up, groups, posting, first look, voting) is covered by the
  tests on a local copy; on the hosted site it has not been tried with real accounts.

## Related project

**ProMic** (https://github.com/senkumram777-cpu/ProMic): the Android safety app, its Firebase
backend, the admin panel where officers are created, and the live-audio relay. `CLAUDE.md` in
each repository records what one side depends on in the other.
