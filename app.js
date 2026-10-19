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
  collection, addDoc, getDocs, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const APP_NAME = "목자의 삶";
const APP_VERSION = "16.0 (2026-10-19)";

/* 사진 크기 — 얼굴을 알아볼 수 있는 선에서 가장 작게.
   얼굴 하나가 가로 80px은 되어야 알아보는데, 여럿이 한 줄로 선
   단체 사진이면 전체가 1,200px은 돼야 그게 나옵니다. */
const PHOTO = {
  face:   { max: 480, q: 0.72 },   // 영혼 카드 얼굴 사진 (크게 볼 때)
  faceTh: { max:  64, q: 0.62 },   // 목록에 뜨는 아주 작은 사본
  shot:   { max:1200, q: 0.70 },   // 모임 사진 원본
  shotTh: { max:  96, q: 0.62 }    // 기록 안에 붙는 작은 사본
};
const MAX_SHOTS = 3;

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
                 "s-edit","s-train","s-search","s-mine","s-usage","s-more","s-manage",
                 "s-photos","s-stats","s-inbox"];
const show = (id) => {
  SCREENS.forEach(s => $(s).hidden = (s !== id));
  if (id !== "s-loading" && typeof bump === "function") bump(id.replace(/^s-/, ""), "screen");
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
/* 기본 모임 종류 — 지울 수 없고, 교회가 직접 더 만들 수 있습니다.
   solo 가 true 면 한 명만, false 면 여러 명을 고릅니다. */
const BASE_KINDS = [
  { id:"one",   name:"1:1 만남",    solo:true,  order:1 },
  { id:"small", name:"소그룹 모임",  solo:false, order:2 },
  { id:"cell",  name:"셀모임 후",    solo:false, order:3 },
  /* 훈련 모임 — 새로운 삶 · 제자의 삶처럼 후원자와 피후원자가 회차로 만나는 것 */
  { id:"train", name:"훈련 모임",    solo:false, order:4 }
];
/* 교회 공통 종류 + 내가 직접 만든 종류 (남이 만든 개인 종류는 안 보임).
   순서와 숨기기는 사람마다 따로 — 내 계정(users)에 kindPrefs 로 둡니다. */
const kindPrefs = () => (state.me && state.me.kindPrefs) || { hidden:[], order:[] };
const kindList = () => {
  const ord = kindPrefs().order || [];
  const at = (id) => { const i = ord.indexOf(id); return i < 0 ? 999 : i; };
  return [...BASE_KINDS, ...state.meetTypes.filter(t => !t.ownerUid || t.ownerUid === uid())]
    .sort((a,b)=> (at(a.id) - at(b.id)) || ((a.order||99) - (b.order||99)));
};
/* 고를 때 보이는 것 — 숨긴 건 빼되, 지금 고쳐 쓰는 기록의 종류는 남겨둡니다 */
const kindsShown = (keep) => {
  const hid = kindPrefs().hidden || [];
  const list = kindList().filter(k => !hid.includes(k.id) || k.id === keep);
  return list.length ? list : [BASE_KINDS[0]];
};
const kindOf = (id) => kindList().find(k => k.id === id) || BASE_KINDS[0];
const kindName = (id) => (kindList().find(k => k.id === id) || {}).name || "만남";
/* 기록에 붙는 이름 — 훈련 모임이면 '새로운 삶 3회차' 처럼 */
const meetLabel = (r) => (r.kind === "train" && r.courseName)
  ? `${r.courseName}${r.sessionNo ? ` ${r.sessionNo}회차` : ""}`
  : ((kindList().find(k => k.id === r.kind) || {}).name || r.kindLabel || "만남");
const nameOfSoul = (id) => (state.souls.find(s => s.id === id) || {}).name || "";
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
/* 목록은 칸이 좁아 짧게 — 뒤에 붙는 출석·결석이 잘리지 않도록 */
function agoShort(n) {
  if (n === null) return "만남 없음";
  if (n <= 0) return "오늘 만남";
  if (n === 1) return "어제 만남";
  return `만남 ${n}일 전`;
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
/* 시간 — "14:30" → "오후 2:30", 범위는 "오후 2:30~4:00" */
function fmtTime(t) {
  if (!t) return "";
  const [h,m] = String(t).split(":").map(Number);
  if (isNaN(h)) return t;
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${pad2(m||0)}`;
}
function fmtSpan(from, to) {
  if (!from && !to) return "";
  if (!to) return fmtTime(from);
  if (!from) return `~ ${fmtTime(to)}`;
  const a = fmtTime(from), b = fmtTime(to);
  const sameHalf = a.slice(0,2) === b.slice(0,2);
  return `${a}~${sameHalf ? b.slice(3) : b}`;
}
function minutesBetween(from, to) {
  if (!from || !to) return null;
  const [h1,m1] = from.split(":").map(Number), [h2,m2] = to.split(":").map(Number);
  if ([h1,m1,h2,m2].some(isNaN)) return null;
  let d = (h2*60+m2) - (h1*60+m1);
  if (d < 0) d += 24*60;          // 자정을 넘긴 경우
  return d;
}
function durText(from, to) {
  const d = minutesBetween(from, to);
  if (d === null || d === 0) return "";
  const h = Math.floor(d/60), m = d%60;
  return `${h?`${h}시간`:""}${h&&m?" ":""}${m?`${m}분`:""} 함께했어요`;
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
  jins:[], cells:[], members:[], invites:[], courses:[], meetTypes:[], orgAt:0,
  soulsAt:0, meetingsAt:0, myNotes:[], mineFilter:"all", shared:[],
  souls:[], meetings:[], trainings:[], allRecords:null, allTrainings:null,
  soul:null, records:[], soulTab:"rec", recKw:"", recType:"all", flowAsc:false,
  meeting:null, log:null,
  prayIdx:0, filter:"all", photoCache:{}, editingId:null, editPhoto:undefined, editThumb:undefined,
  editDirty:false, lastTab:"home", calMonth:null, calPick:null, gsFilter:"all"
};
const uid = () => auth.currentUser ? auth.currentUser.uid : null;
const isLeaderOf = (s) => s && s.leaderUid === uid();
const canLead = () => state.me && (state.me.role === "leader" || state.me.isLeader === true);
/* 진장은 셀리더를 목양하므로, 셀을 맡지 않아도 카드를 만들 수 있습니다 */
const canMakeSoul = () => canLead() || (state.me && state.me.role === "jinjang");
/* 셀리더 카드는 셀 구성원이 아니므로 출석 명단에 넣지 않습니다 */
const isLeaderCard = (s) => s && (s.kind === "leader" || s.kind === "coach");
const KINDLABEL = { leader:"셀리더", coach:"코치" };
const initial = (name) => (name || "?").trim().slice(-1);
/* 목록·명단에 쓰는 동그란 얼굴.
   작은 사본은 영혼 카드 안에 들어 있어서 따로 불러오지 않습니다. */
function avatar(s, px) {
  const size = px ? `width:${px}px;height:${px}px;font-size:${Math.round(px*0.38)}px;` : "";
  return s.thumb
    ? `<span class="ava" style="${size}background-image:url(${s.thumb})"></span>`
    : `<span class="ava" style="${size}">${esc(initial(s.name))}</span>`;
}
const pack = (s) => s.docs.map(d => ({ id:d.id, ...d.data() }));
/* 리더가 정한 순서 먼저, 안 정한 사람은 이름순으로 뒤에 */
const bySeq = (a,b) =>
  (a.seq ?? 9999) - (b.seq ?? 9999) || (a.name||"").localeCompare(b.name||"","ko");
/* "1992-03-11" → "1992년생 · 3월 11일", 연도가 없으면 "3월 11일" */
function birthText(s) {
  if (!s.birth) return "";
  const p = String(s.birth).split("-");
  if (p.length < 3) return "";
  const year = p[0] !== "0000" ? `${p[0]}년생` : "";
  const md = (p[1] !== "00" && p[2] !== "00")
    ? `${Number(p[1])}월 ${Number(p[2])}일${s.lunar ? " (음력)" : ""}`
    : (p[1] !== "00" ? `${Number(p[1])}월` : "");
  return [year, md].filter(Boolean).join(" · ");
}

/* ── 사진 줄이기 ──
   브라우저에서 바로 줄여서 넣습니다. 원본은 올라가지 않아요. */
function shrink(file, spec) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("사진을 읽지 못했어요."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("사진 형식을 알아보지 못했어요."));
      img.onload = () => {
        const scale = Math.min(1, spec.max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(img.width * scale));
        cv.height = Math.max(1, Math.round(img.height * scale));
        const cx = cv.getContext("2d");
        cx.fillStyle = "#000"; cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", spec.q));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
/* 저장되는 칸 하나는 1MB를 넘으면 안 됩니다.
   그 전에 품질을 더 낮춰서라도 들어가게 합니다. */
async function shrinkFit(file, spec, limit) {
  let q = spec.q, max = spec.max, out = "";
  for (let i = 0; i < 4; i++) {
    out = await shrink(file, { max, q });
    if (out.length <= limit) return out;
    q = Math.max(0.3, q - 0.12); max = Math.round(max * 0.8);
  }
  if (out.length > limit) throw new Error("사진이 너무 커요. 다른 사진을 골라주세요.");
  return out;
}

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
ICON.train = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9m5 10V5m5 14v-7m5 7V8"/></svg>`;
ICON.stats = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6.5h9M4 12h14M4 17.5h6"/></svg>`;
ICON.photos = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/><circle cx="9" cy="11" r="1.8"/><path d="m20.5 16-4.5-4.5-7.5 8"/></svg>`;
/* 폰 아래 탭은 다섯 칸이 한계라 그대로 두고, 넓은 화면 왼쪽 목록에만 더 둡니다.
   폰에서는 같은 것들이 '더보기' 안에 있어요. */
const NAV = [["home","홈"],["souls","영혼들"],["cal","캘린더"],["meet","셀모임"],["more","더보기"]];
ICON.inbox = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>`;
const SIDE = [["home","홈"],["inbox","소식"],["souls","영혼들"],["cal","캘린더"],["meet","셀모임"],
  ["train","훈련 현황"],["stats","활동 통계"],["photos","사진 모아보기"],["more","더보기"]];
function renderNav() {
  document.querySelectorAll("[data-nav]").forEach(nav => {
    nav.innerHTML = NAV.map(([k,label]) =>
      `<button data-tab="${k}" class="${nav.dataset.nav === k ? "on" : ""}">${ICON[k]}${label}</button>`).join("");
  });
  $("side-nav").innerHTML = SIDE.map(([k,label]) =>
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
  else if (t === "train") openTrainBoard();
  else if (t === "stats") openStats();
  else if (t === "photos") openPhotos();
  else if (t === "inbox") openInbox();
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
/* 조직도(진·셀·구성원·훈련과정·모임종류)는 자주 바뀌지 않습니다.
   화면을 옮길 때마다 다시 읽으면 하루 읽기 횟수의 상당 부분이
   여기서 날아가므로, 한 번 읽고 10분 동안 재사용합니다. */
const ORG_TTL = 10 * 60 * 1000;
async function loadOrg(force) {
  if (!force && state.orgAt && Date.now() - state.orgAt < ORG_TTL) return;
  const me = state.me, isSuper = me.role === "super";
  const mine = (col) => isSuper ? getDocs(collection(db, col))
    : getDocs(query(collection(db, col), where("jinId","==",me.jinId)));
  try {
    const [jins, cells, users, invites, courses, mtypes] = await Promise.all([
      getDocs(collection(db,"jins")), mine("cells"), mine("users"), mine("invites"),
      getDocs(collection(db,"courses")), getDocs(collection(db,"meetTypes"))
    ]);
    state.jins = pack(jins);
    state.cells = pack(cells);
    state.members = pack(users).sort((a,b)=>(a.name||"").localeCompare(b.name||"","ko"));
    state.invites = pack(invites);
    state.courses = pack(courses).filter(c=>c.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
    state.meetTypes = pack(mtypes).filter(t=>t.active!==false)
      .map(t=>({ ...t, solo:false, order:(t.order||0)+10 }))
      .sort((a,b)=>(a.order||0)-(b.order||0));
    state.orgAt = Date.now();
  } catch (e) { toast(msgOf(e)); }
}
async function loadSouls(force) {
  if (!force && state.soulsAt && Date.now() - state.soulsAt < ORG_TTL) return;
  const me = state.me, col = collection(db,"souls");
  const out=[], seen={};
  const push = (rows) => rows.forEach(r => { if(!seen[r.id]){seen[r.id]=true;out.push(r);} });
  try {
    if (canLead()) push(pack(await getDocs(query(col, where("leaderUid","==",me.id)))));
    if (me.role === "coach") {
      /* 규칙이 '같은 진'까지 확인하므로 질의에도 진을 함께 겁니다 */
      const res = await Promise.all((me.cellIds||[]).map(cid =>
        getDocs(query(col, where("cellId","==",cid), where("jinId","==",me.jinId)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "jinjang") push(pack(await getDocs(query(col, where("jinId","==",me.jinId)))));
    state.souls = out.filter(s=>s.active!==false).sort(bySeq);
    state.soulsAt = Date.now();
  } catch (e) { state.souls=[]; toast(msgOf(e)); }
}
async function loadMeetings(force) {
  if (!force && state.meetingsAt && Date.now() - state.meetingsAt < ORG_TTL) return;
  const me = state.me, col = collection(db,"meetings");
  const out=[], seen={};
  const push = (rows) => rows.forEach(r => { if(!seen[r.id]){seen[r.id]=true;out.push(r);} });
  try {
    if (canLead()) push(pack(await getDocs(query(col, where("leaderUid","==",me.id)))));
    if (me.role === "coach") {
      /* 규칙이 '같은 진'까지 확인하므로 질의에도 진을 함께 겁니다 */
      const res = await Promise.all((me.cellIds||[]).map(cid =>
        getDocs(query(col, where("cellId","==",cid), where("jinId","==",me.jinId)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "jinjang") push(pack(await getDocs(query(col, where("jinId","==",me.jinId)))));
    state.meetings = out.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
    state.meetingsAt = Date.now();
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
/* 한 사람 카드의 기록 — 규칙이 허락하는 세 갈래(내가 쓴 것 · 담당 공개 · 코치 공유)로 나눠 읽습니다.
   조건 없이 한 번에 읽으면 서버가 질의를 거절합니다. */
async function fetchRecords(soulId, canSeeAll) {
  const col = collection(db,"souls",soulId,"records");
  const parts = canSeeAll
    ? await Promise.all([
        getDocs(query(col, where("by","==",uid()))),
        getDocs(query(col, where("scope","==","leader"))),
        getDocs(query(col, where("scope","==","coach")))])
    : [await getDocs(query(col, where("scope","==","coach")))];
  const seen = {};
  return parts.flatMap(pack).filter(r => seen[r.id] ? false : (seen[r.id] = true));
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
/* 내가 무언가를 바꿨으면 모아둔 것을 버려서 다음에 새로 읽게 합니다.
   반대로 그냥 화면만 옮길 때는 다시 읽지 않습니다 — 읽기 횟수가
   하루 한도에 닿는 가장 큰 이유가 이것이었어요. */
const invalidate = () => {
  state.allRecords = null; state.allTrainings = null;
  state.soulsAt = 0; state.meetingsAt = 0;
};

/* ── 출석 계산 ── */
const cellMeetings = (cellId) => state.meetings.filter(m => m.cellId === cellId);
/* 출석은 셀모임의 attendance 에 사람별로 적힙니다.
   셀원은 영혼 카드 ID로, 셀리더 본인은 계정 ID로 (셀리더는 자기 카드를 못 열기 때문).
   그래서 진장이 보는 '셀리더 목양 카드'는 그 셀리더의 계정 ID로 출석을 찾습니다. */
const attKey  = (s) => (isLeaderCard(s) && s.linkedUid) ? s.linkedUid : s.id;
const attCell = (s) => isLeaderCard(s) ? s.ofCellId : s.cellId;
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
  startLive(); renderVerCard(); checkVersion(); noteUpdated();
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
  const absentees = state.souls.filter(s=>isLeaderOf(s) && absentStreak(attKey(s),attCell(s))>=2);
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
    await loadAllRecords();
    renderSoon(); renderAbsent(absentees); renderPray(); renderTodos(todos); renderAnnivs(annivs);
  } else if (me.role==="coach" || me.role==="jinjang") {
    $("home-tiles").innerHTML = tile("영혼", state.souls.length+"명")
      + tile("셀", state.cells.length+"개") + tile("구성원", state.members.length+"명");
    $("home-soon").innerHTML = ""; $("home-absent").innerHTML = "";
    $("home-pray").innerHTML = card("맡겨진 셀을 살펴보세요",
      "영혼들 탭에서 카드를, 셀모임 탭에서 출석을 볼 수 있어요. 기록은 '코치 공유'로 올라온 것만 보여요.");
    $("home-todo").innerHTML=""; $("home-anniv").innerHTML="";
  } else {
    $("home-tiles").innerHTML = tile("구성원", state.members.length+"명")
      + tile("셀", state.cells.length+"개") + tile("대기 중 초대", pendingN+"건");
    $("home-soon").innerHTML = ""; $("home-absent").innerHTML = "";
    $("home-pray").innerHTML = card("영혼 카드는 담당 리더만 열람해요",
      "수퍼 관리자는 사람과 진을 배치해요. 셀을 직접 맡고 있다면 리더 관리에서 '나도 셀을 맡아요'를 켜주세요.");
    $("home-todo").innerHTML=""; $("home-anniv").innerHTML="";
  }
  $("btn-manage").hidden = !(me.role==="super" || me.role==="jinjang");
  markSide("home"); show("s-home");
  /* 기기 알림을 눌러 앱이 새로 열렸으면 바로 소식함으로 */
  if (state.openInboxOnStart) { state.openInboxOnStart = false; openInbox(); }
}
/* ── 곧 만날 사람 ──
   앱이 알림을 못 보내니(서버가 없어서), 앱을 열었을 때 눈에 띄게 둡니다.
   하루 한 번은 여시는 앱이라 실제로는 이게 제일 많이 보일 거예요. */
/* 여러 명이 묶인 예정은 한 줄로 */
function oneLinePerGroup(list) {
  const seen = {};
  return list.filter(r=>{
    if (!r.groupId) { r._names = [r.soulName]; return true; }
    if (seen[r.groupId]) { seen[r.groupId]._names.push(r.soulName); return false; }
    seen[r.groupId] = r; r._names = [r.soulName]; return true;
  });
}
const planLine = (r) => r.kind === "train" && r.sponsorName
  ? `${meetLabel(r)} · ${r.sponsorName} → ${(r.sponseeNames||[]).join("·")}`
  : `${(r._names||[r.soulName]).join("·")} · ${meetLabel(r)}`;
function renderSoon() {
  const plans = oneLinePerGroup((state.allRecords||[]).filter(r=>r.planned));
  /* 일주일 안의 예정은 모두 — 앱이 알림을 못 보내니 열었을 때 보이게 */
  const soon = plans.filter(r=>{ const d=daysUntil(r.date); return d!==null && d>=0 && d<=7; })
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const past = plans.filter(r=>{ const d=daysUntil(r.date); return d!==null && d<0; })
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const cells = state.meetings.filter(m=>{ const d=daysUntil(m.date); return d!==null && d>=0 && d<=7; });
  if (!soon.length && !past.length && !cells.length) { $("home-soon").innerHTML = ""; return; }
  const when = (d) => { const n = daysUntil(d);
    return n===0 ? "오늘" : n===1 ? "내일" : n===2 ? "모레" : `${fmtDate(d)} · ${n}일 뒤`; };
  $("home-soon").innerHTML = `
    <div class="card" style="margin-top:14px">
      <h3 style="font-size:13px;font-weight:600">곧 만날 사람</h3>
      <div class="list" style="margin-top:10px">
        ${cells.map(m=>{ const c=state.cells.find(x=>x.id===m.cellId);
          return `<div class="row" data-gomeet2="${m.id}" style="cursor:pointer">
            <i style="width:8px;height:8px;border-radius:999px;background:var(--brand);flex-shrink:0"></i>
            <div class="grow"><p class="nm">${esc(c?c.name:"셀")} 셀모임</p>
              <p class="sub">${when(m.date)}${m.time?" "+esc(fmtSpan(m.time,m.timeEnd)):""}</p></div>
          </div>`; }).join("")}
        ${soon.map(r=>`<div class="row" data-gosoul6="${r.soulId}" style="cursor:pointer">
            <i style="width:8px;height:8px;border-radius:999px;background:#E8B473;flex-shrink:0"></i>
            <div class="grow"><p class="nm">${esc(planLine(r))}</p>
              <p class="sub">${when(r.date)}${r.time?" "+esc(fmtSpan(r.time,r.timeEnd)):""}${
                r.place?" · "+esc(r.place):""}</p></div>
          </div>`).join("")}
        ${past.slice(0,3).map(r=>`<div class="row" data-gosoul6="${r.soulId}" style="cursor:pointer">
            <i style="width:8px;height:8px;border-radius:999px;background:#6B5C5D;flex-shrink:0"></i>
            <div class="grow"><p class="nm">${esc(planLine(r))}</p>
              <p class="sub">${fmtDate(r.date)} — 만나셨으면 기록을 채워주세요</p></div>
            <span class="chip warn">기록 비어 있음</span>
          </div>`).join("")}
      </div>
    </div>`;
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
        ${list.map(s=>`${esc(s.name)} (${absentStreak(attKey(s),attCell(s))}주)`).join(" · ")}</p>
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
        ${avatar(s)}
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
    [["birth","생일"],["baptizedAt","침례"],["marriedAt","결혼기념일"]].forEach(([f,label])=>{
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
  const g6 = ev.target.closest("[data-gosoul6]"); if (g6) { openSoul(g6.dataset.gosoul6); return; }
  const gm = ev.target.closest("[data-gomeet2]"); if (gm) { openMeeting(gm.dataset.gomeet2); return; }
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
  if (!canMakeSoul() && state.me.role!=="coach" && state.me.role!=="jinjang") {
    toast("영혼 카드는 담당 리더만 볼 수 있어요. 리더 관리에서 '나도 셀을 맡아요'를 켤 수 있어요."); return;
  }
  show("s-loading");
  await loadOrg(); await loadSouls(); await loadMeetings();
  if (canLead()) await loadSelfCard();
  renderFilter(); renderSouls();
  /* 예전 얼굴 사진의 작은 사본 — 뒤에서 한 번 만들고, 생기면 목록을 다시 그립니다 */
  backfillThumbs().then(n => { if (n && !$("s-souls").hidden) renderSouls(); });
  $("btn-soul-new").hidden = !canMakeSoul();
  $("btn-order-souls").hidden = !canMakeSoul() || state.souls.filter(isLeaderOf).length < 2;
  markSide("souls"); show("s-souls");
}
function renderFilter() {
  const f = [["all","전체"],["care","돌봄 필요"],["new","새가족"],["due","연락할 때"]];
  $("soul-filter").innerHTML = f.map(([k,l])=>`<button data-f="${k}" class="${state.filter===k?"on":""}">${l}</button>`).join("");
}
$("soul-filter").addEventListener("click",async(ev)=>{
  const b = ev.target.closest("[data-f]"); if(!b) return;
  state.filter = b.dataset.f; renderFilter();
  /* 만난 횟수를 세려면 기록이 있어야 합니다 */
  if (state.filter === "new" && !state.allRecords) { await loadAllRecords(); }
  renderSouls();
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
  const newView = state.filter === "new";
  const metCount = {};
  if (newView) (state.allRecords||[]).forEach(r=>{
    if (r.type === "meet" && !r.planned && !r.away) metCount[r.soulId] = (metCount[r.soulId]||0) + 1;
  });
  $("list-souls").innerHTML = list.map(s=>{
    const n = daysSince(s.lastMetAt), st = absentStreak(attKey(s),attCell(s));
    if (newView) {
      /* 새가족은 '등록하고 몇 주 지났나'가 제일 중요한 숫자입니다.
         반갑게 맞고는 정신없이 지내다 보면 석 달이 지나 있거든요. */
      const days = daysSince(s.registeredAt);
      const weeks = days === null ? null : Math.floor(days / 7) + 1;
      const met = metCount[s.id] || 0;
      const slow = weeks !== null && weeks >= 4 && met < 2;
      return `<div class="row" data-open="${s.id}" style="cursor:pointer">
        ${avatar(s)}
        <div class="grow">
          <p class="nm">${esc(s.name)}</p>
          <p class="sub">${weeks === null
            ? "교회 등록일을 적어주세요"
            : `등록 ${weeks}주차 · 그동안 만남 ${met}번`}${
            (s.prayOpen||0)>0?` · 기도 ${s.prayOpen}`:""}</p>
          <p class="sub2">${agoShort(n)}${
            attendRate(attKey(s),attCell(s))===null?"":` · 출석 ${attendRate(attKey(s),attCell(s))}%`}</p>
        </div>
        <span class="chip ${slow?"warn":"rose"}">${slow?"챙길 때":"새가족"}</span>
      </div>`;
    }
    const bt = birthText(s), bd = annivIn(s.birth);
    const rate = attendRate(attKey(s), attCell(s));
    return `<div class="row" data-open="${s.id}" style="cursor:pointer">
      ${avatar(s)}
      <div class="grow">
        <p class="nm">${esc(s.name)}</p>
        <p class="sub">${bt ? esc(bt) : "생일 미입력"}${
          bd !== null && bd <= 14 ? ` · 🎂 ${bd===0?"오늘":"D-"+bd}` : ""}</p>
        <p class="sub2">${st>=2?`<span style="color:var(--warn-tx)">결석 ${st}주</span> · `:""}${
          agoShort(n)}${rate===null?"":` · 출석 ${rate}%`}${
          (s.prayOpen||0)>0?` · 기도 ${s.prayOpen}`:""}</p>
      </div>
      <span class="chip ${isLeaderCard(s)?"":s.status==="care"?"warn":"rose"}">${
        isLeaderCard(s)?KINDLABEL[s.kind]:esc(STATUS[s.status]||"—")}</span>
    </div>`;
  }).join("") || `<p class="muted">${
    kw ? "찾는 이름이 없어요."
    : state.me.role==="coach" && !(state.me.cellIds||[]).length
    ? "담당 셀이 아직 지정되지 않았어요. 진장에게 요청해 주세요."
    : state.filter!=="all" ? "이 조건에 맞는 영혼이 없어요."
    : "아직 등록된 영혼이 없어요. 오른쪽 위 + 를 눌러 시작해요."}</p>`;
  /* 맨 위에 '나' — 셀리더도 이 셀의 한 사람이니까.
     눌러도 진장·코치가 쓰는 목양 카드가 아니라, 내가 나에 대해 적는 '내 카드'가 열립니다. */
  if (canLead() && state.filter === "all" && !kw) {
    const a = myActivity(statsFrom("3"));
    $("list-souls").insertAdjacentHTML("afterbegin", `
      <div class="row" data-mine="1" style="cursor:pointer;border-color:#3A2226">
        ${meAvatar()}
        <div class="grow"><p class="nm">${esc(state.me.name||"나")}</p>
          <p class="sub">내 카드 · 셀모임 출석 ${a.marked?`${a.came}/${a.marked}`:"—"} · 최근 3개월 함께한 모임 ${a.met}번</p></div>
        <span class="chip rose">나 · 셀리더</span>
      </div>`);
  }
}
/* 나의 출석과 활동 — 내 셀모임의 내 출석, 내가 직접 함께한 모임 */
function myActivity(from) {
  const to = todayStr(), me = uid();
  const ms = state.meetings.filter(m => m.leaderUid === me && m.date >= from && m.date <= to);
  const marked = ms.filter(m => (m.attendance||{})[me]);
  const came = marked.filter(m => m.attendance[me] !== "absent").length;
  const uniq = {};
  (state.allRecords||[]).filter(r => r.type==="meet" && !r.planned && !r.away && !r.meetingId
      && r.by === me && r.date >= from && r.date <= to)
    .forEach(r => { uniq[r.groupId || r.id] = r; });
  const once = Object.values(uniq);
  return { cells: ms.length, marked: marked.length, came, met: once.length,
    one: once.filter(r=>r.kind==="one").length, train: once.filter(r=>r.kind==="train").length };
}
$("list-souls").addEventListener("click",(ev)=>{
  if (ev.target.closest("[data-mine]")) { openMine(); return; }
  const r = ev.target.closest("[data-open]"); if(!r) return; openSoul(r.dataset.open);
});
$("btn-soul-new").onclick = () => openEdit(null);

/* ── 셀원 순서 정하기 ── */
const dlgOrder = $("dlg-order");
let orderList = [], orderAfter = null;
function openOrderDlg(cellId, after) {
  const mine = state.souls.filter(s=>isLeaderOf(s) && (!cellId || s.cellId === cellId));
  if (!mine.length) { toast("순서를 정할 영혼이 없어요."); return; }
  orderList = mine.slice(); orderAfter = after || null;
  $("order-err").textContent = ""; renderOrder(); dlgOrder.showModal();
}
function renderOrder() {
  $("order-list").innerHTML = orderList.map((s,i)=>`
    <div class="ordrow">
      <span class="no">${i+1}</span>
      <span class="who">${esc(s.name)}</span>
      <button type="button" data-up="${i}" aria-label="위로"${i===0?" disabled":""}>↑</button>
      <button type="button" data-down="${i}" aria-label="아래로"${i===orderList.length-1?" disabled":""}>↓</button>
    </div>`).join("");
}
$("order-list").addEventListener("click",(ev)=>{
  const u = ev.target.closest("[data-up]"), d = ev.target.closest("[data-down]");
  const i = u ? Number(u.dataset.up) : d ? Number(d.dataset.down) : -1;
  if (i < 0) return;
  const j = u ? i-1 : i+1;
  if (j < 0 || j >= orderList.length) return;
  [orderList[i], orderList[j]] = [orderList[j], orderList[i]];
  renderOrder();
});
$("ord-cancel").onclick = () => dlgOrder.close();
$("ord-save").onclick = async () => {
  $("ord-save").disabled = true;
  try {
    /* 자리가 바뀐 사람만 저장해서 쓸데없는 쓰기를 줄입니다 */
    const writes = [];
    orderList.forEach((s,i)=>{
      if (s.seq !== i+1) writes.push(updateDoc(doc(db,"souls",s.id), { seq:i+1 }));
    });
    await Promise.all(writes);
    state.soulsAt = 0;
    orderList.forEach((s,i)=>{
      s.seq = i+1;
      const inList = state.souls.find(x=>x.id===s.id); if (inList) inList.seq = i+1;
    });
    state.souls.sort(bySeq);
    dlgOrder.close(); toast("순서를 저장했어요.");
    if (orderAfter) orderAfter(); else renderSouls();
  } catch (e) { $("order-err").textContent = msgOf(e); }
  finally { $("ord-save").disabled = false; }
};
$("btn-order-souls").onclick = () => {
  if (!canLead()) { toast("셀을 맡은 분만 순서를 정할 수 있어요."); return; }
  openOrderDlg(null, () => renderSouls());
};
$("btn-order-meet").onclick = () =>
  openOrderDlg(state.meeting.cellId, () => renderAttendance(true));

/* ════════ 영혼 카드 ════════ */
async function openSoul(soulId) {
  show("s-loading");
  if (!state.souls.length) { await loadOrg(); await loadSouls(); await loadMeetings(); }
  const s = state.souls.find(x=>x.id===soulId);
  if (!s) { toast("카드를 찾을 수 없어요."); openSouls(); return; }
  state.soul = s; state.soulTab = "rec"; state.recKw = ""; state.recType = "all";
  await loadRecords(soulId, isLeaderOf(s));
  await loadTrainings(soulId);
  state.shared = isLeaderCard(s) ? await loadShared(s.linkedUid) : [];
  state.linkedSelf = null;
  if (isLeaderCard(s) && s.linkedUid && state.me.role === "jinjang") {
    try { const d = await getDoc(doc(db,"selfCards",s.linkedUid)); state.linkedSelf = d.exists() ? d.data() : null; }
    catch { state.linkedSelf = null; }   // 본인이 '나만 보기'로 두면 규칙이 막습니다
  }
  const photo = await loadPhoto(soulId);

  $("soul-ava").textContent = photo ? "" : initial(s.name);
  $("soul-ava").style.backgroundImage = photo ? `url(${photo})` : "";
  $("soul-name").textContent = s.name;
  const cell = state.cells.find(c=>c.id===(isLeaderCard(s)?s.ofCellId:s.cellId));
  $("soul-chips").innerHTML =
    (isLeaderCard(s) ? `<span class="chip">${KINDLABEL[s.kind]}</span>` : "")
    + `<span class="chip rose">${esc(STATUS[s.status]||"—")}</span>`
    + (cell?`<span class="chip">${esc(cell.name)}${isLeaderCard(s)?" 담당":""}</span>`:"");
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
  const s = state.soul, n = daysSince(s.lastMetAt), rate = attendRate(attKey(s),attCell(s));
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
  const span = fmtSpan(r.time, r.timeEnd);
  const dur = durText(r.time, r.timeEnd);
  const head = r.type==="meet"
    ? `${esc(meetLabel(r))} · ${fmtDate(r.date)}${span?" "+esc(span):""}${r.place?" · "+esc(r.place):""}`
    : `${RTYPE[r.type]||r.type} · ${fmtDate(r.date)}`;
  return `<article class="rec">
    <div class="head">
      <span style="font-size:12px;color:var(--dim)">${showSoul?`<b style="color:var(--text)">${esc(r.soulName)}</b> · `:""}${head}</span>
      ${scopeChip(r.scope)}
    </div>
    ${r.type!=="meet" && r.body ? `<p class="body${r.type==="heart"?" serif":""}">${hl(r.body,kw)}</p>` : ""}
    ${blocks.map(([l,v])=>`<div class="blk"><p class="lbl">${l}</p><p>${hl(v,kw)}</p></div>`).join("")}
    ${(r.photos||[]).length?`<div class="shots">${r.photos.map((p,i)=>
      `<div class="sh" style="background-image:url(${p.thumb})" data-viewshot="${r.id}:${i}"
        role="button" aria-label="사진 ${i+1} 크게 보기"></div>`).join("")}</div>`:""}
    <div class="foot">
      ${r.planned?`<span class="chip warn">예정 · ${(()=>{const d=daysUntil(r.date);
        return d===null?"":d>0?`D-${d}`:d===0?"오늘":`${-d}일 지남`;})()}</span>`:""}
      ${r.kind==="train"&&r.sponsorName?`<span class="chip">후원 ${esc(r.sponsorName)} → ${esc((r.sponseeNames||[]).join(", "))}</span>`
        :(r.withNames||[]).length>1?`<span class="chip">${esc(r.withNames.join(", "))}</span>`:""}
      ${r.away?`<span class="chip">나 없이 모임 · 전해 들음</span>`:""}
      ${r.type==="pray"?`<span class="chip ${r.prayStatus==="answered"?"ok":""}">${r.prayStatus==="answered"?"응답됨":"기도 중 "+((daysSince(r.date)||0)+1)+"일째"}</span>`:""}
      ${r.type==="heart"?`<span class="chip">${r.who==="soul"?"이 친구가 받은 은혜":"내가 받은 마음"}</span>`:""}
      ${dur?`<span class="chip">${dur}</span>`:""}
      ${r.meetingId?`<span class="chip">셀모임에서</span>`:""}
      ${r.scope==="coach" && !showSoul?`<button class="btn-sm" data-cmt="${r.id}">댓글</button>`:""}
      ${r.by===uid()&&!showSoul?`
        ${r.planned?`<button class="btn-sm" data-editrec="${r.id}" data-rtype="meet" data-fill="1">만났어요 — 기록 채우기</button>`:""}
        ${r.type==="pray"&&r.prayStatus!=="answered"?`<button class="btn-sm" data-answer="${r.id}">응답됐어요</button>`:""}
        <button class="btn-sm" data-editrec="${r.id}" data-rtype="${r.type}">수정</button>
        <button class="btn-sm danger" data-delrec="${r.id}">삭제</button>`:""}
      ${showSoul?`<button class="btn-sm" data-gosoul2="${r.soulId}">카드 열기</button>`:""}
    </div>
  </article>`;
}

/* ── 한 사람의 출석 ──
   도넛 하나는 '얼마나 왔나'를, 네모 칸 열두 개는 '언제 빠졌나'를 보여줍니다.
   같은 60%라도 띄엄띄엄 빠진 것과 최근 다섯 주 내리 빠진 것은
   전혀 다른 상황인데, 숫자 하나로는 그게 안 보입니다. */
function attendBlock(soulId, cellId) {
  const ms = cellMeetings(cellId);
  if (!ms.length) return "";
  const marked = ms.filter(m => m.attendance && m.attendance[soulId]);
  const rate = marked.length
    ? Math.round(marked.filter(m => m.attendance[soulId] !== "absent").length / marked.length * 100)
    : null;
  /* 오래된 것이 왼쪽에 오도록 — 왼쪽에서 오른쪽으로 읽습니다 */
  const last12 = ms.slice(0, 12).reverse();
  const R = 30, C = 2 * Math.PI * R, on = rate === null ? 0 : C * rate / 100;
  const cells = last12.map(m => {
    const v = (m.attendance && m.attendance[soulId]) || "none";
    const why = v === "absent" && m.reasons && m.reasons[soulId] ? ` · ${m.reasons[soulId]}` : "";
    const label = v === "none" ? "기록 없음" : ATT[v];
    return `<i class="${v}" title="${esc(fmtDate(m.date))} · ${esc(label)}${esc(why)}"></i>`;
  }).join("");
  return `<div class="card" style="margin-bottom:12px">
    <h3 style="font-size:13px;font-weight:600;margin-bottom:12px">셀모임 출석</h3>
    <div class="ring">
      <svg width="84" height="84" viewBox="0 0 84 84" role="img"
        aria-label="출석률 ${rate===null?"기록 없음":rate+"퍼센트"}">
        <circle cx="42" cy="42" r="${R}" fill="none" stroke="#2A2424" stroke-width="9"/>
        ${rate===null?"":`<circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--brand)"
          stroke-width="9" stroke-linecap="round" stroke-dasharray="${on.toFixed(1)} ${(C-on).toFixed(1)}"
          transform="rotate(-90 42 42)"/>`}
        <text class="rv" x="42" y="42" text-anchor="middle" dominant-baseline="middle"
          >${rate===null?"—":rate+"%"}</text>
        <text class="rk" x="42" y="58" text-anchor="middle">출석률</text>
      </svg>
      <div style="min-width:0">
        <p style="font-size:14px;line-height:1.7">${marked.length}번 중
          <b>${marked.filter(m=>m.attendance[soulId]!=="absent").length}번</b> 나왔어요</p>
        <p class="muted" style="font-size:12px;margin-top:4px">
          최근 ${last12.length}주 흐름 — 왼쪽이 오래된 쪽이에요</p>
        <div class="weeks">${cells}</div>
      </div>
    </div>
    <div class="legend">
      <span><i class="present" style="background:#2E7D54;border-color:#2E7D54"></i>출석</span>
      <span><i class="online" style="background:#4A4140;border-color:#5A4F4E"></i>온라인</span>
      <span><i class="absent" style="background:var(--rose-bg);border-color:#5A2A32"></i>결석</span>
      <span><i></i>기록 없음</span>
    </div>
  </div>`;
}

function renderSoulBody() {
  const s = state.soul, mine = isLeaderOf(s), box = $("soul-body");

  if (state.soulTab === "rec") {
    const kw = state.recKw.trim();
    /* '근황'은 따로 있는 종류가 아니라, 만남 기록 안의 근황 칸입니다.
       셀모임에서 적은 것도 1:1에서 적은 것도 다 여기로 모입니다. */
    const flowing = state.recType === "update" || state.recType === "pray";
    let list = state.records;
    if (state.recType === "update") list = list.filter(r=>r.type==="meet" && r.update);
    else if (state.recType !== "all") list = list.filter(r=>r.type===state.recType);
    if (kw) list = list.filter(r => recText(r).toLowerCase().includes(kw.toLowerCase()));
    if (flowing && state.flowAsc) list = list.slice().reverse();
    const types = [["all","전체"],["update","근황"],["pray","기도"],
                   ["meet","만남"],["heart","받은 마음"]];
    box.innerHTML = `
      ${isLeaderCard(s) && !s.linkedUid ? "" : attendBlock(attKey(s), attCell(s))}
      ${state.shared.length ? `<div class="card" style="margin-bottom:12px;background:var(--rose-bg);border-color:#3A2226">
        <h3 style="font-size:13px;font-weight:600;color:var(--rose-tx)">본인이 열어준 기록</h3>
        <p class="muted" style="font-size:12px;margin-top:4px">
          ${esc(s.name)} 님이 '내 기록'에서 진장에게 보이기로 켠 것들이에요.</p>
        <div class="list" style="margin-top:10px">${state.shared.map(n=>`
          <div class="row"><div class="grow">
            <p class="sub" style="margin:0">${MYKIND[n.kind]||""} · ${fmtDate(n.date)}</p>
            <p class="nm" style="margin-top:4px;white-space:pre-wrap">${esc(n.body)}</p>
          </div></div>`).join("")}</div>
      </div>` : ""}
      <input id="rec-search" placeholder="기록 안에서 찾기 (예: 이직, 어머니)" value="${esc(state.recKw)}" style="height:44px">
      <div class="seg" id="rec-type">${types.map(([k,l])=>
        `<button data-rty="${k}" class="${state.recType===k?"on":""}">${l}</button>`).join("")}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 12px">
        <p class="hint" style="margin:0">${list.length}건${kw?` · '${esc(kw)}' 검색 결과`:""}</p>
        ${flowing && list.length>1
          ? `<button class="btn-sm" id="btn-flow-order">${state.flowAsc?"오래된 것부터 ↑":"최근 것부터 ↓"}</button>`
          : ""}
      </div>
      ${flowing && list.length
        ? `<div class="flow">${list.map(r=>flowRow(r,kw)).join("")}</div>`
        : ""}
      <div class="list">${flowing ? "" : list.length ? list.map(r=>recCard(r,kw,false)).join("")
        : `<p class="muted">${kw?"찾는 말이 없어요."
          : state.recType==="update"?"아직 적은 근황이 없어요.<br>셀모임에서 이름 옆 ▾ 를 눌러 적으시면 여기에 쌓여요."
          : mine?"아직 기록이 없어요. 아래 '만남 기록'으로 첫 기록을 남겨보세요."
          :"공유된 기록이 없어요. 담당 리더가 코치 공유로 올린 기록만 보여요."}</p>`}</div>`;
    const si = $("rec-search");
    si.oninput = () => { state.recKw = si.value; const p=si.selectionStart; renderSoulBody();
      const n=$("rec-search"); n.focus(); try{n.setSelectionRange(p,p);}catch{} };
    $("rec-type").addEventListener("click",(ev)=>{
      const b = ev.target.closest("[data-rty]"); if(!b) return;
      state.recType = b.dataset.rty; renderSoulBody();
    });
    const fo = $("btn-flow-order");
    if (fo) fo.onclick = () => { state.flowAsc = !state.flowAsc; renderSoulBody(); };
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
    /* 침례는 훈련 과정이 아니라 한 번 있는 일이라, 맨 앞에 따로 둡니다 */
    const bapBox = `<div class="cbox ${s.baptizedAt?"done":""}" ${mine?`data-bap="1" style="cursor:pointer"`:""}>
      <p class="cn">침례</p>
      <p class="cs">${s.baptizedAt ? `${fmtDate(s.baptizedAt,true)} 받음`
        : (mine ? "아직 — 눌러서 날짜 적기" : "아직")}</p></div>`;
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
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:13px;font-weight:600">훈련 현황</h3>
          <span class="muted" style="font-size:12px">${
            state.courses.length ? `${state.courses.length}개 중 ${doneN}개 수료` : "과정 미등록"}</span>
        </div>
        <div class="courses">${bapBox}${grid}</div>
        ${state.courses.length ? "" : `<p class="muted" style="margin-top:12px">훈련 과정이 아직 등록되지 않았어요.</p>
          ${canAddCourse?`<button class="btn-sm" id="btn-course-here" style="margin-top:10px">여기서 과정 등록하기</button>`
            :`<p class="muted" style="margin-top:8px">진장에게 과정 등록을 요청해 주세요.</p>`}`}
      </div>
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
              <p class="sub">${fmtDate(t.startDate,true)}${t.endDate?" ~ "+fmtDate(t.endDate,true):""}${total>1?` · ${okN}/${total}회`:""}${last?` · 최근 ${fmtDate(last)}`:""}</p>
              ${t.sponsorName?`<p class="sub">후원자 ${esc(t.sponsorName)}</p>`:""}</div>
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
    /* 이 사람이 후원자로 이끌고 있는 사람들 — 훈련 모임 기록에서 모읍니다 */
    const leads = {};
    state.records.filter(r=>r.kind==="train" && r.sponsorKind==="soul" && r.sponsorId===s.id)
      .forEach(r=>{
        const key = `${r.courseId}|${(r.sponseeIds||[]).join(",")}`, cur = leads[key];
        const sNo = r.planned ? 0 : (r.sessionNo||0);
        if (!cur) leads[key] = { r, maxNo:sNo, last:r.planned?"":r.date };
        else { cur.maxNo = Math.max(cur.maxNo, sNo);
          if (!r.planned && r.date > cur.last) cur.last = r.date; }
      });
    const leadRows = Object.values(leads);
    if (leadRows.length) box.insertAdjacentHTML("beforeend", `
      <div class="card" style="margin-top:12px">
        <h3 style="font-size:13px;font-weight:600">후원자로 이끌고 있어요</h3>
        <div class="list" style="margin-top:10px">${leadRows.map(x=>`
          <div class="row"><div class="grow">
            <p class="nm">${esc((x.r.sponseeNames||[]).join(", "))} · ${esc(x.r.courseName||"")}</p>
            <p class="sub">${x.maxNo?`${x.maxNo}회차까지`:"아직 예정만"}${x.last?` · 최근 ${fmtDate(x.last)}`:""}</p>
          </div></div>`).join("")}</div>
      </div>`);
    const b=$("btn-train-new"); if(b) b.onclick=()=>openTrainDlg(null);
    const c=$("btn-course-here"); if(c) c.onclick=()=>openCourseDlg(null,()=>renderSoulBody());
  }

  if (state.soulTab === "profile") {
    const rows = [
      ["생일", s.birth?fmtDate(s.birth,true)+(s.lunar?" (음력)":""):""],
      ["연락처", s.phone], ["주소", [s.address,s.address2].filter(Boolean).join(" ")],
      ["직장 · 학교", s.job], ["성별", s.gender],
      ["교회 등록일", fmtDate(s.registeredAt,true)], ["침례일", fmtDate(s.baptizedAt,true)],
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
    /* 셀리더 카드라면, 그 셀리더가 스스로 적어 진장에게 열어둔 프로필도 같이 */
    const ls = state.linkedSelf;
    if (isLeaderCard(s) && ls) box.insertAdjacentHTML("afterbegin", `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          ${avatar({ name:s.name, thumb:ls.thumb }, 40)}
          <div><h3 style="font-size:13px;font-weight:600">본인이 적은 프로필</h3>
            <p class="muted" style="font-size:12px">${esc(s.name)} 님이 '내 카드'에 적고 진장에게 열어둔 것</p></div>
        </div>
        ${selfRows(ls)}
      </div>`);
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
  const vs = ev.target.closest("[data-viewshot]");
  if (vs) {
    const [rid, i] = vs.dataset.viewshot.split(":");
    const r = state.records.find(x=>x.id===rid);
    if (r && r.photos && r.photos[Number(i)]) showPhoto(r.photos[Number(i)]);
    return;
  }
  const del = ev.target.closest("[data-delrec]");
  if (del) {
    if (!confirm("이 기록을 지울까요? 되돌릴 수 없어요.")) return;
    try {
      const gone = state.records.find(x=>x.id===del.dataset.delrec);
      await deleteDoc(doc(db,"souls",s.id,"records",del.dataset.delrec));
      /* 사진은 다른 사람 카드의 같은 모임 기록이 아직 쓰고 있으면 남겨둡니다 */
      if (gone && (gone.photos||[]).some(p=>p.id)) {
        const all = await loadAllRecords(true);
        for (const p of gone.photos) {
          if (!p.id || all.some(r=>(r.photos||[]).some(q=>q.id===p.id))) continue;
          try { await deleteDoc(doc(db,"recordPhotos",p.id)); } catch {}
        }
      }
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
  const cm = ev.target.closest("[data-cmt]");
  if (cm) { const r = state.records.find(x=>x.id===cm.dataset.cmt); if (r) openComments(recTarget(s, r)); return; }
  const er = ev.target.closest("[data-editrec]");
  if (er) {
    if (er.dataset.rtype === "meet") openLog(s.id, er.dataset.editrec, { fill: er.dataset.fill === "1" });
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
  if (ev.target.closest("[data-bap]")) { openBapDlg(); return; }
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
function openLog(soulId, recId, opts) {
  const o = opts || {};
  const mine = state.souls.filter(isLeaderOf);
  if (!mine.length) { toast("먼저 영혼 카드를 하나 만들어 주세요."); return; }
  /* 영혼 카드에서 왔으면 그 카드의 기록에서, 캘린더에서 왔으면 모아둔 기록에서 찾습니다 */
  const rec = !recId ? null : (state.records.find(r=>r.id===recId)
    || (state.allRecords||[]).find(r=>r.id===recId && r.soulId===soulId) || null);
  if (recId && !rec) { toast("그 기록을 찾지 못했어요. 영혼 카드에서 열어주세요."); return; }
  const first = soulId || (state.soul&&isLeaderOf(state.soul)?state.soul.id:mine[0].id);
  /* 앞날을 고르고 들어오면 처음부터 '예정'으로 */
  const future = !!(o.date && o.date > todayStr());
  state.log = {
    recId: recId||null, rec,
    kind: rec?rec.kind:(o.kind||"one"),
    back: o.back||null,
    /* 소그룹은 여럿을 고르니 늘 목록으로 들고 다닙니다 */
    picked: rec ? [soulId || first] : (o.noPick ? [] : [first]),
    /* 예전 기록에는 away 가 없으니 '함께 있었음'으로 봅니다 */
    withMe: rec ? !rec.away : true,
    shots: rec ? (rec.photos||[]).slice() : [],
    /* '만났어요 — 기록 채우기'로 들어오면 예정을 끝난 일로 바꿉니다 */
    planned: rec ? (o.fill ? false : !!rec.planned)
                 : (o.planned !== undefined ? !!o.planned : future),
    autoPlan: !rec && o.planned === undefined && future,
    groupId: rec ? (rec.groupId||null) : null,
    /* 훈련 모임 */
    courseId: (rec && rec.courseId) || o.courseId || "",
    sessionNo: (rec && rec.sessionNo) || 0,
    sponsor: (rec && rec.sponsorKind)
      ? { kind:rec.sponsorKind, id:rec.sponsorId||"", name:rec.sponsorName||"" }
      : { kind:"me", id:uid(), name:state.me.name||"나" },
    sponsorTouched: !!rec,
    sponsees: rec ? (rec.sponseeIds||[soulId||first]).slice() : (o.noPick ? [] : [first])
  };
  const L = state.log;
  if (!L.courseId)
    L.courseId = (state.courses.find(c=>(c.sessions||1)>1) || state.courses[0] || {}).id || "";
  $("log-kind").innerHTML = kindChips();
  $("log-soul-wrap").hidden = !!rec;
  $("log-picks").innerHTML =
    `<button type="button" class="me" data-me="1">나 (본인)</button>`
    + mine.map(s=>`<button type="button" data-pick="${s.id}">${esc(s.name)}</button>`).join("");
  $("log-sponsor").innerHTML =
    `<button type="button" class="me" data-sp="me">나</button>`
    + mine.map(s=>`<button type="button" data-sp="${s.id}">${esc(s.name)}</button>`).join("")
    + `<button type="button" class="add" data-sp="other">다른 사람</button>`;
  $("log-sponsee").innerHTML =
    mine.map(s=>`<button type="button" data-se="${s.id}">${esc(s.name)}</button>`).join("");
  $("log-course").innerHTML = state.courses.length
    ? state.courses.map(c=>`<option value="${c.id}">${esc(c.name)}${
        (c.sessions||1)>1?` (${c.sessions}회)`:""}</option>`).join("")
    : `<option value="">등록된 과정이 없어요</option>`;
  $("log-course").value = L.courseId;
  $("log-sponsor-name").value = L.sponsor.kind==="other" ? L.sponsor.name : "";
  $("log-train-people").hidden = !!rec;
  renderShots();
  $("log-date").value = rec ? rec.date : (o.date || todayStr());
  $("log-time").value = rec?(rec.time||""):"";
  $("log-time-end").value = rec?(rec.timeEnd||""):"";
  syncLogDur();
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
  syncLogKind(true);
  syncLogMode();
  show("s-log");
  LOGF.forEach(id=>{ const el=$(id); if(el&&el.tagName==="TEXTAREA") autoGrow(el); });
  /* 훈련 회차를 맞춰 주려면 각 사람의 훈련 이력이 필요합니다 (캐시돼 있으면 바로) */
  loadAllTrainings().then(()=>{ if (state.log===L && L.kind==="train") syncTrain(true); });
}
const kindChips = () => kindsShown(state.log && state.log.kind).map(k=>
    `<button type="button" data-k="${k.id}">${esc(k.name)}</button>`).join("")
  + `<button type="button" class="add" data-addk="1">＋ 새 종류</button>`
  + `<button type="button" class="add" data-kset="1" aria-label="모임 종류 설정">⚙ 설정</button>`;
$("btn-log-new").onclick = () => openLog(state.soul.id, null);
$("log-back").onclick = () => {
  if (state.log && state.log.back === "cal") { openCal(); return; }
  if (state.log && state.log.soulId) openSoul(state.log.soulId); else openSouls();
};
function syncLogDur() {
  $("log-dur").textContent = durText($("log-time").value, $("log-time-end").value)
    || "끝나는 시간까지 적으면 얼마나 함께했는지 남아요.";
}
$("log-time").addEventListener("input", syncLogDur);
$("log-time-end").addEventListener("input", syncLogDur);
/* 날짜를 앞날로 바꾸면 '예정'으로 — 내가 직접 고른 게 아니면 다시 돌려놓기도 */
$("log-date").addEventListener("change", () => {
  const L = state.log; if (!L || L.recId) return;
  const d = $("log-date").value, t = todayStr();
  if (d > t && !L.planned) { L.planned = true; L.autoPlan = true; }
  else if (d && d <= t && L.planned && L.autoPlan) { L.planned = false; L.autoPlan = false; }
  syncLogMode();
});
$("log-mode").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-mode]"); if (!b) return;
  state.log.planned = b.dataset.mode === "plan"; state.log.autoPlan = false;
  syncLogMode();
});
function syncLogMode() {
  const L = state.log, P = L.planned;
  $("log-mode").querySelectorAll("[data-mode]").forEach(b=>
    b.classList.toggle("on", (b.dataset.mode === "plan") === P));
  /* 예정이면 '만나서' 이후 칸은 아직 쓸 게 없으니 접어둡니다 */
  $("log-sec-after").hidden = P;
  $("log-before-title").textContent = P ? "만나기 전 — 미리 기도하며" : "만나기 전 — 기도하며 받은 것";
  $("log-title").textContent = L.recId
    ? (P ? "예정 수정" : (L.rec && L.rec.planned ? "만난 뒤 기록 채우기" : "만남 기록 수정"))
    : (P ? "모임 예정 잡기" : "만남 기록");
  $("btn-log-save").textContent = P ? "예정 저장" : "저장";
  $("log-mode-hint").textContent = P
    ? (L.autoPlan ? "앞날이라 '앞으로 예정'으로 바꿨어요. " : "")
      + "캘린더와 홈 '곧 만날 사람'에 떠요. 만난 뒤 카드에서 '만났어요 — 기록 채우기'를 누르면 이어서 적어요."
    : "";
  if (L.kind === "train") syncTrain();
}
$("log-kind").addEventListener("click",(ev)=>{
  if (ev.target.closest("[data-kset]")) {
    openKindsDlg(() => { $("log-kind").innerHTML = kindChips(); syncLogKind(); });
    return;
  }
  if (ev.target.closest("[data-addk]")) {
    openMtypeDlg(null, (newId) => {
      $("log-kind").innerHTML = kindChips();
      state.log.kind = newId; syncLogKind();
    });
    return;
  }
  const b = ev.target.closest("[data-k]"); if(!b) return;
  /* 훈련 모임에서 '나는 안 갔어요'였던 것이 다른 종류로 따라가지 않게 */
  if (state.log.kind === "train" && b.dataset.k !== "train") state.log.withMe = true;
  state.log.kind = b.dataset.k;
  /* 1:1로 바꾸면 — 내가 있으면 한 사람, 나 없이면 두 사람까지만 */
  if (kindOf(state.log.kind).solo)
    state.log.picked = state.log.picked.slice(0, state.log.withMe ? 1 : 2);
  syncLogKind(true);
});
$("log-picks").addEventListener("click",(ev)=>{
  const L = state.log, solo = kindOf(L.kind).solo;
  if (ev.target.closest("[data-me]")) {
    L.withMe = !L.withMe;
    if (solo && L.withMe) L.picked = L.picked.slice(-1);
    syncLogKind(); return;
  }
  const b = ev.target.closest("[data-pick]"); if(!b) return;
  const id = b.dataset.pick;
  /* 1:1 — 나와 한 사람이면 바꿔 끼우기, 나 없이면 셀원 둘 (셋째를 누르면 처음 사람이 빠짐) */
  if (solo && L.withMe) { L.picked = [id]; }
  else if (L.picked.includes(id)) L.picked = L.picked.filter(x=>x!==id);
  else L.picked = solo ? [...L.picked, id].slice(-2) : [...L.picked, id];
  syncLogKind();
});
function syncLogKind(suggest) {
  const L = state.log, k = kindOf(L.kind), solo = k.solo, train = L.kind === "train";
  $("log-kind").querySelectorAll("[data-k]").forEach(b=>b.classList.toggle("on", b.dataset.k===L.kind));
  $("log-train").hidden = !train;
  $("log-soul-wrap").hidden = !!L.recId || train;
  if (train) { syncTrain(suggest); return; }
  $("log-picks").querySelectorAll("[data-pick]").forEach(b=>
    b.classList.toggle("on", L.picked.includes(b.dataset.pick)));
  const meBtn = $("log-picks").querySelector("[data-me]");
  if (meBtn) {
    meBtn.classList.toggle("on", L.withMe); meBtn.hidden = false;
    meBtn.textContent = L.withMe ? "나 (본인)" : "나 — 안 감";
  }
  $("log-soul-label").textContent = solo
    ? (L.withMe ? "누구를 만났나요 — 나와 한 사람" : "누가 누구를 만났나요 — 셀원 둘 (나는 안 감)")
    : L.withMe ? "누구누구를 만났나요 (여러 명 고를 수 있어요)"
    : "누구누구가 모였나요 — 나는 안 간 모임";
  const names = L.picked.map(nameOfSoul).filter(Boolean);
  const total = names.length + (!solo && L.withMe ? 1 : 0);
  $("log-pick-hint").textContent = !names.length
    ? (solo && !L.withMe ? "만난 두 사람을 골라주세요." : "한 명 이상 골라주세요.")
    : solo ? (L.withMe ? "'나'를 누르면 셀원 둘이 만난 1:1로 바뀌어요."
        : names.length < 2 ? `${names[0]} — 한 사람 더 골라주세요.`
        : `${names.join(" ↔ ")} 1:1 (나는 안 감). 두 사람 카드에 같이 쌓이고, '마지막 만남'은 바뀌지 않아요.`)
    : (L.withMe
        ? `${total}명 — ${["나"].concat(names).join(", ")}. `
        : `${names.length}명 — ${names.join(", ")} (나는 안 감). 전해 들은 것으로 남고, '마지막 만남'은 바뀌지 않아요. `)
      + "같은 기록이 고른 사람 모두의 카드에 쌓여요.";
  syncLogAway();
}
/* 내가 안 간 모임이면 '내가 기도하며 받은 마음' 칸은 해당이 없습니다 */
function syncLogAway() {
  const L = state.log, away = !L.withMe;
  $("log-sec-before").hidden = away;
  $("log-dheart-wrap").hidden = away;
  $("log-during-title").textContent = away ? "모여서 — 전해 들은 것" : "만나서";
}

/* ── 훈련 모임: 후원자 · 피후원자 · 회차 ── */
function trainOf(soulId, courseId) {
  return (state.allTrainings||[])
    .filter(t => t.soulId===soulId && t.courseId===courseId && t.status!=="dropped")
    .sort((a,b)=>String(b.startDate||"").localeCompare(String(a.startDate||"")))[0] || null;
}
function syncTrain(suggest) {
  const L = state.log, c = state.courses.find(x=>x.id===L.courseId);
  const total = (c && c.sessions) || 1;
  const t = L.sponsees[0] ? trainOf(L.sponsees[0], L.courseId) : null;
  if (suggest && !L.recId) {
    /* 다음에 할 회차 = 아직 체크 안 된 첫 회차 */
    const log = (t && t.sessionLog) || [];
    L.sessionNo = Array.from({length:total},(_,i)=>i+1)
      .find(no => !log.some(x => x.no===no && x.ok)) || total;
    if (!L.sponsorTouched) {
      if (t && t.sponsorKind) L.sponsor = { kind:t.sponsorKind, id:t.sponsorId||"", name:t.sponsorName||"" };
      $("log-sponsor-name").value = L.sponsor.kind==="other" ? L.sponsor.name : "";
      L.withMe = L.sponsor.kind === "me";
    }
  }
  if (!L.sessionNo || L.sessionNo > total) L.sessionNo = 1;
  $("log-sesno").innerHTML = Array.from({length:total},(_,i)=>{
    const no = i+1, done = t && (t.sessionLog||[]).some(x=>x.no===no && x.ok);
    return `<option value="${no}">${no}회차${done?" ✓":""}</option>`; }).join("");
  $("log-sesno").value = String(L.sessionNo);
  const spKey = L.sponsor.kind === "soul" ? L.sponsor.id : L.sponsor.kind;
  $("log-sponsor").querySelectorAll("[data-sp]").forEach(b=>
    b.classList.toggle("on", b.dataset.sp === spKey));
  $("log-sponsor-name").hidden = L.sponsor.kind !== "other";
  $("log-sponsee").querySelectorAll("[data-se]").forEach(b=>{
    b.classList.toggle("on", L.sponsees.includes(b.dataset.se));
    b.disabled = L.sponsor.kind === "soul" && b.dataset.se === L.sponsor.id;
  });
  /* 내가 후원자면 당연히 그 자리에 있었고, 아니면 고를 수 있게 */
  if (L.sponsor.kind === "me") L.withMe = true;
  const meBtn = $("log-train-me");
  meBtn.hidden = L.sponsor.kind === "me";
  meBtn.classList.toggle("on", L.withMe);
  meBtn.textContent = L.withMe ? "나도 그 자리에 있었어요" : "나는 안 갔어요";
  const names = L.sponsees.map(nameOfSoul).filter(Boolean);
  const okN = t ? (t.sessionLog||[]).filter(x=>x.ok).length : 0;
  const spName = L.sponsor.kind === "me" ? "나"
    : L.sponsor.kind === "soul" ? nameOfSoul(L.sponsor.id)
    : ($("log-sponsor-name").value.trim() || "다른 사람");
  $("log-train-hint").textContent = !names.length
    ? "피후원자를 한 명 이상 골라주세요."
    : `${spName} → ${names.join(", ")} · ${c ? c.name : ""} `
      + (t ? `지금까지 ${okN}/${total}회. ` : "아직 훈련 이력이 없어 새로 만들어요. ")
      + `저장하면 ${names.length>1?"각자의 ":""}훈련 이력 ${L.sessionNo}회차가 ${L.planned ? "예정으로 잡혀요" : "체크돼요"}.`;
  syncLogAway();
}
$("log-sponsor").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-sp]"); if (!b) return;
  const L = state.log, v = b.dataset.sp;
  if (v === "me") L.sponsor = { kind:"me", id:uid(), name:state.me.name||"나" };
  else if (v === "other") {
    L.sponsor = { kind:"other", id:"", name:$("log-sponsor-name").value.trim() };
    setTimeout(()=>$("log-sponsor-name").focus(), 50);
  } else {
    L.sponsor = { kind:"soul", id:v, name:nameOfSoul(v) };
    L.sponsees = L.sponsees.filter(x => x !== v);
  }
  L.sponsorTouched = true;
  L.withMe = L.sponsor.kind === "me";
  syncTrain();
});
$("log-sponsor-name").addEventListener("input", () => {
  state.log.sponsor.name = $("log-sponsor-name").value.trim(); syncTrain();
});
$("log-sponsee").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-se]"); if (!b || b.disabled) return;
  const L = state.log, id = b.dataset.se;
  L.sponsees = L.sponsees.includes(id) ? L.sponsees.filter(x=>x!==id) : [...L.sponsees, id];
  syncTrain(L.sponsees.length === 1);
});
$("log-course").onchange = () => { state.log.courseId = $("log-course").value; syncTrain(true); };
$("log-sesno").onchange = () => { state.log.sessionNo = Number($("log-sesno").value)||1; syncTrain(); };
$("log-train-me").onclick = () => { state.log.withMe = !state.log.withMe; syncTrain(); };
$("log-quick").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-place]"); if(!b) return;
  $("log-place").value = b.dataset.place;
});
$("log-todo-on").onchange = () => { $("log-todo-fields").hidden = !$("log-todo-on").checked; };

/* ── 모임 사진 ──
   기록 안에는 작은 사본만 넣고, 큰 사진은 따로 둡니다.
   그래야 기록 목록을 열 때마다 큰 사진을 내려받지 않아요. */
function renderShots() {
  const shots = state.log.shots;
  $("log-shots").innerHTML = shots.map((p,i)=>`
    <div class="sh" style="background-image:url(${p.thumb})" data-shot="${i}" role="button"
      aria-label="사진 ${i+1} 크게 보기">
      <button type="button" data-rmshot="${i}" aria-label="사진 ${i+1} 빼기">×</button>
    </div>`).join("")
    + (shots.length < MAX_SHOTS
      ? `<button type="button" class="add" id="btn-add-shot">＋ 사진<br>${shots.length}/${MAX_SHOTS}</button>`
      : "");
  const a = $("btn-add-shot"); if (a) a.onclick = () => $("log-photo-input").click();
}
$("log-shots").addEventListener("click", async (ev) => {
  const rm = ev.target.closest("[data-rmshot]");
  if (rm) {
    ev.stopPropagation();
    state.log.shots.splice(Number(rm.dataset.rmshot), 1); renderShots(); return;
  }
  const open = ev.target.closest("[data-shot]");
  if (open) { const p = state.log.shots[Number(open.dataset.shot)]; if (p) showPhoto(p); }
});
$("log-photo-input").onchange = async (ev) => {
  const files = [...(ev.target.files||[])]; ev.target.value = "";
  const room = MAX_SHOTS - state.log.shots.length;
  if (!files.length) return;
  if (files.length > room) toast(`${MAX_SHOTS}장까지만 넣을 수 있어요. 앞의 ${room}장만 넣을게요.`);
  toast("사진을 줄이는 중이에요…");
  for (const f of files.slice(0, room)) {
    try {
      const [big, small] = await Promise.all([
        shrinkFit(f, PHOTO.shot, 900000),
        shrinkFit(f, PHOTO.shotTh, 14000)
      ]);
      state.log.shots.push({ thumb: small, full: big, id: null });
      renderShots();
    } catch (e) { toast(e.message || "사진 하나를 넣지 못했어요."); }
  }
};
async function showPhoto(p) {
  let src = p.full;
  if (!src && p.id) {
    try {
      const d = await getDoc(doc(db,"recordPhotos",p.id));
      src = d.exists() ? d.data().data : null;
    } catch (e) { toast(msgOf(e)); }
  }
  $("pv-img").src = src || p.thumb;
  $("photo-view").showModal();
}
$("pv-close").onclick = () => { $("photo-view").close(); $("pv-img").src = ""; };

$("btn-log-save").onclick = () => saveLog();

async function saveLog() {
  const L = state.log, scope = $("log-scope").value;
  const v = (id) => $(id).value.trim();
  const did=v("log-did"), talked=v("log-talked"), update=v("log-update");
  const train = L.kind === "train", soloKind = kindOf(L.kind).solo;
  const away = !L.withMe;
  const planned = L.planned;
  const fail = (m) => { $("log-err").textContent = m; };
  $("log-err").textContent = "";
  let ids = L.picked.slice(), course = null;
  if (train) {
    course = state.courses.find(c=>c.id===L.courseId);
    if (!course) return fail("어떤 과정인지 골라주세요. 과정은 관리 화면에서 등록해요.");
    if (!L.recId) {
      if (L.sponsor.kind === "other") L.sponsor.name = v("log-sponsor-name");
      if (L.sponsor.kind === "other" && !L.sponsor.name) return fail("후원자 이름을 적어주세요.");
      if (!L.sponsees.length) return fail("피후원자를 한 명 이상 골라주세요.");
      /* 기록은 피후원자 카드에 쌓이고, 후원자가 내 셀원이면 그 카드에도 */
      ids = [...L.sponsees,
        ...(L.sponsor.kind === "soul" && !L.sponsees.includes(L.sponsor.id) ? [L.sponsor.id] : [])];
    }
  }
  if (!ids.length) return fail("누구를 만났는지 골라주세요.");
  if (soloKind && away && !L.recId && ids.length !== 2)
    return fail("나 없이 1:1이면 만난 두 사람을 골라주세요.");
  /* 예정은 아직 안 만난 일이라 비어도 되고, 훈련 회차는 체크만 해도 됩니다 */
  if (!planned && !train && !did && !talked && !update
      && !(away?"":v("log-bheart")) && !(away?"":v("log-dheart")) && !v("log-spirit"))
    return fail("한 칸이라도 적어주세요. 아직 안 만났다면 맨 위에서 '앞으로 예정'을 골라주세요.");
  $("btn-log-save").disabled = true;
  try {
    const date = $("log-date").value || todayStr();
    const label = train ? `${course.name} ${L.sessionNo}회차` : kindName(L.kind);
    const names = ids.map(nameOfSoul).filter(Boolean);
    const withNames = (ids.length > 1 || (!soloKind && L.withMe))
      ? (!soloKind && L.withMe ? [state.me.name || "나"] : []).concat(names) : [];
    const base = {
      type:"meet", kind:L.kind, kindLabel:label, scope, date,
      time: $("log-time").value||"", timeEnd: $("log-time-end").value||"",
      place: v("log-place"),
      beforeHeart: away?"":v("log-bheart"), beforeWord: away?"":v("log-bword"),
      did, talked, duringHeart: away?"":v("log-dheart"), update, spiritual:v("log-spirit"),
      body: talked || did || update || (away?"":v("log-dheart"))
        || (planned ? `${label} 예정` : train ? label : ""),
      planned, away,
      groupId: L.recId ? (L.groupId||null) : (ids.length > 1 ? "g" + Date.now() : null),
      withMe: L.withMe,
      withNames: L.recId ? ((L.rec && L.rec.withNames) || []) : withNames,
      by: uid(), byName: state.me.name||""
    };
    if (train) Object.assign(base, {
      courseId: course.id, courseName: course.name, sessionNo: L.sessionNo,
      sponsorKind: L.sponsor.kind, sponsorId: L.sponsor.id||"",
      sponsorName: L.sponsor.kind === "me" ? (state.me.name||"나") : L.sponsor.name,
      sponseeIds: L.sponsees.slice(), sponseeNames: L.sponsees.map(nameOfSoul)
    });

    let touched = [];
    if (L.recId) {
      const soulId = ids[0];
      const photos = await putShots(soulId, L.recId, scope);
      await updateDoc(doc(db,"souls",soulId,"records",L.recId), { ...base, photos });
      touched = [soulId];
      /* 여러 명이 같이 묶인 기록이면, 다른 사람 카드의 같은 기록도 함께 고칩니다 */
      if (L.groupId) {
        const all = await loadAllRecords(true);
        const sibs = all.filter(r => r.groupId === L.groupId && r.by === uid() && r.type === "meet"
          && !(r.soulId === soulId && r.id === L.recId));
        for (const r of sibs) {
          await updateDoc(doc(db,"souls",r.soulId,"records",r.id), { ...base, photos });
          touched.push(r.soulId);
        }
      }
    } else {
      for (const soulId of ids) {
        const ref = await addDoc(collection(db,"souls",soulId,"records"),
          { ...base, photos: [], createdAt: serverTimestamp() });
        const photos = await putShots(soulId, ref.id, scope);
        if (photos.length) await updateDoc(doc(db,"souls",soulId,"records",ref.id), { photos });

        const prayTxt = v("log-pray");
        if (prayTxt && !planned) {
          await addDoc(collection(db,"souls",soulId,"records"), {
            type:"pray", scope, date, body:prayTxt,
            prayStatus:"praying", by:uid(), byName:state.me.name||"", createdAt: serverTimestamp()
          });
        }
        if ($("log-todo-on").checked && v("log-todo-text") && !planned) {
          const target = state.souls.find(x=>x.id===soulId)||{};
          const todos = [...(target.todos||[]),
            { id:"t"+Date.now()+soulId.slice(0,4), text:v("log-todo-text"),
              due:$("log-todo-due").value||"", done:false }];
          await updateDoc(doc(db,"souls",soulId), { todos });
          Object.assign(target, { todos });
        }
      }
      touched = ids;
    }
    /* '마지막 만남'은 내가 직접 만난 일만 — 예정이나 전해 들은 모임은 빼고, 더 최근일 때만 */
    if (!planned && !away) {
      for (const soulId of [...new Set(touched)]) {
        const s = state.souls.find(x=>x.id===soulId);
        if (s && String(s.lastMetAt||"") >= date) continue;
        await updateDoc(doc(db,"souls",soulId), { lastMetAt: date });
        if (s) s.lastMetAt = date;
      }
    }
    /* 훈련 모임이면 피후원자마다 훈련 이력의 그 회차를 체크(또는 예정)합니다 */
    if (train) {
      for (const sid of base.sponseeIds)
        await markSession(sid, course, L.sessionNo, date, !planned, base);
    }
    invalidate();
    toast(L.recId ? (L.rec && L.rec.planned && !planned ? "만난 기록으로 바꿨어요." : "고쳤어요.")
      : planned ? `${fmtDate(date)} 예정을 잡았어요.`
      : train ? `${label}를 기록했어요.`
      : ids.length > 1 ? `${ids.length}명 카드에 기록했어요.` : "기록했어요.");
    bump(planned ? "planCreate" : "recordCreate");
    if (L.back === "cal") openCal(); else openSoul(ids[0]);
  } catch (e) { $("log-err").textContent = msgOf(e); }
  finally { $("btn-log-save").disabled = false; }
}

/* 피후원자 한 사람의 훈련 이력에서 그 회차를 채웁니다. 이력이 없으면 새로 만듭니다. */
async function markSession(soulId, course, no, date, done, sp) {
  const col = collection(db,"souls",soulId,"trainings");
  const t = pack(await getDocs(col))
    .filter(x => x.courseId === course.id && x.status !== "dropped")
    .sort((a,b)=>String(b.startDate||"").localeCompare(String(a.startDate||"")))[0];
  const spf = { sponsorKind: sp.sponsorKind, sponsorId: sp.sponsorId||"", sponsorName: sp.sponsorName||"" };
  if (t) {
    const log = (t.sessionLog||[]).filter(x => x.no !== no)
      .concat([{ no, date, ok: done }]).sort((a,b)=>a.no-b.no);
    const patch = { sessionLog: log, ...spf, by: uid() };
    if (done && t.status === "planned") patch.status = "ongoing";
    if (!t.startDate || date < t.startDate) patch.startDate = date;
    await updateDoc(doc(db,"souls",soulId,"trainings",t.id), patch);
  } else {
    await addDoc(col, {
      courseId: course.id, courseName: course.name, totalSessions: course.sessions||1,
      cohort:"", status: done ? "ongoing" : "planned", startDate: date, endDate:"", note:"",
      sessionLog: [{ no, date, ok: done }], ...spf, by: uid(), createdAt: serverTimestamp()
    });
  }
}

/* 아직 안 올린 사진만 올리고, 기록에 넣을 목록을 돌려줍니다 */
async function putShots(soulId, recId, scope) {
  const out = [];
  for (const p of state.log.shots) {
    if (p.id) { out.push({ id:p.id, thumb:p.thumb }); continue; }
    const ref = await addDoc(collection(db,"recordPhotos"), {
      soulId, recordId: recId, scope, data: p.full,
      by: uid(), createdAt: serverTimestamp()
    });
    /* 여러 명이 함께한 모임이면 같은 사진을 사람마다 또 올리지 않고 한 장을 같이 씁니다.
       (예전에는 셋이 만나 세 장을 올리면 아홉 장이 저장됐어요) */
    p.id = ref.id;
    out.push({ id: ref.id, thumb: p.thumb });
  }
  return out;
}

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

/* ── 침례 ── */
const dlgBap = $("dlg-bap");
function openBapDlg() {
  const s = state.soul;
  $("bp-date").value = s.baptizedAt ? fmtRaw(s.baptizedAt) : "";
  $("bp-clear").hidden = !s.baptizedAt;
  $("bap-err").textContent = "";
  dlgBap.showModal(); setTimeout(()=>$("bp-date").focus(),120);
}
$("bp-cancel").onclick = () => dlgBap.close();
$("bp-clear").onclick = async () => {
  await saveSoulField({ baptizedAt:"" });
  dlgBap.close(); invalidate(); renderSoulBody(); toast("침례 날짜를 지웠어요.");
};
$("bp-save").onclick = async () => {
  const raw = $("bp-date").value.trim();
  if (!raw) { $("bap-err").textContent = "날짜를 적어주세요."; return; }
  const parsed = parseDateLoose(raw);
  if (parsed === null) {
    $("bap-err").textContent = "날짜 형식을 확인해 주세요. 2024-5-19 처럼 적어주세요."; return;
  }
  await saveSoulField({ baptizedAt: parsed });
  dlgBap.close(); invalidate(); renderSoulBody(); toast("침례 날짜를 저장했어요.");
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
  const others = state.souls.filter(x=>isLeaderOf(x) && x.id!==state.soul.id);
  $("tr-sponsor").innerHTML = `<option value="">아직 안 정함</option><option value="me">나</option>`
    + others.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")
    + `<option value="other">다른 사람 — 이름 적기</option>`;
  $("tr-sponsor").value = !t || !t.sponsorKind ? "" : t.sponsorKind==="soul" ? t.sponsorId : t.sponsorKind;
  if ($("tr-sponsor").value === "" && t && t.sponsorKind === "soul") $("tr-sponsor").value = "other";
  $("tr-sponsor-name").value = t && t.sponsorKind !== "me" ? (t.sponsorName||"") : "";
  $("tr-sponsor-name").hidden = $("tr-sponsor").value !== "other";
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
$("tr-sponsor").onchange = () => {
  $("tr-sponsor-name").hidden = $("tr-sponsor").value !== "other";
  if ($("tr-sponsor").value === "other") $("tr-sponsor-name").focus();
};
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
    const sp = $("tr-sponsor").value;
    if (sp === "other" && !$("tr-sponsor-name").value.trim()) {
      $("train-err").textContent = "후원자 이름을 적어주세요."; $("tr-save").disabled=false; return; }
    Object.assign(data, !sp ? { sponsorKind:"", sponsorId:"", sponsorName:"" }
      : sp === "me" ? { sponsorKind:"me", sponsorId:uid(), sponsorName:state.me.name||"나" }
      : sp === "other" ? { sponsorKind:"other", sponsorId:"", sponsorName:$("tr-sponsor-name").value.trim() }
      : { sponsorKind:"soul", sponsorId:sp, sponsorName:nameOfSoul(sp) });
    if (editing) await updateDoc(doc(db,"souls",state.soul.id,"trainings",editing), data);
    else await addDoc(collection(db,"souls",state.soul.id,"trainings"),
      { ...data, sessionLog:[], createdAt: serverTimestamp() });
    await loadTrainings(state.soul.id); invalidate(); bump("trainSave");
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
    await loadOrg(true); dlgCourse.close(); toast("저장했어요.");
    if(courseAfter) courseAfter(); else openManage();
  } catch(e){ $("course-err").textContent=msgOf(e); }
  finally { $("co-save").disabled=false; }
};
/* ── 모임 종류 ── */
const dlgMtype = $("dlg-mtype");
let editingTypeId = null, mtypeAfter = null;
const sharesTypes = () => state.me.role === "super" || state.me.role === "jinjang";
function openMtypeDlg(typeId, after) {
  editingTypeId = typeId || null; mtypeAfter = after || null;
  const t = typeId ? state.meetTypes.find(x=>x.id===typeId) : null;
  $("mtype-title").textContent = t ? "모임 종류 수정" : "모임 종류 추가";
  $("mt-name").value = t ? t.name : "";
  /* 진장·수퍼가 만들면 교회 전체가, 셀리더가 만들면 그 사람만 씁니다 */
  $("mt-hint").textContent = "1:1 만남 · 소그룹 모임 · 셀모임 후 · 훈련 모임은 기본으로 들어 있어요. "
    + (sharesTypes() ? "여기서 만든 종류는 교회 전체가 같이 써요." : "여기서 만든 종류는 나에게만 보여요.");
  $("mtype-err").textContent = "";
  dlgMtype.showModal(); setTimeout(()=>$("mt-name").focus(),120);
}
$("mt-cancel").onclick = () => dlgMtype.close();
$("mt-save").onclick = async () => {
  const name = $("mt-name").value.trim();
  if (!name) { $("mtype-err").textContent = "이름을 적어주세요."; return; }
  $("mt-save").disabled = true;
  try {
    if (editingTypeId) {
      await updateDoc(doc(db,"meetTypes",editingTypeId), { name });
      await log("모임 종류 수정", name);
    } else {
      if (kindList().some(k => k.name === name)) {
        $("mtype-err").textContent = "같은 이름이 이미 있어요."; return; }
      /* 기본 종류(1~4) 뒤에 붙도록 */
      const mx = state.meetTypes.reduce((m,t)=>Math.max(m,t.order||0), BASE_KINDS.length);
      const data = { name, order:mx+1, active:true, createdAt:serverTimestamp() };
      if (!sharesTypes()) data.ownerUid = uid();
      const ref = await addDoc(collection(db,"meetTypes"), data);
      editingTypeId = ref.id;
      await log("모임 종류 추가", name);
    }
    await loadOrg(true); dlgMtype.close(); toast("저장했어요.");
    if (mtypeAfter) { const f = mtypeAfter; mtypeAfter = null; f(editingTypeId); }
    else openManage();
  } catch (e) { $("mtype-err").textContent = msgOf(e); }
  finally { $("mt-save").disabled = false; }
};
$("btn-mtype-add").onclick = () => openMtypeDlg(null);

async function moveCourse(courseId, dir) {
  const list=[...state.courses];
  const i=list.findIndex(c=>c.id===courseId), j=i+dir;
  if(i<0||j<0||j>=list.length) return;
  [list[i],list[j]]=[list[j],list[i]];
  try { await Promise.all(list.map((c,idx)=>updateDoc(doc(db,"courses",c.id),{order:idx+1})));
    await loadOrg(true); openManage(); }
  catch(e){ toast(msgOf(e)); }
}

/* ════════ 훈련 현황 ════════ */
async function openTrainBoard() {
  show("s-loading"); markSide("train");
  await loadOrg(); await loadSouls();
  const all = await loadAllTrainings();
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
  const bapN = souls.filter(s=>s.baptizedAt).length;
  $("train-sum").innerHTML = `
    <div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${tile("영혼", souls.length+"명")}
      ${tile("침례 받음", bapN+"명")}
      ${tile("수강 중", sum.reduce((n,x)=>n+x.ing,0)+"명")}
    </div>
    ${!state.courses.length ? `<p class="muted" style="margin-top:14px">훈련 과정을 먼저 등록해 주세요.</p>` : `
    <div class="courses">
      <div class="cbox ${bapN===souls.length&&souls.length?"done":""}">
        <p class="cn">침례</p>
        <p class="cs">받음 ${bapN} · 아직 ${souls.length-bapN}</p>
        <div class="pbar"><i style="width:${souls.length?Math.round(bapN/souls.length*100):0}%"></i></div>
      </div>
      ${sum.map(x=>`<div class="cbox"><p class="cn">${esc(x.c.name)}</p>
        <p class="cs">${[`수료 ${x.done}`, `수강 중 ${x.ing}`,
            x.plan?`예정 ${x.plan}`:"", x.drop?`포기 ${x.drop}`:"",
            `아직 ${x.none}`].filter(Boolean).join(" · ")}</p>
        <div class="pbar"><i style="width:${souls.length?Math.round(x.done/souls.length*100):0}%"></i></div>
      </div>`).join("")}
    </div>`}`;

  const cell = (s,c) => {
    const t = latest[s.id+"|"+c.id];
    if (!t) return `<td class="planned">—</td>`;
    const total=(c.sessions||1), ok=doneSessions(t);
    const label = t.status==="ongoing"&&total>1?`${ok}/${total}`:(TSTAT[t.status]||"");
    return `<td class="${t.status}">${label}</td>`;
  };
  const bapCell = (s) => s.baptizedAt
    ? `<td class="done">${fmtDate(s.baptizedAt, true)}</td>`
    : `<td class="planned">—</td>`;
  $("train-matrix").innerHTML = souls.length ? `
    <table><thead><tr><th style="text-align:left">이름</th><th>생년 · 생일</th><th>침례</th>
      ${state.courses.map(c=>`<th>${esc(c.name)}${(c.sessions||1)>1?`<br><span style="font-weight:400">${c.sessions}회</span>`:""}</th>`).join("")}
    </tr></thead><tbody>
      ${souls.map(s=>`<tr><td class="nm">${esc(s.name)}</td>
        <td class="planned">${esc(birthText(s)||"—")}</td>${bapCell(s)}${
        state.courses.map(c=>cell(s,c)).join("")}</tr>`).join("")}
    </tbody></table>` : "";

  $("train-list").innerHTML = souls.map(s=>{
    const mine = state.courses.map(c=>latest[s.id+"|"+c.id]).filter(Boolean);
    const done = mine.filter(t=>t.status==="done").length;
    const ing = mine.find(t=>t.status==="ongoing");
    const plan = mine.find(t=>t.status==="planned");
    const extra = ing ? ` · ${esc(ing.courseName)} 수강 중`
      : plan ? ` · ${esc(plan.courseName)} 예정` : "";
    return `<div class="row" data-gosoul3="${s.id}" style="cursor:pointer">
      ${avatar(s)}
      <div class="grow"><p class="nm">${esc(s.name)}</p>
        <p class="sub">${s.baptizedAt?`침례 ${fmtDate(s.baptizedAt,true)}`:"침례 아직"}</p>
        <p class="sub2">수료 ${done}개${extra}</p></div>
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
  await loadAllRecords();
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
      title:`${c?c.name:"셀"} 셀모임`, sub:m.topic||"", time:m.time||"", timeEnd:m.timeEnd||"",
      place:m.place||"", id:m.id });
  });
  /* 여러 명이 함께한 모임은 사람마다 한 줄씩이 아니라 한 줄로 묶습니다 */
  const groups = {}, trainKeys = new Set();
  /* 셀모임 때 적은 근황은 그 셀모임 줄이 이미 있으니 따로 띄우지 않습니다 */
  (state.allRecords||[]).filter(r=>r.type==="meet" && !r.meetingId).forEach(r=>{
    if (r.kind === "train" && r.courseId)
      trainKeys.add(`${r.soulId}|${r.courseId}|${r.sessionNo}`);
    if (r.groupId && groups[r.groupId]) { groups[r.groupId].names.push(r.soulName); return; }
    const e = { date:r.date, kind:r.planned?"plan":"record",
      color: r.planned ? "#E8B473" : "#7FCB9B", r, names:[r.soulName],
      sub:r.body||"", time:r.time||"",
      timeEnd:r.timeEnd||"", place:r.place||"", soulId:r.soulId };
    if (r.groupId) groups[r.groupId] = e;
    ev.push(e);
  });
  ev.forEach(e=>{
    if (!e.r) return;
    const r = e.r, pre = r.planned ? "[예정] " : "";
    e.title = r.kind === "train" && r.sponsorName
      ? `${pre}${meetLabel(r)} · ${r.sponsorName} → ${(r.sponseeNames||[]).join("·")}`
      : `${pre}${e.names.join("·")} · ${meetLabel(r)}${r.away ? " (나 없이)" : ""}`;
  });
  const y = Number(state.calMonth.split("-")[0]);
  state.souls.forEach(s=>{
    [["birth","생일"],["baptizedAt","침례"],["marriedAt","결혼기념일"]].forEach(([f,label])=>{
      const v = s[f]; if(!v) return;
      const p = String(v).split("-"); if(p.length<3||p[1]==="00"||p[2]==="00") return;
      ev.push({ date:`${y}-${p[1]}-${p[2]}`, kind:"anniv", color:"#E8B473",
        title:`${s.name} ${label}`, sub:"", soulId:s.id });
    });
  });
  (state.allTrainings||[]).forEach(t=>{
    (t.sessionLog||[]).filter(x=>x.date && !trainKeys.has(`${t.soulId}|${t.courseId}|${x.no}`)).forEach(x=>{
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
  $("btn-cal-add").textContent = ds > todayStr() ? "＋ 이 날 예정" : "＋ 이 날 기록";
  $("cal-day-list").innerHTML = list.length ? list.map((e,i)=>`
    <div class="row">
      <i style="width:8px;height:8px;border-radius:999px;background:${e.color};flex-shrink:0"></i>
      <div class="grow"><p class="nm">${esc(e.title)}</p>
        <p class="sub">${[fmtSpan(e.time,e.timeEnd),e.place,e.sub]
          .filter(Boolean).map(esc).join(" · ")||"&nbsp;"}</p></div>
      <button class="btn-sm" data-gcal="${i}">캘린더에</button>
      ${e.r && e.r.by===uid() && e.r.planned
        ?`<button class="btn-sm" data-calrec="${e.r.soulId}|${e.r.id}|fill">만났어요</button>`:""}
      ${e.r && e.r.by===uid()?`<button class="btn-sm" data-calrec="${e.r.soulId}|${e.r.id}">수정</button>`:""}
      ${e.soulId?`<button class="btn-sm" data-gosoul4="${e.soulId}">카드</button>`:""}
      ${e.id?`<button class="btn-sm" data-gomeet="${e.id}">열기</button>`:""}
    </div>`).join("")
    : canLead()
      ? `<button class="btn-ghost" id="cal-empty-add" style="height:46px;font-size:13px;max-width:360px">${
          ds > todayStr() ? "이 날 예정 잡기" : "이 날 있었던 일 적기"}</button>`
      : `<p class="muted">이 날은 일정이 없어요.</p>`;
  const ea = $("cal-empty-add"); if (ea) ea.onclick = () => $("btn-cal-add").click();
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
  const er=ev.target.closest("[data-calrec]");
  if (er) { const [sid, rid, how] = er.dataset.calrec.split("|");
    openLog(sid, rid, { back:"cal", fill: how === "fill" }); return; }
  const s=ev.target.closest("[data-gosoul4]"); if(s){ openSoul(s.dataset.gosoul4); return; }
  const m=ev.target.closest("[data-gomeet]"); if(m){ openMeeting(m.dataset.gomeet); return; }
});
/* 끝 시간이 적혀 있으면 그대로, 없으면 2시간으로 잡아줍니다. */
function endStamp(e) {
  const end = new Date(`${e.date}T${e.time}:00`);
  if (e.timeEnd) {
    const [h2,m2] = e.timeEnd.split(":").map(Number);
    const [h1,m1] = e.time.split(":").map(Number);
    end.setHours(h2, m2, 0, 0);
    if (h2*60+m2 <= h1*60+m1) end.setDate(end.getDate()+1);  // 자정을 넘긴 경우
  } else end.setHours(end.getHours()+2);
  return `${ymd(end).replace(/-/g,"")}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`;
}
/* 몇 분 전에 울릴지 — 종류마다 다릅니다.
   셀모임은 하루 전에도 한 번 (준비할 게 있으니까),
   기념일은 아침에 한 번이면 됩니다. */
const ALARM = {
  meeting: ["-PT1D", "-PT1H"],   // 하루 전, 1시간 전
  record:  ["-PT1H"],            // 1시간 전
  plan:    ["-PT1D", "-PT1H"],   // 예약 — 하루 전, 1시간 전
  anniv:   ["PT9H"],             // 그날 아침 9시 (하루 종일 일정이라 자정 + 9시간)
  train:   ["-PT2H"]             // 2시간 전
};
function gcalUrl(e) {
  const d = e.date.replace(/-/g,"");
  let dates;
  if (e.time) {
    const [hh,mm] = e.time.split(":").map(Number);
    dates = `${d}T${pad2(hh)}${pad2(mm)}00/${endStamp(e)}`;
  } else {
    const nx = new Date(e.date+"T00:00:00"); nx.setDate(nx.getDate()+1);
    dates = `${d}/${ymd(nx).replace(/-/g,"")}`;
  }
  const p = new URLSearchParams({ action:"TEMPLATE", text:e.title,
    details:(e.sub||"")+"\n\n목자의 삶", location:e.place||"", dates });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
/* 날짜를 눌러 그 날짜로 바로 기록하기 */
const dlgCalNew = $("dlg-calnew");
$("btn-cal-add").onclick = () => {
  if (!canLead()) { toast("셀을 맡은 분만 기록을 남길 수 있어요."); return; }
  const ds = state.calPick || todayStr();
  /* 앞날을 골랐으면 처음부터 '예정' */
  state.cnPlan = ds > todayStr();
  fillCnKinds("one");
  syncCalNew(); $("calnew-err").textContent = "";
  dlgCalNew.showModal();
};
/* 직접 만든 종류까지 — 숨긴 건 빼고 내가 정한 순서대로.
   '셀모임 후' 는 셀모임(출석)과 겹치지 않게 값만 따로 둡니다. */
function fillCnKinds(want) {
  const shown = kindsShown();
  $("cn-kind").innerHTML = `<option value="cell">셀모임 (출석 포함)</option>`
    + shown.map(k=>`<option value="${k.id==="cell"?"after":k.id}">${esc(k.name)}</option>`).join("");
  const vals = [...$("cn-kind").options].map(o=>o.value);
  $("cn-kind").value = vals.includes(want) ? want : (vals[1] || "cell");
}
$("cn-kinds").onclick = () => {
  const cur = $("cn-kind").value;
  openKindsDlg(() => { fillCnKinds(cur); syncCalNew(); });
};
function syncCalNew() {
  const k = $("cn-kind").value, ds = state.calPick || todayStr(), P = state.cnPlan;
  /* 누가 함께했는지는 다음 화면에서 — 나를 포함해 여러 명을 고를 수 있어서 */
  $("cn-who-hint").textContent = k === "cell" ? "출석 체크 화면으로 갑니다."
    : k === "train" ? "다음 화면에서 후원자와 피후원자를 골라요."
    : k === "one" ? "다음 화면에서 두 사람을 골라요 — 나와 셀원, 또는 셀원 둘."
    : "다음 화면에서 함께한 사람을 모두 골라요 — 나를 빼고 셀원끼리도 돼요.";
  $("cn-mode").querySelectorAll("[data-cnmode]").forEach(b=>
    b.classList.toggle("on", (b.dataset.cnmode === "plan") === P));
  $("calnew-title").textContent = P ? "이 날 예정 잡기" : "이 날 기록 남기기";
  $("calnew-sub").textContent = P
    ? `${fmtDate(ds, true)}에 있을 모임을 미리 적어둬요.`
    : `${fmtDate(ds, true)}에 있었던 일을 적어요.`;
  $("cn-go").textContent = P ? "예정 잡으러 가기" : "적으러 가기";
}
$("cn-kind").onchange = syncCalNew;
$("cn-mode").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-cnmode]"); if (!b) return;
  state.cnPlan = b.dataset.cnmode === "plan"; syncCalNew();
});
$("cn-cancel").onclick = () => dlgCalNew.close();
$("cn-go").onclick = () => {
  const v = $("cn-kind").value, ds = state.calPick || todayStr();
  if (v === "cell") { dlgCalNew.close(); openMeeting(null, { date:ds, back:"cal" }); return; }
  if (!state.souls.some(isLeaderOf)) { $("calnew-err").textContent = "먼저 영혼 카드를 하나 만들어 주세요."; return; }
  dlgCalNew.close();
  /* 캘린더에서는 아무도 미리 고르지 않고 시작합니다 */
  openLog(null, null, { date:ds, kind: v === "after" ? "cell" : v, back:"cal",
    planned: state.cnPlan, noPick: true });
};
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
      lines.push(`DTSTART:${d}T${pad2(hh)}${pad2(mm)}00`, `DTEND:${endStamp(e)}`);
    } else {
      const nx=new Date(e.date+"T00:00:00"); nx.setDate(nx.getDate()+1);
      lines.push(`DTSTART;VALUE=DATE:${d}`,`DTEND;VALUE=DATE:${ymd(nx).replace(/-/g,"")}`);
    }
    lines.push(`SUMMARY:${esc2(e.title)}`);
    if (e.sub) lines.push(`DESCRIPTION:${esc2(e.sub)}`);
    if (e.place) lines.push(`LOCATION:${esc2(e.place)}`);
    /* 알람을 일정에 같이 담아둡니다. 구글 캘린더로 가져오면 그대로 울려요.
       앱은 서버가 없어서 직접 못 울리지만, 구글 캘린더는 울려줍니다. */
    (ALARM[e.kind] || ["-PT1H"]).forEach(t => lines.push("BEGIN:VALARM", "ACTION:DISPLAY",
      `TRIGGER:${t}`, `DESCRIPTION:${esc2(e.title)}`, "END:VALARM"));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  download(`목자의삶_일정_${todayStr()}.ics`, lines.join("\r\n"), "text/calendar");
  toast("파일을 받았어요. 알람도 같이 들어 있어요. 구글 캘린더 설정 → 가져오기 에서 올려주세요.");
};

/* ════════ 영혼 추가 · 수정 ════════ */
const EDIT_FIELDS = ["e-name","e-gender","e-birth","e-phone","e-address","e-address2","e-job",
  "e-reg","e-bap","e-married","e-position","e-invitedby","e-verse","e-hobby","e-mbti",
  "e-food","e-avoid","e-interest","e-memo","e-status","e-cycle","e-cell"];
function openEdit(soulId) {
  state.editingId=soulId; state.editPhoto=undefined; state.editThumb=undefined; state.editDirty=false;
  const s = soulId?state.souls.find(x=>x.id===soulId):null;
  $("edit-title").textContent = s?"프로필 수정":"영혼 추가";
  $("btn-del-soul").hidden = !s;
  $("btn-hand").hidden = !s;
  $("btn-promote").hidden = !(s && isLeaderOf(s) && (s.kind||"member") === "member");
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
  /* 셀리더·코치 카드 — 진장이 만듭니다. 셀 구성원이 아니라 출석 명단에서 빠지고,
     계정을 연결하면 그 사람 본인은 어떤 경로로도 못 봅니다. */
  const canUpCard = state.me.role==="jinjang" || state.me.role==="super";
  $("e-leader-wrap").hidden = !canUpCard;
  $("e-kind").value = (s && s.kind) || "member";
  $("e-ofcell").innerHTML = use.map(c=>
    `<option value="${c.id}"${s&&s.ofCellId===c.id?" selected":""}>${esc(c.name)}</option>`).join("")
    || `<option value="">셀 없음</option>`;
  /* 나 자신은 고를 수 없게 빼둡니다 — 자기 카드는 자기가 못 가집니다 */
  $("e-link").innerHTML = `<option value="">— 아직 계정 없음 —</option>`
    + state.members.filter(m=>m.id!==state.me.id && m.role!=="super").map(m=>
      `<option value="${m.id}"${s&&s.linkedUid===m.id?" selected":""}>${esc(m.name)} · ${ROLE[m.role]||m.role}</option>`).join("");
  syncLeaderCard();
  const ph = s?state.photoCache[s.id]:null;
  $("edit-ava").style.backgroundImage = ph?`url(${ph})`:"";
  $("edit-ava").textContent = ph?"":($("e-name").value?initial($("e-name").value):"+");
  $("edit-err").textContent=""; autoGrow($("e-memo")); updateFoldCounts();
  show("s-edit");
  setTimeout(()=>{ if(!s) $("e-name").focus(); },120);
}
const KINDHINT = {
  member: "셀모임 출석 명단에 들어가고, 출석률도 쌓입니다.",
  leader: "출석 명단에는 안 나와요. 진장과 그 셀 담당 코치가 봅니다. 본인은 못 봐요.",
  coach : "출석 명단에는 안 나와요. 진장만 봅니다. 본인과 다른 코치는 못 봐요."
};
function syncLeaderCard() {
  const k = $("e-kind").value, up = k !== "member";
  $("e-cell-wrap").hidden = up;        // 셀리더·코치는 셀 구성원이 아닙니다
  $("e-ofcell-wrap").hidden = k !== "leader";
  $("e-link-wrap").hidden = !up;
  $("e-kind-hint").textContent = KINDHINT[k] || "";
}
$("e-kind").onchange = () => { syncLeaderCard(); state.editDirty = true; };

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
  state.editPhoto=null; state.editThumb=null; state.editDirty=true;
  $("edit-ava").style.backgroundImage=""; $("edit-ava").textContent=initial($("e-name").value||"?");
  updateFoldCounts();
};
$("photo-input").onchange=async(ev)=>{
  const file=ev.target.files&&ev.target.files[0]; ev.target.value="";
  if(!file) return;
  try{
    /* 큰 사진과, 목록에 뜰 아주 작은 사본을 같이 만듭니다 */
    const [big,small] = await Promise.all([
      shrinkFit(file, PHOTO.face, 700000),
      shrinkFit(file, PHOTO.faceTh, 12000)
    ]);
    state.editPhoto=big; state.editThumb=small; state.editDirty=true;
    $("edit-ava").style.backgroundImage=`url(${big})`; $("edit-ava").textContent="";
    updateFoldCounts();
  }catch(e){ toast(e.message||"사진을 넣지 못했어요."); }
};
$("btn-save-soul").onclick=async()=>{
  const name=$("e-name").value.trim();
  $("edit-err").textContent="";
  if(!name){ $("edit-err").textContent="이름은 꼭 적어주세요."; $("e-name").focus(); return; }
  if(!canMakeSoul()){ $("edit-err").textContent="셀을 맡은 분과 진장만 영혼 카드를 만들 수 있어요."; return; }
  if(!state.me.jinId){ $("edit-err").textContent="먼저 리더 관리에서 내 진과 셀을 지정해 주세요."; return; }
  const dates={};
  for(const [key,id,label] of [["birth","e-birth","생일"],["registeredAt","e-reg","교회 등록일"],
      ["baptizedAt","e-bap","침례일"],["marriedAt","e-married","결혼기념일"]]) {
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
    status:$("e-status").value, contactCycle:Number($("e-cycle").value)||0, ...dates };
  const kind = $("e-leader-wrap").hidden ? "member" : $("e-kind").value;
  if (kind === "member") {
    data.kind = "member"; data.cellId = $("e-cell").value || null;
    data.ofCellId = null; data.linkedUid = "";
  } else {
    /* 셀리더·코치 카드는 cellId 를 비워둡니다. 그래야 그 셀의 출석
       명단에 안 들어가고, 코치에게는 ofCellId 로만 열립니다. */
    data.kind = kind; data.cellId = null;
    data.ofCellId = kind === "leader" ? ($("e-ofcell").value || null) : null;
    data.linkedUid = $("e-link").value || "";
    if (data.linkedUid === state.me.id) {
      $("edit-err").textContent = "내 계정을 연결할 수는 없어요. 자기 카드는 자기가 가질 수 없습니다.";
      $("btn-save-soul").disabled = false; return;
    }
  }
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
      /* 목록에 쓸 작은 사본은 영혼 카드 자체에 둡니다 — 목록이 사진을
         따로 불러오지 않아도 되도록 */
      await updateDoc(doc(db,"souls",soulId),{ thumb: state.editThumb || "" });
    }
    state.editDirty=false; invalidate(); await loadSouls(true);
    if(!state.editingId) bump("soulCreate");
    toast("저장했어요."); openSoul(soulId);
  } catch(e){ $("edit-err").textContent=msgOf(e); }
  finally { $("btn-save-soul").disabled=false; }
};
$("btn-hand").onclick = () => { state.editDirty=false; openHandDlg(state.editingId); };
$("btn-promote").onclick = () => { state.editDirty=false; openPromoteDlg(state.editingId); };
$("btn-del-soul").onclick=async()=>{
  if(!confirm("이 카드를 목록에서 보관할까요? 기록은 지워지지 않아요.")) return;
  try { await updateDoc(doc(db,"souls",state.editingId),{active:false});
    state.editDirty=false; invalidate(); await loadSouls(true); toast("보관했어요."); openSouls(); }
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
  renderMeetChart();
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

/* ── 출석률 그래프 ──
   재는 것이 '출석률' 하나뿐이라 색도 하나만 씁니다.
   숫자는 글자 색으로 적어, 색을 구별하지 못해도 읽을 수 있게 했어요. */
const meetRate = (m) => {
  const v = Object.values(m.attendance||{});
  return v.length ? Math.round(v.filter(x=>x!=="absent").length / v.length * 100) : null;
};
function renderMeetChart() {
  const box = $("meet-chart");
  const rows = state.meetings.filter(m=>meetRate(m)!==null)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if (rows.length < 2) {
    box.innerHTML = rows.length
      ? `<p class="muted" style="margin-top:14px">모임이 두 번 이상 쌓이면 출석률 흐름이 그래프로 보여요.</p>`
      : "";
    return;
  }
  const recent = rows.slice(-12);
  const avg = Math.round(recent.reduce((n,m)=>n+meetRate(m),0) / recent.length);
  const short = (d) => { const p=String(d).split("-"); return `${Number(p[1])}/${Number(p[2])}`; };
  const bars = recent.map((m,i)=>{
    const r = meetRate(m), last = i===recent.length-1;
    const v = Object.values(m.attendance||{});
    return `<div class="bar${r===0?" zero":""}" title="${short(m.date)} · ${r}% (${
      v.filter(x=>x!=="absent").length}/${v.length}명)">
      ${last?`<span class="val">${r}%</span>`:""}
      <i style="${r===0 ? "height:4px" : `height:${r}%`}"></i></div>`;
  }).join("");
  /* 칸이 넉넉하면 전부, 좁으면 처음·가운데·마지막만 */
  const keep = recent.length <= 7
    ? null : new Set([0, Math.floor((recent.length-1)/2), recent.length-1]);
  const axis = recent.map((m,i)=>
    `<span>${(!keep || keep.has(i)) ? short(m.date) : ""}</span>`).join("");

  const souls = state.souls.filter(s=>s.cellId && cellMeetings(s.cellId).length);
  const people = souls.map(s=>({ s, rate: attendRate(attKey(s), attCell(s)) }))
    .filter(x=>x.rate!==null).sort((a,b)=>a.rate-b.rate);

  box.innerHTML = `
    <div class="card" style="margin-top:14px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
        <h3 style="font-size:13px;font-weight:600">주차별 출석률</h3>
        <span class="muted" style="font-size:12px;display:inline-flex;align-items:center;gap:5px">
          최근 ${recent.length}회
          <i style="width:14px;border-top:1px dashed #6B5C5D;display:inline-block"></i>평균 ${avg}%
        </span>
      </div>
      <div class="chart">
        <div class="plot">
          <div class="avg" style="bottom:calc(96px * ${avg} / 100)" aria-hidden="true"></div>
          ${bars}
        </div>
        <div class="xaxis">${axis}</div>
      </div>
    </div>
    ${people.length ? `
    <div class="card" style="margin-top:10px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
        <h3 style="font-size:13px;font-weight:600">사람별 출석률</h3>
        <span class="muted" style="font-size:12px">낮은 사람부터</span>
      </div>
      <div class="hbars">${people.map(({s,rate})=>`
        <div class="hb${rate<60?" low":""}" data-gosoul5="${s.id}" style="cursor:pointer">
          <span class="who">${esc(s.name)}</span>
          <span class="track"><i style="width:${Math.max(rate,2)}%"></i></span>
          <span class="pct">${rate}%</span>
        </div>`).join("")}</div>
      <p class="muted" style="font-size:11px;margin-top:12px">
        이름을 누르면 그 사람 카드가 열려요. 60%가 안 되면 숫자를 노란색으로 표시했어요.</p>
    </div>` : ""}`;
}
$("meet-chart").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-gosoul5]"); if(!b) return; openSoul(b.dataset.gosoul5);
});
$("btn-meet-new").onclick=()=>openMeeting(null);
$("meeting-back").onclick=()=>
  (state.meeting && state.meeting.back==="cal") ? openCal() : openMeet();

function openMeeting(id, opts) {
  const o = opts || {};
  const m = id?state.meetings.find(x=>x.id===id):null;
  const cells = myCells();
  if(!m && !cells.length){ toast("먼저 셀을 만들어 주세요. 리더 관리에서 추가할 수 있어요."); return; }
  state.meeting = m ? { attendance:{}, reasons:{}, notes:{}, ...m } : {
    id:null, cellId:defaultCellId(), jinId:state.me.jinId, date:o.date||todayStr(), time:"",
    timeEnd:"", place:"", topic:"", note:"", visitors:"",
    attendance:{}, reasons:{}, notes:{}, open:{} };
  state.meeting.back = o.back || null;
  state.meeting.open = state.meeting.open || {};
  state.meeting.shots = (m && m.photos ? m.photos.slice() : []);
  const mine = !m || m.leaderUid===uid();
  $("meeting-title").textContent = m?fmtDate(m.date)+" 모임":"새 모임";
  $("m-cell").innerHTML = cells.map(c=>
    `<option value="${c.id}"${state.meeting.cellId===c.id?" selected":""}>${esc(c.name)}</option>`).join("")
    || `<option value="">셀 없음</option>`;
  $("m-date").value=state.meeting.date;
  $("m-time").value=state.meeting.time||"";
  $("m-time-end").value=state.meeting.timeEnd||"";
  $("m-place").value=state.meeting.place||"";
  $("m-topic").value=state.meeting.topic||"";
  $("m-note").value=state.meeting.note||"";
  $("m-visitor").value=state.meeting.visitors||"";
  ["m-date","m-time","m-time-end","m-place","m-topic","m-note","m-visitor","m-cell"]
    .forEach(i=>$(i).disabled=!mine);
  $("btn-meeting-save").hidden=!mine;
  $("btn-all-present").hidden=!mine; $("btn-all-open").hidden=!mine;
  $("btn-order-meet").hidden=!mine;
  $("meeting-del").hidden=!(mine&&m);
  $("m-shots").hidden = !mine && !state.meeting.shots.length;
  renderMeetShots(mine);
  autoGrow($("m-note")); renderAttendance(mine); show("s-meeting");
  /* 저장된 모임이면 댓글 — 이 모임을 볼 수 있는 사람(셀리더 · 담당 코치 · 진장)이 같이 봅니다 */
  $("btn-m-cmt").hidden = !m;
  $("btn-m-cmt").textContent = "댓글";
  if (m) loadComments(meetTarget(m)).then(rows => {
    if (state.meeting && state.meeting.id === m.id)
      $("btn-m-cmt").textContent = rows.length ? `댓글 ${rows.length}개` : "댓글 남기기";
  }).catch(()=>{});
}
$("m-cell").onchange=()=>{ state.meeting.cellId=$("m-cell").value; renderAttendance(true); };
$("btn-all-present").onclick=()=>{
  const lk = state.meeting.leaderUid || uid();
  if (!state.meeting.attendance[lk]) state.meeting.attendance[lk] = "present";
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
  /* 셀리더 본인도 출석 명단에 — 영혼 카드가 아니라 계정 ID로 적습니다 */
  const lk = mt.leaderUid || uid();
  const lm = lk === uid() ? state.me : (state.members||[]).find(x=>x.id===lk);
  const lname = (lm && lm.name) || "셀리더";
  const lv = mt.attendance[lk] || "";
  const n=Object.values(mt.attendance).filter(v=>v&&v!=="absent").length;
  const head = `<p class="muted" style="font-size:12px;grid-column:1/-1">셀리더 포함 ${roster.length+1}명 중 ${n}명 출석</p>`;
  const leadRow = `<div class="member lead">
      <div class="top">
        ${lk===uid() ? meAvatar(34) : `<span class="ava" style="width:34px;height:34px;font-size:13px">${esc(initial(lname))}</span>`}
        <div class="grow" style="flex-grow:1;min-width:0">
          <p class="nm">${esc(lname)} <span class="chip rose" style="font-size:10px;padding:1px 7px">셀리더${lk===uid()?" · 나":""}</span></p>
          ${lk===uid()?`<p class="sub" style="margin-top:2px">내 근황은 '내 카드'에 적어요</p>`:""}
        </div>
        <div class="att">${["present","online","absent"].map(k=>
          `<button data-att="${lk}" data-v="${k}" class="${lv===k?"on":""}" ${mine?"":"disabled"}>${ATT[k].slice(0,2)}</button>`).join("")}</div>
      </div>
    </div>`;
  $("list-att").innerHTML = head + leadRow + roster.map(s=>{
    const v=mt.attendance[s.id]||"", nt=mt.notes[s.id]||{}, open=!!mt.open[s.id];
    const has=(nt.update||nt.pray);
    return `<div class="member">
      <div class="top">
        ${avatar(s, 34)}
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
  }).join("") + (roster.length ? "" : `<p class="muted" style="grid-column:1/-1">이 셀에 등록된 영혼이 없어요. 영혼 카드를 만들 때 이 셀을 골라주세요.</p>`);
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
    date:$("m-date").value||todayStr(),
    time:$("m-time").value||"", timeEnd:$("m-time-end").value||"",
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
            ...(type==="meet"?{kind:"cell",update:txt,place:data.place||"",
                               time:data.time||"",timeEnd:data.timeEnd||""}:{}),
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
    const photos = await putMeetShots(mid, cellId);
    await updateDoc(doc(db,"meetings",mid), { ...data, recRefs:refs, photos });
    await loadMeetings(); invalidate(); toast("저장했어요."); bump("meetingSave");
    if (mt.back === "cal") openCal(); else openMeet();
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
    timeEnd:$("m-time-end").value||"", title:`${c?c.name:"셀"} 셀모임`,
    sub:$("m-topic").value.trim(), place:$("m-place").value.trim() }),"_blank");
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
  $("btn-go-usage").hidden = me.role!=="super";
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
    "교회등록일","침례일","결혼기념일","직분","인도자","인생말씀","취미","MBTI","좋아하는것",
    "피해야할것","관심사","연락주기(일)","마지막만남","기도중","메모"];
  const rows=state.souls.map(s=>[s.name,STATUS[s.status]||"",cellNm(s.cellId),fmtDate(s.birth,true),
    s.lunar?"음력":"",s.phone,s.address,s.address2,s.job,s.gender,
    fmtDate(s.registeredAt,true),fmtDate(s.baptizedAt,true),fmtDate(s.marriedAt,true),
    s.position,s.invitedBy,s.verse,s.hobby,s.mbti,s.food,s.avoid,s.interest,
    s.contactCycle||"",s.lastMetAt||"",s.prayOpen||0,s.memo]);
  bump("exportCsv"); await log("명단 내려받기", `${rows.length}명`);
  download(`목자의삶_영혼명단_${todayStr()}.csv`,[csvRow(head),...rows.map(csvRow)].join("\r\n"));
  toast(`${rows.length}명을 내려받았어요.`);
};
$("btn-export-recs").onclick=async()=>{
  toast("기록을 모으는 중이에요…");
  await loadOrg(); await loadSouls();
  const all=await loadAllRecords();
  const head=["이름","종류","만남유형","날짜","시간","장소","내용","무엇을했나","나눈이야기",
    "만나기전마음","주신말씀","만나면서받은마음","근황","영적상태","공개범위"];
  const rows=all.map(r=>[r.soulName,RTYPE[r.type]||r.type,r.kind?meetLabel(r):"",
    r.date,r.time||"",r.place||"",r.body||"",r.did||"",r.talked||"",r.beforeHeart||"",
    r.beforeWord||"",r.duringHeart||"",r.update||"",r.spiritual||"",SCOPE[r.scope]||r.scope]);
  bump("exportCsv"); await log("기록 내려받기", `${rows.length}건`);
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
        fetchRecords(s.id, isLeaderOf(s)),
        getDocs(collection(db,"souls",s.id,"trainings"))
      ]);
      souls.push({ ...s, records:recs, trainings:pack(trains) });
    }
    const backup={ 앱:APP_NAME, 버전:APP_VERSION, 만든날짜:todayStr(),
      만든사람:{이름:state.me.name,이메일:state.me.email,역할:ROLE[state.me.role]},
      진:state.jins, 셀:state.cells, 훈련과정:state.courses, 영혼:souls, 셀모임:state.meetings };
    await log("전체 백업 내려받기", `영혼 ${souls.length}명`);
    download(`목자의삶_전체백업_${todayStr()}.json`,JSON.stringify(backup,null,2),"application/json");
    toast("백업 파일을 내려받았어요.");
  }catch(e){ toast(msgOf(e)); }
};

