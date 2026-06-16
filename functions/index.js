const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { initializeApp } = require("firebase-admin/app");

initializeApp();
setGlobalOptions({ maxInstances: 10, region: "europe-west1" });

const db = getFirestore();

// ─── MATCHING (инвертированный индекс) ───────────────────────────────────────
// Использует statement_users для быстрого матчинга при любом количестве юзеров
exports.getMatches = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found");

  const myClickedRaw = userSnap.data().clicked || [];
  console.log("uid:", uid, "myClickedRaw.length:", myClickedRaw.length);
  if (myClickedRaw.length === 0) return { matches: [] };

  const myLocation = userSnap.data().location || null;
  const useLocation = request.data?.useLocation || false;

  // Возраст: взаимный фильтр (исключает, а не сортирует — в отличие от локации)
  const myAge = userSnap.data().age;
  const myAgeMin = userSnap.data().ageMin;
  const myAgeMax = userSnap.data().ageMax;
  const useAge = request.data?.useAge || false;
  const ageFilterActive = useAge
    && Number.isFinite(myAge) && Number.isFinite(myAgeMin) && Number.isFinite(myAgeMax);

  // Фильтруем существующие утверждения чанками по 30
  const existingIds = new Set();
  for (let i = 0; i < myClickedRaw.length; i += 30) {
    const chunk = myClickedRaw.slice(i, i + 30);
    const snap = await db.collection("statements").where("__name__", "in", chunk).get();
    snap.docs.forEach(d => existingIds.add(d.id));
  }
  const myClicked = myClickedRaw.filter(id => existingIds.has(id));
  console.log("existingIds.size:", existingIds.size, "myClicked.length:", myClicked.length);
  if (myClicked.length === 0) return { matches: [] };

  // Используем инвертированный индекс — для каждого утверждения смотрим кто его выбрал
  const userScores = {}; // uid -> { common: [], distKm }

  for (const stmtId of myClicked) {
    const suSnap = await db.collection("statement_users").doc(stmtId).get();
    console.log("stmtId:", stmtId, "exists:", suSnap.exists, suSnap.exists ? "users:" + JSON.stringify(suSnap.data().users) : "");
    if (!suSnap.exists) continue;
    const users = suSnap.data().users || [];
    for (const otherUid of users) {
      if (otherUid === uid) continue;
      if (!userScores[otherUid]) userScores[otherUid] = { commonIds: [] };
      userScores[otherUid].commonIds.push(stmtId);
    }
  }

  console.log("userScores keys:", Object.keys(userScores));
  if (Object.keys(userScores).length === 0) return { matches: [] };

  // Загружаем профили найденных пользователей чанками по 30
  const matchUids = Object.keys(userScores);
  const userProfiles = {};
  for (let i = 0; i < matchUids.length; i += 30) {
    const chunk = matchUids.slice(i, i + 30);
    const snap = await db.collection("users").where("__name__", "in", chunk).get();
    snap.docs.forEach(d => { userProfiles[d.id] = { id: d.id, ...d.data() }; });
  }

  // Формируем матчи
  const matches = [];
  for (const [otherUid, score] of Object.entries(userScores)) {
    const u = userProfiles[otherUid];
    if (!u || u.blocked === true) continue;

    // Возрастной фильтр как взаимный шлюз видимости:
    // юзеры с фильтром ON и юзеры с фильтром OFF никогда не видят друг друга.
    // "Фильтр ON" = useAge true И валидные age/ageMin/ageMax (иначе считается OFF).
    const candFilterOn = u.useAge === true
      && Number.isFinite(u.age) && Number.isFinite(u.ageMin) && Number.isFinite(u.ageMax);
    if (ageFilterActive) {
      // Звонящий в пуле ON: только другие ON, прошедшие взаимную проверку диапазонов
      if (!candFilterOn) continue;
      const theyFitMe = myAgeMin <= u.age && u.age <= myAgeMax;
      const iFitThem = u.ageMin <= myAge && myAge <= u.ageMax;
      if (!theyFitMe || !iFitThem) continue;
    } else {
      // Звонящий в пуле OFF: только другие OFF
      if (candFilterOn) continue;
    }

    let distKm = null;
    if (useLocation && myLocation && u.location) {
      distKm = getDistanceKm(myLocation.lat, myLocation.lng, u.location.lat, u.location.lng);
    }

    matches.push({
      id: otherUid,
      nickname: u.nickname,
      location: u.location || null,
      age: u.age ?? null,
      common: score.commonIds.length,
      commonIds: score.commonIds,
      distKm,
    });
  }

  // Загружаем тексты общих утверждений
  const allCommonIds = [...new Set(matches.flatMap(m => m.commonIds))];
  const commonStmts = {};
  for (let i = 0; i < allCommonIds.length; i += 30) {
    const chunk = allCommonIds.slice(i, i + 30);
    const snap = await db.collection("statements").where("__name__", "in", chunk).get();
    snap.docs.forEach(d => {
      commonStmts[d.id] = { id: d.id, text: d.data().text, author: d.data().author, clicks: d.data().clicks || 0 };
    });
  }
  matches.forEach(m => {
    m.commonStatements = m.commonIds.map(id => commonStmts[id]).filter(Boolean);
    // Вес общего утверждения тем выше, чем оно реже (меньше кликов).
    // weight = 1 / log2(clicks + 2): clicks=1 → ~0.63, 10 → ~0.29, 1000 → ~0.10, 50000 → ~0.064
    m.score = m.commonStatements.reduce((sum, s) => sum + 1 / Math.log2((s.clicks || 0) + 2), 0);
  });

  // Сортируем по взвешенному score (редкие общие утверждения весят больше).
  // Локация — мягкий бонус к ранжированию, не жёсткий фильтр: ~1e-4/км
  // (расстояние подвигает ближних вверх, но не перебивает редкость совпадений).
  const DIST_FACTOR = 0.0001;
  const rankOf = (m) =>
    (useLocation && m.distKm !== null) ? m.score - m.distKm * DIST_FACTOR : m.score;
  matches.sort((a, b) => rankOf(b) - rankOf(a));

  // Ограничиваем размер ответа топ-100 (без пагинации — счётчик "in common" остаётся точным)
  return { matches: matches.slice(0, 100) };
});

