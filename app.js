/* ──────────────────────────────────────────────
   목자의 삶
   1단계 계정 · 조직 · 초대
   2단계 영혼 카드 · 기록 · 후속조치
   3단계 셀모임 출석 · 훈련 이력 · 겸직
   4단계 입력 편의 · 앱 설치(PWA) · 백업
   5단계 훈련 개편(회차·순서) · 기록 수정
   6단계 만남 기록(1:1·소그룹) · 셀모임 개인 나눔 ·
         기록 검색 · 캘린더 · 훈련 현황 · 가로 화면
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

const APP_NAME = "목자의 삶";
const APP_VERSION = "6.0 (2026-10-06)";

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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ── 공통 ── */
const $ = (id) => document.getElementById(id);
const SCREENS = ["s-loading","s-login","s-verify","s-setup","s-accept","s-pending",
                 "s-home","s-souls","s-cal","s-meet","s-meeting","s-log","s-soul",
                 "s-edit","s-train","s-search","s-more","s-manage"];
const show = (id) => {
  SCREENS.forEach(s => $(s).hidden = (s !== id));
  const sb = $("sidebar");
  const inApp = !["s-loading","s-login","s-verify","s-setup","s-accept","s-pending"].includes(id);
  sb.style.display = inApp ? "" : "none";
  const sc = document.querySelector(`#${id} .scroll`);
  if (sc) sc.scrollTop = 0;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const isWide = () => window.matchMedia("(min-width:880px)").matches;

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
const KIND   = { one:"1:1 만남", small:"소그룹", cell:"셀모임" };
const TSTAT  = { planned:"수강 예정", ongoing:"수강 중", done:"수료", dropped:"중도 포기" };
const ATT    = { present:"출석", online:"온라인", absent:"결석" };
const PLACES = ["카페","식사","집","교회","전화","산책"];
const RELS   = ["배우자","아버지","어머니","아들","딸","형제","자매"];

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
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
function todayStr() { return ymd(new Date()); }
function plusDays(n) { const d = new Date(); d.setDate(d.getDate()+n); return ymd(d); }
function parseDateLoose(raw) {
  if (!raw) return "";
  const t = String(raw).trim().replace(/[.\/년월]/g, "-").replace(/일/g, "").replace(/\s+/g, "");
  const nums = t.split("-").filter(Boolean).map(Number);
  if (!nums.length || nums.some(n => isNaN(n))) return null;
  if (nums.length === 1) { const y = nums[0]; return (y>=1900 && y<=2100) ? `${y}-00-00` : null; }
  if (nums.length === 2) {
    if (nums[0] >= 1900) return `${nums[0]}-${pad2(nums[1])}-00`;
    if (nums[0] >= 1 && nums[0] <= 12 && nums[1] >= 1 && nums[1] <= 31)
      return `0000-${pad2(nums[0])}-${pad2(nums[1])}`;
    return null;
  }
  let [y,m,d] = nums;
  if (y < 100) y += (y > 30 ? 1900 : 2000);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function fmtDate(s, withYear) {
  if (!s) return "";
  const p = String(s).split("-"); if (p.length < 3) return s;
  const [y,m,d] = p;
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
const daysUntil = (s) => { const n = daysSince(s); return n === null ? null : -n; };
function agoText(n) {
  if (n === null) return "아직 만남 기록 없음";
  if (n <= 0) return "오늘 만났어요";
  if (n === 1) return "어제 만났어요";
  return `마지막 만남 ${n}일 전`;
}
function annivIn(dateStr) {
  if (!dateStr) return null;
  const p = String(dateStr).split("-");
  if (p.length < 3 || p[1] === "00" || p[2] === "00") return null;
  const now = new Date(todayStr() + "T00:00:00");
  let d = new Date(now.getFullYear(), Number(p[1])-1, Number(p[2]));
  if (d < now) d = new Date(now.getFullYear()+1, Number(p[1])-1, Number(p[2]));
  return Math.round((d - now) / 86400000);
}
function fmtPhone(v) {
  const n = String(v||"").replace(/\D/g,"").slice(0,11);
  if (!n) return "";
  if (n.startsWith("02")) {
    if (n.length<=2) return n;
    if (n.length<=5) return `${n.slice(0,2)}-${n.slice(2)}`;
    if (n.length<=9) return `${n.slice(0,2)}-${n.slice(2,5)}-${n.slice(5)}`;
    return `${n.slice(0,2)}-${n.slice(2,6)}-${n.slice(6,10)}`;
  }
  if (n.length<=3) return n;
  if (n.length<=7) return `${n.slice(0,3)}-${n.slice(3)}`;
  if (n.length<=10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
  return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`;
}

/* ── 상태 ── */
const state = {
  user:null, me:null,
  jins:[], cells:[], members:[], invites:[], courses:[],
  souls:[], meetings:[], trainings:[], allRecords:null, allTrainings:null,
  soul:null, records:[], soulTab:"rec", recKw:"", recType:"all",
  meeting:null, log:null,
  prayIdx:0, filter:"all", photoCache:{}, editingId:null, editPhoto:undefined,
  editDirty:false, lastTab:"home", calMonth:null, calPick:null, gsFilter:"all"
};
const uid = () => auth.currentUser ? auth.currentUser.uid : null;
const isLeaderOf = (s) => s && s.leaderUid === uid();
const canLead = () => state.me && (state.me.role === "leader" || state.me.isLeader === true);
const initial = (name) => (name || "?").trim().slice(-1);
const pack = (s) => s.docs.map(d => ({ id:d.id, ...d.data() }));

/* ── 입력 편의 ── */
function autoGrow(el){ el.style.height="auto"; el.style.height=Math.min(el.scrollHeight,500)+"px"; }
document.addEventListener("input", (ev) => { if (ev.target.tagName === "TEXTAREA") autoGrow(ev.target); });
document.addEventListener("focusin", (ev) => {
  const t = ev.target;
  if (!t.matches || !t.matches("input,textarea,select")) return;
  if (isWide()) return;
  setTimeout(() => { try { t.scrollIntoView({ block:"center", behavior:"smooth" }); } catch {} }, 250);
});

/* ── 네비게이션 ── */
const ICON = {
  home:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4.2l8 6.3V19a1.5 1.5 0 0 1-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/></svg>`,
  souls:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="8.5" r="3"/><path d="M4 19.5v-1a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v1M16.5 6.2a3 3 0 0 1 0 4.6M17.5 14.7a4 4 0 0 1 2.5 3.7v1.1"/></svg>`,
  cal:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10.5h17M8.5 3.5v4M15.5 3.5v4"/></svg>`,
  meet:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="m8 12.5 2.6 2.6L16.5 9.5"/></svg>`,
  more:`<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`
};
const NAV = [["home","홈"],["souls","영혼들"],["cal","캘린더"],["meet","셀모임"],["more","더보기"]];
function renderNav() {
  document.querySelectorAll("[data-nav]").forEach(nav => {
    nav.innerHTML = NAV.map(([k,label]) =>
      `<button data-tab="${k}" class="${nav.dataset.nav === k ? "on" : ""}">${ICON[k]}${label}</button>`).join("");
  });
  $("side-nav").innerHTML = NAV.map(([k,label]) =>
    `<button data-tab="${k}" data-side="${k}">${ICON[k]}${label}</button>`).join("");
}
renderNav();
function markSide(which) {
  $("side-nav").querySelectorAll("[data-side]").forEach(b =>
    b.classList.toggle("on", b.dataset.side === which));
  state.lastTab = which;
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-tab]"); if (!b) return;
  const t = b.dataset.tab;
  if (t === "home") openHome();
  else if (t === "souls") openSouls();
  else if (t === "cal") openCal();
  else if (t === "meet") openMeet();
  else if (t === "more") openMore();
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
  if (!user.emailVerified) { $("verify-email").textContent = user.email || ""; show("s-verify"); return; }
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
      { name: jinName, jinjangUid:null, active:true, createdAt: serverTimestamp() });
    await setDoc(doc(db, "users", u.uid), {
      name: myName, email:(u.email||"").toLowerCase(), role:"super",
      jinId:null, cellId:null, cellIds:[], isLeader:false, active:true, createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "system", "bootstrap"), { at: serverTimestamp(), by:u.uid });
    toast("설정이 끝났어요."); route(u);
  } catch (e) { $("setup-err").textContent = msgOf(e); }
  finally { $("btn-setup").disabled = false; }
};
$("btn-accept").onclick = async () => {
  const name = $("ac-name").value.trim();
  $("accept-err").textContent = "";
  if (!name) { $("accept-err").textContent = "이름을 적어주세요."; return; }
  const u = auth.currentUser, email = (u.email||"").toLowerCase();
  $("btn-accept").disabled = true;
  try {
    await setDoc(doc(db, "users", u.uid), {
      name, email, role: state.invite.role, jinId: state.invite.jinId,
      cellId: state.invite.cellId || null, cellIds:[], isLeader:false,
      active:true, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "invites", email),
      { status:"accepted", acceptedUid:u.uid, acceptedAt: serverTimestamp() });
    route(u);
  } catch (e) { $("accept-err").textContent = msgOf(e); }
  finally { $("btn-accept").disabled = false; }
};

/* ════════ 데이터 ════════ */
async function loadOrg() {
  const me = state.me, isSuper = me.role === "super";
  const mine = (col) => isSuper ? getDocs(collection(db, col))
    : getDocs(query(collection(db, col), where("jinId","==",me.jinId)));
  try {
    const [jins, cells, users, invites, courses] = await Promise.all([
      getDocs(collection(db,"jins")), mine("cells"), mine("users"), mine("invites"),
      getDocs(collection(db,"courses"))
    ]);
    state.jins = pack(jins);
    state.cells = pack(cells);
    state.members = pack(users).sort((a,b)=>(a.name||"").localeCompare(b.name||"","ko"));
    state.invites = pack(invites);
    state.courses = pack(courses).filter(c=>c.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
  } catch (e) { toast(msgOf(e)); }
}
async function loadSouls() {
  const me = state.me, col = collection(db,"souls");
  const out=[], seen={};
  const push = (rows) => rows.forEach(r => { if(!seen[r.id]){seen[r.id]=true;out.push(r);} });
  try {
    if (canLead()) push(pack(await getDocs(query(col, where("leaderUid","==",me.id)))));
    if (me.role === "coach") {
      const res = await Promise.all((me.cellIds||[]).map(cid => getDocs(query(col, where("cellId","==",cid)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "jinjang") push(pack(await getDocs(query(col, where("jinId","==",me.jinId)))));
    state.souls = out.filter(s=>s.active!==false).sort((a,b)=>(a.name||"").localeCompare(b.name||"","ko"));
  } catch (e) { state.souls=[]; toast(msgOf(e)); }
}
async function loadMeetings() {
  const me = state.me, col = collection(db,"meetings");
  const out=[], seen={};
  const push = (rows) => rows.forEach(r => { if(!seen[r.id]){seen[r.id]=true;out.push(r);} });
  try {
    if (canLead()) push(pack(await getDocs(query(col, where("leaderUid","==",me.id)))));
    if (me.role === "coach") {
      const res = await Promise.all((me.cellIds||[]).map(cid => getDocs(query(col, where("cellId","==",cid)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "jinjang") push(pack(await getDocs(query(col, where("jinId","==",me.jinId)))));
    state.meetings = out.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  } catch (e) { state.meetings=[]; toast(msgOf(e)); }
}
async function loadRecords(soulId, canSeeAll) {
  const col = collection(db,"souls",soulId,"records");
  try {
    let rows = [];
    if (canSeeAll) {
      const [a,b,c] = await Promise.all([
        getDocs(query(col, where("by","==",uid()))),
        getDocs(query(col, where("scope","==","leader"))),
        getDocs(query(col, where("scope","==","coach")))
      ]);
      rows = [...pack(a), ...pack(b), ...pack(c)];
    } else rows = pack(await getDocs(query(col, where("scope","==","coach"))));
    const seen = {};
    state.records = rows.filter(r => seen[r.id] ? false : (seen[r.id]=true))
      .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  } catch (e) { state.records=[]; toast(msgOf(e)); }
}
/* 내 영혼들의 기록을 한꺼번에 (검색 · 캘린더용) */
async function loadAllRecords(force) {
  if (state.allRecords && !force) return state.allRecords;
  const out = [];
  for (const s of state.souls) {
    try {
      const col = collection(db,"souls",s.id,"records");
      let rows = [];
      if (isLeaderOf(s)) {
        const [a,b,c] = await Promise.all([
          getDocs(query(col, where("by","==",uid()))),
          getDocs(query(col, where("scope","==","leader"))),
          getDocs(query(col, where("scope","==","coach")))
        ]);
        rows = [...pack(a), ...pack(b), ...pack(c)];
      } else rows = pack(await getDocs(query(col, where("scope","==","coach"))));
      const seen = {};
      rows.filter(r => seen[r.id] ? false : (seen[r.id]=true))
        .forEach(r => out.push({ ...r, soulId:s.id, soulName:s.name }));
    } catch {}
  }
  state.allRecords = out.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  return state.allRecords;
}
async function loadAllTrainings(force) {
  if (state.allTrainings && !force) return state.allTrainings;
  const out = [];
  for (const s of state.souls) {
    try {
      const rows = pack(await getDocs(collection(db,"souls",s.id,"trainings")));
      rows.forEach(t => out.push({ ...t, soulId:s.id, soulName:s.name }));
    } catch {}
  }
  state.allTrainings = out;
  return out;
}
async function loadTrainings(soulId) {
  const rank = { ongoing:0, planned:1, done:2, dropped:3 };
  try {
    state.trainings = pack(await getDocs(collection(db,"souls",soulId,"trainings")))
      .sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)
        || String(b.startDate||"").localeCompare(String(a.startDate||"")));
  } catch { state.trainings=[]; }
}
async function loadPhoto(soulId) {
  if (state.photoCache[soulId] !== undefined) return state.photoCache[soulId];
  try {
    const s = await getDoc(doc(db,"photos",soulId));
    state.photoCache[soulId] = s.exists() ? (s.data().self||null) : null;
  } catch { state.photoCache[soulId]=null; }
  return state.photoCache[soulId];
}
const invalidate = () => { state.allRecords = null; state.allTrainings = null; };

/* ── 출석 계산 ── */
const cellMeetings = (cellId) => state.meetings.filter(m => m.cellId === cellId);
function attendRate(soulId, cellId) {
  const ms = cellMeetings(cellId).filter(m => m.attendance && m.attendance[soulId]);
  if (!ms.length) return null;
  return Math.round(ms.filter(m => m.attendance[soulId] !== "absent").length / ms.length * 100);
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
  let title = APP_NAME;
  try { const org = await getDoc(doc(db,"org","main")); if (org.exists()) title = org.data().name; } catch {}
  $("home-title").textContent = title;
  $("home-role").textContent = ROLE[me.role] || me.role;

  await loadOrg();
  const sees = canLead() || me.role === "coach" || me.role === "jinjang";
  if (sees) { await loadSouls(); await loadMeetings(); } else { state.souls=[]; state.meetings=[]; }

  const jin = state.jins.find(j=>j.id===me.jinId);
  const cell = state.cells.find(c=>c.id===me.cellId);
  const where1 = (me.role==="super" && !me.isLeader) ? "전체" : (cell?cell.name:(jin?jin.name:""));
  $("home-where").textContent = where1; $("home-where").hidden = !where1;
  $("side-who").innerHTML = `${esc(me.name||"")}<br>${esc(ROLE[me.role]||"")}${where1?" · "+esc(where1):""}`;

  const pendingN = state.invites.filter(i=>i.status==="pending").length;
  const todos = openTodos(), annivs = upcomingAnnivs();
  const absentees = state.souls.filter(s=>isLeaderOf(s) && absentStreak(s.id,s.cellId)>=2);
  $("btn-quick-add").hidden = !canLead();

  if (canLead()) {
    const mine = state.souls.filter(isLeaderOf);
    const recent = state.meetings.slice(0,6);
    const rate = recent.length ? Math.round(recent.reduce((sum,m)=>{
      const v = Object.values(m.attendance||{});
      return sum + (v.length ? v.filter(x=>x!=="absent").length/v.length : 0);
    },0)/recent.length*100) : null;
    $("home-tiles").innerHTML = tile("영혼", mine.length+"명")
      + tile("이번 주 기념일", annivs.length+"명") + tile("챙길 일", todos.length+"건")
      + tile("최근 출석률", rate===null?"—":rate+"%")
      + tile("셀모임", state.meetings.length+"회")
      + tile("기도 중", mine.reduce((n,s)=>n+(s.prayOpen||0),0)+"개");
    renderAbsent(absentees); renderPray(); renderTodos(todos); renderAnnivs(annivs);
  } else if (me.role==="coach" || me.role==="jinjang") {
    $("home-tiles").innerHTML = tile("영혼", state.souls.length+"명")
      + tile("셀", state.cells.length+"개") + tile("구성원", state.members.length+"명");
    $("home-absent").innerHTML = "";
    $("home-pray").innerHTML = card("맡겨진 셀을 살펴보세요",
      "영혼들 탭에서 카드를, 셀모임 탭에서 출석을 볼 수 있어요. 기록은 '코치 공유'로 올라온 것만 보여요.");
    $("home-todo").innerHTML=""; $("home-anniv").innerHTML="";
  } else {
    $("home-tiles").innerHTML = tile("구성원", state.members.length+"명")
      + tile("셀", state.cells.length+"개") + tile("대기 중 초대", pendingN+"건");
    $("home-absent").innerHTML = "";
    $("home-pray").innerHTML = card("영혼 카드는 담당 리더만 열람해요",
      "수퍼 관리자는 사람과 진을 배치해요. 셀을 직접 맡고 있다면 리더 관리에서 '나도 셀을 맡아요'를 켜주세요.");
    $("home-todo").innerHTML=""; $("home-anniv").innerHTML="";
  }
  $("btn-manage").hidden = !(me.role==="super" || me.role==="jinjang");
  markSide("home"); show("s-home");
}
const tile = (k,v) => `<div class="tile"><p class="k">${k}</p><p class="v">${v}</p></div>`;
const card = (h,b) => `<div class="card"><h3 class="serif" style="font-size:17px;font-weight:600">${h}</h3>
  <p class="muted" style="margin-top:8px">${b}</p></div>`;

function renderAbsent(list) {
  if (!list.length) { $("home-absent").innerHTML=""; return; }
  $("home-absent").innerHTML = `
    <div class="card" style="margin-top:14px;background:var(--warn-bg);border-color:#3A2E1E">
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--warn-tx)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9.2v4m0 2.9h.01"/><path d="M10.4 4.3 3 17.2A1.8 1.8 0 0 0 4.6 20h14.8a1.8 1.8 0 0 0 1.6-2.8L13.6 4.3a1.8 1.8 0 0 0-3.2 0Z"/></svg>
        연속 결석
      </div>
      <p style="margin-top:8px;font-size:14px;line-height:1.7;color:#E8D9C4">
        ${list.map(s=>`${esc(s.name)} (${absentStreak(s.id,s.cellId)}주)`).join(" · ")}</p>
      <p class="muted" style="margin-top:6px;font-size:12px">안부 연락을 남겨볼 때예요.</p>
    </div>`;
}
const prayList = () => state.souls.filter(s=>(s.prayOpen||0)>0 && isLeaderOf(s))
  .sort((a,b)=>String(a.lastPrayedAt||"").localeCompare(String(b.lastPrayedAt||"")));
function renderPray() {
  const list = prayList();
  if (!list.length) {
    $("home-pray").innerHTML = card("기도제목을 적어보세요",
      "영혼 카드에서 기도제목을 추가하면, 여기에 오늘 기도할 영혼이 한 명씩 떠요."); return;
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
            <span class="chip rose">${esc(STATUS[s.status]||"—")}</span>
            ${top.since?`<span class="chip">${(daysSince(top.since)||0)+1}일째 기도</span>`:""}
          </div>
        </div>
      </div>
      <p style="margin-top:14px;font-size:15px;line-height:1.75;color:#DCD6D5">${esc(top.text||"기도제목을 적어주세요.")}</p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" style="height:48px" data-pray="${s.id}">기도했어요</button>
        <button class="btn-ghost" style="width:48px;height:48px;flex-shrink:0;padding:0" data-next="1" aria-label="다음 영혼">›</button>
      </div>
    </section>`;
}
function openTodos() {
  const out = [];
  state.souls.filter(isLeaderOf).forEach(s =>
    (s.todos||[]).filter(t=>!t.done).forEach(t=>out.push({...t,soulId:s.id,soulName:s.name})));
  return out.sort((a,b)=>String(a.due||"9999").localeCompare(String(b.due||"9999")));
}
function renderTodos(todos) {
  if (!todos.length) { $("home-todo").innerHTML=""; return; }
  $("home-todo").innerHTML = `
    <h3 class="sec-title">챙길 일</h3>
    <div class="list">${todos.slice(0,6).map(t=>`
      <div class="row">
        <button class="icon-btn" style="width:34px;height:34px;color:#6E6260"
          data-done="${t.id}" data-soul="${t.soulId}" aria-label="완료">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/></svg>
        </button>
        <div class="grow" data-gosoul="${t.soulId}" style="cursor:pointer">
          <p class="nm">${esc(t.soulName)} · ${esc(t.text)}</p>
          <p class="sub">${t.due?(daysUntil(t.due)<0?"지남 · ":"")+fmtDate(t.due)+"까지":"날짜 없음"}</p>
        </div>
      </div>`).join("")}</div>`;
}
function upcomingAnnivs() {
  const out = [];
  state.souls.filter(isLeaderOf).forEach(s => {
    [["birth","생일"],["baptizedAt","세례"],["marriedAt","결혼기념일"]].forEach(([f,label])=>{
      const d = annivIn(s[f]);
      if (d !== null && d <= 7) out.push({ id:s.id, name:s.name, label, d, date:s[f] });
    });
  });
  return out.sort((a,b)=>a.d-b.d);
}
function renderAnnivs(list) {
  if (!list.length) { $("home-anniv").innerHTML=""; return; }
  $("home-anniv").innerHTML = `
    <h3 class="sec-title">이번 주 기념일</h3>
    <div class="list">${list.map(a=>`
      <div class="row" data-gosoul="${a.id}" style="cursor:pointer">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F24557" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 20h15M6 20v-5.2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V20M12 12.2V9.6"/><circle cx="12" cy="7.6" r="1"/></svg>
        <div class="grow"><p class="nm">${esc(a.name)} ${a.label}</p>
          <p class="sub">${fmtDate(a.date)} · ${a.d===0?"오늘":"D-"+a.d}</p></div>
      </div>`).join("")}</div>`;
}
$("s-home").addEventListener("click", async (ev) => {
  const go = ev.target.closest("[data-gosoul]"); if (go) { openSoul(go.dataset.gosoul); return; }
  const next = ev.target.closest("[data-next]");
  if (next) { const n=prayList().length; state.prayIdx=(state.prayIdx+1)%Math.max(n,1); renderPray(); return; }
  const pray = ev.target.closest("[data-pray]");
  if (pray) {
    try {
      await updateDoc(doc(db,"souls",pray.dataset.pray), { lastPrayedAt: todayStr() });
      const s = state.souls.find(x=>x.id===pray.dataset.pray); if (s) s.lastPrayedAt = todayStr();
      toast("기도 기록을 남겼어요."); renderPray();
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const done = ev.target.closest("[data-done]");
  if (done) {
    const s = state.souls.find(x=>x.id===done.dataset.soul); if (!s) return;
    const todos = (s.todos||[]).map(t=>t.id===done.dataset.done?{...t,done:true}:t);
    try {
      await updateDoc(doc(db,"souls",s.id), { todos });
      s.todos = todos; toast("완료 처리했어요.");
      const list = openTodos(); renderTodos(list);
      const tl = $("home-tiles").children; if (tl[2]) tl[2].querySelector(".v").textContent = list.length+"건";
    } catch (e) { toast(msgOf(e)); }
  }
});
$("btn-manage").onclick = () => openManage();
$("btn-back").onclick = () => openHome();
$("btn-quick-add").onclick = () => {
  const mine = state.souls.filter(isLeaderOf);
  if (!mine.length) { toast("먼저 영혼 카드를 하나 만들어 주세요."); openSouls(); return; }
  openLog(null, null);
};

/* ════════ 영혼 목록 ════════ */
async function openSouls() {
  if (!canLead() && state.me.role!=="coach" && state.me.role!=="jinjang") {
    toast("영혼 카드는 담당 리더만 볼 수 있어요. 리더 관리에서 '나도 셀을 맡아요'를 켤 수 있어요."); return;
  }
  show("s-loading");
  await loadOrg(); await loadSouls(); await loadMeetings();
  renderFilter(); renderSouls();
  $("btn-soul-new").hidden = !canLead();
  markSide("souls"); show("s-souls");
}
function renderFilter() {
  const f = [["all","전체"],["care","돌봄 필요"],["new","새가족"],["due","연락할 때"]];
  $("soul-filter").innerHTML = f.map(([k,l])=>`<button data-f="${k}" class="${state.filter===k?"on":""}">${l}</button>`).join("");
}
$("soul-filter").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-f]"); if(!b) return;
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
  if (state.filter==="care") list = list.filter(s=>s.status==="care");
  if (state.filter==="new") list = list.filter(s=>s.status==="new");
  if (state.filter==="due") list = list.filter(contactDue);
  if (kw) list = list.filter(s=>(s.name||"").includes(kw));
  $("list-souls").innerHTML = list.map(s=>{
    const n = daysSince(s.lastMetAt), st = absentStreak(s.id,s.cellId);
    return `<div class="row" data-open="${s.id}" style="cursor:pointer">
      <span class="ava">${esc(initial(s.name))}</span>
      <div class="grow">
        <p class="nm">${esc(s.name)}</p>
        <p class="sub">${agoText(n)}${(s.prayOpen||0)>0?` · 기도 ${s.prayOpen}`:""}${st>=2?` · 결석 ${st}주`:""}</p>
      </div>
      <span class="chip ${s.status==="care"?"warn":"rose"}">${esc(STATUS[s.status]||"—")}</span>
    </div>`;
  }).join("") || `<p class="muted">${
    kw ? "찾는 이름이 없어요."
    : state.me.role==="coach" && !(state.me.cellIds||[]).length
    ? "담당 셀이 아직 지정되지 않았어요. 진장에게 요청해 주세요."
    : state.filter!=="all" ? "이 조건에 맞는 영혼이 없어요."
    : "아직 등록된 영혼이 없어요. 오른쪽 위 + 를 눌러 시작해요."}</p>`;
}
$("list-souls").addEventListener("click",(ev)=>{
  const r = ev.target.closest("[data-open]"); if(!r) return; openSoul(r.dataset.open);
});
$("btn-soul-new").onclick = () => openEdit(null);

/* ════════ 영혼 카드 ════════ */
async function openSoul(soulId) {
  show("s-loading");
  if (!state.souls.length) { await loadOrg(); await loadSouls(); await loadMeetings(); }
  const s = state.souls.find(x=>x.id===soulId);
  if (!s) { toast("카드를 찾을 수 없어요."); openSouls(); return; }
  state.soul = s; state.soulTab = "rec"; state.recKw = ""; state.recType = "all";
  await loadRecords(soulId, isLeaderOf(s));
  await loadTrainings(soulId);
  const photo = await loadPhoto(soulId);

  $("soul-ava").textContent = photo ? "" : initial(s.name);
  $("soul-ava").style.backgroundImage = photo ? `url(${photo})` : "";
  $("soul-name").textContent = s.name;
  const cell = state.cells.find(c=>c.id===s.cellId);
  $("soul-chips").innerHTML = `<span class="chip rose">${esc(STATUS[s.status]||"—")}</span>`
    + (cell?`<span class="chip">${esc(cell.name)}</span>`:"");
  const tel = (s.phone||"").replace(/\D/g,"");
  $("soul-contact").innerHTML = tel ? `
    <div style="display:flex;gap:8px;max-width:420px">
      <a class="btn-ghost" href="tel:${tel}" style="height:44px;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--text);font-size:13px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5h3l1.4 3.5-2 1.4a10.5 10.5 0 0 0 5.2 5.2l1.4-2 3.5 1.4v3a1.6 1.6 0 0 1-1.8 1.6C11.3 18.2 5.8 12.7 5.4 6.3A1.6 1.6 0 0 1 7 4.5Z"/></svg>전화</a>
      <a class="btn-ghost" href="sms:${tel}" style="height:44px;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--text);font-size:13px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5.5h15v11h-9l-4 3.5v-3.5h-2z"/></svg>문자</a>
    </div>` : "";
  updateSummary();
  $("soul-edit").hidden = !isLeaderOf(s);
  $("btn-log-new").hidden = !isLeaderOf(s);
  $("btn-rec-new").hidden = !isLeaderOf(s);
  renderSoulTabs(); renderSoulBody();
  show("s-soul");
}
function updateSummary() {
  const s = state.soul, n = daysSince(s.lastMetAt), rate = attendRate(s.id,s.cellId);
  const meets = state.records.filter(r=>r.type==="meet").length;
  $("soul-summary").textContent = agoText(n)
    + (rate===null?"":` · 출석 ${rate}%`)
    + ` · 만남 ${meets}회 · 기도 ${s.prayOpen||0}개`;
}
$("soul-back").onclick = () => state.lastTab==="home" ? openHome() : openSouls();
$("soul-edit").onclick = () => openEdit(state.soul.id);
function renderSoulTabs() {
  $("soul-tabs").querySelectorAll("[data-st]").forEach(b=>b.classList.toggle("on", b.dataset.st===state.soulTab));
}
$("soul-tabs").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-st]"); if(!b) return;
  state.soulTab = b.dataset.st; renderSoulTabs(); renderSoulBody();
});
function scopeChip(scope) {
  const cls = scope==="coach" ? "rose" : scope==="private" ? "lock" : "";
  return `<span class="chip ${cls}">${SCOPE[scope]||scope}</span>`;
}
/* 검색어 강조 */
function hl(text, kw) {
  const t = esc(text || "");
  if (!kw) return t;
  const k = esc(kw).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return t.replace(new RegExp(k,"gi"), m=>`<mark>${m}</mark>`);
}
const recText = (r) => [r.body,r.place,r.did,r.talked,r.beforeHeart,r.beforeWord,
  r.duringHeart,r.update,r.spiritual].filter(Boolean).join(" ");

