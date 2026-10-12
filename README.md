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

## Repository layout

| Path | What it is |
|---|---|
| `frontend/` | Next.js 14 (App Router), React 18, Tailwind, next-pwa, RxDB |
| `backend/` | Express API in TypeScript, Prisma, PostgreSQL, JWT auth |
| `backend/prisma/schema.prisma` | Database schema |
| `docker-compose.yml` | Postgres, backend and frontend together |
| `frontend/fly.toml`, `backend/fly.toml` | Fly.io hosting |

## How ExiThreat works

1. **Account.** Register with a username and password; no email or phone is asked for.
   Passwords are hashed with bcrypt, and sign-in returns a token valid for 7 days.
2. **Groups.** Nobody chooses or creates a group. The server places each user in one group at
   random (emptier groups are more likely), at sign-up, or at the next sign-in for older
   accounts. A group holds at most 25 members; new groups are opened as needed and get a
   generated name. A user sees only their own group: its posts, its chat (which never leaves
   it) and its member names. One network address can create 5 accounts a day.
3. **Disclosure.** The author (the "Original Complainant") writes at least 20 characters. The
   server makes a redacted copy, replacing emails, phone numbers, names, addresses, URLs, dates
   and ID numbers with labels such as `[NAME REDACTED]`, and places the post in a random group
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

### Pages

| Route | Purpose |
|---|---|
| `/` | Home |
| `/auth/register`, `/auth/login` | Account |
| `/groups`, `/group/[id]` | Groups, a group's posts and chat |
| `/post/new`, `/post/[id]` | Write a disclosure; view one, vote and comment |
| `/promic` | A ProMic user's own backups |
| `/law-enforcement` | Officer sign in (separate from ExiThreat accounts) |

### API

All routes are under `/api` and, except register and login, need `Authorization: Bearer <token>`.

| Route | Purpose |
|---|---|
| `POST /auth/register`, `POST /auth/login` | Account |
| `GET /groups`, `GET /groups/:id`, `POST /groups/:id/heartbeat` | The user's own group and activity |
| `GET /groups/:id/chat`, `POST /groups/:id/chat` | Group chat |
| `POST /posts`, `GET /posts/:id`, `GET /posts/:id/strip`, `POST /posts/:id/strip/done` | Create a post, read it, the one-time image strip, close the first look |
| `GET /posts/:id/comments`, `POST /posts/:id/comments` | Comments |
| `POST /push/:postId/vote`, `DELETE /push/:postId/vote`, `POST /push/:postId/manual`, `GET /push/:postId/status` | Voting and manual push |
| `GET /weightage/:postId`, `POST /weightage/:postId/recalculate` | Weightage |
| `GET /promic/link`, `POST /promic/link`, `DELETE /promic/link`, `GET /promic/backups`, `GET /promic/backups/{audio\|video}/:id` | ProMic backups |
| `GET /health` | Health check |

### Database

`User`, `Group`, `GroupMember`, `Post`, `PushVote`, `PostHistory`, `Comment`, `ViewRecord`,
`ChatMessage`, `ProMicLink`. There is no migration history: the schema is applied with
`prisma db push`.

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
3. Enter the 6-digit code that user sees in their ProMic app. They can refuse.
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
  with name, mobile number and GPS position. Clicking shows the location on the map. A blinking
  green dot marks a user who is live streaming; if they shared the stream with law enforcement,
  clicking jumps to them in the live list. "Download CSV" saves the current list.
- **Live Streaming.** Users in the area who ticked "Law Enforcement" in ProMic when starting
  their stream. Click **Listen** to hear it.

The lists refresh every 15 seconds. Which users fall in an officer's area is decided by ProMic's
backend, not by this page.

### How live playback works
`liveAudio.ts` connects to ProMic's relay over WebSocket and decrypts each frame in the browser
with the Web Crypto API, using a session key ProMic hands over only for a shared stream. It
must stay in step with ProMic's formats: a 60-byte frame header, then
`IV(12) || ciphertext || tag(16)` holding 16 kHz mono 16-bit PCM.

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
npx prisma db push
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
| `JWT_SECRET` | Signs sign-in tokens; use a long random value |
| `FRONTEND_ORIGIN` | The website's address, for CORS |
| `PORT` | Defaults to 4000 |
| `TRUST_PROXY` | Set to `1` behind a hosting proxy so rate limits apply per visitor |
| `PROMIC_DATABASE_URL`, `PROMIC_STORAGE_BUCKET` | ProMic's Firebase project (optional) |
| `PROMIC_SERVICE_ACCOUNT_PATH` or `PROMIC_SERVICE_ACCOUNT_JSON` | ProMic service-account key (optional). Never commit it |

Frontend (`frontend/.env.local`, or build arguments):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | The API's address. Compiled into the pages at build time |
| `NEXT_PUBLIC_PROMIC_LE_URL` | ProMic's law-enforcement endpoints. Has a built-in default |

### Commands

| Where | Command |
|---|---|
| `backend` | `npm run dev`, `npm run build`, `npm start`, `npm run db:push`, `npm run db:generate`, `npm run db:studio` |
| `frontend` | `npm run dev`, `npm run build`, `npm start`, `npm run lint` |

## Hosting (Fly.io)

| App | Role |
|---|---|
| `exithreat` | Website (`frontend/fly.toml`). Sleeps when idle and wakes on the first request |
| `exithreat-api` | API (`backend/fly.toml`). Kept running, because the push observer polls votes |
| `exithreat-db` | Fly Postgres, attached to `exithreat-api` as `DATABASE_URL` |

```bash
cd backend  && fly deploy --ha=false
cd frontend && fly deploy --ha=false
```

Secrets on `exithreat-api` (`fly secrets set`): `JWT_SECRET`, `PROMIC_SERVICE_ACCOUNT_JSON`.
The backend image applies the schema with `prisma db push` each time it starts.

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
- The group sizes can be changed with `GROUP_MIN_MEMBERS` and `GROUP_MAX_MEMBERS` on the
  backend (`fly secrets set` or `[env]` in `backend/fly.toml`), and the sign-up limit with
  `REGISTER_LIMIT_PER_DAY`.
- The strip is drawn with fonts installed in the backend's image (`backend/Dockerfile`):
  DejaVu for Latin text, Noto for Tamil and Devanagari. Other scripts need their font added.
- Sign-in tokens are kept in the browser's local storage. The officer's session is kept in
  session storage and ends when the tab is closed.
- The ProMic service-account key gives the backend wide access to ProMic's data. Keep it out of
  the repository and limit who can read the hosting secrets.
- `helmet`, CORS limited to `FRONTEND_ORIGIN`, and rate limiting are enabled on the API.

## Known limitations

- The group trust score formula exists (`weightageService.ts`) but nothing calls it yet, so
  scores stay at 0.
- There is no admin role in ExiThreat, and no way to leave or change group.
- Until two groups have 5 members each, nobody can post; with three groups it takes at least
  15 accounts before a post can also move on.
- Redaction is pattern-based and tuned to English and US formats, so it will miss some names
  and numbers.
- The move to the next group runs by polling every 10 seconds.
- Live listening and the officer map have been checked against ProMic's backend but not yet
  clicked through end to end in a browser.

## Related project

**ProMic** (https://github.com/senkumram777-cpu/ProMic): the Android safety app, its Firebase
backend, the admin panel where officers are created, and the live-audio relay. `CLAUDE.md` in
each repository records what one side depends on in the other.
