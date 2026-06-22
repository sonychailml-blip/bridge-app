# Bridge admin scripts

Standalone Node scripts (Firebase Admin SDK) for seeding the app. They run from the
command line, **bypass Firestore security rules** (Admin SDK has full access), and are
NOT part of the deployed Cloud Functions.

Project: `bridge-898a6` · System author UID: **`system_H`**

## 1. Get a service-account key (no gcloud needed)

1. Firebase Console → **Project settings** → **Service accounts** → **Generate new private key**.
2. Save the downloaded JSON as exactly **`scripts/serviceAccountKey.json`**.

> ⚠️ This file has **full admin access** to the database. It is listed in
> `scripts/.gitignore`, so it will **never be committed** to git. Keep it private and
> do not share it.

## 2. Install

```bash
cd scripts
npm install
```

The scripts load the key directly:
```js
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
```
No `gcloud` and no environment variables required.

## 3. Part A — create the H system account (one time)

```bash
node init-h-account.js
```
Creates `users/system_H` with: `nickname:"H"`, `clicked:[]`, `blocked:false`,
`onboardingDone:true`, `system:true`, `ts`. Safe to re-run (no-op if it exists).
`upload-statements.js` also ensures H exists, so this step is optional.

## 4. Part B — bulk upload statements

```bash
node upload-statements.js <file> <language> [--skip-dupes]

# examples
node upload-statements.js statements.txt en
node upload-statements.js spanish.txt es --skip-dupes
```

- File = plain text, **one statement per line**, empty lines ignored.
- `<language>` tags each doc (`en`/`es`/`fr`/`de`/`ru`/…) — **metadata only**, no behaviour.
- Lines over **200 chars are skipped** and listed (not truncated).
- `--skip-dupes` (optional) skips texts already in the collection + dupes within the file.
  It reads every existing statement, so cost grows with the collection — leave it off for
  large loads unless you specifically need it. Without it, re-running creates duplicates.

Each statement is written as:
```js
{ text, author: "H", authorId: "system_H", clicks: 0, reports: 0, ts: <serverTimestamp>, language }
```
which matches `createStatement` exactly, except `clicks` is `0` (not `1`) and there is no
`statement_users` click-index entry — both on purpose, so H never enters matching.