function recCard(r, kw, showSoul) {
  const blocks = [
    ["만나기 전 받은 마음", r.beforeHeart],
    ["주신 말씀", r.beforeWord],
    ["무엇을 했나", r.did],
    ["나눈 이야기", r.talked],
    ["만나면서 받은 마음", r.duringHeart],
    ["근황 · 현재 상황", r.update],
    ["영적 상태", r.spiritual]
  ].filter(([,v]) => v);
  const head = r.type==="meet"
    ? `${KIND[r.kind]||"만남"} · ${fmtDate(r.date)}${r.time?" "+r.time:""}${r.place?" · "+esc(r.place):""}`
    : `${RTYPE[r.type]||r.type} · ${fmtDate(r.date)}`;
  return `<article class="rec">
    <div class="head">
      <span style="font-size:12px;color:var(--dim)">${showSoul?`<b style="color:var(--text)">${esc(r.soulName)}</b> · `:""}${head}</span>
      ${scopeChip(r.scope)}
    </div>
    ${r.type!=="meet" && r.body ? `<p class="body${r.type==="heart"?" serif":""}">${hl(r.body,kw)}</p>` : ""}
    ${blocks.map(([l,v])=>`<div class="blk"><p class="lbl">${l}</p><p>${hl(v,kw)}</p></div>`).join("")}
    <div class="foot">
      ${r.type==="pray"?`<span class="chip ${r.prayStatus==="answered"?"ok":""}">${r.prayStatus==="answered"?"응답됨":"기도 중 "+((daysSince(r.date)||0)+1)+"일째"}</span>`:""}
      ${r.type==="heart"?`<span class="chip">${r.who==="soul"?"이 친구가 받은 은혜":"내가 받은 마음"}</span>`:""}
      ${r.meetingId?`<span class="chip">셀모임에서</span>`:""}
      ${r.by===uid()&&!showSoul?`
        ${r.type==="pray"&&r.prayStatus!=="answered"?`<button class="btn-sm" data-answer="${r.id}">응답됐어요</button>`:""}
        <button class="btn-sm" data-editrec="${r.id}" data-rtype="${r.type}">수정</button>
        <button class="btn-sm danger" data-delrec="${r.id}">삭제</button>`:""}
      ${showSoul?`<button class="btn-sm" data-gosoul2="${r.soulId}">카드 열기</button>`:""}
    </div>
  </article>`;
}