/* ════════ 리더 관리 ════════ */
async function openManage() {
  show("s-loading");
  await loadOrg(true);
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
  $("list-mtypes").innerHTML =
    BASE_KINDS.map(k=>`<div class="row"><div class="grow"><p class="nm">${esc(k.name)}</p>
      <p class="sub">기본 — 지울 수 없어요${k.solo?" · 한 명":" · 여러 명"}</p></div></div>`).join("")
    + state.meetTypes.filter(t=>!t.ownerUid).map(t=>`<div class="row"><div class="grow"><p class="nm">${esc(t.name)}</p>
        <p class="sub">직접 만든 종류 · 여러 명</p></div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn-sm" data-act="tedit" data-tid="${t.id}">수정</button>
          <button class="btn-sm danger" data-act="thide" data-tid="${t.id}">숨기기</button>
        </div></div>`).join("");
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
  if(act==="tedit") openMtypeDlg(el.dataset.tid);
  if(act==="thide"){
    if(!confirm("이 모임 종류를 목록에서 숨길까요? 이미 적은 기록은 그대로 남아요.")) return;
    try{ await updateDoc(doc(db,"meetTypes",el.dataset.tid),{active:false});
      await log("모임 종류 숨김",el.dataset.tid); await loadOrg(true); openManage(); }
    catch(e){ toast(msgOf(e)); }
  }
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
    await log("셀 추가",name.trim()); await loadOrg(true); toast("셀을 만들었어요.");
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

/* ════════ 사용 현황 ════════
   화면을 누를 때마다 한 줄씩 쌓으면 쓰기 횟수가 금세 한도에 닿습니다.
   그래서 메모리에 모았다가 30초마다, 그리고 화면을 덮을 때 한 번만 올립니다.
   사람 한 명의 하루치가 칸 하나입니다. 접속 위치는 모으지 않아요. */
const usage = { screens:{}, acts:{}, opens:0, dirty:false };
const mergeCount = (a,b) => {
  const o = { ...(a||{}) };
  Object.entries(b||{}).forEach(([k,v]) => { o[k] = (o[k]||0) + v; });
  return o;
};
function deviceKind() {
  const w = Math.min(screen.width, screen.height);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const kind = w < 500 ? "폰" : w < 1100 ? "패드" : "컴퓨터";
  return standalone ? kind + " (앱)" : kind;
}
function bump(what, kind) {
  if (!state.me) return;
  if (kind === "screen") usage.screens[what] = (usage.screens[what]||0) + 1;
  else usage.acts[what] = (usage.acts[what]||0) + 1;
  usage.dirty = true;
}
async function flushUsage() {
  if (!usage.dirty || !state.me || !uid()) return;
  const payload = { screens:{...usage.screens}, acts:{...usage.acts}, opens:usage.opens };
  usage.screens = {}; usage.acts = {}; usage.opens = 0; usage.dirty = false;
  try {
    const ref = doc(db, "usage", `${uid()}_${todayStr()}`);
    const snap = await getDoc(ref);
    const old = snap.exists() ? snap.data() : null;
    await setDoc(ref, {
      uid: uid(), name: state.me.name || "", role: state.me.role,
      jinId: state.me.jinId || null, date: todayStr(),
      opens: ((old && old.opens) || 0) + payload.opens,
      screens: mergeCount(old && old.screens, payload.screens),
      acts: mergeCount(old && old.acts, payload.acts),
      hours: mergeCount(old && old.hours, { [String(new Date().getHours())]: 1 }),
      device: deviceKind(), lastAt: serverTimestamp()
    }, { merge: true });
  } catch {
    /* 못 올려도 앱은 그대로 굴러가야 합니다 — 다음 번에 다시 모읍니다 */
    usage.screens = mergeCount(usage.screens, payload.screens);
    usage.acts = mergeCount(usage.acts, payload.acts);
    usage.opens += payload.opens; usage.dirty = true;
  }
}
setInterval(flushUsage, 30000);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushUsage(); });
window.addEventListener("pagehide", flushUsage);

