/* ──────────────────────────────────────────────
   목양노트
   1단계 계정 · 조직 · 초대
   2단계 영혼 카드 · 기록 · 후속조치
   3단계 셀모임 출석 · 훈련 이력 · 겸직
   4단계 입력 편의 · 앱 설치(PWA) · 백업
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

const APP_VERSION = "4.0 (2026-10-03)";

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

/* 앱 설치용 서비스 워커 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ── 공통 ── */
const $ = (id) => document.getElementById(id);
const SCREENS = ["s-loading","s-login","s-verify","s-setup","s-accept","s-pending",
                 "s-home","s-souls","s-meet","s-meeting","s-soul","s-edit","s-more","s-manage"];
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
const TSTAT  = { planned:"수강 예정", ongoing:"수강 중", done:"수료", dropped:"중도 포기" };
const ATT    = { present:"출석", online:"온라인", absent:"결석" };
const PLACES  = ["카페","식사","전화","카톡","심방","셀모임 후","교회에서"];
const RELS    = ["배우자","아버지","어머니","아들","딸","형제","자매"];

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
  if (c.includes("unavailable") || c.includes("network")) return "인터넷 연결을 확인해 주세요.";
  return (e && e.message) ? e.message : "문제가 생겼어요. 다시 시도해 주세요.";
}

