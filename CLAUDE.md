# ExiThreat

PWA with a Next.js frontend and an Express + PostgreSQL backend.

## Layout

- `frontend/` — Next.js PWA (React, next-pwa, Tailwind), dev server on port 3000
- `backend/` — Express API in TypeScript with Prisma, JWT auth, on port 4000 under `/api`
- `backend/prisma/schema.prisma` — database schema; `backend/prisma/migrations/` — its history
- `backend/src/tests/` — unit tests and the API test
- `docker-compose.yml` — runs postgres, backend and frontend together

## Commands

- `docker compose up` — full stack
- `backend`: `npm run dev`, `npm run build`, `npm run typecheck`, `npm test` (unit, no
  database), `npm run test:api` (needs `DATABASE_URL`; uses a throwaway schema),
  `npm run db:migrate -- --name <what_changed>`, `npm run db:generate`
- A schema change always comes with a new migration folder. Never `prisma db push`.
- Accounts: one per email address and per mobile number, stored only as HMAC fingerprints
  (`backend/src/services/contactService.ts`, key `CONTACT_HASH_SECRET`, which must never
  change). Email codes go out from Gmail (`services/delivery.ts`); without keys and off the
  host they are printed as `[local code] email <id> <code>`, which the API test reads. Mobile
  numbers are confirmed by Firebase Phone Auth on ProMic's project in the browser
  (`frontend/src/lib/firebasePhone.ts`) and checked in `services/phoneVerification.ts`; off the
  host, `PHONE_TOKEN_TEST=1` accepts `test-phone:<number>` instead (the API test uses it).
  Routes use `requireAuth` (refuses accounts lacking contact details with `CONTACT_REQUIRED`)
  or `requireSignedIn` (account management only).
- `frontend`: `npm run dev`, `npm run build`, `npm run lint`

## Sibling project: ProMic

ProMic is a separate Android project at
`C:\Users\SenthilKumarRamakris\AndroidStudioProjects\ProMic`. It is registered as an
additional directory in `.claude/settings.local.json`, so its files can be read and edited
from an ExiThreat session.

- `app/` — Android phone app (Kotlin, Jetpack Compose, Hilt), package `com.example.promic`
- `wear/` — Wear OS companion module
- `functions/`, `firebase/` — Firebase Cloud Functions and database/storage rules
- `admin-web/` — admin panel (Vite + TypeScript)
- `server/` — Node server deployed on Fly.io
- Git repository; main branch is `master`.

The two codebases share no code or backend: ExiThreat uses its own Express/Postgres backend,
ProMic uses Firebase. When a task spans both, read the relevant ProMic files directly rather
than assuming, and record any integration that gets built here.

### Integration: ProMic backups

A user can open their ProMic Host account's backup audio/video at `/promic`.

- Linking: the ProMic app (Settings → Link ExiThreat Account) shows a one-time code;
  `POST /api/promic/link` redeems it from `exithreat_link_codes/{code}` in ProMic's Realtime
  Database and stores the user → host uid mapping in `ProMicLink`.
- Access: `backend/src/services/promicService.ts` uses the Firebase Admin SDK with a ProMic
  service account (`PROMIC_*` env vars, see `backend/.env.example`) to list segment metadata
  and decrypt Storage blobs server-side. The browser never gets Firebase credentials or the
  backup key; media comes back as WAV/MP4 from `/api/promic/backups/{audio|video}/:id`.
- Without the `PROMIC_*` env vars the routes answer 503 and the rest of the app is unaffected.

### Integration: ProMic law-enforcement sign in

`/law-enforcement` (`frontend/src/app/law-enforcement/page.tsx`) is a separate login for police
officers. Officers are not ExiThreat users: their accounts are created in ProMic's admin panel,
and the page calls ProMic's Cloud Functions directly (`leLogin`, `leRequestAccess`,
`leVerifyHostCode`, `leVerifyEmailCode`, `leGetAudio` in the ProMic repo's `functions/le.js`).
It never uses the ExiThreat token or backend, so an officer sees only the recording flow. The
credentials email ProMic sends links to this page, so the route must keep its path.

## Hosting (Fly.io)

- Website: app `exithreat` → https://exithreat.fly.dev (`frontend/fly.toml`)
- API: app `exithreat-api` → https://exithreat-api.fly.dev/api (`backend/fly.toml`)
- Database: Fly Postgres app `exithreat-db`, attached to `exithreat-api` as `DATABASE_URL`
- Deploy with `fly deploy --ha=false` from `frontend/` or `backend/`. The API URL is compiled
  into the website at build time (`NEXT_PUBLIC_API_URL` build arg in `frontend/fly.toml`).
- The backend image runs `backend/scripts/start.js`: `prisma migrate deploy`, then the API. A
  failed migration stops the server from starting.
- The service worker is registered by `frontend/src/components/ServiceWorker.tsx`, not by
  next-pwa. It must never keep API responses (see the comment in `frontend/next.config.js`).

The page also drives ProMic's fallback for a phone that cannot be reached (`leFallbackStatus`,
`leStartFallback`): a Connected User's code, then a ProMic administrator's approval, which the
page waits for by polling.

`AreaDashboard.tsx` (shown once the officer is signed in) is the station map (Leaflet with
OpenStreetMap tiles), the area's AI threat / SOS alerts and the shared live streams, from
ProMic's `leSetStation`, `leOverview` and `leJoinLive`. `liveAudio.ts` plays a stream in the
browser: it connects to ProMic's relay and decrypts each frame, so it must match ProMic's
`AudioFrameCodec` (60-byte header) and `AudioEncryption` (IV(12) || ciphertext || tag, 16 kHz
mono 16-bit PCM).

While an officer is listening, `AreaDashboard.tsx` calls ProMic's `leLivePing` every 20 seconds (and
once with `leaving` on stopping), which is what lets the ProMic user's app show that police are
listening.

The same row lets the officer ask the user "Are you OK?" (`leCheckIn`) and shows the outcome by
polling `leCheckInStatus` every 3 seconds. If the user does not answer with their passcode within
15 seconds, their phone opens talk-back and the page offers "Hold To Talk": `liveAudio.ts` sends
the microphone as frames in the same layout and with the same key as the stream, on the same
socket. ProMic's relay passes them to the user's phone only, and the phone decides whether to
play them (ProMic repo, `HostCheckIn.kt`).

`leOverview` also says, per live stream, whether the user is in a remote area (`remote`, `place`),
has a weak signal (`weak`, `bars`, `net`) or has stopped reporting (`lost`, `lastSeenAt`, with
`lat`/`lon`/`locationAt` then being the last known position), and per alert whether it was raised
in a remote area. The page shows these as badges and offers them as filters; all of it is decided
by ProMic (`regionOf` and `linkOf` in `functions/le.js`).
