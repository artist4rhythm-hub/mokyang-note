/* ──────────────────────────────────────────────
   목양노트 — 2단계: 영혼 카드 · 기록 · 후속조치
   (1단계 계정 · 조직 · 초대 포함)
   ────────────────────────────────────────────── */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBxdl2JT2qRGZPPYdOz0BRNIjE-Z4g-Ftk",
  authDomain: "mokyang-note.firebaseapp.com",
  projectId: "mokyang-note",
  storageBucket: "mokyang-note.firebasestorage.app",
  messagingSenderId: "783816661858",
  appId: "1:783816661858:web:c96ad79f965eabd6ca2a3b"
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* ── 공통 ── */
const $ = (id) => document.getElementById(id);
const SCREENS = ["s-loading","s-login","s-verify","s-setup","s-accept","s-pending",
                 "s-home","s-souls","s-soul","s-edit","s-manage"];
const show = (id) => SCREENS.forEach(s => $(s).hidden = (s !== id));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2800);
}

const ROLE   = { super:"수퍼 관리자", jinjang:"진장", coach:"코치", leader:"셀리더" };
const STATUS = { new:"새가족", settling:"정착 중", growing:"성장", cand:"리더 후보", care:"돌봄 필요" };
const SCOPE  = { private:"나만 보기", leader:"담당 리더", coach:"코치 공유" };
const RTYPE  = { meet:"만남", pray:"기도", heart:"받은 마음" };

function msgOf(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "이메일이나 비밀번호가 맞지 않아요.";
  if (c.includes("email-already-in-use")) return "이미 가입된 이메일이에요. 로그인해 주세요.";
  if (c.includes("weak-password")) return "비밀번호는 6자 이상으로 해주세요.";
  if (c.includes("invalid-email")) return "이메일 형식을 확인해 주세요.";
  if (c.includes("too-many-requests")) return "잠시 후 다시 시도해 주세요.";
  if (c.includes("permission-denied")) return "권한이 없어요. 보안 규칙을 다시 확인해 주세요.";
  if (c.includes("popup-closed")) return "로그인 창이 닫혔어요.";
  return (e && e.message) ? e.message : "문제가 생겼어요. 다시 시도해 주세요.";
}

/* ── 날짜 ── */
const pad2 = (n) => String(n).padStart(2, "0");
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function fmtDate(s) {
  if (!s) return "";
  const p = String(s).split("-");
  return p.length >= 3 ? `${Number(p[1])}월 ${Number(p[2])}일` : s;
}
function daysSince(s) {
  if (!s) return null;
  const a = new Date(s + "T00:00:00"), b = new Date(todayStr() + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
function daysUntil(s) {
  const n = daysSince(s);
  return n === null ? null : -n;
}
/* 올해 기준으로 다음 기념일까지 며칠 */
function annivIn(dateStr) {
  if (!dateStr) return null;
  const p = String(dateStr).split("-");
  if (p.length < 3) return null;
  const now = new Date(todayStr() + "T00:00:00");
  let d = new Date(now.getFullYear(), Number(p[1]) - 1, Number(p[2]));
  if (d < now) d = new Date(now.getFullYear() + 1, Number(p[1]) - 1, Number(p[2]));
  return Math.round((d - now) / 86400000);
}

/* ── 상태 ── */
const state = {
  user:null, me:null,
  jins:[], cells:[], members:[], invites:[],
  souls:[], soul:null, records:[], soulTab:"rec",
  prayIdx:0, filter:"all", photoCache:{}, editingId:null, editPhoto:undefined
};
const uid = () => auth.currentUser ? auth.currentUser.uid : null;
const isLeaderOf = (s) => s && s.leaderUid === uid();
const initial = (name) => (name || "?").trim().slice(-1);

/* ════════ 로그인 ════════ */
$("btn-google").onclick = async () => {
  $("login-err").textContent = "";
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, p); }
  catch (e) {
    if (String(e.code).includes("popup")) { await signInWithRedirect(auth, p); return; }
    $("login-err").textContent = msgOf(e);
  }
};
$("btn-email-login").onclick = async () => {
  $("login-err").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("in-email").value.trim(), $("in-pw").value); }
  catch (e) { $("login-err").textContent = msgOf(e); }
};
$("btn-signup").onclick = async () => {
  $("login-err").textContent = "";
  try {
    const c = await createUserWithEmailAndPassword(auth, $("in-email").value.trim(), $("in-pw").value);
    await sendEmailVerification(c.user);
  } catch (e) { $("login-err").textContent = msgOf(e); }
};
$("btn-reset").onclick = async () => {
  const email = $("in-email").value.trim();
  if (!email) { $("login-err").textContent = "이메일을 먼저 적어주세요."; return; }
  try { await sendPasswordResetEmail(auth, email); $("login-err").textContent = "";
    toast("비밀번호 재설정 메일을 보냈어요."); }
  catch (e) { $("login-err").textContent = msgOf(e); }
};
$("btn-resend").onclick = async () => {
  try { await sendEmailVerification(auth.currentUser); toast("인증 메일을 다시 보냈어요."); }
  catch (e) { $("verify-err").textContent = msgOf(e); }
};
$("btn-verified").onclick = async () => {
  await auth.currentUser.reload();
  if (auth.currentUser.emailVerified) route(auth.currentUser);
  else $("verify-err").textContent = "아직 확인되지 않았어요. 메일 속 링크를 눌렀는지 확인해 주세요.";
};
["btn-logout-1","btn-logout-2","btn-logout-3","btn-logout-4","btn-logout-5"]
  .forEach(id => $(id).onclick = () => signOut(auth));
$("btn-recheck").onclick = () => route(auth.currentUser);

/* 탭바 */
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  const t = b.dataset.tab;
  if (t === "home") openHome();
  else if (t === "souls") openSouls();
  else toast("다음 단계에서 열려요.");
});

/* ════════ 길 찾기 ════════ */
onAuthStateChanged(auth, (u) => route(u));
getRedirectResult(auth).catch(() => {});