function renderSoulBody() {
  const s = state.soul, mine = isLeaderOf(s), box = $("soul-body");

  if (state.soulTab === "rec") {
    const kw = state.recKw.trim();
    let list = state.records;
    if (state.recType !== "all") list = list.filter(r=>r.type===state.recType);
    if (kw) list = list.filter(r => recText(r).toLowerCase().includes(kw.toLowerCase()));
    const types = [["all","전체"],["meet","만남"],["pray","기도"],["heart","받은 마음"]];
    box.innerHTML = `
      <input id="rec-search" placeholder="기록 안에서 찾기 (예: 이직, 어머니)" value="${esc(state.recKw)}" style="height:44px">
      <div class="seg" id="rec-type">${types.map(([k,l])=>
        `<button data-rty="${k}" class="${state.recType===k?"on":""}">${l}</button>`).join("")}</div>
      <p class="hint" style="margin:10px 0 12px">${list.length}건${kw?` · '${esc(kw)}' 검색 결과`:""}</p>
      <div class="list">${list.length ? list.map(r=>recCard(r,kw,false)).join("")
        : `<p class="muted">${kw?"찾는 말이 없어요."
          : mine?"아직 기록이 없어요. 아래 '만남 기록'으로 첫 기록을 남겨보세요."
          :"공유된 기록이 없어요. 담당 리더가 코치 공유로 올린 기록만 보여요."}</p>`}</div>`;
    const si = $("rec-search");
    si.oninput = () => { state.recKw = si.value; const p=si.selectionStart; renderSoulBody();
      const n=$("rec-search"); n.focus(); try{n.setSelectionRange(p,p);}catch{} };
    $("rec-type").addEventListener("click",(ev)=>{
      const b = ev.target.closest("[data-rty]"); if(!b) return;
      state.recType = b.dataset.rty; renderSoulBody();
    });
  }

  if (state.soulTab === "todo") {
    const todos = (s.todos||[]);
    box.innerHTML = `
      ${mine?`<button class="btn-ghost" id="btn-todo-new" style="height:44px;font-size:13px;margin-bottom:12px;max-width:320px">후속조치 추가</button>`:""}
      <div class="list">${todos.length?todos.map(t=>`
        <div class="row ${t.done?"off":""}">
          ${mine?`<button class="icon-btn" style="width:34px;height:34px;color:${t.done?"#F24557":"#6E6260"}" data-tgl="${t.id}" aria-label="완료 전환">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/>${t.done?'<path d="m8.5 12 2.5 2.5 4.5-5" stroke-linecap="round" stroke-linejoin="round"/>':""}</svg>
          </button>`:""}
          <div class="grow"><p class="nm" style="white-space:normal">${esc(t.text)}</p>
            <p class="sub">${t.due?fmtDate(t.due)+"까지":"날짜 없음"}${t.done?" · 완료":""}</p></div>
          ${mine?`<button class="btn-sm danger" data-deltodo="${t.id}">삭제</button>`:""}
        </div>`).join(""):`<p class="muted">후속조치가 없어요.</p>`}</div>`;
    const b=$("btn-todo-new"); if(b) b.onclick=()=>openTodoDlg();
  }

  if (state.soulTab === "train") {
    const byCourse = {};
    state.trainings.forEach(t=>{
      const cur = byCourse[t.courseId];
      if (!cur || String(t.startDate||"") > String(cur.startDate||"")) byCourse[t.courseId]=t;
    });
    const canAddCourse = state.me.role==="super" || state.me.role==="jinjang";
    const doneN = state.courses.filter(c=>byCourse[c.id]&&byCourse[c.id].status==="done").length;
    const grid = state.courses.map(c=>{
      const t = byCourse[c.id], total = c.sessions||1, okN = t?doneSessions(t):0;
      let line = "아직 안 들음";
      if (t && t.status==="done") line = "수료"+(t.cohort?` · ${t.cohort}`:"");
      else if (t && t.status==="ongoing") line = total>1?`수강 중 ${okN}/${total}회`:"수강 중";
      else if (t && t.status==="planned") line = "수강 예정";
      else if (t && t.status==="dropped") line = "중도 포기";
      const bar = (t&&t.status==="ongoing"&&total>1)
        ? `<div class="pbar"><i style="width:${Math.round(okN/total*100)}%"></i></div>`:"";
      return `<div class="cbox ${t?t.status:""}"><p class="cn">${esc(c.name)}</p><p class="cs">${line}</p>${bar}</div>`;
    }).join("");
    box.innerHTML = `
      ${state.courses.length?`
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <h3 style="font-size:13px;font-weight:600">훈련 현황</h3>
            <span class="muted" style="font-size:12px">${state.courses.length}개 중 ${doneN}개 수료</span>
          </div>
          <div class="courses">${grid}</div>
        </div>`:`
        <div class="card"><p class="muted">훈련 과정이 아직 등록되지 않았어요.</p>
          ${canAddCourse?`<button class="btn-sm" id="btn-course-here" style="margin-top:12px">여기서 과정 등록하기</button>`
            :`<p class="muted" style="margin-top:8px">진장에게 과정 등록을 요청해 주세요.</p>`}</div>`}
      ${mine&&state.courses.length?`<button class="btn-ghost" id="btn-train-new" style="height:44px;font-size:13px;margin-top:12px;max-width:320px">훈련 기록 추가</button>`:""}
      <div class="list" style="margin-top:12px">${state.trainings.length?state.trainings.map(t=>{
        const c = state.courses.find(x=>x.id===t.courseId);
        const total = (c&&c.sessions)||t.totalSessions||1, okN = doneSessions(t), log = t.sessionLog||[];
        const dots = total>1?`<div class="dots">${Array.from({length:total},(_,i)=>{
          const x = log.find(y=>y.no===i+1);
          return `<span class="${x&&x.ok?"ok":""}" title="${x&&x.date?fmtDate(x.date):""}">${i+1}</span>`;
        }).join("")}</div>`:"";
        const last = log.filter(x=>x.ok&&x.date).map(x=>x.date).sort().pop();
        return `<div class="row" style="flex-direction:column;align-items:stretch">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="grow"><p class="nm">${esc(t.courseName)}${t.cohort?" · "+esc(t.cohort):""}</p>
              <p class="sub">${fmtDate(t.startDate,true)}${t.endDate?" ~ "+fmtDate(t.endDate,true):""}${total>1?` · ${okN}/${total}회`:""}${last?` · 최근 ${fmtDate(last)}`:""}</p></div>
            <span class="chip ${t.status==="done"?"ok":t.status==="dropped"?"warn":"rose"}">${TSTAT[t.status]||t.status}</span>
          </div>
          ${t.note?`<p class="sub" style="margin-top:6px;white-space:normal">${esc(t.note)}</p>`:""}
          ${dots}
          ${mine?`<div class="acts">
            ${total>1?`<button class="btn-sm" data-ses="${t.id}">회차 기록</button>`:""}
            <button class="btn-sm" data-edittrain="${t.id}">수정</button>
            <button class="btn-sm danger" data-deltrain="${t.id}">삭제</button></div>`:""}
        </div>`;
      }).join(""):`<p class="muted">훈련 이력이 없어요.</p>`}</div>`;
    const b=$("btn-train-new"); if(b) b.onclick=()=>openTrainDlg(null);
    const c=$("btn-course-here"); if(c) c.onclick=()=>openCourseDlg(null,()=>renderSoulBody());
  }

  if (state.soulTab === "profile") {
    const rows = [
      ["생일", s.birth?fmtDate(s.birth,true)+(s.lunar?" (음력)":""):""],
      ["연락처", s.phone], ["주소", [s.address,s.address2].filter(Boolean).join(" ")],
      ["직장 · 학교", s.job], ["성별", s.gender],
      ["교회 등록일", fmtDate(s.registeredAt,true)], ["세례일", fmtDate(s.baptizedAt,true)],
      ["결혼기념일", fmtDate(s.marriedAt,true)], ["직분", s.position],
      ["인도자", s.invitedBy], ["인생 말씀", s.verse],
      ["취미", s.hobby], ["MBTI", s.mbti], ["좋아하는 것", s.food],
      ["피해야 할 것", s.avoid], ["요즘 관심사", s.interest],
      ["연락 주기", s.contactCycle?s.contactCycle+"일마다":""], ["메모", s.memo]
    ].filter(([,v])=>v);
    box.innerHTML = (rows.length?`<div class="list">${rows.map(([k,v])=>`
      <div class="row"><div class="grow"><p class="sub" style="margin:0">${k}</p>
        <p class="nm" style="margin-top:4px;white-space:pre-wrap">${esc(v)}</p></div></div>`).join("")}</div>`
      :`<p class="muted">아직 적은 정보가 없어요.</p>`)
      + (mine?`<button class="btn-ghost" id="btn-edit-here" style="height:44px;font-size:13px;margin-top:12px;max-width:320px">프로필 수정</button>`:"");
    const e=$("btn-edit-here"); if(e) e.onclick=()=>openEdit(s.id);
  }

  if (state.soulTab === "family") {
    const fam = s.family||[];
    box.innerHTML = `
      ${mine?`<button class="btn-ghost" id="btn-fam-new" style="height:44px;font-size:13px;margin-bottom:12px;max-width:320px">가족 추가</button>`:""}
      <div class="list">${fam.length?fam.map((f,i)=>`
        <div class="row"><span class="ava">${esc(initial(f.name))}</span>
          <div class="grow"><p class="nm">${esc(f.relation)} · ${esc(f.name)}</p>
            <p class="sub">${[f.birth,f.faith==="y"?"신앙 있음":f.faith==="n"?"아직 아님":"",f.note].filter(Boolean).map(esc).join(" · ")}</p></div>
          ${mine?`<button class="btn-sm danger" data-delfam="${i}">삭제</button>`:""}
        </div>`).join(""):`<p class="muted">가족 정보가 없어요.</p>`}</div>`;
    const b=$("btn-fam-new"); if(b) b.onclick=()=>openFamilyDlg();
  }
}

$("soul-body").addEventListener("click", async (ev) => {
  const s = state.soul;
  const del = ev.target.closest("[data-delrec]");
  if (del) {
    if (!confirm("이 기록을 지울까요? 되돌릴 수 없어요.")) return;
    try {
      await deleteDoc(doc(db,"souls",s.id,"records",del.dataset.delrec));
      await loadRecords(s.id,true); await syncPraySummary(); invalidate();
      renderSoulBody(); updateSummary(); toast("지웠어요.");
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const ans = ev.target.closest("[data-answer]");
  if (ans) {
    try {
      await updateDoc(doc(db,"souls",s.id,"records",ans.dataset.answer), { prayStatus:"answered" });
      await loadRecords(s.id,true); await syncPraySummary(); invalidate();
      renderSoulBody(); toast("응답으로 표시했어요. 감사해요.");
    } catch (e) { toast(msgOf(e)); }
    return;
  }
  const er = ev.target.closest("[data-editrec]");
  if (er) {
    if (er.dataset.rtype === "meet") openLog(s.id, er.dataset.editrec);
    else openRecDialog(s.id, er.dataset.editrec);
    return;
  }
  const tgl = ev.target.closest("[data-tgl]");
  if (tgl) { const todos=(s.todos||[]).map(t=>t.id===tgl.dataset.tgl?{...t,done:!t.done}:t);
    await saveSoulField({todos}); renderSoulBody(); return; }
  const dt = ev.target.closest("[data-deltodo]");
  if (dt) { const todos=(s.todos||[]).filter(t=>t.id!==dt.dataset.deltodo);
    await saveSoulField({todos}); renderSoulBody(); return; }
  const df = ev.target.closest("[data-delfam]");
  if (df) { const family=(s.family||[]).filter((_,i)=>i!==Number(df.dataset.delfam));
    await saveSoulField({family}); renderSoulBody(); return; }
  const dtr = ev.target.closest("[data-deltrain]");
  if (dtr) {
    if (!confirm("이 훈련 기록을 지울까요?")) return;
    try { await deleteDoc(doc(db,"souls",s.id,"trainings",dtr.dataset.deltrain));
      await loadTrainings(s.id); invalidate(); renderSoulBody(); toast("지웠어요."); }
    catch (e) { toast(msgOf(e)); }
    return;
  }
  const etr = ev.target.closest("[data-edittrain]"); if (etr) { openTrainDlg(etr.dataset.edittrain); return; }
  const ses = ev.target.closest("[data-ses]"); if (ses) { openSessionsDlg(ses.dataset.ses); return; }
});

async function saveSoulField(patch) {
  try {
    await updateDoc(doc(db,"souls",state.soul.id), patch);
    Object.assign(state.soul, patch);
    const inList = state.souls.find(x=>x.id===state.soul.id);
    if (inList) Object.assign(inList, patch);
  } catch (e) { toast(msgOf(e)); }
}
async function syncPraySummary() {
  const open = state.records.filter(r=>r.type==="pray"&&r.prayStatus!=="answered")
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  await saveSoulField({
    prayOpen: open.length,
    prayTop: open.length?{ text:open[0].body, since:open[0].date }:null
  });
}

/* ════════ 만남 기록 (1:1 · 소그룹 · 셀모임 후) ════════ */
const LOGF = ["log-date","log-time","log-place","log-bheart","log-bword","log-did",
              "log-talked","log-dheart","log-update","log-spirit","log-pray"];
function openLog(soulId, recId) {
  const mine = state.souls.filter(isLeaderOf);
  if (!mine.length) { toast("먼저 영혼 카드를 하나 만들어 주세요."); return; }
  const rec = recId ? state.records.find(r=>r.id===recId) : null;
  state.log = { soulId: soulId || (state.soul&&isLeaderOf(state.soul)?state.soul.id:mine[0].id),
                recId: recId||null, kind: rec?rec.kind:"one" };
  $("log-title").textContent = rec ? "만남 기록 수정" : "만남 기록";
  $("log-soul-wrap").hidden = !!rec;
  $("log-soul").innerHTML = mine.map(s=>
    `<option value="${s.id}"${s.id===state.log.soulId?" selected":""}>${esc(s.name)}</option>`).join("");
  syncLogKind();
  $("log-date").value = rec?rec.date:todayStr();
  $("log-time").value = rec?(rec.time||""):"";
  $("log-place").value = rec?(rec.place||""):"";
  $("log-bheart").value = rec?(rec.beforeHeart||""):"";
  $("log-bword").value = rec?(rec.beforeWord||""):"";
  $("log-did").value = rec?(rec.did||""):"";
  $("log-talked").value = rec?(rec.talked||""):"";
  $("log-dheart").value = rec?(rec.duringHeart||""):"";
  $("log-update").value = rec?(rec.update||""):"";
  $("log-spirit").value = rec?(rec.spiritual||""):"";
  $("log-pray").value = "";
  $("log-pray").parentElement.hidden = !!rec;
  $("log-scope").value = rec?rec.scope:"leader";
  $("log-todo-on").checked = false; $("log-todo-fields").hidden = true;
  $("log-todo-text").value = ""; $("log-todo-due").value = plusDays(7);
  $("log-todo-on").parentElement.parentElement.hidden = !!rec;
  $("log-quick").innerHTML = PLACES.map(p=>`<button type="button" data-place="${p}">${p}</button>`).join("");
  $("log-err").textContent = "";
  show("s-log");
  LOGF.forEach(id=>{ const el=$(id); if(el&&el.tagName==="TEXTAREA") autoGrow(el); });
}
$("btn-log-new").onclick = () => openLog(state.soul.id, null);
$("log-back").onclick = () => state.log && state.log.soulId ? openSoul(state.log.soulId) : openSouls();
$("log-kind").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-k]"); if(!b) return;
  state.log.kind = b.dataset.k; syncLogKind();
});
function syncLogKind() {
  $("log-kind").querySelectorAll("[data-k]").forEach(b=>b.classList.toggle("on", b.dataset.k===state.log.kind));
}
$("log-quick").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-place]"); if(!b) return;
  $("log-place").value = b.dataset.place;
});
$("log-todo-on").onchange = () => { $("log-todo-fields").hidden = !$("log-todo-on").checked; };

