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
- A post is in up to five groups at once (`PostPlacement`; there is no `Post.currentGroupId`).
  Access, votes and tallies are per group (`readerGroup` in `accessService.ts`). Pushes forward
  to several groups: reach and destinations in `services/forwarding.ts` (pure, unit-tested),
  applied by `pushIfReady` / `forwardByAuthor` in `groupService.ts`. Each placement and history
  row records how the post arrived (`arrivedBy`: `start`, `group` with `fromGroupId`, or
  `author`); these are the edges of the author's group map (`GET /posts/:id/map`,
  `services/groupMap.ts` pure and unit-tested, `groupMapService.ts`, website
  `components/GroupMap.tsx`, page `/post/[id]/map`, opened from "Mine"). It covers every
  group, with the round (`Post.cycle`) and the groups covered in it. The map gives group
  names and weights only: never members, member counts or group ids, and only to the author.
- Forwarding goes round in cycles (`Post.cycleStartedAt`, `chooseInCycle` in `forwarding.ts`):
  only groups not reached since the cycle began, then a new cycle once all eligible groups have
  had the post.
- Pseudonyms (`User.pseudonym`, `services/pseudonym.ts`) are what groups and the common page
  see of an author. Never send a username next to a pseudonym. Members never get a username or
  account id of anyone else: comments and chat carry `author` (pseudonym) and `mine`, and a
  group's page gives only its member count and the reader's own `myPseudonym` (API test checks).
- The first look is opened only by a GET of `/posts/:id/strip`; HEAD is refused (405) so a
  preview or prefetch cannot use it up. Both clients show a "Read now" step before fetching it.
- Common page: `services/spread.ts` (pure, unit-tested) and `spreadService.ts` store
  `reachedGroups`, `eligibleGroups`, `spreadScore` and `listedAt` on each post, after every
  push and hourly; `routes/common.ts` lists them. Officers get the original as well, after
  `services/officerAuth.ts` checks their ProMic session with ProMic's `leWhoAmI`.
- Local test builds use Next's `output: 'standalone'`, which leaves a link
  `.next/standalone/node_modules` into the real packages. Remove that link first
  (`cmd //c "rmdir .next\standalone\node_modules"`), then `.next`; `rm -rf .next` from Git
  Bash empties `node_modules`.
- Group weight (`Group.trustScore`, with `loginScore` and `reviewScore`): formula in
  `backend/src/services/groupWeight.ts` (pure, unit-tested), gathered and stored by
  `groupWeightService.ts`. Days of use are written by `requireAuth` and at sign-in
  (`UserActiveDay`); a post counts as gone through when `ViewRecord.completedAt` and
  `redactedSeenAt` are set (the website sends `reason: "done"` with `strip/done`).
- Member weightage (`User.weight`, with `activityScore`, `postScore`, `voteScore`): formula in
  `memberWeight.ts`, stored by `memberWeightService.ts`, which reuses `reviewCounts` from
  `groupWeightService.ts`. Time on the site comes from `ActivityHeartbeat.tsx` →
  `POST /auth/heartbeat` (`UserActiveDay.seconds`). Never send it to anyone but its owner.
- Accounts: one per email address and per mobile number, stored only as HMAC fingerprints
  (`backend/src/services/contactService.ts`, key `CONTACT_HASH_SECRET`, which must never
  change). Email codes go out from Gmail (`services/delivery.ts`); without keys and off the
  host they are printed as `[local code] email <id> <code>`, which the API test reads. Mobile
  numbers are confirmed by Firebase Phone Auth on ProMic's project in the browser
  (`frontend/src/lib/firebasePhone.ts`) and checked in `services/phoneVerification.ts`; off the
  host, `PHONE_TOKEN_TEST=1` accepts `test-phone:<number>` instead (the API test uses it).
  Routes use `requireAuth` (refuses accounts lacking contact details with `CONTACT_REQUIRED`)
  or `requireSignedIn` (account management only).