// ─── TOGGLE CLICK ─────────────────────────────────────────────────────────────
// Обновляет users.clicked, statements.clicks и statement_users
exports.toggleClick = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const callerSnap = await db.collection("users").doc(uid).get();
  if (callerSnap.exists && callerSnap.data().blocked === true) {
    throw new HttpsError("permission-denied", "Account suspended");
  }

  const { statementId, action } = request.data;
  if (!statementId || !["add", "remove"].includes(action)) {
    throw new HttpsError("invalid-argument", "Invalid arguments");
  }

  const userRef = db.collection("users").doc(uid);
  const stmtRef = db.collection("statements").doc(statementId);
  const suRef = db.collection("statement_users").doc(statementId);

  await db.runTransaction(async (t) => {
    const stmtSnap = await t.get(stmtRef);
    if (!stmtSnap.exists) throw new HttpsError("not-found", "Statement not found");

    const currentClicks = stmtSnap.data().clicks || 0;
    const newClicks = Math.max(0, currentClicks + (action === "add" ? 1 : -1));

    t.update(stmtRef, { clicks: newClicks });
    t.update(userRef, {
      clicked: action === "add" ? FieldValue.arrayUnion(statementId) : FieldValue.arrayRemove(statementId)
    });
    t.set(suRef, {
      users: action === "add" ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid)
    }, { merge: true });
  });

  return { success: true };
});