/* ── 날짜 ── */
const pad2 = (n) => String(n).padStart(2, "0");
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
/* "3-5", "3/5", "1985.3.5", "2024-03" 전부 받아줌. 연도 모르면 0000 */
function parseDateLoose(raw) {
  if (!raw) return "";
  const t = String(raw).trim().replace(/[.\/년월]/g, "-").replace(/일/g, "").replace(/\s+/g, "");
  const nums = t.split("-").filter(Boolean).map(Number);
  if (!nums.length || nums.some(n => isNaN(n))) return null;
  if (nums.length === 1) {
    const y = nums[0];
    return (y >= 1900 && y <= 2100) ? `${y}-00-00` : null;
  }
  if (nums.length === 2) {
    if (nums[0] >= 1900) return `${nums[0]}-${pad2(nums[1])}-00`;
    if (nums[0] >= 1 && nums[0] <= 12 && nums[1] >= 1 && nums[1] <= 31)
      return `0000-${pad2(nums[0])}-${pad2(nums[1])}`;
    return null;
  }
  let [y, m, d] = nums;
  if (y < 100) y += (y > 30 ? 1900 : 2000);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function fmtDate(s, withYear) {
  if (!s) return "";
  const p = String(s).split("-");
  if (p.length < 3) return s;
  const [y, m, d] = p;
  if (m === "00") return `${y}년`;
  if (d === "00") return y === "0000" ? `${Number(m)}월` : `${y}년 ${Number(m)}월`;
  const md = `${Number(m)}월 ${Number(d)}일`;
  return (withYear && y !== "0000") ? `${y}년 ${md}` : md;
}
function daysSince(s) {
  if (!s || String(s).includes("-00")) return null;
  const a = new Date(s + "T00:00:00"), b = new Date(todayStr() + "T00:00:00");
  if (isNaN(a)) return null;
  return Math.round((b - a) / 86400000);
}
function daysUntil(s) { const n = daysSince(s); return n === null ? null : -n; }
function annivIn(dateStr) {
  if (!dateStr) return null;
  const p = String(dateStr).split("-");
  if (p.length < 3 || p[1] === "00" || p[2] === "00") return null;
  const now = new Date(todayStr() + "T00:00:00");
  let d = new Date(now.getFullYear(), Number(p[1]) - 1, Number(p[2]));
  if (d < now) d = new Date(now.getFullYear() + 1, Number(p[1]) - 1, Number(p[2]));
  return Math.round((d - now) / 86400000);
}
/* 연락처 자동 하이픈 */
function fmtPhone(v) {
  const n = String(v || "").replace(/\D/g, "").slice(0, 11);
  if (!n) return "";
  if (n.startsWith("02")) {
    if (n.length <= 2) return n;
    if (n.length <= 5) return `${n.slice(0,2)}-${n.slice(2)}`;
    if (n.length <= 9) return `${n.slice(0,2)}-${n.slice(2,5)}-${n.slice(5)}`;
    return `${n.slice(0,2)}-${n.slice(2,6)}-${n.slice(6,10)}`;
  }
  if (n.length <= 3) return n;
  if (n.length <= 7) return `${n.slice(0,3)}-${n.slice(3)}`;
  if (n.length <= 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
  return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`;
}

/* ── 상태 ── */
const state = {
  user:null, me:null,
  jins:[], cells:[], members:[], invites:[], courses:[],
  souls:[], meetings:[], trainings:[],
  soul:null, records:[], soulTab:"rec", meeting:null,
  prayIdx:0, filter:"all", photoCache:{}, editingId:null, editPhoto:undefined,
  editDirty:false, lastTab:"home"
};
const uid = () => auth.currentUser ? auth.currentUser.uid : null;
const isLeaderOf = (s) => s && s.leaderUid === uid();
const canLead = () => state.me && (state.me.role === "leader" || state.me.isLeader === true);
const initial = (name) => (name || "?").trim().slice(-1);

/* ── 입력 편의: textarea 자동 높이 ── */
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 400) + "px";
}
document.addEventListener("input", (ev) => {
  if (ev.target.tagName === "TEXTAREA") autoGrow(ev.target);
});
/* 키보드가 입력칸을 가리지 않게 */
document.addEventListener("focusin", (ev) => {
  const t = ev.target;
  if (!t.matches || !t.matches("input,textarea,select")) return;
  setTimeout(() => { try { t.scrollIntoView({ block:"center", behavior:"smooth" }); } catch {} }, 250);
});

/* ── 탭바 ── */
const ICON = {
  home:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4.2l8 6.3V19a1.5 1.5 0 0 1-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/></svg>`,
  souls:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="8.5" r="3"/><path d="M4 19.5v-1a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v1M16.5 6.2a3 3 0 0 1 0 4.6M17.5 14.7a4 4 0 0 1 2.5 3.7v1.1"/></svg>`,
  cal:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10.5h17M8.5 3.5v4M15.5 3.5v4"/></svg>`,
  meet:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="m8 12.5 2.6 2.6L16.5 9.5"/></svg>`,
  more:`<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`
};
function renderTabbars() {
  const items = [["home","홈"],["souls","영혼들"],["cal","캘린더"],["meet","셀모임"],["more","더보기"]];
  document.querySelectorAll("[data-nav]").forEach(nav => {
    nav.innerHTML = items.map(([k,label]) =>
      `<button data-tab="${k}" class="${nav.dataset.nav === k ? "on" : ""}">${ICON[k]}${label}</button>`).join("");
  });
}
renderTabbars();
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-tab]"); if (!b) return;
  const t = b.dataset.tab;
  if (t === "home") openHome();
  else if (t === "souls") openSouls();
  else if (t === "meet") openMeet();
  else if (t === "more") openMore();
  else toast("캘린더는 다음 단계에서 열려요.");
});

/* ════════ 로그인 ════════ */
$("btn-google").onclick = async () => {
  $("login-err").textContent = "";
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt:"select_account" });
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
  try { await sendPasswordResetEmail(auth, email); toast("비밀번호 재설정 메일을 보냈어요."); }
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

/* ════════ 길 찾기 ════════ */
onAuthStateChanged(auth, (u) => route(u));
getRedirectResult(auth).catch(() => {});

async function route(user) {
  state.user = user;
  if (!user) { show("s-login"); return; }
  show("s-loading");
  if (!user.emailVerified) {
    $("verify-email").textContent = user.email || ""; show("s-verify"); return;
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
    $("pending-email").textContent = user.email || ""; show("s-pending");
  } catch (e) {
    $("pending-email").textContent = user.email || ""; show("s-pending"); toast(msgOf(e));
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
  const u = auth.currentUser; $("btn-setup").disabled = true;
  try {
    await setDoc(doc(db, "org", "main"), { name: church, createdAt: serverTimestamp() });
    await addDoc(collection(db, "jins"),
      { name: jinName, jinjangUid: null, active: true, createdAt: serverTimestamp() });
    await setDoc(doc(db, "users", u.uid), {
      name: myName, email: (u.email || "").toLowerCase(), role: "super",
      jinId: null, cellId: null, cellIds: [], isLeader: false,
      active: true, createdAt: serverTimestamp()
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
      cellId: state.invite.cellId || null, cellIds: [], isLeader: false,
      active: true, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "invites", email),
      { status:"accepted", acceptedUid:u.uid, acceptedAt: serverTimestamp() });
    route(u);
  } catch (e) { $("accept-err").textContent = msgOf(e); }
  finally { $("btn-accept").disabled = false; }
};

/* ════════ 데이터 읽기 ════════ */
const pack = (s) => s.docs.map(d => ({ id:d.id, ...d.data() }));

async function loadOrg() {
  const me = state.me, isSuper = me.role === "super";
  const mine = (col) => isSuper ? getDocs(collection(db, col))
    : getDocs(query(collection(db, col), where("jinId", "==", me.jinId)));
  try {
    const [jins, cells, users, invites, courses] = await Promise.all([
      getDocs(collection(db, "jins")), mine("cells"), mine("users"), mine("invites"),
      getDocs(collection(db, "courses"))
    ]);
    state.jins = pack(jins);
    state.cells = pack(cells);
    state.members = pack(users).sort((a,b) => (a.name||"").localeCompare(b.name||"", "ko"));
    state.invites = pack(invites);
    state.courses = pack(courses).sort((a,b) => (a.order||0) - (b.order||0));
  } catch (e) { toast(msgOf(e)); }
}
async function loadSouls() {
  const me = state.me, col = collection(db, "souls");
  const out = []; const seen = {};
  const push = (rows) => rows.forEach(r => { if (!seen[r.id]) { seen[r.id] = true; out.push(r); } });
  try {
    if (canLead()) push(pack(await getDocs(query(col, where("leaderUid", "==", me.id)))));
    if (me.role === "coach") {
      const res = await Promise.all((me.cellIds || [])
        .map(cid => getDocs(query(col, where("cellId", "==", cid)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "jinjang") push(pack(await getDocs(query(col, where("jinId", "==", me.jinId)))));
    state.souls = out.filter(s => s.active !== false)
      .sort((a,b) => (a.name||"").localeCompare(b.name||"", "ko"));
  } catch (e) { state.souls = []; toast(msgOf(e)); }
}
async function loadMeetings() {
  const me = state.me, col = collection(db, "meetings");
  const out = []; const seen = {};
  const push = (rows) => rows.forEach(r => { if (!seen[r.id]) { seen[r.id] = true; out.push(r); } });
  try {
    if (canLead()) push(pack(await getDocs(query(col, where("leaderUid", "==", me.id)))));
    if (me.role === "coach") {
      const res = await Promise.all((me.cellIds || [])
        .map(cid => getDocs(query(col, where("cellId", "==", cid)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "jinjang") push(pack(await getDocs(query(col, where("jinId", "==", me.jinId)))));
    state.meetings = out.sort((a,b) => String(b.date||"").localeCompare(String(a.date||"")));
  } catch (e) { state.meetings = []; toast(msgOf(e)); }
}
async function loadRecords(soulId, canSeeAll) {
  const col = collection(db, "souls", soulId, "records");
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
async function loadTrainings(soulId) {
  try {
    state.trainings = pack(await getDocs(collection(db, "souls", soulId, "trainings")))
      .sort((a,b) => String(a.startDate||"").localeCompare(String(b.startDate||"")));
  } catch { state.trainings = []; }
}
async function loadPhoto(soulId) {
  if (state.photoCache[soulId] !== undefined) return state.photoCache[soulId];
  try {
    const s = await getDoc(doc(db, "photos", soulId));
    state.photoCache[soulId] = s.exists() ? (s.data().self || null) : null;
  } catch { state.photoCache[soulId] = null; }
  return state.photoCache[soulId];
}

/* ── 출석 계산 ── */
const cellMeetings = (cellId) => state.meetings.filter(m => m.cellId === cellId);
function attendRate(soulId, cellId) {
  const ms = cellMeetings(cellId).filter(m => m.attendance && m.attendance[soulId]);
  if (!ms.length) return null;
  const ok = ms.filter(m => m.attendance[soulId] !== "absent").length;
  return Math.round(ok / ms.length * 100);
}
function absentStreak(soulId, cellId) {
  let n = 0;
  for (const m of cellMeetings(cellId)) {
    const v = m.attendance && m.attendance[soulId];
    if (!v) continue;
    if (v === "absent") n++; else break;
  }
  return n;
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
  const sees = canLead() || me.role === "coach" || me.role === "jinjang";
  if (sees) { await loadSouls(); await loadMeetings(); } else { state.souls = []; state.meetings = []; }

  const jin = state.jins.find(j => j.id === me.jinId);
  const cell = state.cells.find(c => c.id === me.cellId);
  const where1 = (me.role === "super" && !me.isLeader) ? "전체" : (cell ? cell.name : (jin ? jin.name : ""));
  $("home-where").textContent = where1;
  $("home-where").hidden = !where1;

  const pendingN = state.invites.filter(i => i.status === "pending").length;
  const todos = openTodos();
  const annivs = upcomingAnnivs();
  const absentees = state.souls.filter(s => isLeaderOf(s) && absentStreak(s.id, s.cellId) >= 2);

  $("btn-quick-add").hidden = !canLead();

  if (canLead()) {
    $("home-tiles").innerHTML = tile("영혼", state.souls.filter(isLeaderOf).length + "명")
      + tile("이번 주 기념일", annivs.length + "명") + tile("챙길 일", todos.length + "건");
    renderAbsent(absentees); renderPray(); renderTodos(todos); renderAnnivs(annivs);
  } else if (me.role === "coach" || me.role === "jinjang") {
    $("home-tiles").innerHTML = tile("영혼", state.souls.length + "명")
      + tile("셀", state.cells.length + "개") + tile("구성원", state.members.length + "명");
    $("home-absent").innerHTML = "";
    $("home-pray").innerHTML = card("맡겨진 셀을 살펴보세요",
      "영혼들 탭에서 카드를, 셀모임 탭에서 출석을 볼 수 있어요. 기록은 '코치 공유'로 올라온 것만 보여요.");
    $("home-todo").innerHTML = ""; $("home-anniv").innerHTML = "";
  } else {
    $("home-tiles").innerHTML = tile("구성원", state.members.length + "명")
      + tile("셀", state.cells.length + "개") + tile("대기 중 초대", pendingN + "건");
    $("home-absent").innerHTML = "";
    $("home-pray").innerHTML = card("영혼 카드는 담당 리더만 열람해요",
      "수퍼 관리자는 사람과 진을 배치해요. 셀을 직접 맡고 있다면 리더 관리에서 '나도 셀을 맡아요'를 켜주세요.");
    $("home-todo").innerHTML = ""; $("home-anniv").innerHTML = "";
  }
  $("btn-manage").hidden = !(me.role === "super" || me.role === "jinjang");
  state.lastTab = "home";
  show("s-home");
}
const tile = (k,v) => `<div class="tile"><p class="k">${k}</p><p class="v">${v}</p></div>`;
const card = (h,b) => `<div class="card"><h3 class="serif" style="font-size:17px;font-weight:600">${h}</h3>
  <p class="muted" style="margin-top:8px">${b}</p></div>`;

function renderAbsent(list) {
  if (!list.length) { $("home-absent").innerHTML = ""; return; }
  $("home-absent").innerHTML = `
    <div class="card" style="margin-top:14px;background:var(--warn-bg);border-color:#3A2E1E">
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--warn-tx)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9.2v4m0 2.9h.01"/><path d="M10.4 4.3 3 17.2A1.8 1.8 0 0 0 4.6 20h14.8a1.8 1.8 0 0 0 1.6-2.8L13.6 4.3a1.8 1.8 0 0 0-3.2 0Z"/></svg>
        연속 결석
      </div>
      <p style="margin-top:8px;font-size:14px;line-height:1.7;color:#E8D9C4">
        ${list.map(s => `${esc(s.name)} (${absentStreak(s.id, s.cellId)}주)`).join(" · ")}
      </p>
      <p class="muted" style="margin-top:6px;font-size:12px">안부 연락을 남겨볼 때예요.</p>
    </div>`;
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
  const s = list[state.prayIdx], top = s.prayTop || {};
  $("home-pray").innerHTML = `
    <section class="card" style="border-radius:20px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;letter-spacing:.06em;color:var(--brand)">오늘 기도할 영혼</span>
        <span style="font-size:11px;color:var(--dim)">${state.prayIdx+1} / ${list.length}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:14px;cursor:pointer" data-gosoul="${s.id}">
        <span class="ava">${esc(initial(s.name))}</span>
        <div style="min-width:0">
          <h2 class="serif" style="font-size:20px;font-weight:600">${esc(s.name)}</h2>
          <div style="display:flex;gap:6px;margin-top:6px">
            <span class="chip rose">${esc(STATUS[s.status] || "—")}</span>
            ${top.since ? `<span class="chip">${(daysSince(top.since)||0)+1}일째 기도</span>` : ""}
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
    <div class="list">${todos.slice(0,6).map(t => `
      <div class="row">
        <button class="icon-btn" style="width:34px;height:34px;color:#6E6260"
          data-done="${t.id}" data-soul="${t.soulId}" aria-label="완료">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/></svg>
        </button>
        <div class="grow" data-gosoul="${t.soulId}" style="cursor:pointer">
          <p class="nm">${esc(t.soulName)} · ${esc(t.text)}</p>
          <p class="sub">${t.due ? (daysUntil(t.due) < 0 ? "지남 · " : "") + fmtDate(t.due) + "까지" : "날짜 없음"}</p>
        </div>
      </div>`).join("")}</div>`;
}
function upcomingAnnivs() {
  const out = [];
  state.souls.filter(isLeaderOf).forEach(s => {
    [["birth","생일"],["baptizedAt","세례"],["marriedAt","결혼기념일"]].forEach(([f,label]) => {
      const d = annivIn(s[f]);
      if (d !== null && d <= 7) out.push({ id:s.id, name:s.name, label, d, date:s[f] });
    });
  });
  return out.sort((a,b) => a.d - b.d);
}
function renderAnnivs(list) {
  if (!list.length) { $("home-anniv").innerHTML = ""; return; }
  $("home-anniv").innerHTML = `
    <h3 class="sec-title">이번 주 기념일</h3>
    <div class="list">${list.map(a => `
      <div class="row" data-gosoul="${a.id}" style="cursor:pointer">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F24557" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 20h15M6 20v-5.2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V20M12 12.2V9.6"/><circle cx="12" cy="7.6" r="1"/></svg>
        <div class="grow"><p class="nm">${esc(a.name)} ${a.label}</p>
          <p class="sub">${fmtDate(a.date)} · ${a.d === 0 ? "오늘" : "D-" + a.d}</p></div>
      </div>`).join("")}</div>`;
}

$("s-home").addEventListener("click", async (ev) => {
  const go = ev.target.closest("[data-gosoul]");
  if (go) { openSoul(go.dataset.gosoul); return; }
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
    const s = state.souls.find(x => x.id === done.dataset.soul); if (!s) return;
    const todos = (s.todos || []).map(t => t.id === done.dataset.done ? { ...t, done:true } : t);
    try {
      await updateDoc(doc(db, "souls", s.id), { todos });
      s.todos = todos; toast("완료 처리했어요.");
      const list = openTodos(); renderTodos(list);
      const tiles = $("home-tiles").children;
      if (tiles[2]) tiles[2].querySelector(".v").textContent = list.length + "건";
    } catch (e) { toast(msgOf(e)); }
  }
});
$("btn-manage").onclick = () => openManage();
$("btn-back").onclick = () => openHome();
/* 홈의 + : 영혼을 고르고 바로 기록 */
$("btn-quick-add").onclick = () => {
  const mine = state.souls.filter(isLeaderOf);
  if (!mine.length) { toast("먼저 영혼 카드를 하나 만들어 주세요."); openSouls(); return; }
  openRecDialog(null);
};

/* ════════ 영혼 목록 ════════ */
async function openSouls() {
  if (!canLead() && state.me.role !== "coach" && state.me.role !== "jinjang") {
    toast("영혼 카드는 담당 리더만 볼 수 있어요. 리더 관리에서 '나도 셀을 맡아요'를 켤 수 있어요."); return;
  }
  show("s-loading");
  await loadOrg(); await loadSouls(); await loadMeetings();
  renderFilter(); renderSouls();
  $("btn-soul-new").hidden = !canLead();
  state.lastTab = "souls";
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
    const n = daysSince(s.lastMetAt), st = absentStreak(s.id, s.cellId);
    return `
    <div class="row" data-open="${s.id}" style="cursor:pointer">
      <span class="ava">${esc(initial(s.name))}</span>
      <div class="grow">
        <p class="nm">${esc(s.name)}</p>
        <p class="sub">${n === null ? "아직 만남 기록 없음" : `마지막 만남 ${n}일 전`}
          ${(s.prayOpen||0) > 0 ? ` · 기도 ${s.prayOpen}` : ""}${st >= 2 ? ` · 결석 ${st}주` : ""}</p>
      </div>
      <span class="chip ${s.status==="care"?"warn":"rose"}">${esc(STATUS[s.status] || "—")}</span>
    </div>`;
  }).join("") || `<p class="muted">${
    kw ? "찾는 이름이 없어요."
    : state.me.role === "coach" && !(state.me.cellIds||[]).length
    ? "담당 셀이 아직 지정되지 않았어요. 진장에게 요청해 주세요."
    : state.filter !== "all" ? "이 조건에 맞는 영혼이 없어요."
    : "아직 등록된 영혼이 없어요. 오른쪽 위 + 를 눌러 시작해요."}</p>`;
}
$("list-souls").addEventListener("click", (ev) => {
  const r = ev.target.closest("[data-open]"); if (!r) return;
  openSoul(r.dataset.open);
});
$("btn-soul-new").onclick = () => openEdit(null);

/* ════════ 영혼 카드 ════════ */
async function openSoul(soulId) {
  show("s-loading");
  if (!state.souls.length) { await loadOrg(); await loadSouls(); await loadMeetings(); }
  const s = state.souls.find(x => x.id === soulId);
  if (!s) { toast("카드를 찾을 수 없어요."); openSouls(); return; }
  state.soul = s; state.soulTab = "rec";
  await loadRecords(soulId, isLeaderOf(s));
  await loadTrainings(soulId);
  const photo = await loadPhoto(soulId);

  $("soul-ava").textContent = photo ? "" : initial(s.name);
  $("soul-ava").style.backgroundImage = photo ? `url(${photo})` : "";
  $("soul-name").textContent = s.name;
  const cell = state.cells.find(c => c.id === s.cellId);
  $("soul-chips").innerHTML =
    `<span class="chip rose">${esc(STATUS[s.status] || "—")}</span>` +
    (cell ? `<span class="chip">${esc(cell.name)}</span>` : "");

  const tel = (s.phone || "").replace(/\D/g, "");
  $("soul-contact").innerHTML = tel ? `
    <div style="display:flex;gap:8px">
      <a class="btn-ghost" href="tel:${tel}" style="height:44px;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--text);font-size:13px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5h3l1.4 3.5-2 1.4a10.5 10.5 0 0 0 5.2 5.2l1.4-2 3.5 1.4v3a1.6 1.6 0 0 1-1.8 1.6C11.3 18.2 5.8 12.7 5.4 6.3A1.6 1.6 0 0 1 7 4.5Z"/></svg>
        전화
      </a>
      <a class="btn-ghost" href="sms:${tel}" style="height:44px;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--text);font-size:13px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5.5h15v11h-9l-4 3.5v-3.5h-2z"/></svg>
        문자
      </a>
    </div>` : "";

  updateSummary();
  $("soul-edit").hidden = !isLeaderOf(s);
  $("btn-rec-new").hidden = !isLeaderOf(s);
  renderSoulTabs(); renderSoulBody();
  show("s-soul");
}
function updateSummary() {
  const s = state.soul, n = daysSince(s.lastMetAt), rate = attendRate(s.id, s.cellId);
  $("soul-summary").textContent =
    `${n === null ? "만남 기록 없음" : `마지막 만남 ${n}일 전`}`
    + (rate === null ? "" : ` · 출석 ${rate}%`)
    + ` · 기도 ${s.prayOpen || 0}개 · 기록 ${state.records.length}`;
}
$("soul-back").onclick = () => state.lastTab === "home" ? openHome() : openSouls();
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
  const s = state.soul, mine = isLeaderOf(s), box = $("soul-body");

  if (state.soulTab === "rec") {
    box.innerHTML = state.records.length ? `<div class="list">${state.records.map(r => `
      <article class="rec">
        <div class="head">
          <span style="font-size:12px;color:var(--dim)">${RTYPE[r.type] || r.type} · ${fmtDate(r.date)}${r.place ? " · " + esc(r.place) : ""}</span>
          ${scopeChip(r.scope)}
        </div>
        <p class="body${r.type === "heart" ? " serif" : ""}">${esc(r.body)}</p>
        <div class="foot">
          ${r.type === "pray" ? `<span class="chip ${r.prayStatus === "answered" ? "ok" : ""}">${r.prayStatus === "answered" ? "응답됨" : "기도 중 " + ((daysSince(r.date)||0)+1) + "일째"}</span>` : ""}
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
          <div class="grow"><p class="nm" style="white-space:normal">${esc(t.text)}</p>
            <p class="sub">${t.due ? fmtDate(t.due) + "까지" : "날짜 없음"}${t.done ? " · 완료" : ""}</p></div>
          ${mine ? `<button class="btn-sm danger" data-deltodo="${t.id}">삭제</button>` : ""}
        </div>`).join("") : `<p class="muted">후속조치가 없어요.</p>`}</div>`;
    const b = $("btn-todo-new"); if (b) b.onclick = () => openTodoDlg();
  }

  if (state.soulTab === "train") {
    const byCourse = {};
    state.trainings.forEach(t => {
      const cur = byCourse[t.courseId];
      if (!cur || String(t.startDate||"") > String(cur.startDate||"")) byCourse[t.courseId] = t;
    });
    const ladder = state.courses.map(c => {
      const t = byCourse[c.id];
      const cls = !t ? "" : t.status === "done" ? "done" : t.status === "ongoing" ? "ing"
        : t.status === "dropped" ? "drop" : "";
      return `<li><div class="bar ${cls}"></div><p>${esc(c.name)}</p></li>`;
    }).join("");
    const doneN = state.courses.filter(c => byCourse[c.id] && byCourse[c.id].status === "done").length;
    const canAddCourse = state.me.role === "super" || state.me.role === "jinjang";

    box.innerHTML = `
      ${state.courses.length ? `
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <h3 style="font-size:13px;font-weight:600">훈련 사다리</h3>
            <span class="muted" style="font-size:12px">${state.courses.length}단계 중 ${doneN}단계 수료</span>
          </div>
          <ul class="ladder">${ladder}</ul>
        </div>` : `
        <div class="card">
          <p class="muted">훈련 과정이 아직 등록되지 않았어요.</p>
          ${canAddCourse
            ? `<button class="btn-sm" id="btn-course-here" style="margin-top:12px">여기서 과정 등록하기</button>`
            : `<p class="muted" style="margin-top:8px">진장에게 과정 등록을 요청해 주세요.</p>`}
        </div>`}
      ${mine && state.courses.length ? `<button class="btn-ghost" id="btn-train-new" style="height:44px;font-size:13px;margin-top:12px">훈련 기록 추가</button>` : ""}
      <div class="list" style="margin-top:12px">${state.trainings.length ? state.trainings.map(t => `
        <div class="row">
          <div class="grow">
            <p class="nm">${esc(t.courseName)}${t.cohort ? " · " + esc(t.cohort) : ""}</p>
            <p class="sub">${fmtDate(t.startDate)}${t.endDate ? " ~ " + fmtDate(t.endDate) : ""}${t.note ? " · " + esc(t.note) : ""}</p>
          </div>
          <span class="chip ${t.status==="done"?"ok":t.status==="dropped"?"warn":"rose"}">${TSTAT[t.status]||t.status}</span>
          ${mine ? `<button class="btn-sm danger" data-deltrain="${t.id}">삭제</button>` : ""}
        </div>`).join("") : `<p class="muted">훈련 이력이 없어요.</p>`}</div>`;
    const b = $("btn-train-new"); if (b) b.onclick = () => openTrainDlg();
    const c = $("btn-course-here"); if (c) c.onclick = () => addCourse(() => renderSoulBody());
  }

  if (state.soulTab === "profile") {
    const rows = [
      ["생일", s.birth ? fmtDate(s.birth, true) + (s.lunar ? " (음력)" : "") : ""],
      ["연락처", s.phone], ["주소", [s.address, s.address2].filter(Boolean).join(" ")],
      ["직장 · 학교", s.job], ["성별", s.gender],
      ["교회 등록일", fmtDate(s.registeredAt, true)], ["세례일", fmtDate(s.baptizedAt, true)],
      ["결혼기념일", fmtDate(s.marriedAt, true)], ["직분", s.position],
      ["인도자", s.invitedBy], ["인생 말씀", s.verse],
      ["취미", s.hobby], ["MBTI", s.mbti], ["좋아하는 것", s.food],
      ["피해야 할 것", s.avoid], ["요즘 관심사", s.interest],
      ["연락 주기", s.contactCycle ? s.contactCycle + "일마다" : ""],
      ["메모", s.memo]
    ].filter(([,v]) => v);
    box.innerHTML = (rows.length ? `<div class="list">${rows.map(([k,v]) => `
      <div class="row"><div class="grow"><p class="sub" style="margin:0">${k}</p>
        <p class="nm" style="margin-top:4px;white-space:pre-wrap">${esc(v)}</p></div></div>`).join("")}</div>`
      : `<p class="muted">아직 적은 정보가 없어요.</p>`)
      + (mine ? `<button class="btn-ghost" id="btn-edit-here" style="height:44px;font-size:13px;margin-top:12px">프로필 수정</button>` : "");
    const e = $("btn-edit-here"); if (e) e.onclick = () => openEdit(s.id);
  }

  if (state.soulTab === "family") {
    const fam = s.family || [];
    box.innerHTML = `
      ${mine ? `<button class="btn-ghost" id="btn-fam-new" style="height:44px;font-size:13px;margin-bottom:12px">가족 추가</button>` : ""}
      <div class="list">${fam.length ? fam.map((f,i) => `
        <div class="row">
          <span class="ava">${esc(initial(f.name))}</span>
          <div class="grow"><p class="nm">${esc(f.relation)} · ${esc(f.name)}</p>
            <p class="sub">${[f.birth, f.faith === "y" ? "신앙 있음" : f.faith === "n" ? "아직 아님" : "", f.note]
              .filter(Boolean).map(esc).join(" · ")}</p></div>
          ${mine ? `<button class="btn-sm danger" data-delfam="${i}">삭제</button>` : ""}
        </div>`).join("") : `<p class="muted">가족 정보가 없어요.</p>`}</div>`;
    const b = $("btn-fam-new"); if (b) b.onclick = () => openFamilyDlg();
  }
}

$("soul-body").addEventListener("click", async (ev) => {
  const s = state.soul;
  const del = ev.target.closest("[data-delrec]");
  if (del) {
    if (!confirm("이 기록을 지울까요? 되돌릴 수 없어요.")) return;
    try {
      await deleteDoc(doc(db, "souls", s.id, "records", del.dataset.delrec));
      await loadRecords(s.id, true); await syncPraySummary();
      renderSoulBody(); updateSummary(); toast("지웠어요.");
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const ans = ev.target.closest("[data-answer]");
  if (ans) {
    try {
      await updateDoc(doc(db, "souls", s.id, "records", ans.dataset.answer), { prayStatus:"answered" });
      await loadRecords(s.id, true); await syncPraySummary();
      renderSoulBody(); toast("응답으로 표시했어요. 감사해요.");
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const tgl = ev.target.closest("[data-tgl]");
  if (tgl) {
    const todos = (s.todos || []).map(t => t.id === tgl.dataset.tgl ? { ...t, done:!t.done } : t);
    await saveSoulField({ todos }); renderSoulBody(); return;
  }
  const dt = ev.target.closest("[data-deltodo]");
  if (dt) {
    const todos = (s.todos || []).filter(t => t.id !== dt.dataset.deltodo);
    await saveSoulField({ todos }); renderSoulBody(); return;
  }
  const df = ev.target.closest("[data-delfam]");
  if (df) {
    const family = (s.family || []).filter((_, i) => i !== Number(df.dataset.delfam));
    await saveSoulField({ family }); renderSoulBody(); return;
  }
  const dtr = ev.target.closest("[data-deltrain]");
  if (dtr) {
    if (!confirm("이 훈련 기록을 지울까요?")) return;
    try {
      await deleteDoc(doc(db, "souls", s.id, "trainings", dtr.dataset.deltrain));
      await loadTrainings(s.id); renderSoulBody(); toast("지웠어요.");
    } catch (e) { toast(msgOf(e)); }
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
async function syncPraySummary() {
  const open = state.records.filter(r => r.type === "pray" && r.prayStatus !== "answered")
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  await saveSoulField({
    prayOpen: open.length,
    prayTop: open.length ? { text: open[0].body, since: open[0].date } : null
  });
}

/* ════════ 기록 추가 ════════ */
const dlgRec = $("dlg-rec");
let recType = "meet";
function openRecDialog(soulId) {
  const mine = state.souls.filter(isLeaderOf);
  const pick = soulId || (state.soul && isLeaderOf(state.soul) ? state.soul.id : (mine[0] && mine[0].id));
  $("r-soul-wrap").hidden = !!soulId;
  $("r-soul").innerHTML = mine.map(s =>
    `<option value="${s.id}"${s.id === pick ? " selected" : ""}>${esc(s.name)}</option>`).join("");
  recType = "meet"; syncRecType();
  $("r-date").value = todayStr(); $("r-body").value = ""; $("r-place").value = "";
  $("r-todo-on").checked = false; $("r-todo-fields").hidden = true;
  $("r-todo-text").value = ""; $("r-todo-due").value = plusDays(7);
  $("r-quick").innerHTML = PLACES.map(p => `<button type="button" data-place="${p}">${p}</button>`).join("");
  $("rec-err").textContent = "";
  autoGrow($("r-body"));
  dlgRec.showModal();
}
$("btn-rec-new").onclick = () => openRecDialog(state.soul.id);
$("r-quick").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-place]"); if (!b) return;
  $("r-place").value = b.dataset.place;
});
$("r-todo-on").onchange = () => { $("r-todo-fields").hidden = !$("r-todo-on").checked; };
dlgRec.querySelectorAll("[data-rt]").forEach(b => b.onclick = () => { recType = b.dataset.rt; syncRecType(); });
function syncRecType() {
  dlgRec.querySelectorAll("[data-rt]").forEach(b => b.classList.toggle("on", b.dataset.rt === recType));
  $("r-place-wrap").hidden = recType !== "meet";
  $("r-who-wrap").hidden = recType !== "heart";
  $("r-todo-wrap").hidden = recType === "heart";
  $("r-body-label").textContent =
    recType === "meet" ? "나눈 이야기 · 특이사항" : recType === "pray" ? "기도제목" : "받은 마음";
  $("r-body").placeholder =
    recType === "meet" ? "오늘 무슨 이야기를 나눴나요"
    : recType === "pray" ? "무엇을 위해 기도할까요"
    : "기도 중에 받은 마음, 또는 이 친구가 나눈 은혜";
  $("r-scope").value = recType === "heart" ? "private" : "leader";
}
$("rec-cancel").onclick = () => dlgRec.close();
$("rec-save").onclick = async () => {
  const body = $("r-body").value.trim();
  $("rec-err").textContent = "";
  if (!body) { $("rec-err").textContent = "내용을 적어주세요."; return; }
  const soulId = $("r-soul-wrap").hidden ? state.soul.id : $("r-soul").value;
  if (!soulId) { $("rec-err").textContent = "영혼을 골라주세요."; return; }
  $("rec-save").disabled = true;
  try {
    const data = {
      type: recType, scope: $("r-scope").value, date: $("r-date").value || todayStr(),
      body, by: uid(), byName: state.me.name || "", createdAt: serverTimestamp()
    };
    if (recType === "meet") data.place = $("r-place").value.trim();
    if (recType === "heart") data.who = $("r-who").value;
    if (recType === "pray") data.prayStatus = "praying";
    await addDoc(collection(db, "souls", soulId, "records"), data);

    const patch = {};
    if (recType === "meet") patch.lastMetAt = data.date;
    if ($("r-todo-on").checked && $("r-todo-text").value.trim()) {
      const target = state.souls.find(x => x.id === soulId) || {};
      patch.todos = [...(target.todos || []),
        { id:"t" + Date.now(), text: $("r-todo-text").value.trim(), due: $("r-todo-due").value || "", done:false }];
    }
    if (Object.keys(patch).length) {
      await updateDoc(doc(db, "souls", soulId), patch);
      const inList = state.souls.find(x => x.id === soulId);
      if (inList) Object.assign(inList, patch);
    }

    dlgRec.close();
    if (state.soul && state.soul.id === soulId) {
      Object.assign(state.soul, patch);
      await loadRecords(soulId, true);
      if (recType === "pray") await syncPraySummary();
      state.soulTab = "rec"; renderSoulTabs(); renderSoulBody(); updateSummary();
    } else {
      if (recType === "pray") {
        state.soul = state.souls.find(x => x.id === soulId);
        await loadRecords(soulId, true); await syncPraySummary(); state.soul = null;
      }
      openHome();
    }
    toast("기록했어요.");
  } catch (e) { $("rec-err").textContent = msgOf(e); }
  finally { $("rec-save").disabled = false; }
};

/* 후속조치 */
const dlgTodo = $("dlg-todo");
function openTodoDlg() {
  $("t-text").value = ""; $("t-due").value = plusDays(7); $("todo-err").textContent = "";
  $("t-quick").innerHTML = [["오늘",0],["내일",1],["이번 주말",(6 - new Date().getDay() + 7) % 7 || 6],["다음 주",7],["2주 뒤",14]]
    .map(([l,n]) => `<button type="button" data-due="${n}">${l}</button>`).join("");
  dlgTodo.showModal();
}
$("t-quick").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-due]"); if (!b) return;
  $("t-due").value = plusDays(Number(b.dataset.due));
});
$("todo-cancel").onclick = () => dlgTodo.close();
$("todo-save").onclick = async () => {
  const text = $("t-text").value.trim();
  if (!text) { $("todo-err").textContent = "할 일을 적어주세요."; return; }
  const todos = [...(state.soul.todos || []),
    { id:"t" + Date.now(), text, due: $("t-due").value || "", done:false }];
  await saveSoulField({ todos });
  dlgTodo.close(); renderSoulBody(); toast("후속조치를 더했어요.");
};

/* 가족 */
function openFamilyDlg() {
  ["f-rel","f-name","f-birth","f-note"].forEach(i => $(i).value = "");
  $("f-faith").value = ""; $("family-err").textContent = "";
  $("f-quick").innerHTML = RELS.map(r => `<button type="button" data-rel="${r}">${r}</button>`).join("");
  $("dlg-family").showModal();
}
$("f-quick").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-rel]"); if (!b) return;
  $("f-rel").value = b.dataset.rel; $("f-name").focus();
});
$("fam-cancel").onclick = () => $("dlg-family").close();
$("fam-save").onclick = async () => {
  const relation = $("f-rel").value.trim(), name = $("f-name").value.trim();
  if (!relation || !name) { $("family-err").textContent = "관계와 이름을 적어주세요."; return; }
  const family = [...(state.soul.family || []),
    { relation, name, birth: $("f-birth").value.trim(), faith: $("f-faith").value, note: $("f-note").value.trim() }];
  await saveSoulField({ family });
  $("dlg-family").close(); renderSoulBody(); toast("가족을 더했어요.");
};

/* 훈련 */
const dlgTrain = $("dlg-train");
function openTrainDlg() {
  $("tr-course").innerHTML = state.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  $("tr-cohort").value = ""; $("tr-start").value = todayStr(); $("tr-end").value = "";
  $("tr-note").value = ""; $("tr-status").value = "ongoing"; $("train-err").textContent = "";
  dlgTrain.showModal();
}
$("tr-cancel").onclick = () => dlgTrain.close();
$("tr-save").onclick = async () => {
  const courseId = $("tr-course").value;
  const course = state.courses.find(c => c.id === courseId);
  if (!course) { $("train-err").textContent = "과정을 골라주세요."; return; }
  $("tr-save").disabled = true;
  try {
    await addDoc(collection(db, "souls", state.soul.id, "trainings"), {
      courseId, courseName: course.name, cohort: $("tr-cohort").value.trim(),
      status: $("tr-status").value, startDate: $("tr-start").value, endDate: $("tr-end").value,
      note: $("tr-note").value.trim(), by: uid(), createdAt: serverTimestamp()
    });
    await loadTrainings(state.soul.id);
    dlgTrain.close(); renderSoulBody(); toast("훈련 기록을 더했어요.");
  } catch (e) { $("train-err").textContent = msgOf(e); }
  finally { $("tr-save").disabled = false; }
};

/* ════════ 영혼 추가 · 수정 ════════ */
const EDIT_FIELDS = ["e-name","e-gender","e-birth","e-phone","e-address","e-address2","e-job",
  "e-reg","e-bap","e-married","e-position","e-invitedby","e-verse","e-hobby","e-mbti",
  "e-food","e-avoid","e-interest","e-memo","e-status","e-cycle","e-cell"];

function openEdit(soulId) {
  state.editingId = soulId; state.editPhoto = undefined; state.editDirty = false;
  const s = soulId ? state.souls.find(x => x.id === soulId) : null;
  $("edit-title").textContent = s ? "프로필 수정" : "영혼 추가";
  $("btn-del-soul").hidden = !s;
  document.querySelectorAll("#s-edit .fold").forEach(f => f.open = false);

  $("e-status").innerHTML = Object.entries(STATUS).map(([k,v]) => `<option value="${k}">${v}</option>`).join("");
  const myCells = state.cells.filter(c => c.jinId === state.me.jinId);
  const useCells = myCells.length ? myCells : state.cells;
  $("e-cell").innerHTML = useCells.length
    ? useCells.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")
    : `<option value="">아직 셀이 없어요</option>`;

  const canAddCell = state.me.role === "super" || state.me.role === "jinjang";
  $("no-cell-help").innerHTML = useCells.length ? "" : `
    <div class="card" style="margin-bottom:14px;background:var(--warn-bg);border-color:#3A2E1E">
      <p style="font-size:13px;line-height:1.7;color:#E8D9C4">셀이 아직 없어요. 셀이 없어도 저장은 되지만,
        출석 체크를 하려면 셀이 필요해요.</p>
      ${canAddCell ? `<button class="btn-sm" id="btn-cell-here" style="margin-top:10px">여기서 셀 만들기</button>`
        : `<p class="muted" style="margin-top:8px;font-size:12px">진장에게 셀 생성을 요청해 주세요.</p>`}
    </div>`;
  const cb = $("btn-cell-here");
  if (cb) cb.onclick = () => addCell(() => openEdit(state.editingId));

  const v = (id, val) => $(id).value = val || "";
  v("e-name", s && s.name); v("e-gender", s && s.gender);
  v("e-birth", s && s.birth ? fmtRaw(s.birth) : "");
  $("e-lunar").checked = !!(s && s.lunar);
  v("e-phone", s && s.phone); v("e-address", s && s.address); v("e-address2", s && s.address2);
  v("e-job", s && s.job);
  v("e-reg", s && s.registeredAt ? fmtRaw(s.registeredAt) : "");
  v("e-bap", s && s.baptizedAt ? fmtRaw(s.baptizedAt) : "");
  v("e-married", s && s.marriedAt ? fmtRaw(s.marriedAt) : "");
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
  autoGrow($("e-memo"));
  updateFoldCounts();
  show("s-edit");
  setTimeout(() => { if (!s) $("e-name").focus(); }, 120);
}
/* 저장된 값을 입력칸에 다시 넣을 때 보기 좋게 */
function fmtRaw(s) {
  const p = String(s).split("-");
  if (p.length < 3) return s;
  if (p[0] === "0000") return `${Number(p[1])}-${Number(p[2])}`;
  if (p[2] === "00") return p[1] === "00" ? p[0] : `${p[0]}-${Number(p[1])}`;
  return `${p[0]}-${Number(p[1])}-${Number(p[2])}`;
}
/* 접힌 섹션에 뭐가 들어있는지 표시 */
function updateFoldCounts() {
  const n = (ids) => ids.filter(i => ($(i).value || "").trim()).length;
  const put = (id, c) => $(id).textContent = c ? `  ${c}개 입력됨` : "";
  put("cnt-photo", state.editPhoto || (state.editingId && state.photoCache[state.editingId]) ? 1 : 0);
  put("cnt-basic", n(["e-phone","e-address","e-gender","e-job","e-birth"]));
  put("cnt-faith", n(["e-reg","e-bap","e-married","e-position","e-invitedby","e-verse"]));
  put("cnt-know", n(["e-hobby","e-mbti","e-food","e-avoid","e-interest"]));
  put("cnt-care", (Number($("e-cycle").value) ? 1 : 0) + n(["e-memo"]));
}
EDIT_FIELDS.forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener("input", () => { state.editDirty = true; updateFoldCounts(); });
  el.addEventListener("change", () => { state.editDirty = true; updateFoldCounts(); });
});
$("e-phone").addEventListener("input", (ev) => {
  const p = ev.target.selectionStart, before = ev.target.value.length;
  ev.target.value = fmtPhone(ev.target.value);
  const after = ev.target.value.length;
  try { ev.target.setSelectionRange(p + (after - before), p + (after - before)); } catch {}
});
$("e-name").addEventListener("input", () => {
  if (!$("edit-ava").style.backgroundImage)
    $("edit-ava").textContent = $("e-name").value ? initial($("e-name").value) : "+";
});
$("edit-back").onclick = () => {
  if (state.editDirty && !confirm("저장하지 않고 나갈까요? 적은 내용이 사라져요.")) return;
  state.editDirty = false;
  state.editingId ? openSoul(state.editingId) : openSouls();
};

/* 주소 찾기 (다음 우편번호) */
$("btn-postcode").onclick = () => {
  const open = () => new window.daum.Postcode({
    oncomplete: (data) => {
      $("e-address").value = data.roadAddress || data.jibunAddress || "";
      state.editDirty = true; updateFoldCounts(); $("e-address2").focus();
    }
  }).open();
  if (window.daum && window.daum.Postcode) { open(); return; }
  const sc = document.createElement("script");
  sc.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
  sc.onload = open;
  sc.onerror = () => toast("주소 검색을 불러오지 못했어요. 직접 적어주세요.");
  document.head.appendChild(sc);
};

$("btn-photo").onclick = () => $("photo-input").click();
$("btn-photo-del").onclick = () => {
  state.editPhoto = null; state.editDirty = true;
  $("edit-ava").style.backgroundImage = "";
  $("edit-ava").textContent = initial($("e-name").value || "?");
  updateFoldCounts();
};
$("photo-input").onchange = (ev) => {
  const file = ev.target.files && ev.target.files[0]; if (!file) return;
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
      state.editPhoto = data; state.editDirty = true;
      $("edit-ava").style.backgroundImage = `url(${data})`; $("edit-ava").textContent = "";
      updateFoldCounts();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file); ev.target.value = "";
};

$("btn-save-soul").onclick = async () => {
  const name = $("e-name").value.trim();
  $("edit-err").textContent = "";
  if (!name) { $("edit-err").textContent = "이름은 꼭 적어주세요."; $("e-name").focus(); return; }
  if (!canLead()) { $("edit-err").textContent = "셀을 맡은 사람만 영혼 카드를 만들 수 있어요."; return; }
  if (!state.me.jinId) {
    $("edit-err").textContent = "먼저 리더 관리에서 내 진과 셀을 지정해 주세요."; return;
  }
  const dates = {};
  for (const [key, id, label] of [["birth","e-birth","생일"],["registeredAt","e-reg","교회 등록일"],
       ["baptizedAt","e-bap","세례일"],["marriedAt","e-married","결혼기념일"]]) {
    const parsed = parseDateLoose($(id).value);
    if (parsed === null) {
      $("edit-err").textContent = `${label} 형식을 확인해 주세요. 3-5 또는 1985-03-05 처럼 적어주세요.`;
      $(id).focus(); return;
    }
    dates[key] = parsed;
  }

  const data = {
    name, gender: $("e-gender").value, lunar: $("e-lunar").checked,
    phone: $("e-phone").value.trim(), address: $("e-address").value.trim(),
    address2: $("e-address2").value.trim(), job: $("e-job").value.trim(),
    position: $("e-position").value.trim(), invitedBy: $("e-invitedby").value.trim(),
    verse: $("e-verse").value.trim(), hobby: $("e-hobby").value.trim(), mbti: $("e-mbti").value.trim(),
    food: $("e-food").value.trim(), avoid: $("e-avoid").value.trim(),
    interest: $("e-interest").value.trim(), memo: $("e-memo").value.trim(),
    status: $("e-status").value, contactCycle: Number($("e-cycle").value) || 0,
    cellId: $("e-cell").value || null, ...dates
  };
  $("btn-save-soul").disabled = true;
  try {
    let soulId = state.editingId;
    if (soulId) await updateDoc(doc(db, "souls", soulId), data);
    else {
      const ref = await addDoc(collection(db, "souls"), {
        ...data, jinId: state.me.jinId, leaderUid: state.me.id,
        family: [], todos: [], lastMetAt: null, lastPrayedAt: null,
        prayOpen: 0, prayTop: null, active: true,
        createdBy: state.me.id, createdAt: serverTimestamp()
      });
      soulId = ref.id;
    }
    if (state.editPhoto !== undefined) {
      await setDoc(doc(db, "photos", soulId), { self: state.editPhoto }, { merge:true });
      state.photoCache[soulId] = state.editPhoto;
    }
    state.editDirty = false;
    await loadSouls(); toast("저장했어요."); openSoul(soulId);
  } catch (e) { $("edit-err").textContent = msgOf(e); }
  finally { $("btn-save-soul").disabled = false; }
};
$("btn-del-soul").onclick = async () => {
  if (!confirm("이 카드를 목록에서 보관할까요? 기록은 지워지지 않아요.")) return;
  try {
    await updateDoc(doc(db, "souls", state.editingId), { active:false });
    state.editDirty = false;
    await loadSouls(); toast("보관했어요."); openSouls();
  } catch (e) { toast(msgOf(e)); }
};

/* ════════ 셀모임 ════════ */
function myCells() {
  const list = state.cells.filter(c => c.jinId === state.me.jinId);
  return list.length ? list : state.cells;
}
function defaultCellId() {
  if (state.me.cellId) return state.me.cellId;
  const mySoul = state.souls.find(s => isLeaderOf(s) && s.cellId);
  if (mySoul) return mySoul.cellId;
  const c = myCells()[0];
  return c ? c.id : null;
}
async function openMeet() {
  if (!canLead() && state.me.role !== "coach" && state.me.role !== "jinjang") {
    toast("셀모임은 셀을 맡은 분과 코치·진장이 볼 수 있어요."); return;
  }
  show("s-loading");
  await loadOrg(); await loadSouls(); await loadMeetings();
  const cellNm = (id) => (state.cells.find(c => c.id === id) || {}).name || "셀";

  const recent = state.meetings.slice(0, 8);
  const rate = recent.length ? Math.round(recent.reduce((sum,m) => {
    const vals = Object.values(m.attendance || {});
    return sum + (vals.length ? vals.filter(v => v !== "absent").length / vals.length : 0);
  }, 0) / recent.length * 100) : null;

  $("meet-tiles").innerHTML = tile("모임 기록", state.meetings.length + "회")
    + tile("최근 출석률", rate === null ? "—" : rate + "%")
    + tile("이번 달", state.meetings.filter(m => String(m.date||"").slice(0,7) === todayStr().slice(0,7)).length + "회");

  $("list-meets").innerHTML = state.meetings.map(m => {
    const vals = Object.values(m.attendance || {});
    const ok = vals.filter(v => v !== "absent").length;
    return `<div class="row" data-meeting="${m.id}" style="cursor:pointer">
      <div class="grow">
        <p class="nm">${fmtDate(m.date)} · ${esc(cellNm(m.cellId))}</p>
        <p class="sub">출석 ${ok} / ${vals.length}${m.topic ? " · " + esc(m.topic) : ""}</p>
      </div>
      <span class="chip">${vals.length ? Math.round(ok/vals.length*100) + "%" : "—"}</span>
    </div>`;
  }).join("") || `<p class="muted">아직 모임 기록이 없어요. 오른쪽 위 + 를 눌러 이번 주 모임을 만들어요.</p>`;

  $("btn-meet-new").hidden = !canLead();
  state.lastTab = "meet";
  show("s-meet");
}
$("list-meets").addEventListener("click", (ev) => {
  const r = ev.target.closest("[data-meeting]"); if (!r) return;
  openMeeting(r.dataset.meeting);
});
$("btn-meet-new").onclick = () => openMeeting(null);
$("meeting-back").onclick = () => openMeet();

function openMeeting(id) {
  const m = id ? state.meetings.find(x => x.id === id) : null;
  const cells = myCells();
  if (!m && !cells.length) { toast("먼저 셀을 만들어 주세요. 리더 관리에서 추가할 수 있어요."); return; }

  state.meeting = m ? { attendance:{}, reasons:{}, ...m } : {
    id:null, cellId: defaultCellId(), jinId: state.me.jinId, date: todayStr(),
    topic:"", note:"", visitors:"", attendance:{}, reasons:{}
  };
  const mine = !m || m.leaderUid === uid();
  $("meeting-title").textContent = m ? fmtDate(m.date) + " 모임" : "새 모임";
  $("m-cell").innerHTML = cells.map(c =>
    `<option value="${c.id}"${state.meeting.cellId === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")
    || `<option value="">셀 없음</option>`;
  $("m-date").value = state.meeting.date;
  $("m-topic").value = state.meeting.topic || "";
  $("m-note").value = state.meeting.note || "";
  $("m-visitor").value = state.meeting.visitors || "";
  ["m-date","m-topic","m-note","m-visitor","m-cell"].forEach(i => $(i).disabled = !mine);
  $("btn-meeting-save").hidden = !mine;
  $("btn-all-present").hidden = !mine;
  $("meeting-del").hidden = !(mine && m);
  autoGrow($("m-note"));
  renderAttendance(mine);
  show("s-meeting");
}
$("m-cell").onchange = () => { state.meeting.cellId = $("m-cell").value; renderAttendance(true); };
$("btn-all-present").onclick = () => {
  const roster = state.souls.filter(s => s.cellId === state.meeting.cellId);
  roster.forEach(s => { if (!state.meeting.attendance[s.id]) state.meeting.attendance[s.id] = "present"; });
  renderAttendance(true);
};
function renderAttendance(mine) {
  const mt = state.meeting;
  const roster = state.souls.filter(s => s.cellId === mt.cellId);
  const n = Object.values(mt.attendance).filter(v => v && v !== "absent").length;
  $("list-att").innerHTML = (roster.length ? `
    <p class="muted" style="font-size:12px;margin-bottom:2px">${roster.length}명 중 ${n}명 출석</p>` : "")
    + roster.map(s => {
    const v = mt.attendance[s.id] || "";
    return `<div class="row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="ava" style="width:34px;height:34px;font-size:13px">${esc(initial(s.name))}</span>
        <div class="grow"><p class="nm">${esc(s.name)}</p></div>
        <div class="att">
          ${["present","online","absent"].map(k =>
            `<button data-att="${s.id}" data-v="${k}" class="${v===k?"on":""}" ${mine?"":"disabled"}>${ATT[k].slice(0,2)}</button>`).join("")}
        </div>
      </div>
      ${v === "absent" ? `<input data-reason="${s.id}" value="${esc(mt.reasons[s.id] || "")}"
        placeholder="결석 사유 (한 줄)" style="height:40px;margin-top:10px;font-size:14px" ${mine?"":"disabled"}>` : ""}
    </div>`;
  }).join("") || `<p class="muted">이 셀에 등록된 영혼이 없어요. 영혼 카드를 만들 때 이 셀을 골라주세요.</p>`;
}
$("list-att").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-att]"); if (!b) return;
  const id = b.dataset.att, v = b.dataset.v;
  state.meeting.attendance[id] = (state.meeting.attendance[id] === v) ? "" : v;
  if (!state.meeting.attendance[id]) delete state.meeting.attendance[id];
  renderAttendance(true);
});
$("list-att").addEventListener("input", (ev) => {
  const i = ev.target.closest("[data-reason]"); if (!i) return;
  state.meeting.reasons[i.dataset.reason] = i.value;
});
$("btn-meeting-save").onclick = async () => {
  const mt = state.meeting;
  $("meeting-err").textContent = "";
  const data = {
    cellId: $("m-cell").value || mt.cellId, jinId: state.me.jinId, leaderUid: state.me.id,
    date: $("m-date").value || todayStr(), topic: $("m-topic").value.trim(),
    note: $("m-note").value.trim(), visitors: $("m-visitor").value.trim(),
    attendance: mt.attendance, reasons: mt.reasons, updatedAt: serverTimestamp()
  };
  $("btn-meeting-save").disabled = true;
  try {
    if (mt.id) await updateDoc(doc(db, "meetings", mt.id), data);
    else await addDoc(collection(db, "meetings"), { ...data, createdAt: serverTimestamp() });
    await loadMeetings(); toast("저장했어요."); openMeet();
  } catch (e) { $("meeting-err").textContent = msgOf(e); }
  finally { $("btn-meeting-save").disabled = false; }
};
$("meeting-del").onclick = async () => {
  if (!state.meeting.id) return;
  if (!confirm("이 모임 기록을 지울까요?")) return;
  try {
    await deleteDoc(doc(db, "meetings", state.meeting.id));
    await loadMeetings(); toast("지웠어요."); openMeet();
  } catch (e) { toast(msgOf(e)); }
};

