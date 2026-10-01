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