- Admin page (`/admin`, `frontend/src/app/admin/page.tsx`, tabs in `components/admin/`;
  API `backend/src/routes/admin.ts`): for ProMic's one admin, checked by
  `services/adminAuth.ts` (Firebase ID token of ProMic's project against ProMic's `admin/`
  entry, `{uid, email}`, set in the Firebase console; Google sign-in with a verified email only;
  ProMic's rules and `functions/adminAccount.js` check the same; the page signs any other
  account out); off the
  host `ADMIN_TEST=1` accepts `test-admin:<name>` (the API test uses it). Every change goes
  through `log()` into `AdminAction`. Suspended accounts (`User.suspendedAt`) are refused by
  `requireAuth`/`requireSignedIn` and at sign-in (`code: "SUSPENDED"`); hidden posts
  (`Post.hiddenAt`) have no reader group (`readerGroup`), are left out of group pages, the
  common page (`ON_COMMON_PAGE` in `routes/common.ts`), the sweep and the author's push.
- Rules an admin can change: defined in `services/rules.ts` (pure, unit-tested), values in
  `services/settings.ts` (`rule('…')`, loaded at start, stored in `Setting`). Read rules
  through `rule()` (or `groupMinMembers()`, `manualPushCooldownMs()` in `groupService.ts`),
  never as constants. The website shows them through `GET /api/rules` and `useRules()`
  (`frontend/src/lib/rules.ts`).
- `frontend`: `npm run dev`, `npm run build`, `npm run lint`

## Android app: ExiThreatApp

A native Android app for members lives in its own repository,
`C:\Users\SenthilKumarRamakris\AndroidStudioProjects\ExiThreatApp`
(https://github.com/senkumram777-cpu/ExiThreatApp; Kotlin, Jetpack Compose, Retrofit). It has
the website's member pages (sign-up and sign-in, groups and chat, posts with the first look,
votes and manual push, comments, Mine and the map, the common page, account, ProMic backups);
officers and admins use the website only. It calls this API directly
(`https://exithreat-api.fly.dev/api`), so the API is a contract with it:

- Its endpoint paths and request fields are in `data/Api.kt`, the response fields in
  `data/Models.kt` (named as in `frontend/src/lib/api.ts`). Renaming or removing a route or a
  field, or changing a field's type, breaks the app: change the app with it, or add the new
  field alongside the old one.
- It relies on `error` and `code` in error answers (`SUSPENDED`, `CONTACT_REQUIRED`), on 401
  for an ended session, on `firstLook`, `POST /posts/:id/strip/done` with `reason`, the strip's
  `{image, rows, rowHeight, scale}`, comments and chat as `{author, mine, ...}`, a group's
  `myPseudonym`, the heartbeats, and `GET /api/rules`.
- Mobile numbers are confirmed with Firebase Phone Auth on ProMic's project, as on the website:
  the app sends the Firebase ID token to `POST /auth/verify/phone`. A test build
  (`-PphoneTest=true`) sends `test-phone:<number>`, which only a local server with
  `PHONE_TOKEN_TEST=1` accepts.
- A new member feature on the website is not in the app until it is built there too.

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
  backup key; media comes back from `/api/promic/backups/{audio|video}/:id` as FLAC (backups
  stored as `.flac`, sent as they are), WAV (older `.pcm` backups) or MP4.
- Without the `PROMIC_*` env vars the routes answer 503 and the rest of the app is unaffected.

### Integration: ProMic law-enforcement sign in

`/law-enforcement` (`frontend/src/app/law-enforcement/page.tsx`) is a separate login for police
officers. Officers are not ExiThreat users: their accounts are created in ProMic's admin panel,
and the page calls ProMic's Cloud Functions directly (`leLogin`, `leRequestAccess`,
`leVerifyHostCode`, `leVerifyEmailCode`, `leGetAudio` in the ProMic repo's `functions/le.js`).
It never uses the ExiThreat token or backend, so an officer sees only the recording flow. The
credentials email ProMic sends links to this page, so the route must keep its path.

## Hosting (Fly.io)

- Website: app `exithreat` → https://exithreat.iyugam.com, admin page https://exithreat-admin.iyugam.com
  (`frontend/fly.toml`; DNS at GoDaddy, Fly certificates; `src/middleware.ts` sends each host to its
  pages; https://exithreat.fly.dev still serves everything). The API allows every address in
  `FRONTEND_ORIGIN` (comma-separated, `backend/fly.toml`)
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
`AudioFrameCodec` (60-byte header), `AudioEncryption` (IV(12) || ciphertext || tag) and
`LiveOpus` (inside: the byte 1, then 20 ms Opus packets of 16 kHz mono, each with a 2-byte
big-endian length), decoded with `opus-decoder`. Talk-back sends 16 kHz mono 16-bit PCM.

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