/* 셀 보고서 */
$("btn-report").onclick = () => {
  const mt = state.meeting;
  const cellId = $("m-cell").value || mt.cellId;
  const cellNm = (state.cells.find(c => c.id === cellId) || {}).name || "셀";
  const roster = state.souls.filter(s => s.cellId === cellId);
  const by = (v) => roster.filter(s => mt.attendance[s.id] === v);
  const present = by("present"), online = by("online"), absent = by("absent");
  const prayers = roster.filter(s => s.prayTop && s.prayTop.text).map(s => `- ${s.name}: ${s.prayTop.text}`);
  const lines = [
    `[${cellNm}] ${fmtDate($("m-date").value || todayStr())} 셀모임`,
    `출석 ${present.length + online.length}명 / 결석 ${absent.length}명`,
    present.length ? `출석: ${present.map(s => s.name).join(", ")}` : "",
    online.length ? `온라인: ${online.map(s => s.name).join(", ")}` : "",
    absent.length ? `결석: ${absent.map(s => mt.reasons[s.id] ? `${s.name}(${mt.reasons[s.id]})` : s.name).join(", ")}` : "",
    $("m-topic").value.trim() ? `나눔: ${$("m-topic").value.trim()}` : "",
    $("m-visitor").value.trim() ? `새 방문자: ${$("m-visitor").value.trim()}` : "",
    prayers.length ? `\n기도제목\n${prayers.join("\n")}` : "",
    $("m-note").value.trim() ? `\n특이사항\n${$("m-note").value.trim()}` : ""
  ].filter(Boolean);
  $("report-text").value = lines.join("\n");
  $("dlg-report").showModal();
  autoGrow($("report-text"));
};
$("rp-close").onclick = () => $("dlg-report").close();
$("rp-copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("report-text").value); toast("복사했어요."); }
  catch { $("report-text").select(); toast("길게 눌러 복사해 주세요."); }
};

