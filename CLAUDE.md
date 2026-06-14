# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server (frontend)
npm run build     # Production build to dist/
npm run preview   # Serve the production build locally
npm run lint      # ESLint over the whole repo

# Cloud Functions (run from functions/)
cd functions
npm run serve     # Firebase emulator, functions only
npm run deploy    # firebase deploy --only functions (wrapper; see Deploy below)
npm run logs      # tail Cloud Functions logs
```

There is no test suite. Project is `bridge-898a6`, region `europe-west1`. Production origin is `https://mybridgeapp.vercel.app` — this exact URL is hardcoded as the CORS allowlist on every callable function, so a new deployment domain requires editing `functions/index.js`.

### Deploy

**ALWAYS run `npx vite build` and confirm it succeeds before deploying anything.** Build errors (e.g. `await` inside a non-`async` function) have repeatedly broken deploys. Never deploy on an unverified build.

- **Frontend** → Vercel, which auto-deploys from GitHub. Deploy with the custom `git deploy` alias, or manually: `git add` / `git commit` / `git push`. The `git deploy` alias is the actual workflow used — the `npm run build`/`preview` scripts are for local verification, not deployment.
- **Cloud Functions** → `firebase deploy --only functions` (or the `npm run deploy` wrapper in `functions/`).
- **Firestore rules** → `firebase deploy --only firestore:rules`.

When a **new** callable function is deployed for the first time, it must be manually set to **"Allow public access"** in the Firebase Console (the function's Cloud Run / security settings). Until that's done it returns CORS errors to the client even though the code and CORS allowlist are correct.

## Architecture

"H" (Bridge) is a React 19 + Vite SPA backed entirely by Firebase (Auth, Firestore, Cloud Functions). Users post short **statements**, "click" (agree with) others' statements, and the backend matches users by shared agreements so they can chat. There is no backend server beyond Cloud Functions.

### Two entry points, no router
`src/main.jsx` switches on `window.location.pathname`: `/admin` renders `AdminPage.jsx`, everything else renders `App.jsx`. There is no routing library — `App.jsx` is a single stateful component that swaps between screens (`feed` / `matches` / `messages` / `chat`) via the `screen` state variable, not URLs.

### State lives in App.jsx + hooks
`App.jsx` owns top-level state (current user, nickname, clicked set, active screen, modals, notifications) and composes a set of hooks in `src/hooks/`, each wrapping one Firestore concern:
- `useStatements` — real-time feed (latest 20, `onSnapshot`), client-side filters out reported (≥3 reports) and >30-day-old statements.
- `useMatches` — calls the `getMatches` callable on demand (not real-time); sets a "new match" dot when count grows.
- `useChat` — real-time list of the user's conversations from `user_chats/{uid}/chats`.
- `useActiveChat` — the currently open conversation: messages stream, sending, and "in common" panel state.

Pattern to preserve: hooks return both state and setters, and `App.jsx` passes setters down so child components and callbacks can do optimistic updates locally before/without a server round-trip.

### Reads are client-direct; writes that touch shared/derived data go through Functions
Direct Firestore reads (via `onSnapshot`) power the feed, chat list, and messages. But any write that must stay consistent across users or maintain a derived index is a callable Cloud Function (`src/firebase.js` → `getFunctions(app, "europe-west1")`):
- `toggleClick` — atomically updates `users.clicked`, `statements.clicks`, and the inverted index `statement_users/{stmtId}.users` in a transaction.
- `getMatches` — reads `users.clicked`, fans out over `statement_users` (the inverted index) to find who shares statements, then loads profiles and common-statement texts. Chunks all `in` queries by 30. Optionally distance-ranks via `useLocation`.
- `resetMap` — clears one user's clicks and decrements every affected counter/index entry in batches.
- `sendMessage` / `markChatRead` — write the message plus update the denormalized `user_chats` summaries (last message, unread flag, common count) for both participants.
- `searchStatements` — substring search over the top 1000 statements by clicks.
- `cleanupOldStatements` — scheduled (daily 03:00 Europe/Moscow), deletes statements >30 days old and their index entries.

### Firestore data model
- `users/{uid}` — `nickname`, `clicked: [statementId]`, optional `location`, `blocked`.
- `statements/{id}` — `text`, `author`, `authorId`, `clicks`, `reports`, `ts`.
- `statement_users/{statementId}` — `{ users: [uid] }`, the inverted index that makes matching scale; **must be kept in sync** with `users.clicked` whenever clicks change (that's why clicks go through `toggleClick`, never direct writes).
- `chats/{chatId}/messages/{id}` and `chats/{chatId}/meta/common` — `chatId` is the two uids sorted and joined with `_`.
- `user_chats/{uid}/chats/{chatId}` — per-user denormalized conversation summary.

`firestore.rules` enforces this: clicks/reports are the only fields a non-author may update on a statement, chat access is gated by parsing `chatId.split('_')` for membership, and the admin UID `ezPSAlWRjZbqGGTIzWK2LRqLgR12` has elevated delete rights (also hardcoded as `ADMIN_UID` in `AdminPage.jsx`).

### "In common" / common-ground feature
When a chat opens, `useActiveChat` loads `chats/{chatId}/meta/common`, merges in any newly-shared statements from the match data, and persists the union back. This is a cached snapshot that grows over time and can be reset by either user — it is intentionally not recomputed live on every message.

## Conventions & gotchas
- Code comments and `console.log`s are largely in Russian; keep that style if editing existing files.
- Firebase web config in `src/firebase.js` is committed (public client config — expected for Firebase web apps; access control is via Firestore rules, not config secrecy).
- The region `"europe-west1"` is repeated across `firebase.js`, every hook that calls a function, and `functions/index.js` — keep them aligned.
- Styling is a mix of one global `App.css` and heavy inline-style objects; there is no CSS framework.
- Firestore `in` queries are limited to 30 values — existing Function code already chunks by 30; preserve that when adding new fan-out reads.
