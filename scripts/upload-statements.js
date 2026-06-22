// upload-statements.js
// Part B — bulk-loads statements from a text file into Firestore, authored by "H".
//
// Mirrors the EXACT schema written by the createStatement Cloud Function
// (functions/index.js), with two intentional differences for system content:
//   - clicks: 0   (createStatement uses 1 because the author auto-clicks; H never clicks)
//   - a new `language` field (metadata only — see note below)
// We deliberately do NOT write a statement_users entry, so H is never added to any
// click index and therefore never appears in matching.
//
// Usage:
//   node upload-statements.js <file> <language> [--skip-dupes]
//
// Examples:
//   node upload-statements.js statements.txt en
//   node upload-statements.js spanish.txt es --skip-dupes
//
// File format: plain text, ONE statement per line. Empty lines are ignored.
// Auth: place a service-account key at scripts/serviceAccountKey.json — see README.md.
// (serviceAccountKey.json is gitignored and must NEVER be committed.)

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const fs = require("fs");
const path = require("path");

const H_UID = "system_H";
const MAX_LEN = 200;      // app limit — statements longer than this are skipped
const BATCH_LIMIT = 500;  // Firestore hard cap of 500 writes per batch

// ── args ──────────────────────────────────────────────────────────────────────
const file = process.argv[2];
const language = process.argv[3];
const skipDupes = process.argv.includes("--skip-dupes");

if (!file || !language) {
  console.error("Usage: node upload-statements.js <file> <language> [--skip-dupes]");
  console.error('  e.g. node upload-statements.js statements.txt en');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Make sure the H author account exists before we attribute statements to it.
async function ensureHAccount() {
  const ref = db.collection("users").doc(H_UID);
  const snap = await ref.get();
  if (snap.exists) {
    console.log(`System account H present → users/${H_UID}`);
    return;
  }
  await ref.set({
    nickname: "H",
    clicked: [],
    blocked: false,
    onboardingDone: true,
    system: true,
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Created system account H → users/${H_UID}`);
}

async function main() {
  await ensureHAccount();

  // Read + normalise lines.
  const raw = fs.readFileSync(path.resolve(file), "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Length filter: skip (don't truncate) anything over the 200-char app limit, and report it.
  const valid = [];
  const tooLong = [];
  for (const line of lines) {
    if (line.length > MAX_LEN) tooLong.push(line);
    else valid.push(line);
  }
  if (tooLong.length) {
    console.warn(`\n  ${tooLong.length} line(s) exceed ${MAX_LEN} chars and were SKIPPED:`);
    tooLong.forEach((l) => console.warn(`   (${l.length} chars) ${l.slice(0, 90)}${l.length > 90 ? "…" : ""}`));
    console.warn("");
  }

  let toUpload = valid;

  // Optional idempotency: skip texts already in the collection (and dupes within the file).
  // Off by default because it reads every existing statement (cost grows with collection size).
  if (skipDupes) {
    const existing = new Set();
    const snap = await db.collection("statements").select("text").get();
    snap.forEach((d) => existing.add(d.data().text));

    const beforeDb = toUpload.length;
    toUpload = toUpload.filter((t) => !existing.has(t));

    const seen = new Set();
    toUpload = toUpload.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));

    console.log(`Skip-dupes ON: ${beforeDb - toUpload.length} already present / duplicated, ${toUpload.length} new.`);
  }

  if (toUpload.length === 0) {
    console.log("Nothing to upload.");
    return;
  }

  // Batched writes, chunked at the 500-op Firestore limit.
  let uploaded = 0;
  for (let i = 0; i < toUpload.length; i += BATCH_LIMIT) {
    const chunk = toUpload.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const text of chunk) {
      const ref = db.collection("statements").doc(); // auto-id, like createStatement
      batch.set(ref, {
        text,
        author: "H",
        authorId: H_UID,
        clicks: 0,
        reports: 0,
        ts: admin.firestore.FieldValue.serverTimestamp(),
        language, // metadata only — does NOT affect the feed or anything currently
      });
    }
    await batch.commit();
    uploaded += chunk.length;
    console.log(`  committed: ${uploaded}/${toUpload.length}`);
  }

  console.log(`\nUploaded ${uploaded} statements in language "${language}".`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
