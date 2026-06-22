// init-h-account.js
// Part A — creates the system author account "H" as a normal Firestore users/{uid} doc.
//
// H authors all generated/curated statements but NEVER clicks anything, so it stays
// out of matching (matching is click-based, via statement_users / clicked arrays).
//
// Run:  node init-h-account.js
// Auth: place a service-account key at scripts/serviceAccountKey.json — see README.md.
// (serviceAccountKey.json is gitignored and must NEVER be committed.)

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

const H_UID = "system_H"; // fixed, documented UID for the system author

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  const ref = db.collection("users").doc(H_UID);
  const snap = await ref.get();

  if (snap.exists) {
    console.log(`System account H already exists → users/${H_UID}`);
    console.log(snap.data());
    process.exit(0);
  }

  await ref.set({
    nickname: "H",
    clicked: [],            // never clicks → never appears in anyone's matches
    blocked: false,
    onboardingDone: true,
    system: true,           // harmless metadata flag marking this as a system account
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Created system account H → users/${H_UID}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