/* ════════ 더보기 (설정 · 백업) ════════ */
async function openMore() {
  const me = state.me;
  $("more-ava").textContent = initial(me.name);
  $("more-name").textContent = me.name || "";
  $("more-email").textContent = `${me.email || ""} · ${ROLE[me.role] || me.role}`;
  $("app-ver").textContent = APP_VERSION;
  $("install-sub").textContent = window.matchMedia("(display-mode: standalone)").matches
    ? "이미 앱으로 설치되어 있어요" : "폰 홈 화면에서 바로 열 수 있어요";
  state.lastTab = "more";
  show("s-more");
}
$("btn-rename").onclick = async () => {
  const name = prompt("이름을 적어주세요", state.me.name || "");
  if (!name || !name.trim()) return;
  try {
    await updateDoc(doc(db, "users", state.me.id), { name: name.trim() });
    state.me.name = name.trim(); toast("바꿨어요."); openMore();
  } catch (e) { toast(msgOf(e)); }
};
$("btn-refresh").onclick = async () => {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
  } catch {}
  location.reload();
};

/* 설치 안내 */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
$("btn-install").onclick = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  $("install-guide").innerHTML = ios ? `
    <p>사파리에서 이 페이지를 연 다음</p>
    <ol style="margin:10px 0 0;padding-left:18px;line-height:2">
      <li>아래쪽 <b>공유 버튼</b>(↑)을 누르고</li>
      <li>목록에서 <b>홈 화면에 추가</b>를 고르고</li>
      <li>오른쪽 위 <b>추가</b>를 누르면 끝이에요.</li>
    </ol>
    <p style="margin-top:12px">크롬이 아니라 <b>사파리</b>에서 해야 돼요.</p>`
    : `<p>브라우저 메뉴(⋮)를 열고 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러주세요.</p>
       <p style="margin-top:10px">메뉴에 보이지 않으면 페이지를 새로고침한 뒤 다시 열어보세요.</p>`;
  $("dlg-install").showModal();
};
$("ins-close").onclick = () => $("dlg-install").close();

