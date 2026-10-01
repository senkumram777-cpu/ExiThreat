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

The two codebases currently share no code, backend or configuration: ExiThreat uses its own
Express/Postgres backend, ProMic uses Firebase. When a task spans both (shared API contract,
auth, data model), read the relevant ProMic files directly rather than assuming, and record
any integration that gets built here.
