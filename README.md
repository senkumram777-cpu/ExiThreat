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
| Website | https://exithreat.iyugam.com (also https://exithreat.fly.dev) |
| Admin page | https://exithreat-admin.iyugam.com |
| API | https://exithreat-api.fly.dev/api |
| Officer sign in | https://exithreat.iyugam.com/law-enforcement |
| Local | website http://localhost:3000, API http://localhost:4000/api |

Current work is on the branch `feature/promic-backups`; the hosted site is deployed from it.

## Repository layout

| Path | What it is |
|---|---|
| `frontend/` | Next.js 14 (App Router), React 18, Tailwind, next-pwa |
| `frontend/public/` | Web app manifest and icons. The service worker files are built, not kept in git |
| `backend/` | Express API in TypeScript, Prisma, PostgreSQL, JWT auth |
| `backend/prisma/schema.prisma`, `backend/prisma/migrations/` | Database schema and its history |
| `backend/src/services/` | The rules: `groupService.ts` (groups, votes, forwarding), `forwarding.ts` (reach and destinations), `groupWeight.ts` and `groupWeightService.ts` (group weight), `memberWeight.ts` and `memberWeightService.ts` (member weightage), `contactService.ts` and `phoneVerification.ts` (one account per email and mobile), `redactionService.ts`, `imageService.ts` (the first-look strip), `promicService.ts` |
| `frontend/src/lib/firebasePhone.ts`, `frontend/src/components/ContactVerifier.tsx` | Confirming an email or mobile number on the pages |
| `backend/src/tests/` | Unit tests and the API test |
| `backend/scripts/start.js` | Hosted start-up: apply migrations, then start the API |
| `.github/workflows/ci.yml` | Tests and builds on every push |
| `docker-compose.yml` | Postgres, backend and frontend together |
| `frontend/fly.toml`, `backend/fly.toml` | Fly.io hosting |

## How ExiThreat works