$("btn-log-save").onclick = async () => {
  const L = state.log;
  const soulId = $("log-soul-wrap").hidden ? L.soulId : $("log-soul").value;
  const v = (id) => $(id).value.trim();
  const did=v("log-did"), talked=v("log-talked"), update=v("log-update");
  $("log-err").textContent = "";
  if (!did && !talked && !update && !v("log-bheart") && !v("log-dheart") && !v("log-spirit")) {
    $("log-err").textContent = "한 칸이라도 적어주세요."; return;
  }
  $("btn-log-save").disabled = true;
  try {
    const data = {
      type:"meet", kind:L.kind, scope:$("log-scope").value,
      date: $("log-date").value||todayStr(), time:$("log-time").value||"",
      place: v("log-place"), beforeHeart:v("log-bheart"), beforeWord:v("log-bword"),
      did, talked, duringHeart:v("log-dheart"), update, spiritual:v("log-spirit"),
      body: talked || did || update || v("log-dheart"),
      by: uid(), byName: state.me.name||""
    };
    if (L.recId) {
      await updateDoc(doc(db,"souls",soulId,"records",L.recId), data);
    } else {
      await addDoc(collection(db,"souls",soulId,"records"), { ...data, createdAt: serverTimestamp() });
      const prayTxt = v("log-pray");
      if (prayTxt) {
        await addDoc(collection(db,"souls",soulId,"records"), {
          type:"pray", scope:$("log-scope").value, date:data.date, body:prayTxt,
          prayStatus:"praying", by:uid(), byName:state.me.name||"", createdAt: serverTimestamp()
        });
      }
      const patch = { lastMetAt: data.date };
      if ($("log-todo-on").checked && v("log-todo-text")) {
        const target = state.souls.find(x=>x.id===soulId)||{};
        patch.todos = [...(target.todos||[]),
          { id:"t"+Date.now(), text:v("log-todo-text"), due:$("log-todo-due").value||"", done:false }];
      }
      await updateDoc(doc(db,"souls",soulId), patch);
      const inList = state.souls.find(x=>x.id===soulId); if (inList) Object.assign(inList, patch);
    }
    invalidate();
    toast(L.recId?"고쳤어요.":"기록했어요.");
    openSoul(soulId);
  } catch (e) { $("log-err").textContent = msgOf(e); }
  finally { $("btn-log-save").disabled = false; }
};

/* ════════ 기도제목 · 받은 마음 ════════ */
const dlgRec = $("dlg-rec");
let recKind = "pray", editingRecId = null;
function openRecDialog(soulId, recId) {
  editingRecId = recId||null;
  const rec = recId ? state.records.find(r=>r.id===recId) : null;
  const mine = state.souls.filter(isLeaderOf);
  const pick = soulId || (state.soul&&isLeaderOf(state.soul)?state.soul.id:(mine[0]&&mine[0].id));
  $("rec-title").textContent = rec?"기록 수정":"기도제목 · 받은 마음";
  $("r-soul-wrap").hidden = !!soulId || !!rec;
  $("r-soul").innerHTML = mine.map(s=>`<option value="${s.id}"${s.id===pick?" selected":""}>${esc(s.name)}</option>`).join("");
  recKind = rec?rec.type:"pray";
  dlgRec.querySelectorAll("[data-rt]").forEach(b=>b.disabled = !!rec);
  syncRecKind();
  $("r-date").value = rec?rec.date:todayStr();
  $("r-body").value = rec?rec.body:"";
  if (rec) { $("r-scope").value = rec.scope; if (rec.who) $("r-who").value = rec.who; }
  $("rec-err").textContent = "";
  dlgRec.showModal(); autoGrow($("r-body"));
}
$("btn-rec-new").onclick = () => openRecDialog(state.soul.id, null);
dlgRec.querySelectorAll("[data-rt]").forEach(b=>b.onclick=()=>{ recKind=b.dataset.rt; syncRecKind(); });
function syncRecKind() {
  dlgRec.querySelectorAll("[data-rt]").forEach(b=>b.classList.toggle("on", b.dataset.rt===recKind));
  $("r-who-wrap").hidden = recKind!=="heart";
  $("r-body-label").textContent = recKind==="pray"?"기도제목":"받은 마음";
  $("r-body").placeholder = recKind==="pray"?"무엇을 위해 기도할까요":"기도 중에 받은 마음, 또는 이 친구가 나눈 은혜";
  if (!editingRecId) $("r-scope").value = recKind==="heart"?"private":"leader";
}
$("rec-cancel").onclick = () => dlgRec.close();
$("rec-save").onclick = async () => {
  const body = $("r-body").value.trim();
  $("rec-err").textContent = "";
  if (!body) { $("rec-err").textContent = "내용을 적어주세요."; return; }
  const soulId = $("r-soul-wrap").hidden ? state.soul.id : $("r-soul").value;
  $("rec-save").disabled = true;
  try {
    if (editingRecId) {
      const patch = { body, date:$("r-date").value||todayStr(), scope:$("r-scope").value };
      if (recKind==="heart") patch.who = $("r-who").value;
      await updateDoc(doc(db,"souls",soulId,"records",editingRecId), patch);
    } else {
      const data = { type:recKind, scope:$("r-scope").value, date:$("r-date").value||todayStr(),
        body, by:uid(), byName:state.me.name||"", createdAt: serverTimestamp() };
      if (recKind==="heart") data.who = $("r-who").value;
      if (recKind==="pray") data.prayStatus = "praying";
      await addDoc(collection(db,"souls",soulId,"records"), data);
    }
    dlgRec.close(); editingRecId = null; invalidate();
    await loadRecords(soulId,true); await syncPraySummary();
    state.soulTab = "rec"; renderSoulTabs(); renderSoulBody(); updateSummary();
    toast("저장했어요.");
  } catch (e) { $("rec-err").textContent = msgOf(e); }
  finally { $("rec-save").disabled = false; }
};

/* 후속조치 · 가족 */
const dlgTodo = $("dlg-todo");
function openTodoDlg() {
  $("t-text").value=""; $("t-due").value=plusDays(7); $("todo-err").textContent="";
  $("t-quick").innerHTML = [["오늘",0],["내일",1],["이번 주말",(6-new Date().getDay()+7)%7||6],["다음 주",7],["2주 뒤",14]]
    .map(([l,n])=>`<button type="button" data-due="${n}">${l}</button>`).join("");
  dlgTodo.showModal();
}
$("t-quick").addEventListener("click",(ev)=>{
  const b=ev.target.closest("[data-due]"); if(!b) return; $("t-due").value=plusDays(Number(b.dataset.due));
});
$("todo-cancel").onclick=()=>dlgTodo.close();
$("todo-save").onclick=async()=>{
  const text=$("t-text").value.trim();
  if(!text){ $("todo-err").textContent="할 일을 적어주세요."; return; }
  const todos=[...(state.soul.todos||[]),{id:"t"+Date.now(),text,due:$("t-due").value||"",done:false}];
  await saveSoulField({todos}); dlgTodo.close(); renderSoulBody(); toast("후속조치를 더했어요.");
};
function openFamilyDlg() {
  ["f-rel","f-name","f-birth","f-note"].forEach(i=>$(i).value="");
  $("f-faith").value=""; $("family-err").textContent="";
  $("f-quick").innerHTML = RELS.map(r=>`<button type="button" data-rel="${r}">${r}</button>`).join("");
  $("dlg-family").showModal();
}
$("f-quick").addEventListener("click",(ev)=>{
  const b=ev.target.closest("[data-rel]"); if(!b) return; $("f-rel").value=b.dataset.rel; $("f-name").focus();
});
$("fam-cancel").onclick=()=>$("dlg-family").close();
$("fam-save").onclick=async()=>{
  const relation=$("f-rel").value.trim(), name=$("f-name").value.trim();
  if(!relation||!name){ $("family-err").textContent="관계와 이름을 적어주세요."; return; }
  const family=[...(state.soul.family||[]),
    {relation,name,birth:$("f-birth").value.trim(),faith:$("f-faith").value,note:$("f-note").value.trim()}];
  await saveSoulField({family}); $("dlg-family").close(); renderSoulBody(); toast("가족을 더했어요.");
};

/* ════════ 훈련 ════════ */
const doneSessions = (t) => (t.sessionLog||[]).filter(x=>x.ok).length;
const dlgTrain = $("dlg-train");
let editingTrainId = null;
function openTrainDlg(trainId) {
  editingTrainId = trainId||null;
  const t = trainId ? state.trainings.find(x=>x.id===trainId) : null;
  $("train-title").textContent = t?"훈련 기록 수정":"훈련 기록";
  $("tr-course").innerHTML = state.courses.map(c=>
    `<option value="${c.id}"${t&&t.courseId===c.id?" selected":""}>${esc(c.name)}</option>`).join("");
  $("tr-cohort").value = t?(t.cohort||""):"";
  $("tr-start").value = t?(t.startDate||""):todayStr();
  $("tr-end").value = t?(t.endDate||""):"";
  $("tr-note").value = t?(t.note||""):"";
  $("tr-status").value = t?t.status:"ongoing";
  $("train-err").textContent=""; syncCourseHint(); dlgTrain.showModal();
}
function syncCourseHint() {
  const c = state.courses.find(x=>x.id===$("tr-course").value);
  const n = (c&&c.sessions)||1;
  $("tr-course-hint").textContent = n>1
    ? `${n}번 만나는 과정이에요. 저장한 뒤 '회차 기록'에서 날짜를 적을 수 있어요.`
    : "한 번에 끝나는 과정이에요.";
}
$("tr-course").onchange = syncCourseHint;
$("tr-cancel").onclick = () => dlgTrain.close();
$("tr-save").onclick = async () => {
  const courseId=$("tr-course").value, course=state.courses.find(c=>c.id===courseId);
  if(!course){ $("train-err").textContent="과정을 골라주세요."; return; }
  const editing = editingTrainId;
  $("tr-save").disabled=true;
  try {
    const data = { courseId, courseName:course.name, totalSessions:course.sessions||1,
      cohort:$("tr-cohort").value.trim(), status:$("tr-status").value,
      startDate:$("tr-start").value, endDate:$("tr-end").value,
      note:$("tr-note").value.trim(), by:uid() };
    if (editing) await updateDoc(doc(db,"souls",state.soul.id,"trainings",editing), data);
    else await addDoc(collection(db,"souls",state.soul.id,"trainings"),
      { ...data, sessionLog:[], createdAt: serverTimestamp() });
    await loadTrainings(state.soul.id); invalidate();
    dlgTrain.close(); editingTrainId=null; renderSoulBody();
    toast(editing?"고쳤어요.":"훈련 기록을 더했어요.");
  } catch (e) { $("train-err").textContent = msgOf(e); }
  finally { $("tr-save").disabled=false; }
};

const dlgSes = $("dlg-sessions");
let sesTrainId=null, sesLog=[], sesTotal=1;
const isPast = (d) => !!d && d <= todayStr();
function openSessionsDlg(trainId) {
  const t = state.trainings.find(x=>x.id===trainId); if(!t) return;
  const c = state.courses.find(x=>x.id===t.courseId);
  sesTrainId = trainId; sesTotal = (c&&c.sessions)||t.totalSessions||1;
  sesLog = Array.from({length:sesTotal},(_,i)=>{
    const old = (t.sessionLog||[]).find(x=>x.no===i+1);
    return { no:i+1, date:old?(old.date||""):"", ok:old?!!old.ok:false };
  });
  $("ses-title").textContent = `${t.courseName} 회차 기록`;
  $("ses-sub").textContent = `총 ${sesTotal}번 만나는 과정이에요. 지난 날짜를 적으면 '만남'으로 체크되고, 앞날은 '예정'으로 남아요. 동그라미를 눌러 직접 바꿔도 돼요.`;
  $("ses-err").textContent=""; renderSessions(); dlgSes.showModal();
}
function renderSessions() {
  const n = sesLog.filter(x=>x.ok).length, planned = sesLog.filter(x=>!x.ok&&x.date).length;
  $("ses-list").innerHTML = sesLog.map(s=>`
    <div class="sesrow"><span class="no">${s.no}회차</span>
      <input type="date" data-sdate="${s.no}" value="${s.date||""}">
      <button type="button" class="${s.ok?"ok":""}" data-sok="${s.no}"
        aria-label="${s.no}회차 ${s.ok?"만남 완료":"예정"}">${s.ok?"✓":"○"}</button></div>`).join("");
  const all = n===sesTotal && sesTotal>0;
  $("ses-done-hint").innerHTML = `<p class="muted" style="font-size:12px">${n} / ${sesTotal}회 만남${planned?` · 예정 ${planned}회`:""}</p>
    ${all?`<button class="btn-sm" id="ses-complete" style="margin-top:10px">수료로 표시하기</button>`:""}`;
  const b=$("ses-complete");
  if(b) b.onclick=async()=>{
    const last = sesLog.filter(x=>x.ok&&x.date).map(x=>x.date).sort().pop()||todayStr();
    await saveSessions({ status:"done", endDate:last }); toast("수료로 표시했어요.");
  };
}
$("ses-list").addEventListener("input",(ev)=>{
  const i=ev.target.closest("[data-sdate]"); if(!i) return;
  const row=sesLog.find(x=>x.no===Number(i.dataset.sdate));
  row.date=i.value; row.ok=isPast(i.value); renderSessions();
});
$("ses-list").addEventListener("click",(ev)=>{
  const b=ev.target.closest("[data-sok]"); if(!b) return;
  const row=sesLog.find(x=>x.no===Number(b.dataset.sok));
  row.ok=!row.ok; if(row.ok&&!row.date) row.date=todayStr(); renderSessions();
});
$("ses-next").onclick=()=>{
  const next=sesLog.find(x=>!x.ok);
  if(!next){ toast("모든 회차가 끝났어요."); return; }
  next.ok=true; next.date=todayStr(); renderSessions();
};
$("ses-weekly").onclick=()=>{
  const first=sesLog.find(x=>x.date);
  const base=new Date((first?first.date:todayStr())+"T00:00:00");
  const off=first?first.no-1:0;
  sesLog.forEach(s=>{
    if(s.date) return;
    const d=new Date(base); d.setDate(d.getDate()+7*(s.no-1-off));
    s.date=ymd(d); s.ok=isPast(s.date);
  });
  renderSessions(); toast("매주 같은 요일로 채웠어요. 지난 날짜는 자동으로 체크됐어요.");
};
async function saveSessions(extra) {
  try {
    await updateDoc(doc(db,"souls",state.soul.id,"trainings",sesTrainId),
      { sessionLog:sesLog, ...(extra||{}) });
    await loadTrainings(state.soul.id); invalidate(); dlgSes.close(); renderSoulBody();
  } catch (e) { $("ses-err").textContent = msgOf(e); }
}
$("ses-cancel").onclick=()=>dlgSes.close();
$("ses-save").onclick=async()=>{
  const t=state.trainings.find(x=>x.id===sesTrainId), extra={};
  const firstDate=sesLog.filter(x=>x.ok&&x.date).map(x=>x.date).sort()[0];
  if(firstDate && !t.startDate) extra.startDate=firstDate;
  if(t.status==="planned" && sesLog.some(x=>x.ok)) extra.status="ongoing";
  await saveSessions(extra); toast("회차를 저장했어요.");
};