/* ── 수퍼 관리자용 화면 ── */
const SCREEN_NAME = { home:"홈", souls:"영혼들", cal:"캘린더", meet:"셀모임", more:"더보기",
  soul:"영혼 카드", log:"만남 기록", meeting:"셀모임 입력", train:"훈련 현황",
  search:"기록 검색", manage:"리더 관리", usage:"사용 현황", edit:"영혼 수정" };
const ACT_NAME = { recordCreate:"기록 남김", planCreate:"만남 예약", meetingSave:"셀모임 저장",
  soulCreate:"영혼 추가", trainSave:"훈련 기록", exportCsv:"내려받기" };

async function openUsage() {
  if (state.me.role !== "super") { toast("수퍼 관리자만 볼 수 있어요."); return; }
  show("s-loading");
  await flushUsage();
  await loadOrg();
  let rows = [], audit = [];
  try {
    const since = plusDays(-30);
    const [u, a] = await Promise.all([
      getDocs(query(collection(db, "usage"), where("date", ">=", since))),
      getDocs(collection(db, "audit"))
    ]);
    rows = pack(u);
    audit = pack(a).sort((x, y) => (y.at && y.at.seconds || 0) - (x.at && x.at.seconds || 0)).slice(0, 100);
  } catch (e) { toast(msgOf(e)); }

  const days = {}, people = {}, screens = {};
  rows.forEach(r => {
    (days[r.date] = days[r.date] || new Set()).add(r.uid);
    const p = people[r.uid] = people[r.uid] || { name: r.name, role: r.role, opens: 0, acts: 0, last: "", device: r.device };
    p.opens += r.opens || 0;
    p.acts += Object.values(r.acts || {}).reduce((n, v) => n + v, 0);
    if (r.date > p.last) { p.last = r.date; p.device = r.device; }
    Object.entries(r.screens || {}).forEach(([k, v]) => { screens[k] = (screens[k] || 0) + v; });
  });
  const dayList = Object.keys(days).sort();
  const peopleList = Object.entries(people)
    .map(([k, v]) => ({ uid: k, ...v, quiet: daysSince(v.last) }))
    .sort((a, b) => (b.quiet ?? 0) - (a.quiet ?? 0));
  const activeN = peopleList.filter(p => (p.quiet ?? 99) <= 7).length;

  $("usage-tiles").innerHTML = tile("구성원", state.members.length + "명")
    + tile("이번 주 접속", activeN + "명")
    + tile("30일 기록", peopleList.reduce((n, p) => n + p.acts, 0) + "건");

  /* 날짜별 접속자 수 — 한 가지만 재므로 색도 하나입니다 */
  if (dayList.length >= 2) {
    const last = dayList.slice(-30);
    const peak = Math.max(...last.map(d => days[d].size), 1);
    const keep = new Set([0, Math.floor((last.length - 1) / 2), last.length - 1]);
    $("usage-chart").innerHTML = `
      <div class="card" style="margin-top:14px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
          <h3 style="font-size:13px;font-weight:600">날마다 몇 명이 썼나</h3>
          <span class="muted" style="font-size:12px">최근 ${last.length}일 · 최대 ${peak}명</span>
        </div>
        <div class="chart"><div class="plot">
          ${last.map((d, i) => {
            const n = days[d].size;
            return `<div class="bar${n === 0 ? " zero" : ""}" title="${fmtDate(d)} · ${n}명">
              ${i === last.length - 1 ? `<span class="val">${n}명</span>` : ""}
              <i style="height:${Math.round(n / peak * 100)}%"></i></div>`;
          }).join("")}
        </div>
        <div class="xaxis">${last.map((d, i) => {
          const p = d.split("-");
          return `<span>${keep.has(i) ? `${Number(p[1])}/${Number(p[2])}` : ""}</span>`;
        }).join("")}</div></div>
      </div>`;
  } else {
    $("usage-chart").innerHTML = `<p class="muted" style="margin-top:14px">이틀 이상 쌓이면 그래프가 생겨요.</p>`;
  }

  $("usage-people").innerHTML = peopleList.map(p => {
    const q = p.quiet;
    const quiet = q === null ? "" : q === 0 ? "오늘 접속" : q === 1 ? "어제 접속" : `${q}일째 안 들어옴`;
    return `<div class="row ${q !== null && q > 30 ? "off" : ""}">
      <span class="ava">${esc(initial(p.name))}</span>
      <div class="grow"><p class="nm">${esc(p.name || "—")}</p>
        <p class="sub">${esc(ROLE[p.role] || "")} · ${esc(p.device || "")} · 기록 ${p.acts}건</p></div>
      <span class="chip ${q !== null && q >= 14 ? "warn" : ""}">${quiet}</span>
    </div>`;
  }).join("") || `<p class="muted">아직 쌓인 게 없어요. 하루이틀 쓰시면 보여요.</p>`;

  const total = Object.values(screens).reduce((n, v) => n + v, 0);
  const sorted = Object.entries(screens).sort((a, b) => b[1] - a[1]);
  $("usage-screens").innerHTML = total ? `<div class="hbars">${sorted.map(([k, v]) => `
    <div class="hb"><span class="who">${esc(SCREEN_NAME[k] || k)}</span>
      <span class="track"><i style="width:${Math.round(v / sorted[0][1] * 100)}%"></i></span>
      <span class="pct">${Math.round(v / total * 100)}%</span></div>`).join("")}</div>`
    : `<p class="muted">아직 쌓인 게 없어요.</p>`;

  $("usage-audit").innerHTML = audit.map(a => `
    <div class="row"><div class="grow">
      <p class="nm">${esc(a.action)}${a.detail ? " · " + esc(a.detail) : ""}</p>
      <p class="sub">${esc(a.byName || "")} · ${a.at && a.at.seconds
        ? new Date(a.at.seconds * 1000).toLocaleString("ko-KR") : "—"}</p>
    </div></div>`).join("") || `<p class="muted">중요 기록이 아직 없어요.</p>`;

  show("s-usage");
}
$("usage-back").onclick = () => openMore();
$("btn-go-usage").onclick = () => openUsage();

