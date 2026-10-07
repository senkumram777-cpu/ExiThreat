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
2. **Groups.** Users create or join groups. Each group has its own chat, which never leaves it.
3. **Disclosure.** The author (the "Original Complainant") writes at least 20 characters. The
   server makes a redacted copy, replacing emails, phone numbers, names, addresses, URLs, dates
   and ID numbers with labels such as `[NAME REDACTED]`, and places the post in a random group.
4. **First look.** A member of the post's current group can see the unredacted text exactly
   once, served as an image strip rather than text. Afterwards only the redacted version is
   available. The browser remembers what it has shown (RxDB), and the server keeps an audit
   record.
5. **Push.** Members of the current group vote to push the post on. The author cannot vote on
   their own post, and a vote can be withdrawn.
6. **Move.** Every 10 seconds the server checks the votes. At 50% of a group's members, the post
   moves to another random group, the vote percentage is saved to its history, and voting starts
   again.
7. **Manual push.** The author may move their own post once every 24 hours. It clears the
   current votes and adds nothing to the post's weight.
8. **Weightage.** A post's weight is the sum of the vote percentages from every group it left by
   vote.
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
| `GET /groups`, `GET /groups/:id`, `POST /groups`, `POST /groups/:id/join`, `POST /groups/:id/heartbeat` | Groups and activity |
| `GET /groups/:id/chat`, `POST /groups/:id/chat` | Group chat |
| `POST /posts`, `GET /posts/:id`, `GET /posts/:id/strip` | Create a post, read it, the one-time image strip |
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
  server and served once per member.
- Sign-in tokens are kept in the browser's local storage. The officer's session is kept in
  session storage and ends when the tab is closed.
- The ProMic service-account key gives the backend wide access to ProMic's data. Keep it out of
  the repository and limit who can read the hosting secrets.
- `helmet`, CORS limited to `FRONTEND_ORIGIN`, and rate limiting are enabled on the API.

## Known limitations

- The group trust score formula exists (`weightageService.ts`) but nothing calls it yet, so
  scores stay at 0.
- Any signed-in user can create a group; there is no admin role in ExiThreat.
- Redaction is pattern-based and tuned to English and US formats, so it will miss some names
  and numbers.
- The move to the next group runs by polling every 10 seconds.
- Live listening and the officer map have been checked against ProMic's backend but not yet
  clicked through end to end in a browser.

## Related project

**ProMic** (https://github.com/senkumram777-cpu/ProMic): the Android safety app, its Firebase
backend, the admin panel where officers are created, and the live-audio relay. `CLAUDE.md` in
each repository records what one side depends on in the other.