// ─── CREATE STATEMENT (rate-limited: 8/min + 150/day UTC) ──────────────────────
// Двухуровневый лимит: в минуту (анти-бот) + в сутки (защита от медленного спама)
const STATEMENT_PER_MINUTE_LIMIT = 8;
const DAILY_STATEMENT_LIMIT = 150;
const MESSAGE_PER_MINUTE_LIMIT = 20;
const DAILY_MESSAGE_LIMIT = 300;
exports.createStatement = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const { text } = request.data;
  if (typeof text !== "string" || text.trim().length === 0 || text.trim().length > 500) {
    throw new HttpsError("invalid-argument", "Invalid statement");
  }
  const cleanText = text.trim();
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

  const userRef = db.collection("users").doc(uid);
  const stmtRef = db.collection("statements").doc();          // pre-generate id
  const suRef = db.collection("statement_users").doc(stmtRef.id);

  await db.runTransaction(async (t) => {
    const userSnap = await t.get(userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "User not found");
    const userData = userSnap.data();
    if (userData.blocked === true) throw new HttpsError("permission-denied", "Account suspended");

    const nowMs = Date.now();
    const sameDay = userData.statementsDate === today;
    const count = sameDay ? (userData.statementsCount || 0) : 0;

    // Лимит в минуту: оставляем только метки за последние 60 секунд
    const recentTs = (userData.statementsRecentTs || []).filter(t => t > nowMs - 60000);
    if (recentTs.length >= STATEMENT_PER_MINUTE_LIMIT) {
      throw new HttpsError("resource-exhausted", "Slow down — you can post up to 8 statements per minute.");
    }
    // Суточный лимит (UTC)
    if (count >= DAILY_STATEMENT_LIMIT) {
      throw new HttpsError("resource-exhausted", "Daily limit reached (150 statements per day).");
    }

    t.set(stmtRef, {
      text: cleanText,
      author: userData.nickname,   // read server-side, not trusted from client
      authorId: uid,
      clicks: 1,
      reports: 0,
      ts: FieldValue.serverTimestamp(),
    });
    t.set(suRef, { users: FieldValue.arrayUnion(uid) }, { merge: true });
    t.update(userRef, {
      clicked: FieldValue.arrayUnion(stmtRef.id),
      statementsRecentTs: [...recentTs, nowMs],
      statementsCount: count + 1,
      statementsDate: today,
    });
  });

  return { id: stmtRef.id };
});

// ─── CLEANUP OLD STATEMENTS ──────────────────────────────────────────────────
exports.cleanupOldStatements = onSchedule({
  schedule: "0 3 * * *",
  region: "europe-west1",
  timeZone: "Europe/Moscow",
}, async () => {
  const MONTH = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - MONTH);

  const snap = await db.collection("statements").where("ts", "<", cutoff).limit(500).get();
  if (snap.empty) { console.log("No old statements to delete"); return; }

  const batch = db.batch();
  snap.docs.forEach(doc => {
    batch.delete(doc.ref);
    // Удаляем и из инвертированного индекса
    batch.delete(db.collection("statement_users").doc(doc.id));
  });
  await batch.commit();
  console.log(`Deleted ${snap.size} old statements`);
});

// ─── RESET MAP ────────────────────────────────────────────────────────────────
exports.resetMap = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found");

  const allClicked = userSnap.data().clicked || [];
  if (allClicked.length === 0) return { success: true };

  // 1. Главное: очищаем clicked отдельным коммитом ДО декрементов,
  //    чтобы отсутствие statements/statement_users не откатило эту запись.
  await userRef.update({ clicked: [] });

  // 2. Чистим инвертированный индекс — батчами set+merge (не падает на отсутствующих
  //    документах). Декремент счётчиков statements вынесен в отдельные точечные
  //    update'ы, чтобы один удалённый документ (статья истекла по 30-дневному сроку)
  //    не откатил остальные — и не утянул за собой очистку индекса в том же батче.
  const commits = [];
  let batch = db.batch();
  let count = 0;
  const flush = () => {
    commits.push(batch.commit().catch((e) => console.error("resetMap index batch error:", e)));
    batch = db.batch();
    count = 0;
  };

  // Точечный декремент счётчика каждой статьи; NOT_FOUND по удалённой статье
  // глотаем индивидуально, чтобы не сорвать остальные.
  const decrements = [];

  for (const id of allClicked) {
    // Инвертированный индекс — батчами (set+merge безопасен на отсутствующем документе)
    batch.set(db.collection("statement_users").doc(id), { users: FieldValue.arrayRemove(uid) }, { merge: true });
    count += 1;
    if (count >= 490) flush();

    // Счётчик clicks — отдельным write'ом с собственным catch
    decrements.push(
      db.collection("statements").doc(id).update({ clicks: FieldValue.increment(-1) })
        .catch((e) => {
          if (e.code === 5) return; // 5 = NOT_FOUND: статья удалена по сроку — пропускаем
          console.error("resetMap decrement error:", id, e);
        })
    );
  }
  if (count > 0) flush();

  await Promise.allSettled([...commits, ...decrements]);

  return { success: true };
});