/* ════════ 내 기록 ════════
   영혼 카드와 완전히 다른 것입니다.
   영혼 카드 = 내가 맡은 사람에 대해 내가 적는 것
   내 기록   = 나 자신에 대해 내가 적는 것
   기본은 나만 봅니다. 줄마다 진장에게 열어줄 수 있어요. */
const MYSCOPE = { private:"나만 보기", upline:"진장에게 보임" };
const MYKIND  = { heart:"받은 마음", pray:"기도제목", meet:"만남 · 일지" };
const myCol = () => collection(db, "myNotes", uid(), "notes");

async function openMine() {
  show("s-loading");
  if (canLead()) { await loadMeetings(); await loadAllRecords(); await loadSelfCard(); }
  try { state.myNotes = pack(await getDocs(myCol()))
    .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))); }
  catch (e) { state.myNotes = []; toast(msgOf(e)); }
  state.mineFilter = state.mineFilter || "all";
  renderMine(); show("s-mine");
}
$("mine-back").onclick = () => openMore();
function renderMine() {
  const cell = state.cells.find(c=>c.id===state.me.cellId);
  if (canLead()) {
    const a3 = myActivity(statsFrom("3")), all = myActivity(statsFrom("all"));
    $("mine-sum").innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        ${meAvatar(48)}
        <div><p style="font-size:17px;font-weight:600">${esc(state.me.name||"나")}</p>
          <p class="muted" style="font-size:12px">셀리더${cell?` · ${esc(cell.name)}`:""}</p></div>
      </div>
      <div class="tiles">
        ${tile("셀모임 출석 · 3개월", a3.marked ? `${a3.came}/${a3.marked}` : "—")}
        ${tile("함께한 모임 · 3개월", a3.met+"번")}
        ${tile("1:1 · 3개월", a3.one+"번")}
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">지금까지 셀모임 출석 ${all.marked?`${all.came}/${all.marked}`:"기록 전"}
        · 함께한 모임 ${all.met}번 — 셀모임 출석 체크의 '나' 줄과 내가 함께한 만남 기록에서 셉니다.</p>`;
  } else $("mine-sum").innerHTML = "";
  renderMineProfile();
  const f = [["all","전체"],["heart","받은 마음"],["pray","기도제목"],["meet","만남 · 일지"]];
  $("mine-filter").innerHTML = f.map(([k,l])=>
    `<button data-mf="${k}" class="${state.mineFilter===k?"on":""}">${l}</button>`).join("");
  const list = state.mineFilter === "all"
    ? state.myNotes : state.myNotes.filter(n=>n.kind===state.mineFilter);
  const shared = state.myNotes.filter(n=>n.scope==="upline").length;
  $("mine-count").textContent = `${list.length}건`
    + (shared ? ` · 그중 ${shared}건을 진장에게 열어뒀어요` : "");
  $("mine-list").innerHTML = list.map(n=>`
    <article class="rec">
      <div class="head">
        <span style="font-size:12px;color:var(--dim)">${MYKIND[n.kind]||""} · ${fmtDate(n.date)}</span>
        <span class="chip ${n.scope==="upline"?"rose":"lock"}">${MYSCOPE[n.scope]||""}</span>
      </div>
      <p class="body${n.kind==="heart"?" serif":""}">${esc(n.body)}</p>
      <div class="foot">
        <button class="btn-sm" data-editmine="${n.id}">수정</button>
        <button class="btn-sm danger" data-delmine="${n.id}">삭제</button>
      </div>
    </article>`).join("")
    || `<p class="muted">아직 없어요. 아래 '기록 남기기'로 시작해요.<br>
        기도제목이든, 요즘 마음이든, 누구를 만났는지든 괜찮습니다.</p>`;
}
$("mine-filter").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-mf]"); if(!b) return;
  state.mineFilter = b.dataset.mf; renderMine();
});

const dlgMine = $("dlg-mine");
let editingMineId = null, mineKind = "heart";
function openMineDlg(noteId) {
  editingMineId = noteId || null;
  const n = noteId ? state.myNotes.find(x=>x.id===noteId) : null;
  $("mine-title").textContent = n ? "내 기록 수정" : "내 기록";
  mineKind = n ? n.kind : "heart";
  syncMineKind();
  $("mn-date").value = n ? n.date : todayStr();
  $("mn-body").value = n ? n.body : "";
  $("mn-scope").value = n ? n.scope : "private";
  $("mine-err").textContent = "";
  dlgMine.showModal(); autoGrow($("mn-body"));
}
$("mn-kind").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-mk]"); if(!b) return;
  mineKind = b.dataset.mk; syncMineKind();
});
function syncMineKind() {
  $("mn-kind").querySelectorAll("[data-mk]").forEach(b=>b.classList.toggle("on", b.dataset.mk===mineKind));
  $("mn-body-label").textContent = MYKIND[mineKind] || "내용";
  $("mn-body").placeholder = mineKind === "pray" ? "무엇을 위해 기도하고 있나요"
    : mineKind === "meet" ? "누구를 만나 무엇을 나눴나요"
    : "오늘 내 마음에 있는 것, 기도 중에 받은 것";
}
$("btn-mine-new").onclick = () => openMineDlg(null);
$("mn-cancel").onclick = () => dlgMine.close();
$("mn-save").onclick = async () => {
  const body = $("mn-body").value.trim();
  if (!body) { $("mine-err").textContent = "내용을 적어주세요."; return; }
  $("mn-save").disabled = true;
  try {
    const data = { kind:mineKind, date:$("mn-date").value||todayStr(), body,
      scope:$("mn-scope").value, by:uid() };
    if (editingMineId) await updateDoc(doc(db,"myNotes",uid(),"notes",editingMineId), data);
    else await addDoc(myCol(), { ...data, createdAt: serverTimestamp() });
    dlgMine.close(); bump("myNote"); toast("저장했어요."); openMine();
  } catch (e) { $("mine-err").textContent = msgOf(e); }
  finally { $("mn-save").disabled = false; }
};
$("mine-list").addEventListener("click", async (ev) => {
  const e = ev.target.closest("[data-editmine]");
  if (e) { openMineDlg(e.dataset.editmine); return; }
  const d = ev.target.closest("[data-delmine]");
  if (d) {
    if (!confirm("이 기록을 지울까요? 되돌릴 수 없어요.")) return;
    try { await deleteDoc(doc(db,"myNotes",uid(),"notes",d.dataset.delmine));
      toast("지웠어요."); openMine(); }
    catch (e2) { toast(msgOf(e2)); }
  }
});
$("btn-go-mine").onclick = () => openMine();

/* 진장이 셀리더·코치 카드를 볼 때, 그 사람이 열어둔 '내 기록'을 같이 보여줍니다 */
async function loadShared(linkedUid) {
  if (!linkedUid || state.me.role !== "jinjang") return [];
  try {
    return pack(await getDocs(query(collection(db,"myNotes",linkedUid,"notes"),
      where("scope","==","upline"))))
      .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  } catch { return []; }
}

/* ════════ 카드 인계 ════════
   넘길 때마다 어디까지 넘길지 고릅니다. 사람마다 사정이 다르니까요.
   '나만 보기'는 어느 쪽을 골라도 안 넘어갑니다. */
const HAND = [
  { id:"all",     name:"전부 넘기기",
    sub:"인적사항 · 가족 · 훈련 · 기도제목 · 지난 만남 기록까지 모두" },
  { id:"summary", name:"요약만 넘기기",
    sub:"인적사항 · 가족 · 훈련 · 지금 기도 중인 것까지. 지난 만남 기록은 안 넘어가요" },
  { id:"fresh",   name:"지금부터",
    sub:"이름 · 연락처 · 셀만. 새 리더가 처음부터 관계를 맺어요" }
];
/* 카드 넘기기의 실제 일 — '다른 리더에게 넘기기'와 '셀리더로 세우기'가 같이 씁니다 */
async function doHandover(soulId, toUid, pick) {
    /* 안 넘길 기록은 '나만 보기'로 바꿔둡니다. 그러면 적은 사람만 계속 보고
       새 담당자는 못 봅니다. 지우는 게 아니라서 원래 리더는 그대로 갖고 있어요. */
    if (pick !== "all") {
      /* 규칙이 '내가 쓴 것'을 보장할 수 있게 질의에도 by 를 겁니다
         (조건 없이 다 읽으려 하면 서버가 질의를 통째로 거절해요) */
      const recs = pack(await getDocs(query(collection(db,"souls",soulId,"records"),
        where("by","==",uid()))));
      const hide = recs.filter(r => {
        if (r.scope === "private") return false;          // 이미 나만 보기
        if (r.by !== uid()) return false;                 // 내가 쓴 것만 바꿀 수 있음
        if (pick === "fresh") return true;            // 지금부터 → 전부 숨김
        if (r.type === "meet") return true;               // 요약만 → 지난 만남은 숨김
        if (r.type === "heart") return true;              // 받은 마음도 숨김
        if (r.type === "pray" && r.prayStatus === "answered") return true;
        return false;                                     // 기도 중인 것은 넘김
      });
      for (const r of hide) {
        await updateDoc(doc(db,"souls",soulId,"records",r.id), { scope:"private" });
      }
      /* 사진도 같이 가립니다 */
      try {
        const shots = pack(await getDocs(query(collection(db,"recordPhotos"),
          where("soulId","==",soulId), where("by","==",uid()))));
        const ids = new Set(hide.map(r=>r.id));
        for (const p of shots.filter(p=>ids.has(p.recordId) && p.by===uid())) {
          await updateDoc(doc(db,"recordPhotos",p.id), { scope:"private" });
        }
      } catch {}
      if (pick === "fresh") {
        await updateDoc(doc(db,"souls",soulId), { todos:[], prayOpen:0, prayTop:null });
      }
    }
    await updateDoc(doc(db,"souls",soulId), { leaderUid: toUid });
}
const dlgHand = $("dlg-hand");
let handSoulId = null, handPick = "summary";
function openHandDlg(soulId) {
  const s = state.souls.find(x=>x.id===soulId); if (!s) return;
  handSoulId = soulId; handPick = "summary";
  $("hand-sub").textContent = `${s.name} 카드를 다른 리더에게 넘깁니다.`;
  /* 본인에게는 넘길 수 없습니다 — 자기 목양 기록을 자기가 보게 되니까요 */
  const to = state.members.filter(m =>
    m.id !== state.me.id && m.active !== false && m.id !== (s.linkedUid || "")
    && (m.role === "leader" || m.isLeader === true || m.role === "jinjang"));
  $("hd-to").innerHTML = to.map(m=>
    `<option value="${m.id}">${esc(m.name)} · ${ROLE[m.role]||m.role}</option>`).join("")
    || `<option value="">넘길 수 있는 리더가 없어요</option>`;
  renderHand();
  $("hand-err").textContent = "";
  dlgHand.showModal();
}
function renderHand() {
  $("hd-scope").innerHTML = HAND.map(h=>`
    <div class="row" data-hand="${h.id}" style="cursor:pointer;${
      handPick===h.id?"border-color:var(--brand)":""}">
      <span style="width:18px;height:18px;border-radius:999px;flex-shrink:0;border:2px solid ${
        handPick===h.id?"var(--brand)":"var(--line)"};background:${
        handPick===h.id?"var(--brand)":"transparent"}"></span>
      <div class="grow"><p class="nm">${h.name}</p>
        <p class="sub" style="white-space:normal">${h.sub}</p></div>
    </div>`).join("");
}
$("hd-scope").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-hand]"); if(!b) return;
  handPick = b.dataset.hand; renderHand();
});
$("hd-cancel").onclick = () => dlgHand.close();
$("hd-go").onclick = async () => {
  const toUid = $("hd-to").value;
  const s = state.souls.find(x=>x.id===handSoulId);
  if (!toUid || !s) { $("hand-err").textContent = "넘길 리더를 골라주세요."; return; }
  if (toUid === (s.linkedUid||"")) {
    $("hand-err").textContent = "본인에게는 넘길 수 없어요."; return; }
  const name = (state.members.find(m=>m.id===toUid)||{}).name || "";
  if (!confirm(`${s.name} 카드를 ${name} 님에게 넘길까요?\n되돌릴 수 없어요.`)) return;
  $("hd-go").disabled = true;
  try {
    await doHandover(handSoulId, toUid, handPick);

    await log("카드 인계", s.name, `${name}에게 · ${(HAND.find(h=>h.id===handPick)||{}).name}`);
    bump("handover");
    dlgHand.close(); invalidate(); await loadSouls(true);
    toast(`${name} 님에게 넘겼어요.`); openSouls();
  } catch (e) { $("hand-err").textContent = msgOf(e); }
  finally { $("hd-go").disabled = false; }
};

/* ── 셀모임 사진 ──
   소그룹과 같은 방식입니다. 작은 사본은 모임에 붙이고,
   큰 사진은 따로 두어 눌렀을 때만 불러옵니다.
   다만 여럿이 같이 찍힌 사진이라 한 사람 카드가 아니라 '모임'에 붙입니다. */
function renderMeetShots(mine) {
  const shots = state.meeting.shots || [];
  $("m-shots").innerHTML = shots.map((p,i)=>`
    <div class="sh" style="background-image:url(${p.thumb})" data-mshot="${i}" role="button"
      aria-label="사진 ${i+1} 크게 보기">
      ${mine?`<button type="button" data-rmmshot="${i}" aria-label="사진 ${i+1} 빼기">×</button>`:""}
    </div>`).join("")
    + (mine && shots.length < MAX_SHOTS
      ? `<button type="button" class="add" id="btn-add-mshot">＋ 사진<br>${shots.length}/${MAX_SHOTS}</button>`
      : "");
  const a = $("btn-add-mshot"); if (a) a.onclick = () => $("m-photo-input").click();
}
$("m-shots").addEventListener("click", (ev) => {
  const rm = ev.target.closest("[data-rmmshot]");
  if (rm) { ev.stopPropagation();
    state.meeting.shots.splice(Number(rm.dataset.rmmshot), 1); renderMeetShots(true); return; }
  const open = ev.target.closest("[data-mshot]");
  if (open) { const p = state.meeting.shots[Number(open.dataset.mshot)];
    if (p) showMeetPhoto(p); }
});
$("m-photo-input").onchange = async (ev) => {
  const files = [...(ev.target.files||[])]; ev.target.value = "";
  const room = MAX_SHOTS - state.meeting.shots.length;
  if (!files.length) return;
  if (files.length > room) toast(`${MAX_SHOTS}장까지만 넣을 수 있어요. 앞의 ${room}장만 넣을게요.`);
  toast("사진을 줄이는 중이에요…");
  for (const f of files.slice(0, room)) {
    try {
      const [big, small] = await Promise.all([
        shrinkFit(f, PHOTO.shot, 900000),
        shrinkFit(f, PHOTO.shotTh, 14000)
      ]);
      state.meeting.shots.push({ thumb: small, full: big, id: null });
      renderMeetShots(true);
    } catch (e) { toast(e.message || "사진 하나를 넣지 못했어요."); }
  }
};
async function putMeetShots(meetingId, cellId) {
  const out = [];
  for (const p of (state.meeting.shots || [])) {
    if (p.id) { out.push({ id:p.id, thumb:p.thumb }); continue; }
    const ref = await addDoc(collection(db,"meetingPhotos"), {
      meetingId, cellId, jinId: state.me.jinId, leaderUid: state.me.id,
      data: p.full, by: uid(), createdAt: serverTimestamp()
    });
    out.push({ id: ref.id, thumb: p.thumb });
  }
  return out;
}
async function showMeetPhoto(p) {
  let src = p.full;
  if (!src && p.id) {
    try { const d = await getDoc(doc(db,"meetingPhotos",p.id));
      src = d.exists() ? d.data().data : null; }
    catch (e) { toast(msgOf(e)); }
  }
  $("pv-img").src = src || p.thumb;
  $("photo-view").showModal();
}

/* ── 흐름 한 줄 ──
   카드 하나씩 띄우면 한 화면에 서너 건밖에 안 들어갑니다.
   왼쪽 날짜 · 오른쪽 내용으로 빽빽하게 두면 열두어 줄이 들어가서
   '어떻게 변해왔나'가 한눈에 읽힙니다. */
function flowRow(r, kw) {
  const cell = r.kind === "cell";
  const done = r.type === "pray" && r.prayStatus === "answered";
  const text = r.type === "pray" ? r.body : (r.update || r.body || "");
  const p = String(r.date || "").split("-");
  const when = p.length >= 3 && p[1] !== "00"
    ? (p[0] === String(new Date().getFullYear()) || p[0] === "0000"
        ? `${Number(p[1])}월 ${Number(p[2])}일`
        : `${p[0].slice(2)}. ${Number(p[1])}.${Number(p[2])}`)
    : fmtDate(r.date);
  const days = r.type === "pray" && !done ? (daysSince(r.date) || 0) + 1 : null;
  return `<div class="fr${cell?" cell":""}${done?" ok done":""}">
    <span class="fd">${esc(when)}</span>
    <span>
      <span class="ft">${hl(text, kw)}</span>
      <span class="fm">${[
        cell ? "셀모임" : (r.type === "meet" ? meetLabel(r) : ""),
        done ? "응답됨" : (days !== null ? `${days}일째` : ""),
        r.by !== uid() && r.byName ? esc(r.byName) : ""
      ].filter(Boolean).join(" · ")}</span>
    </span>
  </div>`;
}

/* ── 오늘 같이 기도할 제목 한 장 ──
   셀모임 끝날 때 다 같이 기도하는데, 지금은 제목이 사람별 카드에
   흩어져 있어서 모으려면 카드를 여러 번 열어야 합니다. 한 장에 모읍니다. */
$("btn-pray-sheet").onclick = async () => {
  const cellId = $("m-cell").value || state.meeting.cellId;
  const roster = state.souls.filter(s => s.cellId === cellId && !isLeaderCard(s));
  if (!roster.length) { toast("이 셀에 등록된 영혼이 없어요."); return; }
  toast("기도제목을 모으는 중이에요…");
  const all = await loadAllRecords();
  const open = all.filter(r => r.type === "pray" && r.prayStatus !== "answered");
  const rows = roster.map(s => ({
    s, items: open.filter(r => r.soulId === s.id)
      .sort((a,b)=>String(a.date).localeCompare(String(b.date)))
  }));
  const withAny = rows.filter(r => r.items.length);
  const cellNm = (state.cells.find(c=>c.id===cellId)||{}).name || "셀";

  $("pray-sheet-title").textContent = `${cellNm} 기도제목`;
  $("pray-sheet-sub").textContent = withAny.length
    ? `${withAny.length}명 · ${open.filter(r=>roster.some(s=>s.id===r.soulId)).length}개`
    : "아직 적어둔 기도제목이 없어요.";
  $("pray-sheet-body").innerHTML = withAny.map(({s, items}) => `
    <div class="row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:10px">
        ${avatar(s, 30)}<p class="nm">${esc(s.name)}</p>
      </div>
      <div class="flow" style="margin-top:8px">${items.map(r=>`
        <div class="fr">
          <span class="fd">${(daysSince(r.date)||0)+1}일째</span>
          <span><span class="ft">${esc(r.body)}</span></span>
        </div>`).join("")}</div>
    </div>`).join("")
    || `<p class="muted">영혼 카드에서 기도제목을 적으시거나, 셀모임에서 이름 옆 ▾ 를
        눌러 적으시면 여기에 모여요.</p>`;

  /* 복사해서 단톡방에 올릴 수 있게 */
  state.praySheetText = [`[${cellNm}] 기도제목 · ${fmtDate(todayStr(), true)}`, ""]
    .concat(withAny.map(({s, items}) =>
      `${s.name}\n` + items.map(r => `  - ${r.body}`).join("\n"))).join("\n");
  $("dlg-pray-sheet").showModal();
};
$("ps-close").onclick = () => $("dlg-pray-sheet").close();
$("ps-copy").onclick = async () => {
  try { await navigator.clipboard.writeText(state.praySheetText || ""); toast("복사했어요."); }
  catch { toast("복사가 안 되면 화면을 길게 눌러 복사해 주세요."); }
};

/* ════════ 모임 종류 설정 ════════
   기록할 때 뜨는 종류를 사람마다 고릅니다 — 순서와 숨기기.
   교회 공통 종류의 이름은 수퍼·진장이, 내가 만든 종류는 내가 고칩니다. */
const dlgKinds = $("dlg-kinds");
let kindsAfter = null;
function openKindsDlg(after) {
  kindsAfter = after || null; $("kinds-err").textContent = "";
  renderKinds(); dlgKinds.showModal();
}
function renderKinds() {
  const list = kindList(), hid = kindPrefs().hidden || [];
  $("kinds-list").innerHTML = list.map((k,i)=>{
    const base = BASE_KINDS.some(b=>b.id===k.id);
    const t = state.meetTypes.find(x=>x.id===k.id);
    const canEdit = !!t && ((t.ownerUid && t.ownerUid===uid()) || (!t.ownerUid && sharesTypes()));
    const off = hid.includes(k.id);
    return `<div class="row">
      <div class="grow${off?" off":""}"><p class="nm">${esc(k.name)}</p>
        <p class="sub">${base?"기본":t&&t.ownerUid?"나만 쓰는 종류":"교회 공통"}${off?" · 숨김":""}</p></div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn-sm" data-kmv="${k.id}|-1" aria-label="${esc(k.name)} 위로" style="width:36px;padding:0"${i===0?" disabled":""}>↑</button>
        <button class="btn-sm" data-kmv="${k.id}|1" aria-label="${esc(k.name)} 아래로" style="width:36px;padding:0"${i===list.length-1?" disabled":""}>↓</button>
        ${canEdit?`<button class="btn-sm" data-kren="${k.id}">이름</button>`:""}
        <button class="btn-sm" data-khide="${k.id}">${off?"보이기":"숨기기"}</button>
      </div></div>`;
  }).join("");
}
async function saveKindPrefs(p) {
  state.me.kindPrefs = p;
  try { await updateDoc(doc(db,"users",state.me.id), { kindPrefs: p }); }
  catch (e) { $("kinds-err").textContent = msgOf(e); }
}
$("kinds-list").addEventListener("click", async (ev) => {
  const mv = ev.target.closest("[data-kmv]");
  if (mv) {
    const [id, d] = mv.dataset.kmv.split("|"), order = kindList().map(k=>k.id);
    const i = order.indexOf(id), j = i + Number(d);
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    renderKinds();  // 바로 바뀐 것처럼 보이게 먼저 그리고
    await saveKindPrefs({ ...kindPrefs(), order }); renderKinds();
    return;
  }
  const hd = ev.target.closest("[data-khide]");
  if (hd) {
    const id = hd.dataset.khide, hid = (kindPrefs().hidden||[]).slice();
    const next = hid.includes(id) ? hid.filter(x=>x!==id) : [...hid, id];
    if (kindList().every(k => next.includes(k.id))) {
      $("kinds-err").textContent = "하나는 남겨둬야 해요."; return; }
    $("kinds-err").textContent = "";
    await saveKindPrefs({ ...kindPrefs(), hidden: next }); renderKinds();
    return;
  }
  const rn = ev.target.closest("[data-kren]");
  if (rn) openMtypeDlg(rn.dataset.kren, () => renderKinds());
});
$("kinds-add").onclick = () => openMtypeDlg(null, () => renderKinds());
$("kinds-close").onclick = () => {
  dlgKinds.close();
  if (kindsAfter) { const f = kindsAfter; kindsAfter = null; f(); }
};
$("btn-go-kinds").onclick = () => openKindsDlg(null);

/* ════════ 사진 모아보기 ════════
   목록에 보이는 작은 사본은 영혼 카드 · 셀모임 · 기록 안에 이미 들어 있어서
   이 화면을 여는 데 따로 읽기가 들지 않습니다. 눌렀을 때만 큰 사진을 읽어요. */
const cellOfSoul = (s) => isLeaderCard(s) ? s.ofCellId : s.cellId;
const MB_SHOT = 0.25, MB_FACE = 0.04, FREE_MB = 1024;
async function openPhotos() {
  show("s-loading"); markSide("photos");
  await loadOrg(); await loadSouls(); await loadMeetings(); await loadAllRecords();
  await backfillThumbs();
  state.phCell = state.phCell || "all"; state.phTab = state.phTab || "all";
  renderPhotos(); show("s-photos");
}
function photoSets(cellId) {
  const inCell = (cid) => cellId === "all" || cid === cellId;
  const faces = state.souls.filter(s => s.thumb && inCell(cellOfSoul(s)));
  const cellShots = state.meetings.filter(m => inCell(m.cellId) && (m.photos||[]).length)
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  /* 여러 명이 함께한 모임은 한 번만 — 같은 사진을 사람 수만큼 보여주지 않게 */
  const seenG = {}, seenP = new Set(), meets = [];
  (state.allRecords||[]).filter(r => r.type==="meet" && (r.photos||[]).length).forEach(r=>{
    const so = state.souls.find(x=>x.id===r.soulId);
    if (!so || !inCell(cellOfSoul(so))) return;
    if (r.groupId && seenG[r.groupId]) { seenG[r.groupId].names.push(r.soulName); return; }
    const photos = r.photos.filter(p => !p.id || !seenP.has(p.id));
    photos.forEach(p => p.id && seenP.add(p.id));
    if (!photos.length) return;
    const g = { r, names:[r.soulName], photos };
    if (r.groupId) seenG[r.groupId] = g;
    meets.push(g);
  });
  meets.sort((a,b)=>String(b.r.date).localeCompare(String(a.r.date)));
  const nCell = cellShots.reduce((n,m)=>n+m.photos.length,0);
  const nMeet = meets.reduce((n,g)=>n+g.photos.length,0);
  return { faces, cellShots, meets, nCell, nMeet };
}
function renderPhotos() {
  const ids = [...new Set([...state.souls.map(cellOfSoul), ...state.meetings.map(m=>m.cellId)]
    .filter(Boolean))];
  const cells = ids.map(id=>state.cells.find(c=>c.id===id)).filter(Boolean);
  if (state.phCell !== "all" && !ids.includes(state.phCell)) state.phCell = "all";
  $("ph-cells").innerHTML = `<button type="button" data-phc="all">전체</button>`
    + cells.map(c=>`<button type="button" data-phc="${c.id}">${esc(c.name)}</button>`).join("");
  /* .seg 는 display:flex 라 hidden 이 안 먹어요 — 직접 숨깁니다 */
  $("ph-cells").style.display = cells.length < 2 ? "none" : "";
  $("ph-cells").querySelectorAll("[data-phc]").forEach(b=>b.classList.toggle("on", b.dataset.phc===state.phCell));
  $("ph-tabs").querySelectorAll("[data-pht]").forEach(b=>b.classList.toggle("on", b.dataset.pht===state.phTab));

  const S = photoSets(state.phCell), all = photoSets("all");
  const usedMB = all.faces.length*MB_FACE + (all.nCell + all.nMeet)*MB_SHOT;
  const pct = Math.min(100, usedMB / FREE_MB * 100);
  $("ph-sum").innerHTML = `
    <div class="tiles" style="margin-top:14px">
      ${tile("얼굴", S.faces.length+"장")}${tile("셀모임", S.nCell+"장")}${tile("만남 · 모임", S.nMeet+"장")}
    </div>
    <p class="muted" style="font-size:12px;margin-top:10px">사진 저장 공간 (추정) 약 ${usedMB<10?usedMB.toFixed(1):Math.round(usedMB)}MB
      · 무료 한도 1,024MB의 ${pct<1?pct.toFixed(1):Math.round(pct)}% — 모임 사진은 대략 4,000장까지 들어가요.
      내가 볼 수 있는 사진 기준이에요.</p>`;

  const T = state.phTab, parts = [];
  if ((T==="all"||T==="face") && S.faces.length) parts.push(`
    <div class="gset"><p class="gh"><span>얼굴 사진</span><span>${S.faces.length}명</span></p>
      <div class="faces">${S.faces.map(s=>`<button type="button" data-face="${s.id}"
        aria-label="${esc(s.name)} 얼굴 크게 보기">${avatar(s,60)}<span>${esc(s.name)}</span></button>`).join("")}</div></div>`);
  if ((T==="all"||T==="cell")) S.cellShots.forEach(m=>{
    const c = state.cells.find(x=>x.id===m.cellId);
    parts.push(`<div class="gset"><p class="gh"><span>${fmtDate(m.date,true)} · ${esc(c?c.name:"")} 셀모임${
      m.topic?" · "+esc(m.topic):""}</span><span>${m.photos.length}장</span></p>
      <div class="gal">${m.photos.map((p,i)=>`<button type="button" data-mph="${m.id}|${i}"
        style="background-image:url(${p.thumb})" aria-label="셀모임 사진 ${i+1} 크게 보기"></button>`).join("")}</div></div>`);
  });
  if ((T==="all"||T==="meet")) S.meets.forEach(g=>{
    parts.push(`<div class="gset"><p class="gh"><span>${fmtDate(g.r.date,true)} · ${esc(meetLabel(g.r))} · ${
      esc(g.names.join(", "))}</span><span>${g.photos.length}장</span></p>
      <div class="gal">${g.photos.map((p,i)=>`<button type="button" data-rph="${g.r.soulId}|${g.r.id}|${i}"
        style="background-image:url(${p.thumb})" aria-label="모임 사진 ${i+1} 크게 보기"></button>`).join("")}</div></div>`);
  });
  $("ph-body").innerHTML = parts.join("")
    || `<p class="muted" style="margin-top:18px">아직 사진이 없어요. 영혼 카드 · 셀모임 · 만남 기록에서 사진을 넣으면 여기 모여요.</p>`;
}
$("ph-cells").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-phc]"); if (!b) return;
  state.phCell = b.dataset.phc; renderPhotos();
});
$("ph-tabs").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-pht]"); if (!b) return;
  state.phTab = b.dataset.pht; renderPhotos();
});
$("ph-body").addEventListener("click", async (ev)=>{
  const f = ev.target.closest("[data-face]");
  if (f) {
    const s = state.souls.find(x=>x.id===f.dataset.face);
    const big = await loadPhoto(f.dataset.face);
    $("pv-img").src = big || (s&&s.thumb) || ""; $("photo-view").showModal(); return;
  }
  const m = ev.target.closest("[data-mph]");
  if (m) { const [mid,i] = m.dataset.mph.split("|");
    const mt = state.meetings.find(x=>x.id===mid);
    if (mt && mt.photos[Number(i)]) showMeetPhoto(mt.photos[Number(i)]); return; }
  const r = ev.target.closest("[data-rph]");
  if (r) { const [sid,rid,i] = r.dataset.rph.split("|");
    const rec = (state.allRecords||[]).find(x=>x.id===rid && x.soulId===sid);
    if (rec && rec.photos[Number(i)]) showPhoto(rec.photos[Number(i)]); }
});
$("photos-back").onclick = () => openMore();
$("btn-go-photos").onclick = () => openPhotos();

/* ════════ 활동 통계 ════════
   '느낌'이 아니라 숫자로 — 누구를 얼마나 만났는지, 모임이 몇 번 있었는지.
   색 네 가지는 검증한 순서 그대로 고정합니다: 셀모임 · 훈련 · 1:1 · 그 밖의 모임. */
const SCAT = [
  ["cell",  "셀모임 출석", "var(--c-cell)"],
  ["train", "훈련",        "var(--c-train)"],
  ["one",   "1:1",         "var(--c-one)"],
  ["etc",   "그 밖의 모임", "var(--c-etc)"]
];
const catOf = (r) => r.kind === "train" ? "train" : r.kind === "one" ? "one" : "etc";
async function openStats() {
  show("s-loading"); markSide("stats");
  await loadOrg(); await loadSouls(); await loadMeetings(); await loadAllRecords();
  state.st = state.st || { per:"3", cell:"all", withCell:true, away:false };
  renderStats(); show("s-stats");
}
function statsFrom(per) {
  if (per === "all") return "0000-00-00";
  const d = new Date();
  if (per === "y") return `${d.getFullYear()}-01-01`;
  d.setMonth(d.getMonth() - Number(per)); return ymd(d);
}
function renderStats() {
  const S = state.st, from = statsFrom(S.per), to = todayStr();
  const inP = (d) => !!d && d >= from && d <= to;
  $("st-period").querySelectorAll("[data-per]").forEach(b=>b.classList.toggle("on", b.dataset.per===S.per));
  const ids = [...new Set(state.souls.map(cellOfSoul).filter(Boolean))];
  const cells = ids.map(id=>state.cells.find(c=>c.id===id)).filter(Boolean);
  if (S.cell !== "all" && !ids.includes(S.cell)) S.cell = "all";
  $("st-cells").innerHTML = `<button type="button" data-stc="all">전체</button>`
    + cells.map(c=>`<button type="button" data-stc="${c.id}">${esc(c.name)}</button>`).join("");
  $("st-cells").style.display = cells.length < 2 ? "none" : "";
  $("st-cells").querySelectorAll("[data-stc]").forEach(b=>b.classList.toggle("on", b.dataset.stc===S.cell));
  $("st-opts").querySelector('[data-opt="cell"]').classList.toggle("on", S.withCell);
  $("st-opts").querySelector('[data-opt="away"]').classList.toggle("on", S.away);

  const inCell = (cid) => S.cell === "all" || cid === S.cell;
  const souls = state.souls.filter(s => inCell(cellOfSoul(s)));
  const soulIds = new Set(souls.map(s=>s.id));
  const meets = state.meetings.filter(m => inCell(m.cellId) && inP(m.date));
  /* 예정은 빼고, '나 없이'는 고른 경우만 */
  /* 셀모임 때 적은 근황(meetingId)은 셀모임 출석으로 이미 세었으니 빼고 */
  const recs = (state.allRecords||[]).filter(r => r.type==="meet" && !r.planned && !r.meetingId && inP(r.date)
    && soulIds.has(r.soulId) && (S.away || !r.away));
  const uniq = {}; recs.forEach(r => { const k = r.groupId || r.id; if (!uniq[k]) uniq[k] = r; });
  const once = Object.values(uniq);

  /* ── 모임 횟수 ── */
  const nCell = meets.length, nOther = once.length;
  let marked = 0, came = 0;
  meets.forEach(m => Object.entries(m.attendance||{}).forEach(([sid,v]) => {
    if (!soulIds.has(sid)) return; marked++; if (v !== "absent") came++; }));
  const nOne = once.filter(r=>r.kind==="one").length;
  $("st-tiles").innerHTML = `
    <div class="tiles" style="margin-top:14px;grid-template-columns:repeat(2,minmax(0,1fr))">
      ${tile("모든 모임 · 셀모임 포함", (nCell+nOther)+"회")}
      ${tile("셀모임 빼고", nOther+"회")}
      ${tile("셀모임 · 평균 출석", `${nCell}회 · ${marked?Math.round(came/marked*100)+"%":"—"}`)}
      ${tile("1:1 만남", nOne+"회")}
    </div>
    ${canLead() ? (() => { const a = myActivity(from); return `
    <div class="tiles" style="margin-top:8px;grid-template-columns:repeat(2,minmax(0,1fr))">
      ${tile("나 · 셀모임 출석", a.marked ? `${a.came}/${a.marked}` : "—")}
      ${tile("나 · 직접 함께한 모임", a.met+"회")}
    </div>`; })() : ""}`;

  /* ── 종류별 ── */
  const kinds = {};
  once.forEach(r => {
    const key = r.kind==="train" ? "train|"+(r.courseId||"") : r.kind;
    const label = r.kind==="train" ? `훈련 · ${r.courseName||"과정"}` : (kindOf(r.kind).id===r.kind ? kindName(r.kind) : (r.kindLabel||"모임"));
    (kinds[key] = kinds[key] || { label, cat:catOf(r), n:0 }).n++;
  });
  let krows = Object.values(kinds).sort((a,b)=>b.n-a.n);
  if (S.withCell) krows = [{ label:"셀모임", cat:"cell", n:nCell }, ...krows];
  const kmax = Math.max(1, ...krows.map(k=>k.n));
  const col = (c) => SCAT.find(x=>x[0]===c)[2];
  $("st-kinds").innerHTML = `
    <div class="card" style="margin-top:14px">
      <h3 style="font-size:13px;font-weight:600">종류별 모임 횟수</h3>
      <p class="muted" style="font-size:12px;margin-top:4px">여러 명이 함께한 모임은 한 번으로 셉니다.</p>
      <div style="margin-top:10px">${krows.length ? krows.map(k=>`
        <div class="kbar" title="${esc(k.label)} ${k.n}회"><span>${esc(k.label)}</span>
          <div><div class="t" style="width:${Math.max(1, k.n/kmax*100)}%;background:${col(k.cat)}"></div></div>
          <span style="text-align:right;font-variant-numeric:tabular-nums">${k.n}</span></div>`).join("")
        : `<p class="muted">이 기간에는 기록이 없어요.</p>`}</div>
    </div>`;

  /* ── 사람별 ── */
  const rows = souls.map(s => {
    const c = { cell:0, train:0, one:0, etc:0 };
    if (S.withCell) c.cell = meets.filter(m => {
      const v = (m.attendance||{})[s.id]; return v === "present" || v === "online"; }).length;
    recs.filter(r=>r.soulId===s.id).forEach(r => c[catOf(r)]++);
    return { s, c, total: c.cell + c.train + c.one + c.etc };
  }).sort((a,b)=> b.total - a.total || String(a.s.name).localeCompare(String(b.s.name)));
  const max = Math.max(1, ...rows.map(x=>x.total));
  const avg = rows.length ? rows.reduce((n,x)=>n+x.total,0) / rows.length : 0;
  const low = rows.filter(x => x.total === 0 || (avg > 0 && x.total <= avg * 0.5));
  const used = SCAT.filter(([k]) => k !== "cell" || S.withCell);
  $("st-people").innerHTML = `
    <div class="card" style="margin-top:14px">
      <h3 style="font-size:13px;font-weight:600">누구를 얼마나 만났나</h3>
      <p class="muted" style="font-size:12px;margin-top:4px">${S.away
        ? "나 없이 모인 것까지 셉니다 — 그 사람의 활동량이에요."
        : "내가 직접 함께한 것만 셉니다 — 내가 만난 횟수예요."} 평균 ${avg.toFixed(1)}회.</p>
      ${low.length ? `<p style="font-size:13px;margin-top:10px;color:var(--warn-tx)">이 기간에 적게 만난 사람 — ${
        low.slice().reverse().slice(0,5).map(x=>`${esc(x.s.name)} ${x.total}회`).join(", ")}</p>` : ""}
      <div class="legend" style="margin-top:12px">${used.map(([k,l,c])=>
        `<span><i style="background:${c};border:none"></i>${l}</span>`).join("")}</div>
      <div style="margin-top:6px">${rows.map(x=>{
        const segs = used.filter(([k])=>x.c[k]>0).map(([k,l,c])=>
          `<i style="flex:${x.c[k]};background:${c}" title="${l} ${x.c[k]}회"></i>`).join("");
        const n = daysSince(x.s.lastMetAt);
        return `<div class="srow" title="${esc(x.s.name)} — ${used.map(([k,l])=>`${l} ${x.c[k]}`).join(" · ")}">
          <span class="who">${avatar(x.s,24)}<span>${esc(x.s.name)}</span></span>
          <div>${x.total ? `<div class="hbar" style="width:${x.total/max*100}%">${segs}</div>`
            : `<span class="chip warn" style="font-size:11px">한 번도 없음</span>`}</div>
          <span class="n">${x.total}</span>
          <span class="det">${used.filter(([k])=>x.c[k]).map(([k,l])=>`${l} ${x.c[k]}`).join(" · ") || "—"}${
            n!==null?` · 마지막 만남 ${n===0?"오늘":n+"일 전"}`:""}</span>
        </div>`; }).join("") || `<p class="muted">영혼 카드가 없어요.</p>`}</div>
    </div>`;
}
$("st-period").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-per]"); if (!b) return; state.st.per = b.dataset.per; renderStats(); });
$("st-cells").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-stc]"); if (!b) return; state.st.cell = b.dataset.stc; renderStats(); });
$("st-opts").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-opt]"); if (!b) return;
  if (b.dataset.opt === "cell") state.st.withCell = !state.st.withCell;
  else state.st.away = !state.st.away;
  renderStats();
});
$("stats-back").onclick = () => openMore();
$("btn-go-stats").onclick = () => openStats();

/* ════════ 내 프로필 (selfCards/{내 계정}) ════════
   셀리더가 자기 자신에 대해 적는 기본 정보. 영혼 카드가 아닙니다.
   - 나는 늘 볼 수 있고, '진장에게 보이기'면 같은 진 진장만 봅니다.
   - 진장·코치가 나에 대해 적는 목양 카드와는 완전히 따로 — 그쪽은 나에게 안 보입니다. */
async function loadSelfCard(force) {
  if (state.selfCard !== undefined && !force) return state.selfCard;
  try { const d = await getDoc(doc(db,"selfCards",uid())); state.selfCard = d.exists() ? d.data() : null; }
  catch { state.selfCard = null; }
  return state.selfCard;
}
const meAvatar = (px) => avatar({ name: state.me.name, thumb: state.selfCard && state.selfCard.thumb }, px);
function selfRows(sc) {
  const rows = [
    ["생일", sc.birth ? fmtDate(sc.birth,true)+(sc.lunar?" (음력)":"") : ""], ["연락처", sc.phone],
    ["교회 등록일", fmtDate(sc.registeredAt,true)], ["침례일", fmtDate(sc.baptizedAt,true)],
    ["결혼기념일", fmtDate(sc.marriedAt,true)], ["직분", sc.position],
    ["가족", sc.family], ["인생 말씀", sc.verse]
  ].filter(([,v])=>v);
  return rows.length
    ? `<div style="display:grid;grid-template-columns:84px 1fr;gap:8px 12px;font-size:13px;margin-top:12px">${
        rows.map(([k,v])=>`<span class="muted">${k}</span><span style="white-space:pre-wrap">${esc(v)}</span>`).join("")}</div>`
    : `<p class="muted" style="margin-top:10px">아직 적은 게 없어요.</p>`;
}
function renderMineProfile() {
  if (!canLead()) { $("mine-profile").innerHTML = ""; return; }
  const sc = state.selfCard || {};
  const filled = !!(sc.birth || sc.phone || sc.thumb || sc.position || sc.verse);
  $("mine-profile").innerHTML = `
    <div class="card" style="margin-top:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h3 style="font-size:13px;font-weight:600">내 프로필</h3>
        ${state.selfCard ? `<span class="chip ${sc.share==="private"?"lock":"rose"}">${sc.share==="private"?"나만 보기":"진장에게 보임"}</span>` : ""}
      </div>
      ${state.selfCard ? selfRows(sc) : `<p class="muted" style="margin-top:10px">사진 · 생일 · 연락처를 넣어두면 출석 명단과 영혼들 맨 위 '나' 줄에 쓰여요.
        영혼 카드를 따로 만들지 않아도 됩니다.</p>`}
      <button class="btn-sm" id="btn-self-edit" style="margin-top:12px">${filled?"프로필 수정":"프로필 채우기"}</button>
    </div>`;
  $("btn-self-edit").onclick = () => openSelfDlg();
}
const dlgSelf = $("dlg-self");
let selfPhoto;   // undefined = 그대로, null = 빼기, {big,small} = 새 사진
function openSelfDlg() {
  const sc = state.selfCard || {};
  selfPhoto = undefined;
  const raw = (v) => v ? fmtRaw(v) : "";
  $("sf-birth").value = raw(sc.birth); $("sf-lunar").checked = !!sc.lunar;
  $("sf-phone").value = sc.phone || "";
  $("sf-reg").value = raw(sc.registeredAt); $("sf-bap").value = raw(sc.baptizedAt);
  $("sf-married").value = raw(sc.marriedAt); $("sf-position").value = sc.position || "";
  $("sf-family").value = sc.family || ""; $("sf-verse").value = sc.verse || "";
  $("sf-share").value = sc.share || "upline";
  syncSelfAva(sc.photo || sc.thumb || "");
  $("self-err").textContent = "";
  dlgSelf.showModal();
}
function syncSelfAva(src) {
  $("sf-ava").style.backgroundImage = src ? `url(${src})` : "";
  $("sf-ava").textContent = src ? "" : initial(state.me.name);
}
$("sf-photo").onclick = () => $("sf-photo-input").click();
$("sf-photo-rm").onclick = () => { selfPhoto = null; syncSelfAva(""); };
$("sf-photo-input").onchange = async (ev) => {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (!f) return;
  try {
    const [big, small] = await Promise.all([ shrinkFit(f, PHOTO.face, 300000), shrinkFit(f, PHOTO.faceTh, 12000) ]);
    selfPhoto = { big, small }; syncSelfAva(big);
  } catch (e) { $("self-err").textContent = e.message || "사진을 넣지 못했어요."; }
};
$("sf-cancel").onclick = () => dlgSelf.close();
$("sf-save").onclick = async () => {
  const dates = {};
  for (const [id,key,label] of [["sf-birth","birth","생일"],["sf-reg","registeredAt","교회 등록일"],
                                ["sf-bap","baptizedAt","침례일"],["sf-married","marriedAt","결혼기념일"]]) {
    const v = parseDateLoose($(id).value);
    if (v === null) { $("self-err").textContent = `${label} 형식을 확인해 주세요. 3-5 또는 1985-3-5 처럼 적어주세요.`; return; }
    dates[key] = v;
  }
  const old = state.selfCard || {};
  const data = { name: state.me.name || "", jinId: state.me.jinId === undefined ? null : state.me.jinId,
    share: $("sf-share").value, lunar: $("sf-lunar").checked, phone: $("sf-phone").value.trim(),
    position: $("sf-position").value.trim(), family: $("sf-family").value.trim(),
    verse: $("sf-verse").value.trim(), ...dates,
    thumb: selfPhoto === undefined ? (old.thumb||"") : selfPhoto ? selfPhoto.small : "",
    photo: selfPhoto === undefined ? (old.photo||"") : selfPhoto ? selfPhoto.big : "",
    updatedAt: serverTimestamp() };
  $("sf-save").disabled = true;
  try {
    await setDoc(doc(db,"selfCards",uid()), data);
    state.selfCard = data; dlgSelf.close(); toast("내 프로필을 저장했어요.");
    renderMine();
  } catch (e) { $("self-err").textContent = msgOf(e); }
  finally { $("sf-save").disabled = false; }
};

/* ════════ 셀리더로 세우기 ════════
   셀원이 셀리더가 되면, 그 사람의 영혼 카드를 버리지 않고 그 사람 계정과 잇습니다.
   잇는 순간부터 그 사람 본인은 이 카드를 어떤 경로로도 못 엽니다(규칙의 linkedUid).
   그 다음에 카드를 진장에게 넘길지, 지난 기록을 얼마나 넘길지 고릅니다. */
const dlgPm = $("dlg-promote");
let pmSoulId = null, pmPick = "summary";
function openPromoteDlg(soulId) {
  const s = state.souls.find(x=>x.id===soulId); if (!s) return;
  pmSoulId = soulId; pmPick = "summary";
  $("pm-sub").textContent = `${s.name} 님의 영혼 카드를 그분의 계정과 이어서 '셀리더 목양 카드'로 바꿉니다. 지난 기록은 지워지지 않아요.`;
  const accs = (state.members||[]).filter(m => m.id !== uid() && m.active !== false && m.role !== "super");
  $("pm-acc").innerHTML = `<option value="">— 골라주세요 —</option>`
    + accs.map(m=>`<option value="${m.id}">${esc(m.name)} · ${esc(m.email||"")}</option>`).join("");
  const same = accs.filter(m => (m.name||"").trim() === (s.name||"").trim());
  if (same.length === 1) $("pm-acc").value = same[0].id;
  $("pm-acc-hint").textContent = accs.length
    ? "이름과 구글 이메일을 꼭 확인하세요. 다른 사람과 이으면, 정작 그분은 막히지 않아요."
    : "아직 가입한 계정이 없어요. 먼저 그분을 초대하고(홈 → 관리 → 리더 초대하기) 그분이 구글로 로그인해 초대를 수락한 뒤 여기서 고르세요.";
  const cells = state.cells.filter(c => c.jinId === state.me.jinId && c.active !== false);
  $("pm-cell").innerHTML = `<option value="">아직 안 정함</option>`
    + cells.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const heads = (state.members||[]).filter(m => m.role === "jinjang" && m.active !== false && m.id !== uid());
  $("pm-to").innerHTML = `<option value="${uid()}">나 — 지금처럼 내가 맡기</option>`
    + heads.map(m=>`<option value="${m.id}">${esc(m.name)} · 진장에게 넘기기</option>`).join("");
  syncPm(); $("pm-err").textContent = "";
  dlgPm.showModal();
}
function syncPm() {
  const away = $("pm-to").value !== uid();
  $("pm-scope-wrap").hidden = !away;
  $("pm-scope").innerHTML = HAND.map(h=>`
    <div class="row" data-pm="${h.id}" style="cursor:pointer;${pmPick===h.id?"border-color:var(--brand)":""}">
      <span style="width:18px;height:18px;border-radius:999px;flex-shrink:0;border:2px solid ${
        pmPick===h.id?"var(--brand)":"var(--line)"};background:${pmPick===h.id?"var(--brand)":"transparent"}"></span>
      <div class="grow"><p class="nm">${h.name}</p><p class="sub" style="white-space:normal">${h.sub}</p></div>
    </div>`).join("");
}
$("pm-to").onchange = syncPm;
$("pm-scope").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-pm]"); if (!b) return; pmPick = b.dataset.pm; syncPm();
});
$("pm-cancel").onclick = () => dlgPm.close();
$("pm-go").onclick = async () => {
  const s = state.souls.find(x=>x.id===pmSoulId);
  const acc = $("pm-acc").value, to = $("pm-to").value;
  if (!s) return;
  if (!acc) { $("pm-err").textContent = "그분의 계정을 골라주세요."; return; }
  if (acc === uid()) { $("pm-err").textContent = "내 계정과는 이을 수 없어요."; return; }
  if (to === acc) { $("pm-err").textContent = "본인에게 자기 카드를 맡길 수는 없어요."; return; }
  const m = (state.members||[]).find(x=>x.id===acc) || {};
  if (!confirm(`${s.name} 카드를 ${m.name||""} (${m.email||""}) 계정과 이을까요?\n이 순간부터 그분은 이 카드를 볼 수 없어요.`)) return;
  $("pm-go").disabled = true;
  try {
    /* 먼저 잇고(본인 차단이 바로 걸리도록), 그 다음에 넘깁니다 */
    await updateDoc(doc(db,"souls",s.id), {
      kind:"leader", cellId:null, ofCellId: $("pm-cell").value || null, linkedUid: acc });
    if (to !== uid()) await doHandover(s.id, to, pmPick);
    await log("셀리더로 세우기", s.name, `${m.name||""} 계정과 연결${to!==uid()?" · 진장에게 넘김":""}`);
    bump("promote");
    dlgPm.close(); invalidate(); await loadSouls(true);
    toast(`${s.name} 님을 셀리더로 세웠어요.`); openSouls();
  } catch (e) { $("pm-err").textContent = msgOf(e); }
  finally { $("pm-go").disabled = false; }
};

/* ════════ 예전에 올린 얼굴 사진의 작은 사본 만들기 ════════
   목록 · 사진 모아보기에 쓰는 작은 사본은 8단계부터 저장했습니다.
   그 전에 올린 얼굴 사진은 큰 사진만 있어서 카드 안에서는 보이는데 목록에서는 안 보였어요.
   한 번만 돌면서 작은 사본을 만들어 둡니다(사진 없는 카드엔 빈 값을 적어 다시 안 봄). */
async function backfillThumbs() {
  if (state.thumbFixed) return 0;
  state.thumbFixed = true;
  const todo = state.souls.filter(s => isLeaderOf(s) && s.thumb === undefined);
  let made = 0;
  for (const s of todo) {
    try {
      const full = await loadPhoto(s.id);
      let th = "";
      if (full) {
        const blob = await (await fetch(full)).blob();
        th = await shrinkFit(new File([blob], "face.jpg", { type: blob.type || "image/jpeg" }), PHOTO.faceTh, 12000);
      }
      await updateDoc(doc(db,"souls",s.id), { thumb: th });
      s.thumb = th; if (th) made++;
    } catch {}
  }
  return made;
}

/* ════════ 버전 기록 · 새 버전 알림 ════════
   올릴 때마다 version.json 도 같이 올립니다. 앱은 열 때 · 다시 볼 때 · 10분마다
   그 파일만 살짝 확인해서(아주 작은 파일), 지금 버전보다 새것이면 위에 알림을 띄웁니다. */
const CHANGELOG = [
  { v:"16.0", d:"2026-10-19", items:[
    "셀리더 · 코치 · 진장끼리 쪽지",
    "셀모임과 '코치 공유' 기록에 댓글",
    "소식함 — 어디에 댓글이 달렸는지 · 안 읽은 수 표시",
    "알림 설정 — 받을 알림 고르기 · 앱이 열려 있을 때 기기 알림",
    "홈에서 버전 기록 보기 · 새 버전이 올라오면 위에 알림",
    "새로 올린 파일이 새로고침 한 번으로 바로 반영" ] },
  { v:"15.0", d:"2026-10-19", items:[
    "내 카드에 내 프로필 (사진 · 생일 · 연락처 등)",
    "셀원을 셀리더로 세우기 — 구글 계정 잇기",
    "예전에 올린 얼굴 사진도 목록 · 사진 모아보기에",
    "카드 넘기기 · 전체 백업이 실제 서버에서 막히던 문제 고침" ] },
  { v:"14.0", d:"2026-10-19", items:[
    "1:1 — 셀원 둘의 1:1도 기록",
    "셀모임 출석에 셀리더 본인",
    "영혼들 맨 위 '나' — 내 카드",
    "캘린더 창에서는 종류만, 사람은 다음 화면에서 여러 명" ] },
  { v:"13.0", d:"2026-10-19", items:[
    "캘린더에서 기록 바로 수정",
    "왼쪽 목록에 훈련 현황 · 활동 통계 · 사진 모아보기",
    "모임 종류 설정 (순서 · 숨기기 · 이름)",
    "함께한 모임 사진은 한 번만 저장",
    "보안: 맡은 셀은 스스로 못 바꿈 · 코치는 같은 진 안에서만" ] },
  { v:"12.0", d:"2026-10-18", items:[
    "훈련 모임 — 후원자 · 피후원자 · 회차 자동 체크",
    "내가 안 간 모임도 기록",
    "예정 입력 (있었던 일 / 앞으로 예정)",
    "캘린더에 함께한 모임 한 줄로" ] },
  { v:"11.0", d:"2026-10-16", items:[
    "셀모임 사진", "근황 · 기도를 흐름으로 보기", "기도제목 모아보기", "새가족 등록 몇 주차" ] },
  { v:"10.0", d:"2026-10-13", items:[
    "셀리더 · 코치 목양 카드 (그 사람 본인은 못 봄)", "카드 넘기기 (지난 기록 범위 고르기)",
    "내 기록", "캘린더 알림 시간" ] }
];
const verOf = (v) => String(v||"").split(" ")[0];
function cmpVer(a, b) {
  const x = verOf(a).split(".").map(Number), y = verOf(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i]||0) - (y[i]||0); if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
async function checkVersion() {
  try {
    const r = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    state.latest = j;
    if (cmpVer(j.version, APP_VERSION) > 0 && !state.updLater) {
      $("upd-ver").textContent = verOf(j.version); $("upd-bar").hidden = false;
    }
    renderVerCard();
  } catch {}
}
$("upd-go").onclick = async () => {
  $("upd-go").textContent = "받는 중…";
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update(); } catch {}
  location.reload();
};
$("upd-later").onclick = () => { $("upd-bar").hidden = true; state.updLater = true; };
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me) checkVersion(); });
setInterval(() => { if (!document.hidden && state.me) checkVersion(); }, 10 * 60 * 1000);
function renderVerCard() {
  if (!$("ver-now")) return;
  $("ver-now").textContent = `버전 ${verOf(APP_VERSION)} · ${(APP_VERSION.match(/\((.*)\)/)||[])[1]||""}`;
  const L = state.latest;
  $("ver-state").textContent = !L ? "바뀐 것 보기"
    : cmpVer(L.version, APP_VERSION) > 0 ? `새 버전 ${verOf(L.version)}이 있어요 — 눌러서 새로고침`
    : "최신 버전이에요 · 바뀐 것 보기";
  $("ver-state").style.color = L && cmpVer(L.version, APP_VERSION) > 0 ? "var(--rose-tx)" : "";
}
$("btn-ver").onclick = () => {
  const L = state.latest;
  if (L && cmpVer(L.version, APP_VERSION) > 0) { $("upd-go").click(); return; }
  $("ver-sub").textContent = `지금 쓰는 버전: ${APP_VERSION}`;
  $("ver-list").innerHTML = CHANGELOG.map(c => `
    <div class="cmt">
      <p class="h"><span><b style="color:var(--text)">${c.v}</b> · ${c.d}</span>${
        verOf(APP_VERSION)===c.v?`<span class="chip rose" style="font-size:10px">지금 이 버전</span>`:""}</p>
      <ul style="margin:6px 0 0 18px;font-size:13px;line-height:1.7">${c.items.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>
    </div>`).join("")
    + `<p class="muted" style="font-size:12px;margin-top:10px">그 전 (1~9단계): 영혼 카드 · 셀모임 출석 · 만남 기록 · 훈련 현황 · 캘린더 · 넓은 화면 · 사진 · 사용 현황</p>`;
  $("dlg-ver").showModal();
};
$("ver-close").onclick = () => $("dlg-ver").close();
/* 새 버전으로 바뀐 뒤 처음 열면 한 번 알려줍니다 */
function noteUpdated() {
  let seen = null;
  try { seen = localStorage.getItem("mokja-seen-ver"); } catch {}
  if (seen && cmpVer(APP_VERSION, seen) > 0) toast(`${verOf(APP_VERSION)} 버전으로 업데이트됐어요. 홈 맨 아래에서 바뀐 것을 볼 수 있어요.`);
  try { localStorage.setItem("mokja-seen-ver", APP_VERSION); } catch {}
}

/* ════════ 댓글 ════════
   셀모임 — 그 모임을 볼 수 있는 사람(셀리더 · 담당 코치 · 진장)
   기록   — '코치 공유'로 둔 기록만. 그 기록을 볼 수 있는 사람만 (본인 차단 그대로)
   보안 규칙이 같은 조건으로 막으므로, 앱 화면을 우회해도 안 보입니다. */
const fmtAgo = (ms) => {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  const d = new Date(ms); return `${d.getMonth()+1}월 ${d.getDate()}일`;
};
const cellNameOf = (id) => (state.cells.find(c=>c.id===id)||{}).name || "";
function meetTarget(m) {
  return { kind:"meeting", id:m.id, owner:m.leaderUid,
    title:`${fmtDate(m.date)} ${cellNameOf(m.cellId)} 셀모임`,
    who:"이 셀모임을 볼 수 있는 사람 — 셀리더 · 담당 코치 · 진장 — 이 같이 봅니다." };
}
function recTarget(s, r) {
  return { kind:"record", soulId:s.id, recId:r.id, owner:r.by,
    title:`${s.name} · ${r.type==="meet" ? meetLabel(r) : (RTYPE[r.type]||"기록")} (${fmtDate(r.date)})`,
    who:"'코치 공유' 기록이라 담당 셀리더 · 담당 코치 · 진장이 같이 봅니다. 카드 주인 본인에게는 보이지 않아요." };
}
const cmtCol = (t) => t.kind === "meeting"
  ? collection(db,"meetings",t.id,"comments")
  : collection(db,"souls",t.soulId,"records",t.recId,"comments");
async function loadComments(t) {
  return pack(await getDocs(cmtCol(t))).sort((a,b)=>(a.atMs||0)-(b.atMs||0));
}
const dlgCmt = $("dlg-cmt");
async function openComments(t) {
  state.cmt = t; state.cmtRows = [];
  $("cmt-title").textContent = t.title; $("cmt-who").textContent = t.who;
  $("cmt-body").value = ""; $("cmt-err").textContent = "";
  $("cmt-list").innerHTML = `<p class="muted">불러오는 중…</p>`;
  if (!dlgCmt.open) dlgCmt.showModal();
  try { state.cmtRows = await loadComments(t); renderComments(); }
  catch (e) { $("cmt-list").innerHTML = `<p class="err">${esc(msgOf(e))}</p>`; }
}
function renderComments() {
  $("cmt-list").innerHTML = state.cmtRows.map(c => `
    <div class="cmt">
      <p class="h"><span><b style="color:var(--text)">${esc(c.byName||"")}</b> · ${fmtAgo(c.atMs)}</span>
        ${c.by===uid()?`<button class="btn-sm danger" data-delcmt="${c.id}" style="height:26px;font-size:11px">지우기</button>`:""}</p>
      <p class="b">${esc(c.body)}</p>
    </div>`).join("") || `<p class="muted">아직 댓글이 없어요. 첫 댓글을 남겨보세요.</p>`;
  $("cmt-list").scrollTop = 1e6;
}
$("cmt-list").addEventListener("click", async (ev) => {
  const d = ev.target.closest("[data-delcmt]"); if (!d) return;
  if (!confirm("이 댓글을 지울까요?")) return;
  try { await deleteDoc(doc(cmtCol(state.cmt), d.dataset.delcmt));
        state.cmtRows = state.cmtRows.filter(c=>c.id!==d.dataset.delcmt); renderComments(); }
  catch (e) { $("cmt-err").textContent = msgOf(e); }
});
$("cmt-close").onclick = () => { dlgCmt.close(); syncMeetCmtBtn(); };
function syncMeetCmtBtn() {
  if (state.cmt && state.cmt.kind === "meeting" && state.meeting && state.meeting.id === state.cmt.id)
    $("btn-m-cmt").textContent = state.cmtRows.length ? `댓글 ${state.cmtRows.length}개` : "댓글 남기기";
}
$("btn-m-cmt").onclick = () => {
  const m = state.meetings.find(x=>x.id===(state.meeting||{}).id); if (m) openComments(meetTarget(m));
};
$("cmt-send").onclick = async () => {
  const t = state.cmt, body = $("cmt-body").value.trim();
  if (!body) { $("cmt-err").textContent = "내용을 적어주세요."; return; }
  if (body.length > 2000) { $("cmt-err").textContent = "2000자까지 적을 수 있어요."; return; }
  $("cmt-send").disabled = true; $("cmt-err").textContent = "";
  try {
    const row = { by:uid(), byName:state.me.name||"", body, atMs:Date.now(), at:serverTimestamp() };
    const ref = await addDoc(cmtCol(t), row);
    state.cmtRows.push({ id:ref.id, ...row }); renderComments(); $("cmt-body").value = "";
    /* 알릴 사람 — 이 모임 · 기록의 주인과 지금까지 댓글을 단 사람들 (나는 빼고) */
    const to = new Set([t.owner, ...state.cmtRows.map(c=>c.by)]); to.delete(uid());
    const where_ = t.kind === "meeting" ? { kind:"meeting", id:t.id } : { kind:"record", soulId:t.soulId, recId:t.recId };
    for (const u of to) {
      if (!u || !(state.members||[]).some(m=>m.id===u)) continue;   // 같은 진 사람에게만
      try { await addDoc(collection(db,"notices"), { to:u, from:uid(), fromName:state.me.name||"",
        kind:"comment", target:where_, title:t.title, snippet:body.slice(0,80),
        atMs:Date.now(), at:serverTimestamp(), read:false }); } catch {}
    }
    bump("comment");
  } catch (e) { $("cmt-err").textContent = msgOf(e); }
  finally { $("cmt-send").disabled = false; }
};

/* ════════ 쪽지 ════════
   같은 진의 셀리더 · 코치 · 진장끼리. 보낸 사람과 받는 사람 둘만 읽습니다. */
async function loadMessages() {
  const col = collection(db,"messages");
  const [a, b] = await Promise.all([
    getDocs(query(col, where("to","==",uid()))),
    getDocs(query(col, where("from","==",uid())))]);
  const seen = {};
  state.msgs = [...pack(a), ...pack(b)].filter(m => seen[m.id] ? false : (seen[m.id] = true))
    .sort((x,y)=>(x.atMs||0)-(y.atMs||0));
  return state.msgs;
}
const memberName = (id) => ((state.members||[]).find(m=>m.id===id)||{}).name || "";
const dmPeople = () => (state.members||[]).filter(m => m.id !== uid() && m.active !== false
  && m.jinId === state.me.jinId);
const dlgTh = $("dlg-thread");
function openThread(other) {
  state.thWith = other || null;
  $("th-pick-wrap").hidden = !!other;
  if (!other) {
    $("th-pick").innerHTML = `<option value="">— 골라주세요 —</option>` + dmPeople().map(m=>
      `<option value="${m.id}">${esc(m.name)} · ${ROLE[m.role]||m.role}</option>`).join("");
  }
  $("th-title").textContent = other ? `${memberName(other) || "쪽지"} 님과 쪽지` : "새 쪽지";
  $("th-body").value = ""; $("th-err").textContent = "";
  renderThread();
  if (!dlgTh.open) dlgTh.showModal();
  markThreadRead();
}
function renderThread() {
  const o = state.thWith;
  const list = o ? (state.msgs||[]).filter(m => (m.from===o && m.to===uid()) || (m.from===uid() && m.to===o)) : [];
  $("th-list").innerHTML = list.map(m => `<div class="bub ${m.from===uid()?"me":"them"}">${esc(m.body)}
      <span class="t">${fmtAgo(m.atMs)}${m.from===uid() && m.read ? " · 읽음" : ""}</span></div>`).join("")
    || (o ? `<p class="muted">아직 주고받은 쪽지가 없어요.</p>` : "");
  $("th-list").scrollTop = 1e6;
}
async function markThreadRead() {
  const o = state.thWith; if (!o) return;
  for (const m of (state.msgs||[]).filter(m => m.from===o && m.to===uid() && !m.read)) {
    try { await updateDoc(doc(db,"messages",m.id), { read:true }); m.read = true; } catch {}
  }
}
$("th-pick").onchange = () => { state.thWith = $("th-pick").value || null; renderThread(); };
$("th-close").onclick = () => { dlgTh.close(); if (!$("s-inbox").hidden) renderInbox(); };
$("th-send").onclick = async () => {
  const to = state.thWith, body = $("th-body").value.trim();
  if (!to) { $("th-err").textContent = "받는 사람을 골라주세요."; return; }
  if (!body) { $("th-err").textContent = "내용을 적어주세요."; return; }
  if (body.length > 2000) { $("th-err").textContent = "2000자까지 적을 수 있어요."; return; }
  $("th-send").disabled = true; $("th-err").textContent = "";
  try {
    const row = { from:uid(), to, fromName:state.me.name||"", toName:memberName(to), body,
      atMs:Date.now(), at:serverTimestamp(), read:false };
    const ref = await addDoc(collection(db,"messages"), row);
    (state.msgs = state.msgs || []).push({ id:ref.id, ...row });
    $("th-body").value = ""; $("th-pick-wrap").hidden = true;
    $("th-title").textContent = `${memberName(to)} 님과 쪽지`;
    renderThread(); bump("dm");
  } catch (e) { $("th-err").textContent = msgOf(e); }
  finally { $("th-send").disabled = false; }
};

/* ════════ 소식함 ════════ */
async function openInbox(tab) {
  show("s-loading"); markSide("inbox");
  await loadOrg();
  state.ibTab = tab || state.ibTab || "notice";
  try {
    const rows = pack(await getDocs(query(collection(db,"notices"), where("to","==",uid()))));
    /* 읽은 지 오래된 알림은 정리합니다 (60일) */
    const old = Date.now() - 60*86400000;
    for (const n of rows.filter(n => n.read && (n.atMs||0) < old)) { try { await deleteDoc(doc(db,"notices",n.id)); } catch {} }
    state.notices = rows.filter(n => !(n.read && (n.atMs||0) < old)).sort((a,b)=>(b.atMs||0)-(a.atMs||0));
  } catch (e) { state.notices = []; toast(msgOf(e)); }
  try { await loadMessages(); } catch (e) { state.msgs = []; toast(msgOf(e)); }
  renderInbox(); show("s-inbox");
}
function renderInbox() {
  const T = state.ibTab, un1 = (state.notices||[]).filter(n=>!n.read).length;
  const un2 = (state.msgs||[]).filter(m=>m.to===uid() && !m.read).length;
  $("ib-n1").textContent = un1 ? `· ${un1}` : ""; $("ib-n2").textContent = un2 ? `· ${un2}` : "";
  $("inbox-tabs").querySelectorAll("[data-ib]").forEach(b=>b.classList.toggle("on", b.dataset.ib===T));
  if (T === "notice") {
    $("inbox-acts").innerHTML = un1 ? `<button class="btn-sm" id="ib-allread">모두 읽음</button>` : "";
    $("inbox-list").innerHTML = (state.notices||[]).map(n => `
      <div class="row" data-notice="${n.id}" style="cursor:pointer;align-items:flex-start">
        ${n.read ? `<span style="width:8px"></span>` : `<span class="dot" style="margin-top:7px"></span>`}
        <div class="grow"><p class="nm" style="white-space:normal">${esc(n.fromName||"")} 님이 <b>${esc(n.title||"")}</b>에 댓글을 남겼어요</p>
          <p class="sub" style="white-space:normal;margin-top:4px">“${esc(n.snippet||"")}” · ${fmtAgo(n.atMs)}</p></div>
      </div>`).join("") || `<p class="muted">아직 소식이 없어요. 내 셀모임이나 '코치 공유' 기록에 댓글이 달리면 여기 모여요.</p>`;
  } else {
    $("inbox-acts").innerHTML = `<button class="btn-sm" id="ib-newdm">＋ 새 쪽지</button>`;
    const by = {};
    (state.msgs||[]).forEach(m => { const o = m.from===uid() ? m.to : m.from;
      (by[o] = by[o] || { o, last:null, un:0 }); by[o].last = m;
      if (m.to===uid() && !m.read) by[o].un++; });
    const convs = Object.values(by).sort((a,b)=>(b.last.atMs||0)-(a.last.atMs||0));
    $("inbox-list").innerHTML = convs.map(c => `
      <div class="row" data-dmwith="${c.o}" style="cursor:pointer">
        <span class="ava">${esc(initial(memberName(c.o) || c.last.fromName))}</span>
        <div class="grow"><p class="nm">${esc(memberName(c.o) || (c.last.from===c.o ? c.last.fromName : c.last.toName) || "")}</p>
          <p class="sub">${c.last.from===uid()?"나: ":""}${esc(c.last.body.slice(0,40))} · ${fmtAgo(c.last.atMs)}</p></div>
        ${c.un ? `<span class="chip rose">${c.un}</span>` : ""}
      </div>`).join("") || `<p class="muted">주고받은 쪽지가 없어요. 같은 진의 셀리더 · 코치 · 진장에게 보낼 수 있어요.</p>`;
  }
  const ar = $("ib-allread"); if (ar) ar.onclick = async () => {
    for (const n of state.notices.filter(n=>!n.read)) { try { await updateDoc(doc(db,"notices",n.id), { read:true }); n.read = true; } catch {} }
    renderInbox();
  };
  const nd = $("ib-newdm"); if (nd) nd.onclick = () => openThread(null);
}
$("inbox-tabs").addEventListener("click",(ev)=>{
  const b = ev.target.closest("[data-ib]"); if (!b) return; state.ibTab = b.dataset.ib; renderInbox();
});
$("inbox-list").addEventListener("click", async (ev) => {
  const d = ev.target.closest("[data-dmwith]");
  if (d) { openThread(d.dataset.dmwith); return; }
  const r = ev.target.closest("[data-notice]"); if (!r) return;
  const n = (state.notices||[]).find(x=>x.id===r.dataset.notice); if (!n) return;
  if (!n.read) { try { await updateDoc(doc(db,"notices",n.id), { read:true }); n.read = true; } catch {} }
  await goToNotice(n);
});
/* 알림을 누르면 — 그 모임 · 기록을 열고 댓글 창까지 */
async function goToNotice(n) {
  const t = n.target || {};
  if (t.kind === "meeting") {
    await loadMeetings(true);
    const m = state.meetings.find(x=>x.id===t.id);
    if (!m) { toast("지금은 볼 수 없는 모임이에요."); return; }
    openMeeting(m.id); openComments(meetTarget(m));
  } else if (t.kind === "record") {
    await loadSouls();
    const s = state.souls.find(x=>x.id===t.soulId);
    if (!s) { toast("지금은 볼 수 없는 기록이에요."); return; }
    await openSoul(s.id);
    const rec = state.records.find(x=>x.id===t.recId);
    if (!rec) { toast("지금은 볼 수 없는 기록이에요."); return; }
    openComments(recTarget(s, rec));
  }
}
$("inbox-back").onclick = () => openHome();
$("btn-bell").onclick = () => openInbox();

/* ════════ 알림 설정 · 안 읽은 수 ════════
   새 소식은 앱이 열려 있는 동안 실시간으로 받습니다(읽지 않은 것만 지켜봄 — 읽기 횟수가 적어요). */
const notifyPrefs = () => ({ comment:true, dm:true, device:false, ...((state.me && state.me.notifyPrefs) || {}) });
function startLive() {
  if (state.liveOn || !state.me) return;
  state.liveOn = true;
  const watch = (col, kind) => onSnapshot(
    query(collection(db,col), where("to","==",uid()), where("read","==",false)),
    (snap) => {
      const rows = pack(snap), prev = state["live_"+kind];
      state["live_"+kind] = rows;
      if (prev) rows.filter(r => !prev.some(p=>p.id===r.id)).forEach(r => alertNew(kind, r));
      renderBadges();
    }, () => {});
  try { watch("notices","notice"); watch("messages","dm"); } catch {}
}
function renderBadges() {
  const n = (state.live_notice||[]).length + (state.live_dm||[]).length;
  const b = $("bdg-home"); if (b) { b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n); }
  const side = $("side-nav").querySelector('[data-side="inbox"]');
  if (side) {
    let s = side.querySelector(".bdg");
    if (!s) { s = document.createElement("span"); s.className = "bdg"; side.appendChild(s); }
    s.hidden = !n; s.textContent = n > 99 ? "99+" : String(n);
  }
}
function alertNew(kind, r) {
  const P = notifyPrefs();
  if ((kind === "notice" && !P.comment) || (kind === "dm" && !P.dm)) return;
  const title = kind === "dm" ? `${r.fromName||""} 님의 쪽지` : `${r.fromName||""} 님이 댓글을 남겼어요`;
  const body = kind === "dm" ? (r.body||"").slice(0,80) : `${r.title||""} — ${r.snippet||""}`;
  toast(`${title} · ${body.slice(0,40)}`);
  if (P.device && document.hidden && "Notification" in window && Notification.permission === "granted") {
    (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null))
      .then(reg => reg ? reg.showNotification(title, { body, tag:"mokja-"+r.id, icon:"./icons/icon-192.png" })
                       : new Notification(title, { body }))
      .catch(()=>{});
  }
}
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (ev) => {
  if (ev.data && ev.data.type === "open-inbox" && state.me) openInbox();
});
if (location.hash === "#inbox") state.openInboxOnStart = true;
const dlgNt = $("dlg-notify");
$("btn-notify-set").onclick = () => {
  const P = notifyPrefs();
  $("nt-comment").checked = P.comment; $("nt-dm").checked = P.dm; $("nt-device").checked = P.device;
  $("nt-err").textContent = "";
  if (!("Notification" in window)) { $("nt-device").disabled = true;
    $("nt-device-hint").textContent = "이 브라우저는 기기 알림을 지원하지 않아요. 아이폰은 홈 화면에 추가한 앱에서만 돼요."; }
  dlgNt.showModal();
};
$("nt-cancel").onclick = () => dlgNt.close();
$("nt-save").onclick = async () => {
  const p = { comment:$("nt-comment").checked, dm:$("nt-dm").checked, device:$("nt-device").checked };
  if (p.device && "Notification" in window && Notification.permission !== "granted") {
    try { const r = await Notification.requestPermission();
      if (r !== "granted") { p.device = false; $("nt-err").textContent = "기기 알림이 허용되지 않았어요. 브라우저 설정에서 허용한 뒤 다시 켜주세요."; } }
    catch { p.device = false; }
  }
  try { await updateDoc(doc(db,"users",state.me.id), { notifyPrefs: p }); state.me.notifyPrefs = p;
        if (!$("nt-err").textContent) { dlgNt.close(); toast("알림 설정을 저장했어요."); } }
  catch (e) { $("nt-err").textContent = msgOf(e); }
};