/* 내려받기 */
function download(filename, text, mime) {
  const blob = new Blob(["﻿" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csvRow = (arr) => arr.map(csvCell).join(",");

$("btn-export-souls").onclick = async () => {
  toast("명단을 모으는 중이에요…");
  await loadOrg(); await loadSouls();
  const cellNm = (id) => (state.cells.find(c => c.id === id) || {}).name || "";
  const head = ["이름","상태","셀","생일","음력","연락처","주소","상세주소","직장·학교","성별",
    "교회등록일","세례일","결혼기념일","직분","인도자","인생말씀","취미","MBTI","좋아하는것",
    "피해야할것","관심사","연락주기(일)","마지막만남","기도중","메모"];
  const rows = state.souls.map(s => [
    s.name, STATUS[s.status] || "", cellNm(s.cellId), fmtDate(s.birth, true), s.lunar ? "음력" : "",
    s.phone, s.address, s.address2, s.job, s.gender,
    fmtDate(s.registeredAt, true), fmtDate(s.baptizedAt, true), fmtDate(s.marriedAt, true),
    s.position, s.invitedBy, s.verse, s.hobby, s.mbti, s.food, s.avoid, s.interest,
    s.contactCycle || "", s.lastMetAt || "", s.prayOpen || 0, s.memo
  ]);
  download(`목양노트_영혼명단_${todayStr()}.csv`, [csvRow(head), ...rows.map(csvRow)].join("\r\n"));
  toast(`${rows.length}명을 내려받았어요.`);
};

$("btn-export-all").onclick = async () => {
  if (!confirm("전체 백업을 만들까요? 영혼 수에 따라 조금 걸릴 수 있어요.")) return;
  toast("백업을 만드는 중이에요…");
  try {
    await loadOrg(); await loadSouls(); await loadMeetings();
    const souls = [];
    for (const s of state.souls) {
      const [recs, trains] = await Promise.all([
        getDocs(collection(db, "souls", s.id, "records")),
        getDocs(collection(db, "souls", s.id, "trainings"))
      ]);
      souls.push({ ...s, records: pack(recs), trainings: pack(trains) });
    }
    const backup = {
      앱: "목양노트", 버전: APP_VERSION, 만든날짜: todayStr(),
      만든사람: { 이름: state.me.name, 이메일: state.me.email, 역할: ROLE[state.me.role] },
      진: state.jins, 셀: state.cells, 훈련과정: state.courses,
      영혼: souls, 셀모임: state.meetings
    };
    download(`목양노트_전체백업_${todayStr()}.json`,
      JSON.stringify(backup, null, 2), "application/json");
    toast("백업 파일을 내려받았어요.");
  } catch (e) { toast(msgOf(e)); }
};

/* ════════ 리더 관리 ════════ */
async function openManage() {
  show("s-loading");
  await loadOrg();
  const isSuper = state.me.role === "super";
  const cellName = (id) => (state.cells.find(c => c.id === id) || {}).name || "";
  const jinName  = (id) => (state.jins.find(j => j.id === id) || {}).name || "";

  const card1 = $("my-cell-card");
  card1.hidden = state.me.role === "leader";
  if (!card1.hidden) {
    $("my-lead").checked = !!state.me.isLeader;
    $("my-cell-wrap").hidden = !state.me.isLeader;
    $("my-jin-wrap").hidden = !isSuper;
    $("my-jin").innerHTML = state.jins.map(j =>
      `<option value="${j.id}"${state.me.jinId === j.id ? " selected" : ""}>${esc(j.name)}</option>`).join("");
    fillMyCells();
  }

  $("list-members").innerHTML = state.members.map(m => {
    const where1 = m.role === "leader" ? cellName(m.cellId)
      : m.role === "coach" ? `담당 셀 ${(m.cellIds || []).length}개`
      : jinName(m.jinId) + (m.isLeader ? " · 셀 겸직" : "");
    const canEdit = m.id !== state.me.id && m.role !== "super" && (isSuper || state.me.role === "jinjang");
    const roleOptions = (isSuper ? ["jinjang","coach","leader"] : ["coach","leader"])
      .map(r => `<option value="${r}"${m.role === r ? " selected" : ""}>${ROLE[r]}</option>`).join("");
    return `
      <div class="row ${m.active ? "" : "off"}" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="grow"><p class="nm">${esc(m.name)} ${m.active ? "" : "· 중지됨"}</p>
            <p class="sub">${esc(m.email)}</p></div>
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
    <div class="row"><div class="grow"><p class="nm">${esc(i.name || i.email)}</p>
      <p class="sub">${esc(i.email)} · ${ROLE[i.role] || i.role}</p></div>
      <button class="btn-sm danger" data-act="cancel" data-email="${esc(i.email)}">취소</button></div>`).join("")
    || `<p class="muted">대기 중인 초대가 없어요.</p>`;

  $("list-cells").innerHTML = state.cells.map(c => `
    <div class="row"><div class="grow"><p class="nm">${esc(c.name)}</p>
      <p class="sub">${esc(jinName(c.jinId))} · 리더 ${state.members.filter(m => m.cellId === c.id).length}명</p>
    </div></div>`).join("") || `<p class="muted">아직 셀이 없어요.</p>`;

  $("list-courses").innerHTML = state.courses.map((c,i) => `
    <div class="row"><span class="chip">${i+1}</span>
      <div class="grow"><p class="nm">${esc(c.name)}</p></div></div>`).join("")
    || `<p class="muted">훈련 과정을 등록하면 영혼 카드에 사다리가 생겨요. 예) 새가족반 → 성장반 → 제자훈련</p>`;

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
function fillMyCells() {
  const jinId = state.me.role === "super" ? ($("my-jin").value || state.me.jinId) : state.me.jinId;
  const list = state.cells.filter(c => c.jinId === jinId);
  $("my-cell").innerHTML = list.map(c =>
    `<option value="${c.id}"${state.me.cellId === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")
    || `<option value="">셀 없음 — 아래에서 셀을 먼저 만들어 주세요</option>`;
}
$("my-lead").onchange = () => { $("my-cell-wrap").hidden = !$("my-lead").checked; };
$("my-jin").onchange = () => fillMyCells();
$("btn-my-save").onclick = async () => {
  const on = $("my-lead").checked;
  const patch = { isLeader: on };
  if (on) {
    patch.cellId = $("my-cell").value || null;
    if (state.me.role === "super") patch.jinId = $("my-jin").value || null;
    if (!patch.cellId) { toast("셀을 먼저 만들고 골라주세요."); return; }
  }
  try {
    await updateDoc(doc(db, "users", state.me.id), patch);
    Object.assign(state.me, patch);
    await log(on ? "셀 겸직 설정" : "셀 겸직 해제", state.me.id);
    toast(on ? "이제 영혼 카드를 만들 수 있어요." : "셀 겸직을 껐어요.");
    openManage();
  } catch (e) { toast(msgOf(e)); }
};

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

/* 셀 · 진 · 과정 추가 (어디서든 쓸 수 있게) */
async function addCell(after) {
  const name = prompt("셀 이름을 적어주세요 (예: 다니엘 셀)");
  if (!name || !name.trim()) return;
  const jinId = state.me.role === "super"
    ? (state.me.jinId || (state.jins[0] && state.jins[0].id)) : state.me.jinId;
  if (!jinId) { toast("먼저 진을 만들어 주세요."); return; }
  try {
    await addDoc(collection(db, "cells"),
      { name: name.trim(), jinId, active:true, createdAt: serverTimestamp() });
    await log("셀 추가", name.trim());
    await loadOrg(); toast("셀을 만들었어요.");
    if (after) after(); else openManage();
  } catch (e) { toast(msgOf(e)); }
}
async function addCourse(after) {
  const name = prompt("훈련 과정 이름을 적어주세요 (예: 새가족반)");
  if (!name || !name.trim()) return;
  try {
    await addDoc(collection(db, "courses"),
      { name: name.trim(), order: state.courses.length + 1, active:true, createdAt: serverTimestamp() });
    await log("훈련 과정 추가", name.trim());
    await loadOrg(); toast("과정을 등록했어요.");
    if (after) after(); else openManage();
  } catch (e) { toast(msgOf(e)); }
}
$("btn-cell-add").onclick = () => addCell();
$("btn-course-add").onclick = () => addCourse();
$("btn-jin-add").onclick = async () => {
  const name = prompt("진 이름을 적어주세요 (예: 2진)");
  if (!name || !name.trim()) return;
  try {
    await addDoc(collection(db, "jins"),
      { name: name.trim(), jinjangUid:null, active:true, createdAt: serverTimestamp() });
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
  fillInviteCells(); $("iv-role").onchange = syncRole; $("iv-jin").onchange = fillInviteCells;
  syncRole(); dlg.showModal();
};
function fillInviteCells() {
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
      email, name, role, jinId, cellId, status:"pending",
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