const dlgCourse = $("dlg-course");
let editingCourseId=null, courseAfter=null;
function openCourseDlg(courseId, after) {
  editingCourseId=courseId||null; courseAfter=after||null;
  const c = courseId?state.courses.find(x=>x.id===courseId):null;
  $("course-title").textContent = c?"훈련 과정 수정":"훈련 과정 추가";
  $("co-name").value = c?c.name:"";
  $("co-sessions").value = String((c&&c.sessions)||1);
  $("course-err").textContent="";
  dlgCourse.showModal(); setTimeout(()=>$("co-name").focus(),120);
}
$("co-cancel").onclick=()=>dlgCourse.close();
$("co-save").onclick=async()=>{
  const name=$("co-name").value.trim();
  const sessions=Math.max(1,Math.min(60,Number($("co-sessions").value)||1));
  if(!name){ $("course-err").textContent="과정 이름을 적어주세요."; return; }
  $("co-save").disabled=true;
  try {
    if(editingCourseId){ await updateDoc(doc(db,"courses",editingCourseId),{name,sessions});
      await log("훈련 과정 수정",name); }
    else {
      const mx=state.courses.reduce((m,c)=>Math.max(m,c.order||0),0);
      await addDoc(collection(db,"courses"),{name,sessions,order:mx+1,active:true,createdAt:serverTimestamp()});
      await log("훈련 과정 추가",name);
    }
    await loadOrg(); dlgCourse.close(); toast("저장했어요.");
    if(courseAfter) courseAfter(); else openManage();
  } catch(e){ $("course-err").textContent=msgOf(e); }
  finally { $("co-save").disabled=false; }
};
async function moveCourse(courseId, dir) {
  const list=[...state.courses];
  const i=list.findIndex(c=>c.id===courseId), j=i+dir;
  if(i<0||j<0||j>=list.length) return;
  [list[i],list[j]]=[list[j],list[i]];
  try { await Promise.all(list.map((c,idx)=>updateDoc(doc(db,"courses",c.id),{order:idx+1})));
    await loadOrg(); openManage(); }
  catch(e){ toast(msgOf(e)); }
}

/* ════════ 훈련 현황 ════════ */
async function openTrainBoard() {
  show("s-loading");
  await loadOrg(); await loadSouls();
  const all = await loadAllTrainings(true);
  const latest = {};
  all.forEach(t=>{
    const k = t.soulId+"|"+t.courseId, cur = latest[k];
    if (!cur || String(t.startDate||"") > String(cur.startDate||"")) latest[k]=t;
  });
  const souls = state.souls;
  const sum = state.courses.map(c=>{
    const rows = souls.map(s=>latest[s.id+"|"+c.id]).filter(Boolean);
    return { c, done:rows.filter(t=>t.status==="done").length,
      ing:rows.filter(t=>t.status==="ongoing").length,
      plan:rows.filter(t=>t.status==="planned").length,
      drop:rows.filter(t=>t.status==="dropped").length, none:souls.length-rows.length };
  });
  $("train-sum").innerHTML = state.courses.length ? `
    <div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${tile("영혼", souls.length+"명")}
      ${tile("과정", state.courses.length+"개")}
      ${tile("수강 중", sum.reduce((n,x)=>n+x.ing,0)+"명")}
    </div>
    <div class="courses">
      ${sum.map(x=>`<div class="cbox"><p class="cn">${esc(x.c.name)}</p>
        <p class="cs">${[`수료 ${x.done}`, `수강 중 ${x.ing}`,
            x.plan?`예정 ${x.plan}`:"", x.drop?`포기 ${x.drop}`:"",
            `아직 ${x.none}`].filter(Boolean).join(" · ")}</p>
        <div class="pbar"><i style="width:${souls.length?Math.round(x.done/souls.length*100):0}%"></i></div>
      </div>`).join("")}
    </div>` : `<p class="muted">훈련 과정을 먼저 등록해 주세요.</p>`;

  const cell = (s,c) => {
    const t = latest[s.id+"|"+c.id];
    if (!t) return `<td class="planned">—</td>`;
    const total=(c.sessions||1), ok=doneSessions(t);
    const label = t.status==="ongoing"&&total>1?`${ok}/${total}`:(TSTAT[t.status]||"");
    return `<td class="${t.status}">${label}</td>`;
  };
  $("train-matrix").innerHTML = state.courses.length && souls.length ? `
    <table><thead><tr><th style="text-align:left">이름</th>
      ${state.courses.map(c=>`<th>${esc(c.name)}${(c.sessions||1)>1?`<br><span style="font-weight:400">${c.sessions}회</span>`:""}</th>`).join("")}
    </tr></thead><tbody>
      ${souls.map(s=>`<tr><td class="nm">${esc(s.name)}</td>${state.courses.map(c=>cell(s,c)).join("")}</tr>`).join("")}
    </tbody></table>` : "";

  $("train-list").innerHTML = souls.map(s=>{
    const mine = state.courses.map(c=>latest[s.id+"|"+c.id]).filter(Boolean);
    const done = mine.filter(t=>t.status==="done").length;
    const ing = mine.find(t=>t.status==="ongoing");
    const plan = mine.find(t=>t.status==="planned");
    const extra = ing ? ` · ${esc(ing.courseName)} 수강 중`
      : plan ? ` · ${esc(plan.courseName)} 예정` : "";
    return `<div class="row" data-gosoul3="${s.id}" style="cursor:pointer">
      <span class="ava">${esc(initial(s.name))}</span>
      <div class="grow"><p class="nm">${esc(s.name)}</p>
        <p class="sub">수료 ${done}개${extra}</p></div>
      <span class="chip ${ing?"rose":""}">${done}/${state.courses.length}</span>
    </div>`;
  }).join("") || `<p class="muted">영혼을 먼저 등록해 주세요.</p>`;
  show("s-train");
}
$("train-back").onclick = () => openMore();
$("train-list").addEventListener("click",(ev)=>{
  const r=ev.target.closest("[data-gosoul3]"); if(!r) return; openSoul(r.dataset.gosoul3);
});

/* ════════ 기록 검색 ════════ */
async function openSearch() {
  show("s-loading");
  await loadOrg(); await loadSouls();
  await loadAllRecords(true);
  state.gsFilter = "all"; $("gs-kw").value = "";
  renderGs(); show("s-search");
  setTimeout(()=>$("gs-kw").focus(),150);
}
$("search-back").onclick = () => openMore();
$("gs-kw").oninput = () => renderGs();
function renderGs() {
  const kw = $("gs-kw").value.trim();
  const types = [["all","전체"],["meet","만남"],["pray","기도"],["heart","받은 마음"]];
  $("gs-filter").innerHTML = types.map(([k,l])=>
    `<button data-gf="${k}" class="${state.gsFilter===k?"on":""}">${l}</button>`).join("");
  let list = state.allRecords || [];
  if (state.gsFilter !== "all") list = list.filter(r=>r.type===state.gsFilter);
  if (kw) list = list.filter(r => (recText(r)+" "+r.soulName).toLowerCase().includes(kw.toLowerCase()));
  else list = list.slice(0,30);
  const pool = state.gsFilter==="all" ? (state.allRecords||[])
    : (state.allRecords||[]).filter(r=>r.type===state.gsFilter);
  $("gs-count").textContent = kw
    ? `'${kw}' — ${list.length}건`
    : (pool.length > list.length
        ? `${pool.length}건 중 최근 ${list.length}건` : `${list.length}건`);
  $("gs-list").innerHTML = list.length
    ? list.map(r=>recCard(r,kw,true)).join("")
    : `<p class="muted">찾는 말이 없어요. 다른 단어로 해보세요.</p>`;
}
$("gs-filter").addEventListener("click",(ev)=>{
  const b=ev.target.closest("[data-gf]"); if(!b) return;
  state.gsFilter=b.dataset.gf; renderGs();
});
$("gs-list").addEventListener("click",(ev)=>{
  const b=ev.target.closest("[data-gosoul2]"); if(!b) return; openSoul(b.dataset.gosoul2);
});

/* ════════ 캘린더 ════════ */
async function openCal() {
  show("s-loading");
  await loadOrg(); await loadSouls(); await loadMeetings();
  await loadAllRecords(); await loadAllTrainings();
  if (!state.calMonth) { const d=new Date(); state.calMonth = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }
  state.calPick = state.calPick || todayStr();
  renderCal(); markSide("cal"); show("s-cal");
}
function calEvents() {
  const ev = [];
  state.meetings.forEach(m=>{
    const c = state.cells.find(x=>x.id===m.cellId);
    ev.push({ date:m.date, kind:"meeting", color:"#F24557",
      title:`${c?c.name:"셀"} 셀모임`, sub:m.topic||"", time:m.time||"", place:m.place||"", id:m.id });
  });
  (state.allRecords||[]).filter(r=>r.type==="meet").forEach(r=>{
    ev.push({ date:r.date, kind:"record", color:"#7FCB9B",
      title:`${r.soulName} · ${KIND[r.kind]||"만남"}`, sub:r.body||"", time:r.time||"",
      place:r.place||"", soulId:r.soulId });
  });
  const y = Number(state.calMonth.split("-")[0]);
  state.souls.forEach(s=>{
    [["birth","생일"],["baptizedAt","세례"],["marriedAt","결혼기념일"]].forEach(([f,label])=>{
      const v = s[f]; if(!v) return;
      const p = String(v).split("-"); if(p.length<3||p[1]==="00"||p[2]==="00") return;
      ev.push({ date:`${y}-${p[1]}-${p[2]}`, kind:"anniv", color:"#E8B473",
        title:`${s.name} ${label}`, sub:"", soulId:s.id });
    });
  });
  (state.allTrainings||[]).forEach(t=>{
    (t.sessionLog||[]).filter(x=>x.date).forEach(x=>{
      ev.push({ date:x.date, kind:"train", color:"#9A8CF0",
        title:`${t.soulName} · ${t.courseName} ${x.no}회차`, sub:"", soulId:t.soulId });
    });
  });
  return ev;
}
function renderCal() {
  const [y,m] = state.calMonth.split("-").map(Number);
  $("cal-title").textContent = `${y}년 ${m}월`;
  const first = new Date(y, m-1, 1), last = new Date(y, m, 0);
  const evs = calEvents();
  const byDate = {};
  evs.forEach(e=>{ (byDate[e.date] = byDate[e.date]||[]).push(e); });
  const dow = ["일","월","화","수","목","금","토"];
  let html = dow.map(d=>`<div class="dow">${d}</div>`).join("");
  for (let i=0;i<first.getDay();i++) html += `<div class="day empty"></div>`;
  for (let d=1; d<=last.getDate(); d++) {
    const ds = `${y}-${pad2(m)}-${pad2(d)}`;
    const list = byDate[ds]||[];
    const colors = [...new Set(list.map(e=>e.color))];
    const dw = new Date(y,m-1,d).getDay();
    html += `<div class="day${ds===todayStr()?" today":""}${ds===state.calPick?" sel":""}" data-day="${ds}">
      <span class="${dw===0?"sun":""}">${d}</span>
      <span class="marks">${colors.map(c=>`<i style="background:${c}"></i>`).join("")}</span>
      ${isWide()&&list.length?`<span style="font-size:10px;color:var(--dim);line-height:1.4;text-align:left;width:100%;overflow:hidden">${list.slice(0,2).map(e=>esc(e.title)).join("<br>")}</span>`:""}
    </div>`;
  }
  $("cal-grid").innerHTML = html;
  renderCalDay();
}
function renderCalDay() {
  const ds = state.calPick;
  const list = calEvents().filter(e=>e.date===ds)
    .sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
  $("cal-day-title").textContent = `${fmtDate(ds,true)} — ${list.length}건`;
  $("cal-day-list").innerHTML = list.length ? list.map((e,i)=>`
    <div class="row">
      <i style="width:8px;height:8px;border-radius:999px;background:${e.color};flex-shrink:0"></i>
      <div class="grow"><p class="nm">${esc(e.title)}</p>
        <p class="sub">${[e.time,e.place,e.sub].filter(Boolean).map(esc).join(" · ")||"&nbsp;"}</p></div>
      <button class="btn-sm" data-gcal="${i}">캘린더에</button>
      ${e.soulId?`<button class="btn-sm" data-gosoul4="${e.soulId}">카드</button>`:""}
      ${e.id?`<button class="btn-sm" data-gomeet="${e.id}">열기</button>`:""}
    </div>`).join("") : `<p class="muted">이 날은 일정이 없어요.</p>`;
  $("cal-day-list").dataset.ds = ds;
}
$("cal-grid").addEventListener("click",(ev)=>{
  const d=ev.target.closest("[data-day]"); if(!d) return;
  state.calPick=d.dataset.day; renderCal();
});
$("cal-prev").onclick=()=>{ const [y,m]=state.calMonth.split("-").map(Number);
  const d=new Date(y,m-2,1); state.calMonth=`${d.getFullYear()}-${pad2(d.getMonth()+1)}`; renderCal(); };
$("cal-next").onclick=()=>{ const [y,m]=state.calMonth.split("-").map(Number);
  const d=new Date(y,m,1); state.calMonth=`${d.getFullYear()}-${pad2(d.getMonth()+1)}`; renderCal(); };