// ─── SEARCH STATEMENTS ────────────────────────────────────────────────────────
exports.searchStatements = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const { query: searchQuery, limit: searchLimit = 50 } = request.data;
  if (!searchQuery || searchQuery.trim().length < 2) return { results: [] };

  const lower = searchQuery.toLowerCase().trim();
  const REPORT_THRESHOLD = 3;

  const snap = await db.collection("statements").orderBy("clicks", "desc").limit(1000).get();

  const results = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.text?.toLowerCase().includes(lower))
    .filter(s => (s.reports || 0) < REPORT_THRESHOLD)
    .slice(0, searchLimit)
    .map(s => ({ id: s.id, text: s.text, author: s.author, clicks: s.clicks || 0, authorId: s.authorId }));

  return { results };
});


// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
// Отправляет сообщение и обновляет user_chats у обоих участников
exports.sendMessage = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const callerSnap = await db.collection("users").doc(uid).get();
  const callerData = callerSnap.exists ? callerSnap.data() : {};
  if (callerData.blocked === true) {
    throw new HttpsError("permission-denied", "Account suspended");
  }

  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const nowMs = Date.now();
  const sameDay = callerData.messagesDate === today;
  const msgCount = sameDay ? (callerData.messagesCount || 0) : 0;

  // Лимит в минуту: оставляем только метки за последние 60 секунд
  const recentTs = (callerData.messagesRecentTs || []).filter(t => t > nowMs - 60000);
  if (recentTs.length >= MESSAGE_PER_MINUTE_LIMIT) {
    throw new HttpsError("resource-exhausted", "Slow down — too many messages per minute.");
  }
  // Суточный лимит (UTC)
  if (msgCount >= DAILY_MESSAGE_LIMIT) {
    throw new HttpsError("resource-exhausted", "Daily message limit reached (300 per day).");
  }

  const { toUid, text, fromNick, toNick, common } = request.data;
  if (!toUid || !text?.trim()) throw new HttpsError("invalid-argument", "Invalid arguments");

  const chatId = [uid, toUid].sort().join("_");
  const now = FieldValue.serverTimestamp();
  const msgData = { from: uid, fromNick, text: text.trim(), ts: now };

  // Добавляем сообщение
  const msgRef = await db.collection("chats").doc(chatId).collection("messages").add(msgData);

  // Обновляем user_chats у обоих участников атомарно
  const batch = db.batch();

  const myChatsRef = db.collection("user_chats").doc(uid).collection("chats").doc(chatId);
  batch.set(myChatsRef, {
    withUid: toUid,
    withNick: toNick,
    lastMsg: text.trim(),
    lastFrom: uid,
    lastTs: now,
    unread: false,
    common: common || 0,
  }, { merge: true });

  const theirChatsRef = db.collection("user_chats").doc(toUid).collection("chats").doc(chatId);
  batch.set(theirChatsRef, {
    withUid: uid,
    withNick: fromNick,
    lastMsg: text.trim(),
    lastFrom: uid,
    lastTs: now,
    unread: true,
    common: common || 0,
  }, { merge: true });

  batch.update(db.collection("users").doc(uid), {
    messagesRecentTs: [...recentTs, nowMs],
    messagesCount: msgCount + 1,
    messagesDate: today,
  });

  await batch.commit();

  return { success: true, msgId: msgRef.id };
});

// ─── MARK CHAT READ ───────────────────────────────────────────────────────────
exports.markChatRead = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const { chatId } = request.data;
  if (!chatId) throw new HttpsError("invalid-argument", "Invalid arguments");

  await db.collection("user_chats").doc(uid).collection("chats").doc(chatId).update({ unread: false });
  return { success: true };
});

// ─── SET USER BLOCKED (admin only) ─────────────────────────────────────────────
exports.setUserBlocked = onCall({ region: "europe-west1", cors: ["https://mybridgeapp.vercel.app"] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Not logged in");

  const ADMIN_UID = "ezPSAlWRjZbqGGTIzWK2LRqLgR12";
  if (uid !== ADMIN_UID) throw new HttpsError("permission-denied", "Admins only");

  const { targetUid, blocked } = request.data;
  if (!targetUid || typeof blocked !== "boolean") {
    throw new HttpsError("invalid-argument", "Invalid arguments");
  }

  await db.collection("users").doc(targetUid).update({ blocked });
  return { success: true };
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