1. **Account.** Register with a username (3 to 30 letters, digits, dots, dashes or
   underscores, at least one letter), an email address, an Indian mobile number and a password
   of 8 to 72 characters. The email and the mobile are each confirmed with a 6-digit code
   (see [How codes are sent](#how-codes-are-sent)). **Each email address and each mobile number can
   have only one account**: a second sign-up with either is refused, also when it is written
   differently (capitals, `+tags`, dots in Gmail addresses, `+91`/`0` prefixes and spaces).
   Neither is stored: the database keeps only a keyed one-way fingerprint of each
   (`backend/src/services/contactService.ts`), so they can be matched but not read back. They
   cannot be changed once set.
   - Sign in with the username, the email address or the mobile number. Passwords are hashed
     with bcrypt, and sign-in returns a token valid for 7 days.
   - "Forgot password?" sends a code to the account's email or mobile and sets a new password;
     every device is signed out.
   - Accounts made before email and mobile were required must add both at their next sign-in
     (`/account/contact`); until then the API refuses them everything else.
   - The Account page signs out, signs out on all devices, and changes the password (which
     also signs every other device out). Ten wrong passwords for one account from one network
     address block further tries for 15 minutes.
   - Codes expire after 10 minutes and allow 5 wrong tries. One address or number gets a new
     code at most once a minute and 5 times a day; one network address may ask for 20 codes
     an hour and create 20 accounts a day.
2. **Groups.** Nobody chooses or creates a group. The server places each user in one group at
   random (emptier groups are more likely), at sign-up, or at the next sign-in for older
   accounts. A group holds at most 25 members; new groups are opened as needed and get a
   generated name. A user sees only their own group: its posts, its chat (which never leaves
   it) and its member names.
   - **Group weight** (0 to 100%, shown on the group pages) measures how active the members
     are. Each member gets two scores, which count equally:
     - *Logins:* the days on which they used ExiThreat signed in, out of the last 30 (or
       since they joined, if that is shorter). Using it every other day is full marks.
     - *Posts gone through:* of the posts that reached the group while they were in it, the
       share whose first look (the original post) they read to the end with "Done reading"
       and whose redacted version they were then shown. A post they have not gone through
       counts against them only once it has been in the group for 24 hours. Voting to push
       is not required: not voting means "keep it here".
     The group's weight is the average of its members' scores; before any post has reached
     it, logins alone. It is recalculated every hour, and for a group at once when one of its
     members finishes going through a post. It decides how far that group's pushes reach (step 6).
   - **Member weightage** (0 to 100%, on the Account page, seen only by the member) measures
     how the member, as a source of posts, uses ExiThreat. Three parts count equally, over the
     last 30 days or since the account was made:
     - *Activity:* half how often they use it (every other day is full marks), half how long
       they stay (about 10 minutes on each of those days is full marks). Time is reported by
       the website once a minute while it is open and in view (`POST /auth/heartbeat`).
     - *Posting:* how often they post; a post a week is full marks, and more adds nothing.
     - *Voting:* the share of posts that reached their group which they went through, the same
       measure as in the group weight. Left out until they have had a post to go through.
     Recalculated every hour, whenever the member opens their Account page, and when they push
     their own post. It decides how far that push reaches (step 7).
3. **Disclosure.** The author (the "Original Complainant") writes at least 20 characters. The
   server makes a redacted copy, replacing emails, phone numbers, names, companies, addresses,
   URLs, dates and ID numbers (Indian and US formats) with labels such as `[NAME REDACTED]`.
   The author must look at that redacted version before submitting ("Preview redaction"), and
   finds their posts again under "Mine". The server places the post in a random group
   that has at least 5 members and that the author is not in. If there is no such group yet,
   the post is refused and nothing is saved.
   A post, its comments, votes and weightage can be read only by members of the groups it is
   in now (one at first, up to five once it is forwarded) and by its author. Nobody is told who the author is; the author's own page says
   "Your Post". Comments and group chat show the writer's pseudonym, never a username, and
   members are not listed to each other: a group shows only how many it has.
4. **First look.** A member of a group the post is in can see the unredacted text once,
   served as an image strip rather than text: one line, 16 characters wide, scrolling slowly
   from right to left, that can't be selected or copied. It starts only when the reader taps
   "Read now", so opening a post by mistake does not use it up. The look ends when the reader taps "Done
   reading" or leaves the page; afterwards only the redacted version is available. The server
   keeps the record, so it is the same on every device. A look that was opened but never
   closed (lost connection) can be reopened for 10 minutes.
5. **Push.** Members of each group the post is in vote to push it on, once they have opened
   its first look. Each group votes separately. The author cannot vote on their own post, and a vote can be withdrawn.
6. **Forwarding by a group.** The votes are counted as each one is cast, against the members
   who used the group in the last 14 days (never against fewer than 5). The vote that brings
   them to 50% forwards the post at once: it leaves that group (the vote percentage is saved
   to its history and that group's votes are cleared) and goes to **several groups at once**.
   How many follows the pushing group's weight: below 40% one group, 40 to 69% two, 70% and
   above three. At least one of them has a higher weight than the pushing group; if there is
   none, the highest-weighted group available is taken. The rest are random. Destinations
   have at least 5 members, do not include the author, and are not groups the post is in
   now. A post goes round the groups **in cycles**: it is sent only to groups it has not
   reached in the current cycle, and once every eligible group has had it, a new cycle
   starts and they are all open to it again. A post is never in more than **five
   groups at once**. The voter is told the post has left their group. If no group can take
   it, it waits and goes as soon as one reaches 5 members. An hourly sweep catches what no
   vote announces, such as members going inactive.
7. **Forwarding by the author** ("Manual Push"), once every 24 hours: the post stays in the
   groups it is in and is also sent to 1 to 3 more, by the author's own weightage (same
   steps), at least one of them better weighted than the best group it is in now. Still at
   most five groups at once. It clears no votes and adds nothing to the post's weight. The
   author is told how many groups were added; they appear on the map (next step).
8. **Journey.** The author sees, on the post ("Journey so far") and under "Mine", how many
   groups are reading it now, how many it has passed through, and when it last reached a
   group. Tapping a post under "Mine" opens its map (`/post/[id]/map`, also linked from the
   post): every group in the system as a dot, by name and weight only (no members, no member
   counts). At the top, the round the post is on (a new round starts each time it has been
   to every eligible group) and how many eligible groups it has covered and has still to
   cover in it. Dots are coloured: reading it now (pulsing, with the date and time it
   arrived), covered in this round, reached only in an earlier round, yet to cover, and
   groups that cannot get it (the author's own, or under 5 members). The post's path is drawn
   with arrows for who sent it where (a group's votes, the author's push, or where it was
   posted); the groups it has not reached are a grid of dots below. Tapping a dot shows the
   group's name, weight and when the post reached it. Only the author sees the map.
   A member whose group has just pushed the post on is shown "This post has moved on".
9. **Weightage.** A post's weight is the sum of the vote percentages from the groups that
   forwarded it by vote. Each group counts once, with at most 100, so going round the same groups adds nothing.
10. **Comments** travel with a post and are shared by every group it is in. Group chat does not.
11. **Pseudonyms.** Every member is given a random pseudonym when they register (for example
    `Voice-7KQ3PZ4M`). Their posts show it, in groups and on the common page, never their
    username. Only the member sees the two together, on their Account page.
12. **Common page** (`/common`). Once a post has reached **20% of the eligible groups** (groups
    with at least 5 members, not counting the author's own), it is listed on the common page
    and stays there. Every group it has been in counts, whether a group's votes or the author
    sent it. The list is ordered by its **spread score**: the share of eligible groups it has
    reached per day since it was posted, highest first. Before 20% this is how fast it got
    there; afterwards it is recalculated after every push and hourly, so a post rises while it
    keeps spreading quickly and falls as it slows or ages. Each entry shows the author's
    pseudonym, how many groups it has reached, how long it took to reach 20%, and its score.
    Every registered member sees the redacted version only. Officers see both the original
    and the redacted version (next section).

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
| `/auth/register`, `/auth/login`, `/auth/reset` | Sign up, sign in, reset a forgotten password |
| `/account`, `/account/contact` | Sign out, change password, delete the account; add email and mobile to an older account |
| `/privacy`, `/delete-account` | Privacy policy; how to delete an account (both given to Google Play) |
| `/groups`, `/group/[id]` | Groups, a group's posts and chat |
| `/common` | The common page: posts that have reached 20% of the groups (an admin setting), fastest spreading first |
| `/disclosures` | The user's own posts ("Mine") |
| `/offline` | Shown by the service worker when there is no connection |
| `/post/new`, `/post/[id]` | Write a disclosure; view one, vote and comment |
| `/promic` | A ProMic user's own backups |
| `/law-enforcement` | Officer sign in (separate from ExiThreat accounts) |
| `/admin` | The admin page, for ProMic's admins (see [Admin page](#admin-page)); not linked from the member pages |

### How codes are sent

- **Email:** the server sends the code from a Gmail account over Gmail SMTP with an app
  password (`GMAIL_USER`, `GMAIL_APP_PASSWORD`), the same account ProMic uses for officers'
  codes (`backend/src/services/delivery.ts`). About 500 emails a day; check spam.
- **Mobile:** Firebase Phone Authentication on ProMic's Firebase project. The browser shows
  Google's reCAPTCHA (usually invisible) and Google sends the SMS
  (`frontend/src/lib/firebasePhone.ts`). The browser passes the resulting token to
  `POST /auth/verify/phone`; the server checks it with the ProMic service account, keeps only
  the fingerprint and deletes the Firebase user the sign-in created
  (`backend/src/services/phoneVerification.ts`). A number that already belongs to a ProMic
  account signs in to that account, which is never deleted. Google bills each SMS to the
  ProMic project. The site's domain must be in Firebase console → Authentication → Settings →
  Authorized domains (`exithreat.iyugam.com`, `exithreat-admin.iyugam.com`, `exithreat.fly.dev`
  and `localhost` are). The project's web settings
  in `firebasePhone.ts` are public identifiers, not secrets.

### API

All routes are under `/api` and, except sign-up, sign-in, codes and reset, need
`Authorization: Bearer <token>`. An account without its email and mobile number is answered
403 with `code: "CONTACT_REQUIRED"` everywhere except `/auth/me`, `/auth/contact`,
`/auth/password` and `/auth/signout-all`.

| Route | Purpose |
|---|---|
| `POST /auth/verify/start`, `POST /auth/verify/check` | Send a code to an email address; enter it |
| `POST /auth/verify/phone` | A Firebase ID token from a phone sign-in, exchanged for a confirmation of that number |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/reset` | Sign up (with both confirmations), sign in (username, email or mobile), new password with a confirmation |
| `POST /auth/delete` | The member deletes their own account (with the password) and everything it wrote |
| `GET /auth/me`, `POST /auth/contact`, `POST /auth/password`, `POST /auth/signout-all` | The account and whether its contact details are complete; add them; change password; sign out everywhere |
| `POST /auth/heartbeat`, `GET /auth/weight` | Time on the site; the member's own weightage |
| `GET /groups`, `GET /groups/:id`, `POST /groups/:id/heartbeat` | The user's own group and activity |
| `GET /groups/:id/chat`, `POST /groups/:id/chat` | Group chat |
| `POST /posts`, `GET /posts/:id`, `GET /posts/:id/strip`, `POST /posts/:id/strip/done` | Create a post, read it, the one-time image strip (a PNG in base64, drawn in rows, with each row's width), close the first look |
| `POST /posts/preview`, `GET /posts/mine` | The redacted version of a text before it is posted; the caller's own posts |
| `GET /posts/:id/map` | Author only: every group by name and weight, which it covered in this round, passed through and is in now, the path between them, and the round |
| `GET /common?offset=` | The common page, 30 at a time: redacted versions, by pseudonym (members) |
| `GET /common/officer?offset=` | The same with the original versions, for an officer's ProMic session token |
| `GET /posts/:id/comments`, `POST /posts/:id/comments` | Comments |
| `POST /push/:postId/vote`, `DELETE /push/:postId/vote`, `POST /push/:postId/manual`, `GET /push/:postId/status` | Voting and manual push |
| `GET /weightage/:postId`, `POST /weightage/:postId/recalculate` | Weightage |
| `GET /promic/link`, `POST /promic/link`, `DELETE /promic/link`, `GET /promic/backups`, `GET /promic/backups/{audio\|video}/:id` | ProMic backups |
| `GET /rules` | The rules the website mentions in its text, as an admin has set them (no sign-in) |
| `/admin/…` | The admin page's API, for a ProMic admin's Firebase ID token (see [Admin page](#admin-page)) |
| `GET /health` | Health check |

### Database

`User` (with the `emailHash` and `phoneHash` fingerprints), `ContactVerification` (codes and
confirmations, kept for a day at most), `Group`, `GroupMember`, `Post`, `PostPlacement` (the
groups a post is in now, with when it arrived), `PushVote` (per post and group),
`PostHistory` (groups a post has left: arrival, departure, vote share), `Comment`, `ViewRecord` (first looks, and when the redacted version was
shown), `UserActiveDay` (days of use and time on the site, kept 60 days), `ChatMessage`, `ProMicLink`,
`Setting` (rules an admin changed from their defaults) and `AdminAction` (the admin log). Admins also set
`User.suspendedAt`, `Post.hiddenAt` and `Post.unlistedAt`. The tables are changed only through the migrations in
`backend/prisma/migrations` (see [Changing the database](#changing-the-database)).

## Admin page

https://exithreat-admin.iyugam.com (also `/admin` on the site) is for ProMic's admin: the one account in ProMic's `admin/`
entry (`{uid, email}`, set in the Firebase console), who also uses ProMic's admin panel. They
sign in with that Google account (Firebase Authentication of ProMic's project,
`frontend/src/lib/adminAuth.ts`); ExiThreat's server checks the Firebase ID token against
`admin/` on every request (`backend/src/services/adminAuth.ts`, read at most once a minute),
and the page signs any other account out. The admin sees everything,
including original posts and which account wrote each one. Every change is written to the
admin log.

| Tab | What an admin can do |
|---|---|
| Dashboard | Accounts, activity, groups, posts and votes at a glance; the last 14 days; the latest admin actions |
| Accounts | Find an account by username, pseudonym, email address or mobile number (matched by fingerprint); see its groups, posts and days of use; suspend it (signs it out; it cannot sign in until restored), restore it, sign it out everywhere, or delete it with everything it wrote |
| Posts | Every post with its original and redacted text and its author; hide a post (only its author and admins see it; it stops travelling and leaves the common page), unhide, unlist, delete; delete comments |
| Common page | The listed posts in the order members and officers see them; unlist or relist one |
| Groups & chat | Groups with their weight and members; rename a group, move a member to another group (their votes in the old one are dropped), read and delete chat messages, recalculate weights and spreads now |
| Officers | ProMic's law-enforcement accounts: list them, create one, email a new password, turn one off or on. ExiThreat's server reads `le_users/` with the service account and calls ProMic's `adminCreateLeUser` / `adminSetLeUserDisabled` with the admin's own sign-in, so ProMic sends the emails and keeps its own audit |
| Settings | The vote share that moves a post, the common page's share, the most groups at once, hours between an author's pushes, the smallest and largest group, and whether new accounts can be created (`backend/src/services/rules.ts`). A change applies at once and starts a recalculation |
| Log | Every admin action, with who and when |

A local copy can be tried without Google: start the backend with `ADMIN_TEST=1` and build the
website with `NEXT_PUBLIC_ADMIN_TEST=1`; the page then signs in as a test admin. A hosted
server never accepts test admins.

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
in the ProMic repository, `functions/le.js`), and officers have no access to groups or chat.

The one thing an officer reads from ExiThreat's own API is the **common page** ("ExiThreat
Common Page" on the officer page, `components/CommonFeed.tsx`): every listed post with both its
original and its redacted version, by pseudonym. `GET /common/officer` takes the officer's
ProMic session token and asks ProMic's `leWhoAmI` whose it is (`services/officerAuth.ts`,
remembered for 5 minutes), so the session secret stays in ProMic.

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
`IV(12) || ciphertext || tag(16)` holding Opus audio (16 kHz mono, 20 ms packets, decoded with
`opus-decoder`). Talk-back sends the
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

### Signing up on your own computer

Without `GMAIL_USER`, the backend prints each email code to its console as
`[local code] email <id> <code>`. Mobile numbers go through Firebase even locally, so
"Send code" texts a real phone (and is billed); to avoid that, add a test number with a fixed
code in the Firebase console, or build the website with `NEXT_PUBLIC_PHONE_TEST=1` and start
the backend with `PHONE_TOKEN_TEST=1`: then any 6 digits confirm a number. A hosted server
refuses that shortcut.

### Configuration

Backend (`backend/.env`, not in git):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs sign-in tokens. Required: the server does not start without it, and when hosted it refuses the example value or one under 32 characters |
| `FRONTEND_ORIGIN` | The website's addresses, comma-separated, for CORS |
| `PORT` | Defaults to 4000 |
| `TRUST_PROXY` | Set to `1` behind a hosting proxy so rate limits apply per visitor |
| `PROMIC_DATABASE_URL`, `PROMIC_STORAGE_BUCKET` | ProMic's Firebase project (optional) |
| `PROMIC_SERVICE_ACCOUNT_PATH` or `PROMIC_SERVICE_ACCOUNT_JSON` | ProMic service-account key: ProMic backups, and checking mobile confirmations. Never commit it |
| `GROUP_MIN_MEMBERS`, `GROUP_MAX_MEMBERS` | Group sizes (optional; 5 and 25). Defaults only: an admin can change them on the admin page |
| `PROMIC_LE_URL` | ProMic's law-enforcement endpoints, for checking officers on the common page. Has a built-in default |
| `CONTACT_HASH_SECRET` | Key for the email and mobile fingerprints, at least 32 characters. **Never change or lose it**: every stored fingerprint would stop matching. Without it a hosted server takes no sign-ups |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Gmail account and app password that send the email codes |
| `REGISTER_LIMIT_PER_DAY`, `CODE_SENDS_PER_HOUR`, `LOGIN_ATTEMPTS` | Accounts per network address a day, codes asked for per address an hour, wrong passwords per 15 minutes (optional; 20, 20 and 10) |

Frontend (`frontend/.env.local`, or build arguments):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | The API's address. Compiled into the pages at build time |
| `NEXT_PUBLIC_PROMIC_LE_URL` | ProMic's law-enforcement endpoints. Has a built-in default |
| `NEXT_PUBLIC_PHONE_TEST` | `1` only for local test builds: mobile numbers are confirmed without an SMS. Never set it for the hosted site |
| `NEXT_PUBLIC_ADMIN_TEST` | `1` only for local test builds: the admin page signs in as a test admin (with `ADMIN_TEST=1` on a local backend) |

### Commands

| Where | Command |
|---|---|
| `backend` | `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`, `npm test`, `npm run test:api`, `npm run db:migrate`, `npm run db:deploy`, `npm run db:generate`, `npm run db:studio` |
| `frontend` | `npm run dev`, `npm run build`, `npm start`, `npm run lint` |

### Tests

| Command (in `backend`) | What it checks |
|---|---|
| `npm test` | Unit tests, no database needed: redaction, the strip's line wrapping and rows, weight, size checks, how email addresses and mobile numbers are normalised |
| `npm run test:api` | Starts the real server on an empty, throwaway PostgreSQL schema and walks through sign-up with codes, one account per email and mobile, sign-in, reset, older accounts, reading rules, the first look, voting and moving, and account limits. Needs `DATABASE_URL`; it builds the schema from the migrations and removes it afterwards |

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
| `exithreat-api` | API (`backend/fly.toml`). Kept running: the hourly push sweep and the live pages need it awake |
| `exithreat-db` | Fly Postgres, attached to `exithreat-api` as `DATABASE_URL` |

```bash
cd backend  && fly deploy --ha=false     # first: the website may need the new API
cd frontend && fly deploy --ha=false
```

Secrets on `exithreat-api` (`fly secrets set`): `JWT_SECRET`, `CONTACT_HASH_SECRET`,
`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `PROMIC_SERVICE_ACCOUNT_JSON`. All five are set. The Gmail
pair is the same as ProMic's Firebase secrets of those names. Without the Gmail keys the
hosted server sends no email codes (sign-up answers "not set up yet"). Fly never shows a
secret's value, so `CONTACT_HASH_SECRET` cannot be read back: never unset or replace it.
The backend image applies any new migrations each time it starts, then starts the API.
`GET /api/health` also asks the database, so Fly's check fails if the API cannot reach it.

## Maps

The officer map uses **Leaflet** with **OpenStreetMap** tiles, so no API key is needed.
District and state names come from OpenStreetMap's Nominatim, looked up by ProMic's backend.
These public servers are meant for light use.

## Security notes

- Members never get the unredacted text of a post as text; it is rendered to an image on the
  server and served once per member. This slows copying down; it cannot stop a screenshot. The
  text is not encrypted in the database. Officers do get it as text, for posts listed on the
  common page.
- The admin (ProMic's `admin/` entry, one account) sees original posts and which account wrote
  each one, and can suspend, hide and delete. Changing `admin/` in the Firebase console moves
  that access to another account within a minute. Every change they make is in the admin log, which admins cannot edit.
- Reading is limited to a group's members, and membership is assigned at random
  (`backend/src/services/groupService.ts`). One person can have more accounts only with more
  email addresses and mobile numbers of their own; extra email addresses are easy to get,
  extra SIM cards less so.
- The email address passes through Gmail, and the mobile number through Google's Firebase,
  to deliver the codes; both keep their own logs. ExiThreat itself keeps only fingerprints;
  with `CONTACT_HASH_SECRET`, anyone holding the database could still check whether a
  particular address or number has an account.
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

- The group weight and the member weightage decide how many groups a push reaches and which
  group must be among them; they change nothing else (vote threshold, credibility weight,
  what a member may do). A member's weightage is shown only to them. Group weights are as of
  the last hourly recalculation, except the pushing group's, which is recalculated at the push.
- There is no admin role in ExiThreat, and no way to leave or change group.
- An account's email or mobile cannot be changed. Its owner can delete it (Account page, or
  `/delete-account`), which removes everything it wrote.
- Only Indian mobile numbers are accepted.
- Sending from Gmail and confirming with Firebase were tested only up to the providers:
  locally, codes were printed and numbers confirmed with test tokens. The hosted site has them
  set up, but no real sign-up has been made there yet.
- Until two groups have 5 members each, nobody can post; with three groups it takes at least
  15 accounts before a post can also move on.
- Redaction is pattern-based, for English text with Indian and US formats. It misses names in
  lower case, a single name with nothing around it to mark it as one, and other languages. It
  redacts place names along with personal names. Posts made before a rule was added keep the
  redaction they got at the time.
- A post cannot be edited or deleted, and there is no moderation, reporting or terms
  of use on the site yet. The privacy policy is at `/privacy` (it covers the Android app too).
- The author is not notified when a post moves or gets a comment; "Mine" shows the current
  counts.
- The officer page's lists, badges and filters have been checked in a browser against
  ProMic's backend. Live listening and talk-back have been checked against ProMic's formats
  but not yet clicked through end to end with a real stream.
- The whole ExiThreat flow (sign-up, groups, posting, first look, voting) is covered by the
  tests on a local copy; on the hosted site it has not been tried with real accounts.

## Related project

**ProMic** (https://github.com/senkumram777-cpu/ProMic): the Android safety app, its Firebase
backend, the admin panel where officers are created, and the live-audio relay. `CLAUDE.md` in
each repository records what one side depends on in the other.