async function route(user) {
  state.user = user;
  if (!user) { show("s-login"); return; }
  show("s-loading");

  if (!user.emailVerified) {
    $("verify-email").textContent = user.email || "";
    show("s-verify"); return;
  }
  try {
    const meSnap = await getDoc(doc(db, "users", user.uid));
    if (meSnap.exists()) { state.me = { id:user.uid, ...meSnap.data() }; await openHome(); return; }

    const email = (user.email || "").toLowerCase();
    const invSnap = await getDoc(doc(db, "invites", email));
    if (invSnap.exists() && invSnap.data().status === "pending") {
      state.invite = invSnap.data();
      const jinName = await nameOfJin(state.invite.jinId);
      $("accept-info").innerHTML =
        `${esc(jinName)}의 <b>${esc(ROLE[state.invite.role] || state.invite.role)}</b>로 초대받았어요.`;
      $("ac-name").value = state.invite.name || "";
      show("s-accept"); return;
    }
    const boot = await getDoc(doc(db, "system", "bootstrap"));
    if (!boot.exists()) { show("s-setup"); return; }

    $("pending-email").textContent = user.email || "";
    show("s-pending");
  } catch (e) {
    $("pending-email").textContent = user.email || "";
    show("s-pending"); toast(msgOf(e));
  }
}
async function nameOfJin(jinId) {
  if (!jinId) return "";
  try { const s = await getDoc(doc(db, "jins", jinId)); return s.exists() ? s.data().name : ""; }
  catch { return ""; }
}

/* ════════ 최초 설정 · 초대 수락 ════════ */
$("btn-setup").onclick = async () => {
  const church = $("st-church").value.trim(), myName = $("st-name").value.trim(),
        jinName = $("st-jin").value.trim();
  $("setup-err").textContent = "";
  if (!church || !myName || !jinName) { $("setup-err").textContent = "세 칸을 모두 채워주세요."; return; }
  const u = auth.currentUser;
  $("btn-setup").disabled = true;
  try {
    await setDoc(doc(db, "org", "main"), { name: church, createdAt: serverTimestamp() });
    await addDoc(collection(db, "jins"),
      { name: jinName, jinjangUid: null, active: true, createdAt: serverTimestamp() });
    await setDoc(doc(db, "users", u.uid), {
      name: myName, email: (u.email || "").toLowerCase(), role: "super",
      jinId: null, cellId: null, cellIds: [], active: true, createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "system", "bootstrap"), { at: serverTimestamp(), by: u.uid });
    toast("설정이 끝났어요."); route(u);
  } catch (e) { $("setup-err").textContent = msgOf(e); }
  finally { $("btn-setup").disabled = false; }
};

$("btn-accept").onclick = async () => {
  const name = $("ac-name").value.trim();
  $("accept-err").textContent = "";
  if (!name) { $("accept-err").textContent = "이름을 적어주세요."; return; }
  const u = auth.currentUser, email = (u.email || "").toLowerCase();
  $("btn-accept").disabled = true;
  try {
    await setDoc(doc(db, "users", u.uid), {
      name, email, role: state.invite.role, jinId: state.invite.jinId,
      cellId: state.invite.cellId || null, cellIds: [], active: true, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "invites", email),
      { status:"accepted", acceptedUid: u.uid, acceptedAt: serverTimestamp() });
    route(u);
  } catch (e) { $("accept-err").textContent = msgOf(e); }
  finally { $("btn-accept").disabled = false; }
};

/* ════════ 조직 데이터 ════════ */
async function loadOrg() {
  const me = state.me, isSuper = me.role === "super";
  const pack = (s) => s.docs.map(d => ({ id:d.id, ...d.data() }));
  const mine = (col) => isSuper ? getDocs(collection(db, col))
    : getDocs(query(collection(db, col), where("jinId", "==", me.jinId)));
  try {
    const [jins, cells, users, invites] = await Promise.all([
      getDocs(collection(db, "jins")), mine("cells"), mine("users"), mine("invites")
    ]);
    state.jins = pack(jins);
    state.cells = pack(cells);
    state.members = pack(users).sort((a,b) => (a.name||"").localeCompare(b.name||"", "ko"));
    state.invites = pack(invites);
  } catch (e) { toast(msgOf(e)); }
}

/* ════════ 영혼 읽기 ════════ */
async function loadSouls() {
  const me = state.me;
  const pack = (s) => s.docs.map(d => ({ id:d.id, ...d.data() }));
  const col = collection(db, "souls");
  try {
    if (me.role === "leader") {
      state.souls = pack(await getDocs(query(col, where("leaderUid", "==", me.id))));
    } else if (me.role === "coach") {
      const ids = me.cellIds || [];
      const res = await Promise.all(ids.map(cid => getDocs(query(col, where("cellId", "==", cid)))));
      const seen = {};
      state.souls = res.flatMap(pack).filter(s => seen[s.id] ? false : (seen[s.id] = true));
    } else if (me.role === "jinjang") {
      state.souls = pack(await getDocs(query(col, where("jinId", "==", me.jinId))));
    } else {
      state.souls = [];
    }
    state.souls = state.souls.filter(s => s.active !== false)
      .sort((a,b) => (a.name||"").localeCompare(b.name||"", "ko"));
  } catch (e) { state.souls = []; toast(msgOf(e)); }
}

async function loadRecords(soulId, canSeeAll) {
  const col = collection(db, "souls", soulId, "records");
  const pack = (s) => s.docs.map(d => ({ id:d.id, ...d.data() }));
  try {
    let rows = [];
    if (canSeeAll) {
      const [a,b,c] = await Promise.all([
        getDocs(query(col, where("by", "==", uid()))),
        getDocs(query(col, where("scope", "==", "leader"))),
        getDocs(query(col, where("scope", "==", "coach")))
      ]);
      rows = [...pack(a), ...pack(b), ...pack(c)];
    } else {
      rows = pack(await getDocs(query(col, where("scope", "==", "coach"))));
    }
    const seen = {};
    state.records = rows.filter(r => seen[r.id] ? false : (seen[r.id] = true))
      .sort((a,b) => String(b.date||"").localeCompare(String(a.date||"")));
  } catch (e) { state.records = []; toast(msgOf(e)); }
}

async function loadPhoto(soulId) {
  if (state.photoCache[soulId] !== undefined) return state.photoCache[soulId];
  try {
    const s = await getDoc(doc(db, "photos", soulId));
    state.photoCache[soulId] = s.exists() ? (s.data().self || null) : null;
  } catch { state.photoCache[soulId] = null; }
  return state.photoCache[soulId];
}

