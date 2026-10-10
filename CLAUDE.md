# ExiThreat

PWA with a Next.js frontend and an Express + PostgreSQL backend.

## Layout

- `frontend/` — Next.js PWA (React, RxDB, next-pwa, Tailwind), dev server on port 3000
- `backend/` — Express API in TypeScript with Prisma, JWT auth, on port 4000 under `/api`
- `backend/prisma/schema.prisma` — database schema
- `docker-compose.yml` — runs postgres, backend and frontend together

## Commands

- `docker compose up` — full stack
- `backend`: `npm run dev`, `npm run build`, `npm run db:migrate`, `npm run db:generate`
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
- There is no Prisma migration history; the backend image runs `prisma db push` on start.

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