$("cal-day-list").addEventListener("click",(ev)=>{
  const g=ev.target.closest("[data-gcal]");
  if (g) {
    const list = calEvents().filter(e=>e.date===state.calPick)
      .sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
    const e = list[Number(g.dataset.gcal)]; if(e) window.open(gcalUrl(e),"_blank");
    return;
  }
  const s=ev.target.closest("[data-gosoul4]"); if(s){ openSoul(s.dataset.gosoul4); return; }
  const m=ev.target.closest("[data-gomeet]"); if(m){ openMeeting(m.dataset.gomeet); return; }
});
function gcalUrl(e) {
  const d = e.date.replace(/-/g,"");
  let dates;
  if (e.time) {
    const [hh,mm] = e.time.split(":").map(Number);
    const s = `${d}T${pad2(hh)}${pad2(mm)}00`;
    const end = new Date(`${e.date}T${e.time}:00`); end.setHours(end.getHours()+2);
    dates = `${s}/${ymd(end).replace(/-/g,"")}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`;
  } else {
    const nx = new Date(e.date+"T00:00:00"); nx.setDate(nx.getDate()+1);
    dates = `${d}/${ymd(nx).replace(/-/g,"")}`;
  }
  const p = new URLSearchParams({ action:"TEMPLATE", text:e.title,
    details:(e.sub||"")+"\n\n목자의 삶", location:e.place||"", dates });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
$("btn-cal-help").onclick = () => $("dlg-gcal").showModal();
$("gcal-close").onclick = () => $("dlg-gcal").close();
$("btn-go-cal-help").onclick = () => $("dlg-gcal").showModal();
$("btn-ics").onclick = () => {
  const evs = calEvents();
  if (!evs.length) { toast("내보낼 일정이 없어요."); return; }
  const esc2 = (s)=>String(s||"").replace(/[\\;,]/g,m=>"\\"+m).replace(/\n/g,"\\n");
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//목자의 삶//KO","CALSCALE:GREGORIAN",
    "X-WR-CALNAME:목자의 삶"];
  evs.forEach((e,i)=>{
    const d = e.date.replace(/-/g,"");
    lines.push("BEGIN:VEVENT",
      `UID:mokja-${i}-${d}@mokyang-note`,
      `DTSTAMP:${todayStr().replace(/-/g,"")}T000000Z`);
    if (e.time) {
      const [hh,mm]=e.time.split(":").map(Number);
      const end=new Date(`${e.date}T${e.time}:00`); end.setHours(end.getHours()+2);
      lines.push(`DTSTART:${d}T${pad2(hh)}${pad2(mm)}00`,
        `DTEND:${ymd(end).replace(/-/g,"")}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`);
    } else {
      const nx=new Date(e.date+"T00:00:00"); nx.setDate(nx.getDate()+1);
      lines.push(`DTSTART;VALUE=DATE:${d}`,`DTEND;VALUE=DATE:${ymd(nx).replace(/-/g,"")}`);
    }
    lines.push(`SUMMARY:${esc2(e.title)}`);
    if (e.sub) lines.push(`DESCRIPTION:${esc2(e.sub)}`);
    if (e.place) lines.push(`LOCATION:${esc2(e.place)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  download(`목자의삶_일정_${todayStr()}.ics`, lines.join("\r\n"), "text/calendar");
  toast("파일을 받았어요. 구글 캘린더 설정 → 가져오기 에서 올려주세요.");
};

/* ════════ 영혼 추가 · 수정 ════════ */
const EDIT_FIELDS = ["e-name","e-gender","e-birth","e-phone","e-address","e-address2","e-job",
  "e-reg","e-bap","e-married","e-position","e-invitedby","e-verse","e-hobby","e-mbti",
  "e-food","e-avoid","e-interest","e-memo","e-status","e-cycle","e-cell"];
function openEdit(soulId) {
  state.editingId=soulId; state.editPhoto=undefined; state.editDirty=false;
  const s = soulId?state.souls.find(x=>x.id===soulId):null;
  $("edit-title").textContent = s?"프로필 수정":"영혼 추가";
  $("btn-del-soul").hidden = !s;
  document.querySelectorAll("#s-edit .fold").forEach(f=>f.open=false);
  $("e-status").innerHTML = Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
  const myCells = state.cells.filter(c=>c.jinId===state.me.jinId);
  const use = myCells.length?myCells:state.cells;
  $("e-cell").innerHTML = use.length?use.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")
    :`<option value="">아직 셀이 없어요</option>`;
  const canAddCell = state.me.role==="super"||state.me.role==="jinjang";
  $("no-cell-help").innerHTML = use.length?"":`
    <div class="card" style="margin-bottom:14px;background:var(--warn-bg);border-color:#3A2E1E;max-width:560px">
      <p style="font-size:13px;line-height:1.7;color:#E8D9C4">셀이 아직 없어요. 셀이 없어도 저장은 되지만, 출석 체크를 하려면 셀이 필요해요.</p>
      ${canAddCell?`<button class="btn-sm" id="btn-cell-here" style="margin-top:10px">여기서 셀 만들기</button>`
        :`<p class="muted" style="margin-top:8px;font-size:12px">진장에게 셀 생성을 요청해 주세요.</p>`}</div>`;
  const cb=$("btn-cell-here"); if(cb) cb.onclick=()=>addCell(()=>openEdit(state.editingId));

  const v=(id,val)=>$(id).value=val||"";
  v("e-name",s&&s.name); v("e-gender",s&&s.gender);
  v("e-birth", s&&s.birth?fmtRaw(s.birth):"");
  $("e-lunar").checked=!!(s&&s.lunar);
  v("e-phone",s&&s.phone); v("e-address",s&&s.address); v("e-address2",s&&s.address2);
  v("e-job",s&&s.job);
  v("e-reg", s&&s.registeredAt?fmtRaw(s.registeredAt):"");
  v("e-bap", s&&s.baptizedAt?fmtRaw(s.baptizedAt):"");
  v("e-married", s&&s.marriedAt?fmtRaw(s.marriedAt):"");
  v("e-position",s&&s.position); v("e-invitedby",s&&s.invitedBy); v("e-verse",s&&s.verse);
  v("e-hobby",s&&s.hobby); v("e-mbti",s&&s.mbti); v("e-food",s&&s.food);
  v("e-avoid",s&&s.avoid); v("e-interest",s&&s.interest); v("e-memo",s&&s.memo);
  $("e-status").value=(s&&s.status)||"new";
  $("e-cycle").value=String((s&&s.contactCycle)||0);
  if(s&&s.cellId) $("e-cell").value=s.cellId; else if(state.me.cellId) $("e-cell").value=state.me.cellId;
  const ph = s?state.photoCache[s.id]:null;
  $("edit-ava").style.backgroundImage = ph?`url(${ph})`:"";
  $("edit-ava").textContent = ph?"":($("e-name").value?initial($("e-name").value):"+");
  $("edit-err").textContent=""; autoGrow($("e-memo")); updateFoldCounts();
  show("s-edit");
  setTimeout(()=>{ if(!s) $("e-name").focus(); },120);
}
function fmtRaw(s) {
  const p=String(s).split("-"); if(p.length<3) return s;
  if(p[0]==="0000") return `${Number(p[1])}-${Number(p[2])}`;
  if(p[2]==="00") return p[1]==="00"?p[0]:`${p[0]}-${Number(p[1])}`;
  return `${p[0]}-${Number(p[1])}-${Number(p[2])}`;
}
function updateFoldCounts() {
  const n=(ids)=>ids.filter(i=>($(i).value||"").trim()).length;
  const put=(id,c)=>$(id).textContent = c?`  ${c}개 입력됨`:"";
  put("cnt-photo", state.editPhoto||(state.editingId&&state.photoCache[state.editingId])?1:0);
  put("cnt-basic", n(["e-phone","e-address","e-gender","e-job","e-birth"]));
  put("cnt-faith", n(["e-reg","e-bap","e-married","e-position","e-invitedby","e-verse"]));
  put("cnt-know", n(["e-hobby","e-mbti","e-food","e-avoid","e-interest"]));
  put("cnt-care", (Number($("e-cycle").value)?1:0)+n(["e-memo"]));
}
EDIT_FIELDS.forEach(id=>{
  const el=$(id); if(!el) return;
  el.addEventListener("input",()=>{ state.editDirty=true; updateFoldCounts(); });
  el.addEventListener("change",()=>{ state.editDirty=true; updateFoldCounts(); });
});
$("e-phone").addEventListener("input",(ev)=>{
  const p=ev.target.selectionStart, before=ev.target.value.length;
  ev.target.value=fmtPhone(ev.target.value);
  const after=ev.target.value.length;
  try{ ev.target.setSelectionRange(p+(after-before),p+(after-before)); }catch{}
});
$("e-name").addEventListener("input",()=>{
  if(!$("edit-ava").style.backgroundImage)
    $("edit-ava").textContent = $("e-name").value?initial($("e-name").value):"+";
});
$("edit-back").onclick=()=>{
  if(state.editDirty && !confirm("저장하지 않고 나갈까요? 적은 내용이 사라져요.")) return;
  state.editDirty=false;
  state.editingId?openSoul(state.editingId):openSouls();
};
$("btn-postcode").onclick=()=>{
  const open=()=>new window.daum.Postcode({ oncomplete:(data)=>{
    $("e-address").value=data.roadAddress||data.jibunAddress||"";
    state.editDirty=true; updateFoldCounts(); $("e-address2").focus();
  }}).open();
  if(window.daum&&window.daum.Postcode){ open(); return; }
  const sc=document.createElement("script");
  sc.src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
  sc.onload=open; sc.onerror=()=>toast("주소 검색을 불러오지 못했어요. 직접 적어주세요.");
  document.head.appendChild(sc);
};
$("btn-photo").onclick=()=>$("photo-input").click();
$("btn-photo-del").onclick=()=>{
  state.editPhoto=null; state.editDirty=true;
  $("edit-ava").style.backgroundImage=""; $("edit-ava").textContent=initial($("e-name").value||"?");
  updateFoldCounts();
};
$("photo-input").onchange=(ev)=>{
  const file=ev.target.files&&ev.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const max=480, scale=Math.min(1,max/Math.max(img.width,img.height));
      const cv=document.createElement("canvas");
      cv.width=Math.round(img.width*scale); cv.height=Math.round(img.height*scale);
      cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
      const data=cv.toDataURL("image/jpeg",0.72);
      if(data.length>700000){ toast("사진이 너무 커요. 다른 사진을 골라주세요."); return; }
      state.editPhoto=data; state.editDirty=true;
      $("edit-ava").style.backgroundImage=`url(${data})`; $("edit-ava").textContent="";
      updateFoldCounts();
    };
    img.src=reader.result;
  };
  reader.readAsDataURL(file); ev.target.value="";
};
$("btn-save-soul").onclick=async()=>{
  const name=$("e-name").value.trim();
  $("edit-err").textContent="";
  if(!name){ $("edit-err").textContent="이름은 꼭 적어주세요."; $("e-name").focus(); return; }
  if(!canLead()){ $("edit-err").textContent="셀을 맡은 사람만 영혼 카드를 만들 수 있어요."; return; }
  if(!state.me.jinId){ $("edit-err").textContent="먼저 리더 관리에서 내 진과 셀을 지정해 주세요."; return; }
  const dates={};
  for(const [key,id,label] of [["birth","e-birth","생일"],["registeredAt","e-reg","교회 등록일"],
      ["baptizedAt","e-bap","세례일"],["marriedAt","e-married","결혼기념일"]]) {
    const parsed=parseDateLoose($(id).value);
    if(parsed===null){ $("edit-err").textContent=`${label} 형식을 확인해 주세요. 3-5 또는 1985-03-05 처럼 적어주세요.`;
      $(id).focus(); return; }
    dates[key]=parsed;
  }
  const data={ name, gender:$("e-gender").value, lunar:$("e-lunar").checked,
    phone:$("e-phone").value.trim(), address:$("e-address").value.trim(),
    address2:$("e-address2").value.trim(), job:$("e-job").value.trim(),
    position:$("e-position").value.trim(), invitedBy:$("e-invitedby").value.trim(),
    verse:$("e-verse").value.trim(), hobby:$("e-hobby").value.trim(), mbti:$("e-mbti").value.trim(),
    food:$("e-food").value.trim(), avoid:$("e-avoid").value.trim(),
    interest:$("e-interest").value.trim(), memo:$("e-memo").value.trim(),
    status:$("e-status").value, contactCycle:Number($("e-cycle").value)||0,
    cellId:$("e-cell").value||null, ...dates };
  $("btn-save-soul").disabled=true;
  try {
    let soulId=state.editingId;
    if(soulId) await updateDoc(doc(db,"souls",soulId),data);
    else {
      const ref=await addDoc(collection(db,"souls"),{ ...data, jinId:state.me.jinId, leaderUid:state.me.id,
        family:[], todos:[], lastMetAt:null, lastPrayedAt:null, prayOpen:0, prayTop:null,
        active:true, createdBy:state.me.id, createdAt:serverTimestamp() });
      soulId=ref.id;
    }
    if(state.editPhoto!==undefined){
      await setDoc(doc(db,"photos",soulId),{self:state.editPhoto},{merge:true});
      state.photoCache[soulId]=state.editPhoto;
    }
    state.editDirty=false; await loadSouls(); invalidate();
    toast("저장했어요."); openSoul(soulId);
  } catch(e){ $("edit-err").textContent=msgOf(e); }
  finally { $("btn-save-soul").disabled=false; }
};
$("btn-del-soul").onclick=async()=>{
  if(!confirm("이 카드를 목록에서 보관할까요? 기록은 지워지지 않아요.")) return;
  try { await updateDoc(doc(db,"souls",state.editingId),{active:false});
    state.editDirty=false; await loadSouls(); invalidate(); toast("보관했어요."); openSouls(); }
  catch(e){ toast(msgOf(e)); }
};

/* ════════ 셀모임 ════════ */
function myCells() {
  const list=state.cells.filter(c=>c.jinId===state.me.jinId);
  return list.length?list:state.cells;
}
function defaultCellId() {
  if(state.me.cellId) return state.me.cellId;
  const s=state.souls.find(x=>isLeaderOf(x)&&x.cellId);
  if(s) return s.cellId;
  const c=myCells()[0]; return c?c.id:null;
}
async function openMeet() {
  if(!canLead() && state.me.role!=="coach" && state.me.role!=="jinjang"){
    toast("셀모임은 셀을 맡은 분과 코치·진장이 볼 수 있어요."); return; }
  show("s-loading");
  await loadOrg(); await loadSouls(); await loadMeetings();
  const cellNm=(id)=>(state.cells.find(c=>c.id===id)||{}).name||"셀";
  const recent=state.meetings.slice(0,8);
  const rate=recent.length?Math.round(recent.reduce((sum,m)=>{
    const v=Object.values(m.attendance||{});
    return sum+(v.length?v.filter(x=>x!=="absent").length/v.length:0);
  },0)/recent.length*100):null;
  $("meet-tiles").innerHTML = tile("모임 기록", state.meetings.length+"회")
    + tile("최근 출석률", rate===null?"—":rate+"%")
    + tile("이번 달", state.meetings.filter(m=>String(m.date||"").slice(0,7)===todayStr().slice(0,7)).length+"회");
  $("list-meets").innerHTML = state.meetings.map(m=>{
    const v=Object.values(m.attendance||{}), ok=v.filter(x=>x!=="absent").length;
    const notes=Object.values(m.notes||{}).filter(n=>n&&(n.update||n.pray)).length;
    return `<div class="row" data-meeting="${m.id}" style="cursor:pointer">
      <div class="grow"><p class="nm">${fmtDate(m.date)} · ${esc(cellNm(m.cellId))}</p>
        <p class="sub">출석 ${ok} / ${v.length}${m.topic?" · "+esc(m.topic):""}${notes?` · 나눔 ${notes}명`:""}</p></div>
      <span class="chip">${v.length?Math.round(ok/v.length*100)+"%":"—"}</span></div>`;
  }).join("") || `<p class="muted">아직 모임 기록이 없어요. 오른쪽 위 + 를 눌러 이번 주 모임을 만들어요.</p>`;
  $("btn-meet-new").hidden = !canLead();
  markSide("meet"); show("s-meet");
}
$("list-meets").addEventListener("click",(ev)=>{
  const r=ev.target.closest("[data-meeting]"); if(!r) return; openMeeting(r.dataset.meeting);
});
$("btn-meet-new").onclick=()=>openMeeting(null);
$("meeting-back").onclick=()=>openMeet();

function openMeeting(id) {
  const m = id?state.meetings.find(x=>x.id===id):null;
  const cells = myCells();
  if(!m && !cells.length){ toast("먼저 셀을 만들어 주세요. 리더 관리에서 추가할 수 있어요."); return; }
  state.meeting = m ? { attendance:{}, reasons:{}, notes:{}, ...m } : {
    id:null, cellId:defaultCellId(), jinId:state.me.jinId, date:todayStr(), time:"",
    place:"", topic:"", note:"", visitors:"", attendance:{}, reasons:{}, notes:{}, open:{} };
  state.meeting.open = state.meeting.open || {};
  const mine = !m || m.leaderUid===uid();
  $("meeting-title").textContent = m?fmtDate(m.date)+" 모임":"새 모임";
  $("m-cell").innerHTML = cells.map(c=>
    `<option value="${c.id}"${state.meeting.cellId===c.id?" selected":""}>${esc(c.name)}</option>`).join("")
    || `<option value="">셀 없음</option>`;
  $("m-date").value=state.meeting.date;
  $("m-time").value=state.meeting.time||"";
  $("m-place").value=state.meeting.place||"";
  $("m-topic").value=state.meeting.topic||"";
  $("m-note").value=state.meeting.note||"";
  $("m-visitor").value=state.meeting.visitors||"";
  ["m-date","m-time","m-place","m-topic","m-note","m-visitor","m-cell"].forEach(i=>$(i).disabled=!mine);
  $("btn-meeting-save").hidden=!mine;
  $("btn-all-present").hidden=!mine; $("btn-all-open").hidden=!mine;
  $("meeting-del").hidden=!(mine&&m);
  autoGrow($("m-note")); renderAttendance(mine); show("s-meeting");
}
$("m-cell").onchange=()=>{ state.meeting.cellId=$("m-cell").value; renderAttendance(true); };
$("btn-all-present").onclick=()=>{
  state.souls.filter(s=>s.cellId===state.meeting.cellId)
    .forEach(s=>{ if(!state.meeting.attendance[s.id]) state.meeting.attendance[s.id]="present"; });
  renderAttendance(true);
};
$("btn-all-open").onclick=()=>{
  const roster=state.souls.filter(s=>s.cellId===state.meeting.cellId);
  const allOpen=roster.every(s=>state.meeting.open[s.id]);
  roster.forEach(s=>state.meeting.open[s.id]=!allOpen);
  renderAttendance(true);
};
function renderAttendance(mine) {
  const mt=state.meeting;
  const roster=state.souls.filter(s=>s.cellId===mt.cellId);
  const n=Object.values(mt.attendance).filter(v=>v&&v!=="absent").length;
  const head = roster.length?`<p class="muted" style="font-size:12px;grid-column:1/-1">${roster.length}명 중 ${n}명 출석</p>`:"";
  $("list-att").innerHTML = head + roster.map(s=>{
    const v=mt.attendance[s.id]||"", nt=mt.notes[s.id]||{}, open=!!mt.open[s.id];
    const has=(nt.update||nt.pray);
    return `<div class="member">
      <div class="top">
        <span class="ava" style="width:34px;height:34px;font-size:13px">${esc(initial(s.name))}</span>
        <div class="grow" style="flex-grow:1;min-width:0">
          <p class="nm">${esc(s.name)}</p>
          ${has&&!open?`<p class="sub" style="margin-top:2px">${esc((nt.update||nt.pray).slice(0,24))}…</p>`:""}
        </div>
        <div class="att">${["present","online","absent"].map(k=>
          `<button data-att="${s.id}" data-v="${k}" class="${v===k?"on":""}" ${mine?"":"disabled"}>${ATT[k].slice(0,2)}</button>`).join("")}</div>
        ${mine?`<button class="btn-sm" data-open-m="${s.id}" style="width:38px;padding:0">${open?"▴":"▾"}</button>`:""}
      </div>
      ${v==="absent"?`<input data-reason="${s.id}" value="${esc(mt.reasons[s.id]||"")}"
        placeholder="결석 사유 (한 줄)" style="height:40px;margin-top:10px;font-size:14px" ${mine?"":"disabled"}>`:""}
      ${open?`<div class="more">
        <p class="tag">근황 · 나눔</p>
        <textarea data-note="${s.id}" data-k="update" placeholder="오늘 나눈 이야기, 요즘 어떤지" ${mine?"":"disabled"}>${esc(nt.update||"")}</textarea>
        <p class="tag">기도제목</p>
        <textarea data-note="${s.id}" data-k="pray" placeholder="함께 기도할 제목" ${mine?"":"disabled"}>${esc(nt.pray||"")}</textarea>
      </div>`:""}
    </div>`;
  }).join("") || `<p class="muted">이 셀에 등록된 영혼이 없어요. 영혼 카드를 만들 때 이 셀을 골라주세요.</p>`;
  $("list-att").querySelectorAll("textarea").forEach(autoGrow);
}
$("list-att").addEventListener("click",(ev)=>{
  const o=ev.target.closest("[data-open-m]");
  if(o){ const id=o.dataset.openM; state.meeting.open[id]=!state.meeting.open[id]; renderAttendance(true); return; }
  const b=ev.target.closest("[data-att]"); if(!b) return;
  const id=b.dataset.att, v=b.dataset.v;
  state.meeting.attendance[id]=(state.meeting.attendance[id]===v)?"":v;
  if(!state.meeting.attendance[id]) delete state.meeting.attendance[id];
  renderAttendance(true);
});
$("list-att").addEventListener("input",(ev)=>{
  const r=ev.target.closest("[data-reason]");
  if(r){ state.meeting.reasons[r.dataset.reason]=r.value; return; }
  const n=ev.target.closest("[data-note]");
  if(n){ const id=n.dataset.note;
    state.meeting.notes[id]=state.meeting.notes[id]||{};
    state.meeting.notes[id][n.dataset.k]=n.value; }
});

$("btn-meeting-save").onclick=async()=>{
  const mt=state.meeting;
  $("meeting-err").textContent="";
  const cellId=$("m-cell").value||mt.cellId;
  const data={ cellId, jinId:state.me.jinId, leaderUid:state.me.id,
    date:$("m-date").value||todayStr(), time:$("m-time").value||"",
    place:$("m-place").value.trim(), topic:$("m-topic").value.trim(),
    note:$("m-note").value.trim(), visitors:$("m-visitor").value.trim(),
    attendance:mt.attendance, reasons:mt.reasons, notes:mt.notes,
    recRefs: mt.recRefs||{}, updatedAt:serverTimestamp() };
  $("btn-meeting-save").disabled=true;
  try {
    let mid=mt.id;
    if(!mid){ const ref=await addDoc(collection(db,"meetings"),{...data,createdAt:serverTimestamp()});
      mid=ref.id; }
    /* 개인별 근황·기도제목을 각자 영혼 카드에 반영 */
    const refs = { ...(data.recRefs||{}) };
    for (const s of state.souls.filter(x=>x.cellId===cellId && isLeaderOf(x))) {
      const nt = mt.notes[s.id]||{};
      const mine = refs[s.id]||{};
      for (const [k,type,extra] of [["update","meet",{kind:"cell"}],["pray","pray",{prayStatus:"praying"}]]) {
        const txt = (nt[k]||"").trim();
        const existing = mine[k];
        if (txt && existing) {
          await updateDoc(doc(db,"souls",s.id,"records",existing),
            { body:txt, date:data.date, ...(type==="meet"?{update:txt}:{}) });
        } else if (txt && !existing) {
          const r = await addDoc(collection(db,"souls",s.id,"records"), {
            type, scope:"leader", date:data.date, body:txt,
            ...(type==="meet"?{kind:"cell",update:txt,place:data.place||"",time:data.time||""}:{}),
            ...extra, meetingId:mid, by:uid(), byName:state.me.name||"", createdAt:serverTimestamp() });
          mine[k]=r.id;
        } else if (!txt && existing) {
          try { await deleteDoc(doc(db,"souls",s.id,"records",existing)); } catch {}
          delete mine[k];
        }
      }
      if (Object.keys(mine).length) refs[s.id]=mine; else delete refs[s.id];
      /* 출석했으면 마지막 만남 갱신 */
      if (mt.attendance[s.id] && mt.attendance[s.id]!=="absent") {
        if (!s.lastMetAt || s.lastMetAt < data.date) {
          await updateDoc(doc(db,"souls",s.id),{ lastMetAt:data.date });
          s.lastMetAt = data.date;
        }
      }
    }
    await updateDoc(doc(db,"meetings",mid), { ...data, recRefs:refs });
    await loadMeetings(); invalidate(); toast("저장했어요."); openMeet();
  } catch(e){ $("meeting-err").textContent=msgOf(e); }
  finally { $("btn-meeting-save").disabled=false; }
};
$("meeting-del").onclick=async()=>{
  if(!state.meeting.id) return;
  if(!confirm("이 모임 기록을 지울까요? 각자 카드에 쌓인 나눔은 남아요.")) return;
  try { await deleteDoc(doc(db,"meetings",state.meeting.id));
    await loadMeetings(); toast("지웠어요."); openMeet(); }
  catch(e){ toast(msgOf(e)); }
};
$("btn-gcal-meeting").onclick=()=>{
  const cellId=$("m-cell").value||state.meeting.cellId;
  const c=state.cells.find(x=>x.id===cellId);
  window.open(gcalUrl({ date:$("m-date").value||todayStr(), time:$("m-time").value||"",
    title:`${c?c.name:"셀"} 셀모임`, sub:$("m-topic").value.trim(), place:$("m-place").value.trim() }),"_blank");
};
$("btn-report").onclick=()=>{
  const mt=state.meeting;
  const cellId=$("m-cell").value||mt.cellId;
  const cellNm=(state.cells.find(c=>c.id===cellId)||{}).name||"셀";
  const roster=state.souls.filter(s=>s.cellId===cellId);
  const by=(v)=>roster.filter(s=>mt.attendance[s.id]===v);
  const present=by("present"), online=by("online"), absent=by("absent");
  const shares=roster.filter(s=>(mt.notes[s.id]||{}).update)
    .map(s=>`- ${s.name}: ${mt.notes[s.id].update}`);
  const prayers=roster.filter(s=>(mt.notes[s.id]||{}).pray)
    .map(s=>`- ${s.name}: ${mt.notes[s.id].pray}`);
  const lines=[
    `[${cellNm}] ${fmtDate($("m-date").value||todayStr())} 셀모임${$("m-time").value?" "+$("m-time").value:""}`,
    $("m-place").value.trim()?`장소: ${$("m-place").value.trim()}`:"",
    `출석 ${present.length+online.length}명 / 결석 ${absent.length}명`,
    present.length?`출석: ${present.map(s=>s.name).join(", ")}`:"",
    online.length?`온라인: ${online.map(s=>s.name).join(", ")}`:"",
    absent.length?`결석: ${absent.map(s=>mt.reasons[s.id]?`${s.name}(${mt.reasons[s.id]})`:s.name).join(", ")}`:"",
    $("m-topic").value.trim()?`나눔: ${$("m-topic").value.trim()}`:"",
    $("m-visitor").value.trim()?`새 방문자: ${$("m-visitor").value.trim()}`:"",
    shares.length?`\n나눔\n${shares.join("\n")}`:"",
    prayers.length?`\n기도제목\n${prayers.join("\n")}`:"",
    $("m-note").value.trim()?`\n특이사항\n${$("m-note").value.trim()}`:""
  ].filter(Boolean);
  $("report-text").value=lines.join("\n");
  $("dlg-report").showModal(); autoGrow($("report-text"));
};
$("rp-close").onclick=()=>$("dlg-report").close();
$("rp-copy").onclick=async()=>{
  try{ await navigator.clipboard.writeText($("report-text").value); toast("복사했어요."); }
  catch{ $("report-text").select(); toast("길게 눌러 복사해 주세요."); }
};

/* ════════ 더보기 ════════ */
async function openMore() {
  const me=state.me;
  $("more-ava").textContent=initial(me.name);
  $("more-name").textContent=me.name||"";
  $("more-email").textContent=`${me.email||""} · ${ROLE[me.role]||me.role}`;
  $("app-ver").textContent=APP_VERSION;
  $("install-sub").textContent = window.matchMedia("(display-mode: standalone)").matches
    ? "이미 앱으로 설치되어 있어요":"폰 홈 화면에서 바로 열 수 있어요";
  markSide("more"); show("s-more");
}
$("btn-go-train").onclick=()=>openTrainBoard();
$("btn-go-search").onclick=()=>openSearch();
$("btn-rename").onclick=async()=>{
  const name=prompt("이름을 적어주세요", state.me.name||"");
  if(!name||!name.trim()) return;
  try{ await updateDoc(doc(db,"users",state.me.id),{name:name.trim()});
    state.me.name=name.trim(); toast("바꿨어요."); openMore(); }
  catch(e){ toast(msgOf(e)); }
};
$("btn-refresh").onclick=async()=>{
  try{
    if("serviceWorker" in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if(window.caches){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); }
  }catch{}
  location.reload();
};
let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",(e)=>{ e.preventDefault(); deferredPrompt=e; });
$("btn-install").onclick=async()=>{
  if(deferredPrompt){ deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; return; }
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
  $("install-guide").innerHTML = ios?`
    <p>사파리에서 이 페이지를 연 다음</p>
    <ol style="margin:10px 0 0;padding-left:18px;line-height:2">
      <li>아래쪽 <b>공유 버튼</b>(↑)을 누르고</li>
      <li>목록에서 <b>홈 화면에 추가</b>를 고르고</li>
      <li>오른쪽 위 <b>추가</b>를 누르면 끝이에요.</li></ol>
    <p style="margin-top:12px">크롬이 아니라 <b>사파리</b>에서 해야 돼요.</p>`
    : `<p>브라우저 메뉴(⋮)를 열고 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러주세요.</p>
       <p style="margin-top:10px">메뉴에 보이지 않으면 페이지를 새로고침한 뒤 다시 열어보세요.</p>`;
  $("dlg-install").showModal();
};
$("ins-close").onclick=()=>$("dlg-install").close();

function download(filename, text, mime) {
  const blob=new Blob(["﻿"+text],{type:(mime||"text/csv")+";charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },1000);
}
const csvCell=(v)=>`"${String(v??"").replace(/"/g,'""')}"`;
const csvRow=(arr)=>arr.map(csvCell).join(",");

$("btn-export-souls").onclick=async()=>{
  toast("명단을 모으는 중이에요…");
  await loadOrg(); await loadSouls();
  const cellNm=(id)=>(state.cells.find(c=>c.id===id)||{}).name||"";
  const head=["이름","상태","셀","생일","음력","연락처","주소","상세주소","직장·학교","성별",
    "교회등록일","세례일","결혼기념일","직분","인도자","인생말씀","취미","MBTI","좋아하는것",
    "피해야할것","관심사","연락주기(일)","마지막만남","기도중","메모"];
  const rows=state.souls.map(s=>[s.name,STATUS[s.status]||"",cellNm(s.cellId),fmtDate(s.birth,true),
    s.lunar?"음력":"",s.phone,s.address,s.address2,s.job,s.gender,
    fmtDate(s.registeredAt,true),fmtDate(s.baptizedAt,true),fmtDate(s.marriedAt,true),
    s.position,s.invitedBy,s.verse,s.hobby,s.mbti,s.food,s.avoid,s.interest,
    s.contactCycle||"",s.lastMetAt||"",s.prayOpen||0,s.memo]);
  download(`목자의삶_영혼명단_${todayStr()}.csv`,[csvRow(head),...rows.map(csvRow)].join("\r\n"));
  toast(`${rows.length}명을 내려받았어요.`);
};
$("btn-export-recs").onclick=async()=>{
  toast("기록을 모으는 중이에요…");
  await loadOrg(); await loadSouls();
  const all=await loadAllRecords(true);
  const head=["이름","종류","만남유형","날짜","시간","장소","내용","무엇을했나","나눈이야기",
    "만나기전마음","주신말씀","만나면서받은마음","근황","영적상태","공개범위"];
  const rows=all.map(r=>[r.soulName,RTYPE[r.type]||r.type,r.kind?(KIND[r.kind]||""):"",
    r.date,r.time||"",r.place||"",r.body||"",r.did||"",r.talked||"",r.beforeHeart||"",
    r.beforeWord||"",r.duringHeart||"",r.update||"",r.spiritual||"",SCOPE[r.scope]||r.scope]);
  download(`목자의삶_기록_${todayStr()}.csv`,[csvRow(head),...rows.map(csvRow)].join("\r\n"));
  toast(`${rows.length}건을 내려받았어요.`);
};
$("btn-export-all").onclick=async()=>{
  if(!confirm("전체 백업을 만들까요? 영혼 수에 따라 조금 걸릴 수 있어요.")) return;
  toast("백업을 만드는 중이에요…");
  try{
    await loadOrg(); await loadSouls(); await loadMeetings();
    const souls=[];
    for(const s of state.souls){
      const [recs,trains]=await Promise.all([
        getDocs(collection(db,"souls",s.id,"records")),
        getDocs(collection(db,"souls",s.id,"trainings"))
      ]);
      souls.push({ ...s, records:pack(recs), trainings:pack(trains) });
    }
    const backup={ 앱:APP_NAME, 버전:APP_VERSION, 만든날짜:todayStr(),
      만든사람:{이름:state.me.name,이메일:state.me.email,역할:ROLE[state.me.role]},
      진:state.jins, 셀:state.cells, 훈련과정:state.courses, 영혼:souls, 셀모임:state.meetings };
    download(`목자의삶_전체백업_${todayStr()}.json`,JSON.stringify(backup,null,2),"application/json");
    toast("백업 파일을 내려받았어요.");
  }catch(e){ toast(msgOf(e)); }
};

/* ════════ 리더 관리 ════════ */
async function openManage() {
  show("s-loading");
  await loadOrg();
  const isSuper=state.me.role==="super";
  const cellName=(id)=>(state.cells.find(c=>c.id===id)||{}).name||"";
  const jinName=(id)=>(state.jins.find(j=>j.id===id)||{}).name||"";
  const card1=$("my-cell-card");
  card1.hidden = state.me.role==="leader";
  if(!card1.hidden){
    $("my-lead").checked=!!state.me.isLeader;
    $("my-cell-wrap").hidden=!state.me.isLeader;
    $("my-jin-wrap").hidden=!isSuper;
    $("my-jin").innerHTML=state.jins.map(j=>
      `<option value="${j.id}"${state.me.jinId===j.id?" selected":""}>${esc(j.name)}</option>`).join("");
    fillMyCells();
  }
  $("list-members").innerHTML = state.members.map(m=>{
    const where1 = m.role==="leader"?cellName(m.cellId)
      : m.role==="coach"?`담당 셀 ${(m.cellIds||[]).length}개`
      : jinName(m.jinId)+(m.isLeader?" · 셀 겸직":"");
    const canEdit = m.id!==state.me.id && m.role!=="super" && (isSuper||state.me.role==="jinjang");
    const roleOptions=(isSuper?["jinjang","coach","leader"]:["coach","leader"])
      .map(r=>`<option value="${r}"${m.role===r?" selected":""}>${ROLE[r]}</option>`).join("");
    return `<div class="row ${m.active?"":"off"}" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="grow"><p class="nm">${esc(m.name)} ${m.active?"":"· 중지됨"}</p>
          <p class="sub">${esc(m.email)}</p></div>
        <span class="chip ${m.role==="super"?"":"rose"}">${ROLE[m.role]||m.role}</span>
      </div>
      ${where1?`<p class="sub" style="margin-top:6px">${esc(where1)}</p>`:""}
      ${canEdit?`<div class="acts">
        <select class="btn-sm" data-act="role" data-uid="${m.id}" style="width:auto;padding:0 10px">${roleOptions}</select>
        ${m.role==="coach"?`<button class="btn-sm" data-act="cells" data-uid="${m.id}">담당 셀</button>`:""}
        <button class="btn-sm" data-act="pwreset" data-email="${esc(m.email)}">비번 재설정 메일</button>
        <button class="btn-sm ${m.active?"danger":""}" data-act="toggle" data-uid="${m.id}" data-on="${m.active}">${m.active?"사용 중지":"다시 사용"}</button>
      </div>`:""}
    </div>`;
  }).join("") || `<p class="muted">아직 구성원이 없어요.</p>`;
  const pending=state.invites.filter(i=>i.status==="pending");
  $("list-invites").innerHTML = pending.map(i=>`
    <div class="row"><div class="grow"><p class="nm">${esc(i.name||i.email)}</p>
      <p class="sub">${esc(i.email)} · ${ROLE[i.role]||i.role}</p></div>
      <button class="btn-sm danger" data-act="cancel" data-email="${esc(i.email)}">취소</button></div>`).join("")
    || `<p class="muted">대기 중인 초대가 없어요.</p>`;
  $("list-cells").innerHTML = state.cells.map(c=>`
    <div class="row"><div class="grow"><p class="nm">${esc(c.name)}</p>
      <p class="sub">${esc(jinName(c.jinId))} · 리더 ${state.members.filter(m=>m.cellId===c.id).length}명</p>
    </div></div>`).join("") || `<p class="muted">아직 셀이 없어요.</p>`;
  $("list-courses").innerHTML = state.courses.map((c,i)=>`
    <div class="row"><div class="grow"><p class="nm">${esc(c.name)}</p>
      <p class="sub">${(c.sessions||1)>1?`${c.sessions}번 만남`:"1번에 끝남"}</p></div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn-sm" data-act="cup" data-cid="${c.id}" aria-label="위로" style="width:36px;padding:0"${i===0?" disabled":""}>↑</button>
        <button class="btn-sm" data-act="cdown" data-cid="${c.id}" aria-label="아래로" style="width:36px;padding:0"${i===state.courses.length-1?" disabled":""}>↓</button>
        <button class="btn-sm" data-act="cedit" data-cid="${c.id}">수정</button>
      </div></div>`).join("")
    || `<p class="muted">훈련 과정을 등록하면 영혼 카드에 현황이 생겨요.<br>예) 새로운 삶(8회), 확신의 삶, 제자훈련</p>`;
  $("jin-block").hidden=!isSuper;
  if(isSuper){
    $("list-jins").innerHTML=state.jins.map(j=>{
      const head=state.members.filter(m=>m.role==="jinjang"&&m.jinId===j.id);
      return `<div class="row"><div class="grow"><p class="nm">${esc(j.name)}</p>
        <p class="sub">${head.length?"진장 "+esc(head.map(h=>h.name).join(", ")):"진장 없음"}</p></div></div>`;
    }).join("") || `<p class="muted">아직 진이 없어요.</p>`;
  }
  show("s-manage");
}
function fillMyCells() {
  const jinId = state.me.role==="super"?($("my-jin").value||state.me.jinId):state.me.jinId;
  const list=state.cells.filter(c=>c.jinId===jinId);
  $("my-cell").innerHTML=list.map(c=>
    `<option value="${c.id}"${state.me.cellId===c.id?" selected":""}>${esc(c.name)}</option>`).join("")
    || `<option value="">셀 없음 — 아래에서 셀을 먼저 만들어 주세요</option>`;
}
$("my-lead").onchange=()=>{ $("my-cell-wrap").hidden=!$("my-lead").checked; };
$("my-jin").onchange=()=>fillMyCells();
$("btn-my-save").onclick=async()=>{
  const on=$("my-lead").checked, patch={isLeader:on};
  if(on){ patch.cellId=$("my-cell").value||null;
    if(state.me.role==="super") patch.jinId=$("my-jin").value||null;
    if(!patch.cellId){ toast("셀을 먼저 만들고 골라주세요."); return; } }
  try{ await updateDoc(doc(db,"users",state.me.id),patch);
    Object.assign(state.me,patch);
    await log(on?"셀 겸직 설정":"셀 겸직 해제",state.me.id);
    toast(on?"이제 영혼 카드를 만들 수 있어요.":"셀 겸직을 껐어요."); openManage(); }
  catch(e){ toast(msgOf(e)); }
};
$("s-manage").addEventListener("click",async(ev)=>{
  const el=ev.target.closest("[data-act]"); if(!el) return;
  const act=el.dataset.act;
  if(act==="pwreset"){
    try{ await sendPasswordResetEmail(auth,el.dataset.email);
      toast("재설정 메일을 보냈어요. 본인 메일함을 확인하라고 알려주세요."); }
    catch(e){ toast(msgOf(e)); }
  }
  if(act==="toggle"){
    const on=el.dataset.on==="true";
    if(!confirm(on?"이 계정의 사용을 중지할까요?":"다시 사용하게 할까요?")) return;
    try{ await updateDoc(doc(db,"users",el.dataset.uid),{active:!on});
      await log(on?"계정 중지":"계정 복구",el.dataset.uid); openManage(); }
    catch(e){ toast(msgOf(e)); }
  }
  if(act==="cancel"){
    if(!confirm("이 초대를 취소할까요?")) return;
    try{ await deleteDoc(doc(db,"invites",el.dataset.email));
      await log("초대 취소",el.dataset.email); openManage(); }
    catch(e){ toast(msgOf(e)); }
  }
  if(act==="cells") openCellsDlg(el.dataset.uid);
  if(act==="cup") moveCourse(el.dataset.cid,-1);
  if(act==="cdown") moveCourse(el.dataset.cid,1);
  if(act==="cedit") openCourseDlg(el.dataset.cid);
});
$("s-manage").addEventListener("change",async(ev)=>{
  const el=ev.target.closest('[data-act="role"]'); if(!el) return;
  try{ await updateDoc(doc(db,"users",el.dataset.uid),{role:el.value});
    await log("역할 변경",el.dataset.uid,el.value); toast("역할을 바꿨어요."); openManage(); }
  catch(e){ toast(msgOf(e)); openManage(); }
});
const dlgCells=$("dlg-cells");
let cellsTargetUid=null;
function openCellsDlg(targetUid) {
  cellsTargetUid=targetUid;
  const m=state.members.find(x=>x.id===targetUid)||{};
  const picked=m.cellIds||[];
  $("cells-check").innerHTML=state.cells.map(c=>`
    <label class="row" style="cursor:pointer">
      <input type="checkbox" value="${c.id}" ${picked.includes(c.id)?"checked":""}
        style="width:20px;height:20px;accent-color:var(--action)">
      <span class="grow nm">${esc(c.name)}</span></label>`).join("")
    || `<p class="muted">셀을 먼저 만들어 주세요.</p>`;
  dlgCells.showModal();
}
$("cc-cancel").onclick=()=>dlgCells.close();
$("cc-save").onclick=async()=>{
  const ids=[...$("cells-check").querySelectorAll("input:checked")].map(i=>i.value);
  try{ await updateDoc(doc(db,"users",cellsTargetUid),{cellIds:ids});
    await log("담당 셀 지정",cellsTargetUid,ids.join(","));
    dlgCells.close(); toast("담당 셀을 저장했어요."); openManage(); }
  catch(e){ toast(msgOf(e)); }
};
async function addCell(after) {
  const name=prompt("셀 이름을 적어주세요 (예: 다니엘 셀)");
  if(!name||!name.trim()) return;
  const jinId = state.me.role==="super"?(state.me.jinId||(state.jins[0]&&state.jins[0].id)):state.me.jinId;
  if(!jinId){ toast("먼저 진을 만들어 주세요."); return; }
  try{ await addDoc(collection(db,"cells"),{name:name.trim(),jinId,active:true,createdAt:serverTimestamp()});
    await log("셀 추가",name.trim()); await loadOrg(); toast("셀을 만들었어요.");
    if(after) after(); else openManage(); }
  catch(e){ toast(msgOf(e)); }
}
$("btn-cell-add").onclick=()=>addCell();
$("btn-course-add").onclick=()=>openCourseDlg(null);
$("btn-jin-add").onclick=async()=>{
  const name=prompt("진 이름을 적어주세요 (예: 2진)");
  if(!name||!name.trim()) return;
  try{ await addDoc(collection(db,"jins"),{name:name.trim(),jinjangUid:null,active:true,createdAt:serverTimestamp()});
    await log("진 추가",name.trim()); openManage(); }
  catch(e){ toast(msgOf(e)); }
};

/* ════════ 초대 ════════ */
const dlg=$("dlg-invite");
$("btn-invite-open").onclick=()=>{
  const isSuper=state.me.role==="super";
  $("iv-name").value=""; $("iv-email").value=""; $("invite-err").textContent="";
  $("iv-role").innerHTML=(isSuper?["jinjang","coach","leader"]:["coach","leader"])
    .map(r=>`<option value="${r}">${ROLE[r]}</option>`).join("");
  $("iv-jin-wrap").hidden=!isSuper;
  $("iv-jin").innerHTML=state.jins.map(j=>`<option value="${j.id}">${esc(j.name)}</option>`).join("");
  fillInviteCells(); $("iv-role").onchange=syncRole; $("iv-jin").onchange=fillInviteCells;
  syncRole(); dlg.showModal();
};
function fillInviteCells() {
  const jinId=state.me.role==="super"?$("iv-jin").value:state.me.jinId;
  const list=state.cells.filter(c=>c.jinId===jinId);
  $("iv-cell").innerHTML=list.length?list.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")
    :`<option value="">셀 없음 (나중에 지정)</option>`;
}
function syncRole(){ $("iv-cell-wrap").hidden=$("iv-role").value!=="leader"; }
$("iv-cancel").onclick=()=>dlg.close();
$("iv-send").onclick=async()=>{
  const name=$("iv-name").value.trim(), email=$("iv-email").value.trim().toLowerCase();
  const role=$("iv-role").value;
  const jinId=state.me.role==="super"?$("iv-jin").value:state.me.jinId;
  const cellId=role==="leader"?($("iv-cell").value||null):null;
  $("invite-err").textContent="";
  if(!name||!email){ $("invite-err").textContent="이름과 이메일을 적어주세요."; return; }
  if(!email.includes("@")){ $("invite-err").textContent="이메일 형식을 확인해 주세요."; return; }
  if(!jinId){ $("invite-err").textContent="먼저 진을 만들어 주세요."; return; }
  $("iv-send").disabled=true;
  try{
    const exist=await getDoc(doc(db,"invites",email));
    if(exist.exists()&&exist.data().status==="accepted"){
      $("invite-err").textContent="이미 가입한 사람이에요."; return; }
    await setDoc(doc(db,"invites",email),{ email,name,role,jinId,cellId,status:"pending",
      invitedBy:state.me.id, invitedAt:serverTimestamp() });
    await log("초대",email,role);
    dlg.close(); toast("초대했어요. 그분이 같은 이메일로 로그인하면 바로 들어와요."); openManage();
  }catch(e){ $("invite-err").textContent=msgOf(e); }
  finally{ $("iv-send").disabled=false; }
};

/* ════════ 기록 로그 ════════ */
async function log(action, target, detail) {
  try{ await addDoc(collection(db,"audit"),{ by:uid(), byName:state.me?state.me.name:"",
    action, target:target||"", detail:detail||"", at:serverTimestamp() }); }catch{}
}