/* ════════ 홈 ════════ */
async function openHome() {
  const me = state.me;
  const now = new Date(), days = ["일","월","화","수","목","금","토"];
  $("home-date").textContent = `${now.getMonth()+1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;

  let title = "목양노트";
  try { const org = await getDoc(doc(db, "org", "main")); if (org.exists()) title = org.data().name; } catch {}
  $("home-title").textContent = title;
  $("home-role").textContent = ROLE[me.role] || me.role;

  await loadOrg();
  if (me.role !== "super") await loadSouls();

  const jin = state.jins.find(j => j.id === me.jinId);
  const cell = state.cells.find(c => c.id === me.cellId);
  const where1 = me.role === "super" ? "전체" : (cell ? cell.name : (jin ? jin.name : ""));
  $("home-where").textContent = where1;
  $("home-where").hidden = !where1;

  const pendingN = state.invites.filter(i => i.status === "pending").length;
  const todos = openTodos();
  const annivs = upcomingAnnivs();

  if (me.role === "super") {
    $("home-tiles").innerHTML = tile("구성원", state.members.length + "명")
      + tile("셀", state.cells.length + "개") + tile("대기 중 초대", pendingN + "건");
    $("home-pray").innerHTML = card("영혼 카드는 담당 리더만 열람해요",
      "수퍼 관리자는 사람과 진을 배치하고, 영혼 카드 내용은 보지 않아요. 설계한 그대로예요.");
    $("home-todo").innerHTML = ""; $("home-anniv").innerHTML = "";
  } else {
    $("home-tiles").innerHTML = tile("영혼", state.souls.length + "명")
      + tile("이번 주 기념일", annivs.length + "명") + tile("챙길 일", todos.length + "건");
    renderPray(); renderTodos(todos); renderAnnivs(annivs);
  }

  $("btn-manage").hidden = !(me.role === "super" || me.role === "jinjang");
  markTab("home");
  show("s-home");
}
const tile = (k,v) => `<div class="tile"><p class="k">${k}</p><p class="v">${v}</p></div>`;
const card = (h,b) => `<div class="card"><h3 class="serif" style="font-size:17px;font-weight:600">${h}</h3>
  <p class="muted" style="margin-top:8px">${b}</p></div>`;

function markTab(which) {
  document.querySelectorAll(".tab").forEach(b =>
    b.classList.toggle("on", b.dataset.tab === which));
}

function prayList() {
  return state.souls.filter(s => (s.prayOpen || 0) > 0 && isLeaderOf(s))
    .sort((a,b) => String(a.lastPrayedAt || "").localeCompare(String(b.lastPrayedAt || "")));
}
function renderPray() {
  const list = prayList();
  if (!list.length) {
    $("home-pray").innerHTML = card("기도제목을 적어보세요",
      "영혼 카드에서 기도제목을 추가하면, 여기에 오늘 기도할 영혼이 한 명씩 떠요.");
    return;
  }
  if (state.prayIdx >= list.length) state.prayIdx = 0;
  const s = list[state.prayIdx];
  const top = s.prayTop || {};
  $("home-pray").innerHTML = `
    <section class="card" style="border-radius:20px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;letter-spacing:.06em;color:var(--brand)">오늘 기도할 영혼</span>
        <span style="font-size:11px;color:var(--dim)">${state.prayIdx+1} / ${list.length}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
        <span class="ava">${esc(initial(s.name))}</span>
        <div style="min-width:0">
          <h2 class="serif" style="font-size:20px;font-weight:600">${esc(s.name)}</h2>
          <div style="display:flex;gap:6px;margin-top:6px">
            <span class="chip rose">${esc(STATUS[s.status] || "—")}</span>
            ${top.since ? `<span class="chip">${daysSince(top.since)+1}일째 기도</span>` : ""}
          </div>
        </div>
      </div>
      <p style="margin-top:14px;font-size:15px;line-height:1.75;color:#DCD6D5">${esc(top.text || "기도제목을 적어주세요.")}</p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" style="height:48px" data-pray="${s.id}">기도했어요</button>
        <button class="btn-ghost" style="width:48px;height:48px;flex-shrink:0;padding:0" data-next="1" aria-label="다음 영혼">›</button>
      </div>
    </section>`;
}
function openTodos() {
  const out = [];
  state.souls.filter(isLeaderOf).forEach(s =>
    (s.todos || []).filter(t => !t.done).forEach(t => out.push({ ...t, soulId:s.id, soulName:s.name })));
  return out.sort((a,b) => String(a.due||"9999").localeCompare(String(b.due||"9999")));
}
function renderTodos(todos) {
  if (!todos.length) { $("home-todo").innerHTML = ""; return; }
  $("home-todo").innerHTML = `
    <h3 class="sec-title">챙길 일</h3>
    <div class="list">${todos.slice(0,5).map(t => `
      <div class="row">
        <button class="icon-btn" style="width:34px;height:34px;color:#6E6260"
          data-done="${t.id}" data-soul="${t.soulId}" aria-label="완료">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/></svg>
        </button>
        <div class="grow">
          <p class="nm">${esc(t.soulName)} · ${esc(t.text)}</p>
          <p class="sub">${t.due ? (daysUntil(t.due) < 0 ? "지남 · " : "") + fmtDate(t.due) + "까지" : "날짜 없음"}</p>
        </div>
      </div>`).join("")}</div>`;
}
function upcomingAnnivs() {
  const out = [];
  state.souls.forEach(s => {
    [["birth","생일"],["baptizedAt","세례"],["marriedAt","결혼기념일"]].forEach(([f,label]) => {
      const d = annivIn(s[f]);
      if (d !== null && d <= 7) out.push({ name:s.name, label, d, date:s[f] });
    });
  });
  return out.sort((a,b) => a.d - b.d);
}
function renderAnnivs(list) {
  if (!list.length) { $("home-anniv").innerHTML = ""; return; }
  $("home-anniv").innerHTML = `
    <h3 class="sec-title">이번 주 기념일</h3>
    <div class="list">${list.map(a => `
      <div class="row">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F24557" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 20h15M6 20v-5.2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V20M12 12.2V9.6"/><circle cx="12" cy="7.6" r="1"/></svg>
        <div class="grow">
          <p class="nm">${esc(a.name)} ${a.label}</p>
          <p class="sub">${fmtDate(a.date)} · ${a.d === 0 ? "오늘" : "D-" + a.d}</p>
        </div>
      </div>`).join("")}</div>`;
}

$("s-home").addEventListener("click", async (ev) => {
  const next = ev.target.closest("[data-next]");
  if (next) { const n = prayList().length; state.prayIdx = (state.prayIdx + 1) % Math.max(n,1); renderPray(); return; }

  const pray = ev.target.closest("[data-pray]");
  if (pray) {
    try {
      await updateDoc(doc(db, "souls", pray.dataset.pray), { lastPrayedAt: todayStr() });
      const s = state.souls.find(x => x.id === pray.dataset.pray);
      if (s) s.lastPrayedAt = todayStr();
      toast("기도 기록을 남겼어요."); renderPray();
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const done = ev.target.closest("[data-done]");
  if (done) {
    const s = state.souls.find(x => x.id === done.dataset.soul);
    if (!s) return;
    const todos = (s.todos || []).map(t => t.id === done.dataset.done ? { ...t, done:true } : t);
    try {
      await updateDoc(doc(db, "souls", s.id), { todos });
      s.todos = todos; toast("완료 처리했어요.");
      const list = openTodos(); renderTodos(list);
      $("home-tiles").children[2].querySelector(".v").textContent = list.length + "건";
    } catch (e) { toast(msgOf(e)); }
  }
});
$("btn-manage").onclick = () => openManage();
$("btn-back").onclick = () => openHome();

/* ════════ 영혼 목록 ════════ */
async function openSouls() {
  if (state.me.role === "super") { toast("수퍼 관리자는 영혼 카드를 볼 수 없어요."); return; }
  show("s-loading");
  await loadSouls();
  renderFilter(); renderSouls();
  markTab("souls");
  $("btn-soul-new").hidden = state.me.role !== "leader";
  show("s-souls");
}
function renderFilter() {
  const f = [["all","전체"],["care","돌봄 필요"],["new","새가족"],["due","연락할 때"]];
  $("soul-filter").innerHTML = f.map(([k,label]) =>
    `<button data-f="${k}" class="${state.filter===k?"on":""}">${label}</button>`).join("");
}
$("soul-filter").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-f]"); if (!b) return;
  state.filter = b.dataset.f; renderFilter(); renderSouls();
});
$("soul-search").oninput = () => renderSouls();

function contactDue(s) {
  if (!s.contactCycle) return false;
  const n = daysSince(s.lastMetAt);
  return n === null || n >= s.contactCycle;
}
function renderSouls() {
  const kw = $("soul-search").value.trim();
  let list = state.souls;
  if (state.filter === "care") list = list.filter(s => s.status === "care");
  if (state.filter === "new") list = list.filter(s => s.status === "new");
  if (state.filter === "due") list = list.filter(contactDue);
  if (kw) list = list.filter(s => (s.name || "").includes(kw));

  $("list-souls").innerHTML = list.map(s => {
    const n = daysSince(s.lastMetAt);
    return `
    <div class="row" data-open="${s.id}" style="cursor:pointer">
      <span class="ava">${esc(initial(s.name))}</span>
      <div class="grow">
        <p class="nm">${esc(s.name)}</p>
        <p class="sub">${n === null ? "아직 만남 기록 없음" : `마지막 만남 ${n}일 전`}
          ${(s.prayOpen||0) > 0 ? ` · 기도 ${s.prayOpen}` : ""}</p>
      </div>
      <span class="chip ${s.status==="care"?"warn":"rose"}">${esc(STATUS[s.status] || "—")}</span>
    </div>`;
  }).join("") || `<p class="muted">${state.me.role === "coach" && !(state.me.cellIds||[]).length
    ? "담당 셀이 아직 지정되지 않았어요. 진장에게 요청해 주세요."
    : "아직 등록된 영혼이 없어요."}</p>`;
}
$("list-souls").addEventListener("click", (ev) => {
  const r = ev.target.closest("[data-open]"); if (!r) return;
  openSoul(r.dataset.open);
});
$("btn-soul-new").onclick = () => openEdit(null);

/* ════════ 영혼 카드 ════════ */
async function openSoul(soulId) {
  show("s-loading");
  const s = state.souls.find(x => x.id === soulId);
  if (!s) { toast("카드를 찾을 수 없어요."); openSouls(); return; }
  state.soul = s; state.soulTab = "rec";
  await loadRecords(soulId, isLeaderOf(s));
  const photo = await loadPhoto(soulId);

  $("soul-ava").textContent = photo ? "" : initial(s.name);
  $("soul-ava").style.backgroundImage = photo ? `url(${photo})` : "";
  $("soul-name").textContent = s.name;
  const cell = state.cells.find(c => c.id === s.cellId);
  $("soul-chips").innerHTML =
    `<span class="chip rose">${esc(STATUS[s.status] || "—")}</span>` +
    (cell ? `<span class="chip">${esc(cell.name)}</span>` : "");
  const n = daysSince(s.lastMetAt);
  $("soul-summary").textContent =
    `${n === null ? "만남 기록 없음" : `마지막 만남 ${n}일 전`} · 기도 ${s.prayOpen || 0}개 · 기록 ${state.records.length}`;
  $("soul-edit").hidden = !isLeaderOf(s);
  $("btn-rec-new").hidden = !isLeaderOf(s);
  renderSoulTabs(); renderSoulBody();
  show("s-soul");
}
$("soul-back").onclick = () => openSouls();
$("soul-edit").onclick = () => openEdit(state.soul.id);

function renderSoulTabs() {
  $("soul-tabs").querySelectorAll("[data-st]").forEach(b =>
    b.classList.toggle("on", b.dataset.st === state.soulTab));
}
$("soul-tabs").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-st]"); if (!b) return;
  state.soulTab = b.dataset.st; renderSoulTabs(); renderSoulBody();
});

function scopeChip(scope) {
  const cls = scope === "coach" ? "rose" : scope === "private" ? "lock" : "";
  return `<span class="chip ${cls}">${SCOPE[scope] || scope}</span>`;
}
function renderSoulBody() {
  const s = state.soul, mine = isLeaderOf(s);
  const box = $("soul-body");

  if (state.soulTab === "rec") {
    box.innerHTML = state.records.length ? `<div class="list">${state.records.map(r => `
      <article class="rec">
        <div class="head">
          <span style="font-size:12px;color:var(--dim)">${RTYPE[r.type] || r.type} · ${fmtDate(r.date)}${r.place ? " · " + esc(r.place) : ""}</span>
          ${scopeChip(r.scope)}
        </div>
        <p class="body${r.type === "heart" ? " serif" : ""}">${esc(r.body)}</p>
        <div class="foot">
          ${r.type === "pray" ? `<span class="chip ${r.prayStatus === "answered" ? "rose" : ""}">${r.prayStatus === "answered" ? "응답됨" : "기도 중 " + (daysSince(r.date)+1) + "일째"}</span>` : ""}
          ${r.type === "heart" ? `<span class="chip">${r.who === "soul" ? "이 친구가 받은 은혜" : "내가 받은 마음"}</span>` : ""}
          ${r.by === uid() ? `
            ${r.type === "pray" && r.prayStatus !== "answered" ? `<button class="btn-sm" data-answer="${r.id}">응답됐어요</button>` : ""}
            <button class="btn-sm danger" data-delrec="${r.id}">삭제</button>` : ""}
        </div>
      </article>`).join("")}</div>`
      : `<p class="muted">${mine ? "아직 기록이 없어요. 아래 '기록 추가'로 첫 기록을 남겨보세요."
          : "공유된 기록이 없어요. 담당 리더가 코치 공유로 올린 기록만 보여요."}</p>`;
  }

  if (state.soulTab === "todo") {
    const todos = (s.todos || []);
    box.innerHTML = `
      ${mine ? `<button class="btn-ghost" id="btn-todo-new" style="height:44px;font-size:13px;margin-bottom:12px">후속조치 추가</button>` : ""}
      <div class="list">${todos.length ? todos.map(t => `
        <div class="row ${t.done ? "off" : ""}">
          ${mine ? `<button class="icon-btn" style="width:34px;height:34px;color:${t.done ? "#F24557" : "#6E6260"}"
            data-tgl="${t.id}" aria-label="완료 전환">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/>${t.done ? '<path d="m8.5 12 2.5 2.5 4.5-5" stroke-linecap="round" stroke-linejoin="round"/>' : ""}</svg>
          </button>` : ""}
          <div class="grow">
            <p class="nm">${esc(t.text)}</p>
            <p class="sub">${t.due ? fmtDate(t.due) + "까지" : "날짜 없음"}${t.done ? " · 완료" : ""}</p>
          </div>
          ${mine ? `<button class="btn-sm danger" data-deltodo="${t.id}">삭제</button>` : ""}
        </div>`).join("") : `<p class="muted">후속조치가 없어요.</p>`}</div>`;
    const b = $("btn-todo-new"); if (b) b.onclick = () => openTodoDlg();
  }

  if (state.soulTab === "profile") {
    const rows = [
      ["생일", s.birth ? fmtDate(s.birth) + (s.lunar ? " (음력)" : "") : ""],
      ["연락처", s.phone], ["주소", s.address], ["직장 · 학교", s.job],
      ["교회 등록일", fmtDate(s.registeredAt)], ["세례일", fmtDate(s.baptizedAt)],
      ["결혼기념일", fmtDate(s.marriedAt)], ["직분", s.position],
      ["인도자", s.invitedBy], ["인생 말씀", s.verse],
      ["취미", s.hobby], ["MBTI", s.mbti], ["좋아하는 것", s.food],
      ["피해야 할 것", s.avoid], ["요즘 관심사", s.interest],
      ["연락 주기", s.contactCycle ? s.contactCycle + "일마다" : "알림 없음"],
      ["메모", s.memo]
    ].filter(([,v]) => v);
    box.innerHTML = rows.length ? `<div class="list">${rows.map(([k,v]) => `
      <div class="row"><div class="grow"><p class="sub" style="margin:0">${k}</p>
        <p class="nm" style="margin-top:4px;white-space:normal">${esc(v)}</p></div></div>`).join("")}</div>`
      : `<p class="muted">아직 적은 정보가 없어요.</p>`;
  }

  if (state.soulTab === "family") {
    const fam = s.family || [];
    box.innerHTML = `
      ${mine ? `<button class="btn-ghost" id="btn-fam-new" style="height:44px;font-size:13px;margin-bottom:12px">가족 추가</button>` : ""}
      <div class="list">${fam.length ? fam.map((f,i) => `
        <div class="row">
          <span class="ava">${esc(initial(f.name))}</span>
          <div class="grow">
            <p class="nm">${esc(f.relation)} · ${esc(f.name)}</p>
            <p class="sub">${[f.birth, f.faith === "y" ? "신앙 있음" : f.faith === "n" ? "아직 아님" : "", f.note]
              .filter(Boolean).map(esc).join(" · ")}</p>
          </div>
          ${mine ? `<button class="btn-sm danger" data-delfam="${i}">삭제</button>` : ""}
        </div>`).join("") : `<p class="muted">가족 정보가 없어요.</p>`}</div>`;
    const b = $("btn-fam-new"); if (b) b.onclick = () => $("dlg-family").showModal();
  }
}

/* 카드 안 동작 */
$("soul-body").addEventListener("click", async (ev) => {
  const s = state.soul;

  const del = ev.target.closest("[data-delrec]");
  if (del) {
    if (!confirm("이 기록을 지울까요? 되돌릴 수 없어요.")) return;
    try {
      await deleteDoc(doc(db, "souls", s.id, "records", del.dataset.delrec));
      await loadRecords(s.id, true); await syncPraySummary();
      renderSoulBody(); toast("지웠어요.");
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const ans = ev.target.closest("[data-answer]");
  if (ans) {
    try {
      await updateDoc(doc(db, "souls", s.id, "records", ans.dataset.answer), { prayStatus: "answered" });
      await loadRecords(s.id, true); await syncPraySummary();
      renderSoulBody(); toast("응답으로 표시했어요.");
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const tgl = ev.target.closest("[data-tgl]");
  if (tgl) {
    const todos = (s.todos || []).map(t => t.id === tgl.dataset.tgl ? { ...t, done: !t.done } : t);
    await saveSoulField({ todos }); renderSoulBody();
    return;
  }
  const dt = ev.target.closest("[data-deltodo]");
  if (dt) {
    const todos = (s.todos || []).filter(t => t.id !== dt.dataset.deltodo);
    await saveSoulField({ todos }); renderSoulBody();
    return;
  }
  const df = ev.target.closest("[data-delfam]");
  if (df) {
    const family = (s.family || []).filter((_, i) => i !== Number(df.dataset.delfam));
    await saveSoulField({ family }); renderSoulBody();
  }
});

async function saveSoulField(patch) {
  try {
    await updateDoc(doc(db, "souls", state.soul.id), patch);
    Object.assign(state.soul, patch);
    const inList = state.souls.find(x => x.id === state.soul.id);
    if (inList) Object.assign(inList, patch);
  } catch (e) { toast(msgOf(e)); }
}

/* 기도 요약 다시 계산 */
async function syncPraySummary() {
  const open = state.records.filter(r => r.type === "pray" && r.prayStatus !== "answered")
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const patch = {
    prayOpen: open.length,
    prayTop: open.length ? { text: open[0].body, since: open[0].date } : null
  };
  await saveSoulField(patch);
}

/* ════════ 기록 추가 ════════ */
const dlgRec = $("dlg-rec");
let recType = "meet";
$("btn-rec-new").onclick = () => {
  recType = "meet"; syncRecType();
  $("r-date").value = todayStr(); $("r-body").value = ""; $("r-place").value = "";
  $("r-scope").value = "leader"; $("rec-err").textContent = "";
  dlgRec.showModal();
};
dlgRec.querySelectorAll("[data-rt]").forEach(b => b.onclick = () => { recType = b.dataset.rt; syncRecType(); });
function syncRecType() {
  dlgRec.querySelectorAll("[data-rt]").forEach(b => b.classList.toggle("on", b.dataset.rt === recType));
  $("r-place-wrap").hidden = recType !== "meet";
  $("r-who-wrap").hidden = recType !== "heart";
  $("r-body-label").textContent =
    recType === "meet" ? "나눈 이야기 · 특이사항" : recType === "pray" ? "기도제목" : "받은 마음";
  $("r-scope").value = recType === "heart" ? "private" : "leader";
}
$("rec-cancel").onclick = () => dlgRec.close();
$("rec-save").onclick = async () => {
  const body = $("r-body").value.trim();
  $("rec-err").textContent = "";
  if (!body) { $("rec-err").textContent = "내용을 적어주세요."; return; }
  const s = state.soul;
  $("rec-save").disabled = true;
  try {
    const data = {
      type: recType, scope: $("r-scope").value, date: $("r-date").value || todayStr(),
      body, by: uid(), byName: state.me.name || "", createdAt: serverTimestamp()
    };
    if (recType === "meet") data.place = $("r-place").value.trim();
    if (recType === "heart") data.who = $("r-who").value;
    if (recType === "pray") data.prayStatus = "praying";

    await addDoc(collection(db, "souls", s.id, "records"), data);
    if (recType === "meet") await saveSoulField({ lastMetAt: data.date });
    await loadRecords(s.id, true);
    if (recType === "pray") await syncPraySummary();
    dlgRec.close(); state.soulTab = "rec"; renderSoulTabs(); renderSoulBody();
    const n = daysSince(s.lastMetAt);
    $("soul-summary").textContent =
      `${n === null ? "만남 기록 없음" : `마지막 만남 ${n}일 전`} · 기도 ${s.prayOpen || 0}개 · 기록 ${state.records.length}`;
    toast("기록했어요.");
  } catch (e) { $("rec-err").textContent = msgOf(e); }
  finally { $("rec-save").disabled = false; }
};

/* 후속조치 */
const dlgTodo = $("dlg-todo");
function openTodoDlg() {
  $("t-text").value = ""; $("t-due").value = todayStr(); $("todo-err").textContent = "";
  dlgTodo.showModal();
}
$("todo-cancel").onclick = () => dlgTodo.close();
$("todo-save").onclick = async () => {
  const text = $("t-text").value.trim();
  if (!text) { $("todo-err").textContent = "할 일을 적어주세요."; return; }
  const todos = [...(state.soul.todos || []),
    { id: "t" + Date.now(), text, due: $("t-due").value || "", done: false }];
  await saveSoulField({ todos });
  dlgTodo.close(); renderSoulBody(); toast("후속조치를 더했어요.");
};

/* 가족 */
$("fam-cancel").onclick = () => $("dlg-family").close();
$("fam-save").onclick = async () => {
  const relation = $("f-rel").value.trim(), name = $("f-name").value.trim();
  if (!relation || !name) { $("family-err").textContent = "관계와 이름을 적어주세요."; return; }
  const family = [...(state.soul.family || []),
    { relation, name, birth: $("f-birth").value.trim(), faith: $("f-faith").value, note: $("f-note").value.trim() }];
  await saveSoulField({ family });
  ["f-rel","f-name","f-birth","f-note"].forEach(i => $(i).value = "");
  $("family-err").textContent = "";
  $("dlg-family").close(); renderSoulBody(); toast("가족을 더했어요.");
};

/* ════════ 영혼 추가 · 수정 ════════ */
function openEdit(soulId) {
  state.editingId = soulId; state.editPhoto = undefined;
  const s = soulId ? state.souls.find(x => x.id === soulId) : null;
  $("edit-title").textContent = s ? "프로필 수정" : "영혼 추가";
  $("btn-del-soul").hidden = !s;

  $("e-status").innerHTML = Object.entries(STATUS)
    .map(([k,v]) => `<option value="${k}">${v}</option>`).join("");
  const myCells = state.cells.filter(c => c.jinId === state.me.jinId);
  $("e-cell").innerHTML = (myCells.length ? myCells : state.cells)
    .map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")
    || `<option value="">셀 없음</option>`;

  const v = (id, val) => $(id).value = val || "";
  v("e-name", s && s.name); v("e-gender", s && s.gender); v("e-birth", s && s.birth);
  $("e-lunar").checked = !!(s && s.lunar);
  v("e-phone", s && s.phone); v("e-address", s && s.address); v("e-job", s && s.job);
  v("e-reg", s && s.registeredAt); v("e-bap", s && s.baptizedAt); v("e-married", s && s.marriedAt);
  v("e-position", s && s.position); v("e-invitedby", s && s.invitedBy); v("e-verse", s && s.verse);
  v("e-hobby", s && s.hobby); v("e-mbti", s && s.mbti); v("e-food", s && s.food);
  v("e-avoid", s && s.avoid); v("e-interest", s && s.interest); v("e-memo", s && s.memo);
  $("e-status").value = (s && s.status) || "new";
  $("e-cycle").value = String((s && s.contactCycle) || 0);
  if (s && s.cellId) $("e-cell").value = s.cellId;
  else if (state.me.cellId) $("e-cell").value = state.me.cellId;

  const ph = s ? state.photoCache[s.id] : null;
  $("edit-ava").style.backgroundImage = ph ? `url(${ph})` : "";
  $("edit-ava").textContent = ph ? "" : ($("e-name").value ? initial($("e-name").value) : "+");
  $("edit-err").textContent = "";
  show("s-edit");
}
$("edit-back").onclick = () => state.editingId ? openSoul(state.editingId) : openSouls();

$("btn-photo").onclick = () => $("photo-input").click();
$("btn-photo-del").onclick = () => {
  state.editPhoto = null;
  $("edit-ava").style.backgroundImage = "";
  $("edit-ava").textContent = initial($("e-name").value || "?");
};
$("photo-input").onchange = (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 480, scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const data = cv.toDataURL("image/jpeg", 0.72);
      if (data.length > 700000) { toast("사진이 너무 커요. 다른 사진을 골라주세요."); return; }
      state.editPhoto = data;
      $("edit-ava").style.backgroundImage = `url(${data})`;
      $("edit-ava").textContent = "";
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  ev.target.value = "";
};

$("btn-save-soul").onclick = async () => {
  const name = $("e-name").value.trim();
  $("edit-err").textContent = "";
  if (!name) { $("edit-err").textContent = "이름은 꼭 적어주세요."; return; }
  if (state.me.role !== "leader") { $("edit-err").textContent = "영혼 카드는 담당 셀리더만 만들 수 있어요."; return; }

  const data = {
    name, gender: $("e-gender").value, birth: $("e-birth").value, lunar: $("e-lunar").checked,
    phone: $("e-phone").value.trim(), address: $("e-address").value.trim(), job: $("e-job").value.trim(),
    registeredAt: $("e-reg").value, baptizedAt: $("e-bap").value, marriedAt: $("e-married").value,
    position: $("e-position").value.trim(), invitedBy: $("e-invitedby").value.trim(),
    verse: $("e-verse").value.trim(), hobby: $("e-hobby").value.trim(), mbti: $("e-mbti").value.trim(),
    food: $("e-food").value.trim(), avoid: $("e-avoid").value.trim(),
    interest: $("e-interest").value.trim(), memo: $("e-memo").value.trim(),
    status: $("e-status").value, contactCycle: Number($("e-cycle").value) || 0,
    cellId: $("e-cell").value || null
  };

  $("btn-save-soul").disabled = true;
  try {
    let soulId = state.editingId;
    if (soulId) {
      await updateDoc(doc(db, "souls", soulId), data);
    } else {
      const ref = await addDoc(collection(db, "souls"), {
        ...data, jinId: state.me.jinId, leaderUid: state.me.id,
        family: [], todos: [], lastMetAt: null, lastPrayedAt: null,
        prayOpen: 0, prayTop: null, active: true,
        createdBy: state.me.id, createdAt: serverTimestamp()
      });
      soulId = ref.id;
    }
    if (state.editPhoto !== undefined) {
      await setDoc(doc(db, "photos", soulId), { self: state.editPhoto }, { merge: true });
      state.photoCache[soulId] = state.editPhoto;
    }
    await loadSouls();
    toast("저장했어요."); openSoul(soulId);
  } catch (e) { $("edit-err").textContent = msgOf(e); }
  finally { $("btn-save-soul").disabled = false; }
};

$("btn-del-soul").onclick = async () => {
  if (!confirm("이 카드를 목록에서 보관할까요? 기록은 지워지지 않아요.")) return;
  try {
    await updateDoc(doc(db, "souls", state.editingId), { active: false });
    await loadSouls(); toast("보관했어요."); openSouls();
  } catch (e) { toast(msgOf(e)); }
};

/* ════════ 리더 관리 ════════ */
async function openManage() {
  show("s-loading");
  await loadOrg();
  const isSuper = state.me.role === "super";
  const cellName = (id) => (state.cells.find(c => c.id === id) || {}).name || "";
  const jinName  = (id) => (state.jins.find(j => j.id === id) || {}).name || "";

  $("list-members").innerHTML = state.members.map(m => {
    const where1 = m.role === "leader" ? cellName(m.cellId)
      : m.role === "coach" ? `담당 셀 ${(m.cellIds || []).length}개` : jinName(m.jinId);
    const canEdit = m.id !== state.me.id && m.role !== "super" && (isSuper || state.me.role === "jinjang");
    const roleOptions = (isSuper ? ["jinjang","coach","leader"] : ["coach","leader"])
      .map(r => `<option value="${r}"${m.role === r ? " selected" : ""}>${ROLE[r]}</option>`).join("");
    return `
      <div class="row ${m.active ? "" : "off"}" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="grow">
            <p class="nm">${esc(m.name)} ${m.active ? "" : "· 중지됨"}</p>
            <p class="sub">${esc(m.email)}</p>
          </div>
          <span class="chip ${m.role === "super" ? "" : "rose"}">${ROLE[m.role] || m.role}</span>
        </div>
        ${where1 ? `<p class="sub" style="margin-top:6px">${esc(where1)}</p>` : ""}
        ${canEdit ? `
        <div class="acts">
          <select class="btn-sm" data-act="role" data-uid="${m.id}" style="width:auto;padding:0 10px">${roleOptions}</select>
          ${m.role === "coach" ? `<button class="btn-sm" data-act="cells" data-uid="${m.id}">담당 셀</button>` : ""}
          <button class="btn-sm" data-act="pwreset" data-email="${esc(m.email)}">비번 재설정 메일</button>
          <button class="btn-sm ${m.active ? "danger" : ""}" data-act="toggle" data-uid="${m.id}"
            data-on="${m.active}">${m.active ? "사용 중지" : "다시 사용"}</button>
        </div>` : ""}
      </div>`;
  }).join("") || `<p class="muted">아직 구성원이 없어요.</p>`;

  const pending = state.invites.filter(i => i.status === "pending");
  $("list-invites").innerHTML = pending.map(i => `
    <div class="row">
      <div class="grow"><p class="nm">${esc(i.name || i.email)}</p>
        <p class="sub">${esc(i.email)} · ${ROLE[i.role] || i.role}</p></div>
      <button class="btn-sm danger" data-act="cancel" data-email="${esc(i.email)}">취소</button>
    </div>`).join("") || `<p class="muted">대기 중인 초대가 없어요.</p>`;

  $("list-cells").innerHTML = state.cells.map(c => `
    <div class="row"><div class="grow"><p class="nm">${esc(c.name)}</p>
      <p class="sub">${esc(jinName(c.jinId))} · 리더 ${state.members.filter(m => m.cellId === c.id).length}명</p>
    </div></div>`).join("") || `<p class="muted">아직 셀이 없어요.</p>`;

  $("jin-block").hidden = !isSuper;
  if (isSuper) {
    $("list-jins").innerHTML = state.jins.map(j => {
      const head = state.members.filter(m => m.role === "jinjang" && m.jinId === j.id);
      return `<div class="row"><div class="grow"><p class="nm">${esc(j.name)}</p>
        <p class="sub">${head.length ? "진장 " + esc(head.map(h => h.name).join(", ")) : "진장 없음"}</p>
      </div></div>`;
    }).join("") || `<p class="muted">아직 진이 없어요.</p>`;
  }
  show("s-manage");
}

$("s-manage").addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act;

  if (act === "pwreset") {
    try { await sendPasswordResetEmail(auth, el.dataset.email);
      toast("재설정 메일을 보냈어요. 본인 메일함을 확인하라고 알려주세요."); }
    catch (e) { toast(msgOf(e)); }
  }
  if (act === "toggle") {
    const on = el.dataset.on === "true";
    if (!confirm(on ? "이 계정의 사용을 중지할까요?" : "다시 사용하게 할까요?")) return;
    try { await updateDoc(doc(db, "users", el.dataset.uid), { active: !on });
      await log(on ? "계정 중지" : "계정 복구", el.dataset.uid); openManage(); }
    catch (e) { toast(msgOf(e)); }
  }
  if (act === "cancel") {
    if (!confirm("이 초대를 취소할까요?")) return;
    try { await deleteDoc(doc(db, "invites", el.dataset.email));
      await log("초대 취소", el.dataset.email); openManage(); }
    catch (e) { toast(msgOf(e)); }
  }
  if (act === "cells") openCellsDlg(el.dataset.uid);
});

$("s-manage").addEventListener("change", async (ev) => {
  const el = ev.target.closest('[data-act="role"]'); if (!el) return;
  try {
    await updateDoc(doc(db, "users", el.dataset.uid), { role: el.value });
    await log("역할 변경", el.dataset.uid, el.value);
    toast("역할을 바꿨어요."); openManage();
  } catch (e) { toast(msgOf(e)); openManage(); }
});

/* 코치 담당 셀 */
const dlgCells = $("dlg-cells");
let cellsTargetUid = null;
function openCellsDlg(targetUid) {
  cellsTargetUid = targetUid;
  const m = state.members.find(x => x.id === targetUid) || {};
  const picked = m.cellIds || [];
  $("cells-check").innerHTML = state.cells.map(c => `
    <label class="row" style="cursor:pointer">
      <input type="checkbox" value="${c.id}" ${picked.includes(c.id) ? "checked" : ""}
        style="width:20px;height:20px;accent-color:var(--action)">
      <span class="grow nm">${esc(c.name)}</span>
    </label>`).join("") || `<p class="muted">셀을 먼저 만들어 주세요.</p>`;
  dlgCells.showModal();
}
$("cc-cancel").onclick = () => dlgCells.close();
$("cc-save").onclick = async () => {
  const ids = [...$("cells-check").querySelectorAll("input:checked")].map(i => i.value);
  try {
    await updateDoc(doc(db, "users", cellsTargetUid), { cellIds: ids });
    await log("담당 셀 지정", cellsTargetUid, ids.join(","));
    dlgCells.close(); toast("담당 셀을 저장했어요."); openManage();
  } catch (e) { toast(msgOf(e)); }
};

/* 셀 · 진 추가 */
$("btn-cell-add").onclick = async () => {
  const name = prompt("셀 이름을 적어주세요 (예: 다니엘 셀)");
  if (!name || !name.trim()) return;
  const jinId = state.me.role === "super" ? (state.jins[0] && state.jins[0].id) : state.me.jinId;
  if (!jinId) { toast("먼저 진을 만들어 주세요."); return; }
  try {
    await addDoc(collection(db, "cells"),
      { name: name.trim(), jinId, active: true, createdAt: serverTimestamp() });
    await log("셀 추가", name.trim()); openManage();
  } catch (e) { toast(msgOf(e)); }
};
$("btn-jin-add").onclick = async () => {
  const name = prompt("진 이름을 적어주세요 (예: 2진)");
  if (!name || !name.trim()) return;
  try {
    await addDoc(collection(db, "jins"),
      { name: name.trim(), jinjangUid: null, active: true, createdAt: serverTimestamp() });
    await log("진 추가", name.trim()); openManage();
  } catch (e) { toast(msgOf(e)); }
};

/* ════════ 초대 ════════ */
const dlg = $("dlg-invite");
$("btn-invite-open").onclick = () => {
  const isSuper = state.me.role === "super";
  $("iv-name").value = ""; $("iv-email").value = ""; $("invite-err").textContent = "";
  $("iv-role").innerHTML = (isSuper ? ["jinjang","coach","leader"] : ["coach","leader"])
    .map(r => `<option value="${r}">${ROLE[r]}</option>`).join("");
  $("iv-jin-wrap").hidden = !isSuper;
  $("iv-jin").innerHTML = state.jins.map(j => `<option value="${j.id}">${esc(j.name)}</option>`).join("");
  fillCells(); $("iv-role").onchange = syncRole; $("iv-jin").onchange = fillCells;
  syncRole(); dlg.showModal();
};
function fillCells() {
  const jinId = state.me.role === "super" ? $("iv-jin").value : state.me.jinId;
  const list = state.cells.filter(c => c.jinId === jinId);
  $("iv-cell").innerHTML = list.length
    ? list.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")
    : `<option value="">셀 없음 (나중에 지정)</option>`;
}
function syncRole() { $("iv-cell-wrap").hidden = $("iv-role").value !== "leader"; }
$("iv-cancel").onclick = () => dlg.close();
$("iv-send").onclick = async () => {
  const name = $("iv-name").value.trim(), email = $("iv-email").value.trim().toLowerCase();
  const role = $("iv-role").value;
  const jinId = state.me.role === "super" ? $("iv-jin").value : state.me.jinId;
  const cellId = role === "leader" ? ($("iv-cell").value || null) : null;
  $("invite-err").textContent = "";
  if (!name || !email) { $("invite-err").textContent = "이름과 이메일을 적어주세요."; return; }
  if (!email.includes("@")) { $("invite-err").textContent = "이메일 형식을 확인해 주세요."; return; }
  if (!jinId) { $("invite-err").textContent = "먼저 진을 만들어 주세요."; return; }
  $("iv-send").disabled = true;
  try {
    const exist = await getDoc(doc(db, "invites", email));
    if (exist.exists() && exist.data().status === "accepted") {
      $("invite-err").textContent = "이미 가입한 사람이에요."; return;
    }
    await setDoc(doc(db, "invites", email), {
      email, name, role, jinId, cellId, status: "pending",
      invitedBy: state.me.id, invitedAt: serverTimestamp()
    });
    await log("초대", email, role);
    dlg.close(); toast("초대했어요. 그분이 같은 이메일로 로그인하면 바로 들어와요."); openManage();
  } catch (e) { $("invite-err").textContent = msgOf(e); }
  finally { $("iv-send").disabled = false; }
};

/* ════════ 기록 로그 ════════ */
async function log(action, target, detail) {
  try {
    await addDoc(collection(db, "audit"), {
      by: uid(), byName: state.me ? state.me.name : "",
      action, target: target || "", detail: detail || "", at: serverTimestamp()
    });
  } catch {}
}
