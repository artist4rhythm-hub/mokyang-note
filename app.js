/* ──────────────────────────────────────────────
   목자의 삶
   1단계 계정 · 조직 · 초대
   2단계 영혼 카드 · 기록 · 후속조치
   3단계 셀모임 출석 · 훈련 이력 · 겸직
   4단계 입력 편의 · 앱 설치(PWA) · 백업
   5단계 훈련 개편(회차·순서) · 기록 수정
   6단계 만남 기록(1:1·소그룹) · 셀모임 개인 나눔 ·
         기록 검색 · 캘린더 · 훈련 현황 · 가로 화면
   18단계 교회 명부(멤버 카드 두 겹) · 셀 관리(담당 바꾸기 · 분가 · 옮기기)
         · 인계 요청 · 역할 주기(초대 순간부터 본인 차단)
   ────────────────────────────────────────────── */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, reauthenticateWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const APP_NAME = "목자의 삶";
const APP_VERSION = "31.0 (2026-11-10)";

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
const SCREENS = ["s-help","s-orgchart","s-loading","s-login","s-verify","s-setup","s-accept","s-pending",
                 "s-home","s-souls","s-cal","s-meet","s-meeting","s-log","s-soul",
                 "s-edit","s-train","s-search","s-mine","s-usage","s-more","s-manage",
                 "s-photos","s-stats","s-inbox","s-dir","s-cellmgr","s-org","s-consent","s-share",
                 "s-reports","s-report","s-import","s-leaders","s-health"];
const show = (id) => {
  SCREENS.forEach(s => $(s).hidden = (s !== id));
  if (id !== "s-loading" && typeof bump === "function") bump(id.replace(/^s-/, ""), "screen");
  const sb = $("sidebar");
  const inApp = !["s-loading","s-login","s-verify","s-setup","s-accept","s-pending","s-consent"].includes(id);
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

const ROLE   = { super:"수퍼 관리자", jinjang:"진장", coach:"코치", leader:"셀리더", pastor:"담당 교역자" };
const STATUS = { new:"새가족", settling:"정착 중", growing:"성장", cand:"리더 후보", care:"돌봄 필요" };
const SCOPE  = { private:"나만 보기", leader:"담당 리더", coach:"코치 공유", pastor:"교역자까지" };
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
  const c = String((e && e.code) || "");   // 구글 캘린더 오류처럼 숫자 코드도 와요
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
  editDirty:false, lastTab:"home", calMonth:null, calPick:null, gsFilter:"all",
  dir:[], handovers:[]
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
ICON.dir = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><circle cx="12" cy="10" r="2.6"/><path d="M8.5 16.5a3.5 3.5 0 0 1 7 0"/></svg>`;
ICON.health = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12h4l2-4.5 4 9 2-4.5h5"/></svg>`;
const SIDE = [["home","홈"],["inbox","소식"],["souls","영혼들"],["dir","교회 명부"],["cal","캘린더"],["meet","셀모임"],
  ["health","셀 건강"],["train","훈련 현황"],["stats","활동 통계"],["photos","사진 모아보기"],["help","도우미"],["more","더보기"]];
ICON.help = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7M12 16.9v.1"/></svg>`;
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
  else if (t === "help") openHelp("");
  else if (t === "train") openTrainBoard();
  else if (t === "stats") openStats();
  else if (t === "photos") openPhotos();
  else if (t === "inbox") openInbox();
  else if (t === "dir") openDir();
  else if (t === "health") openHealth();
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
    if (meSnap.exists()) {
      state.me = { id:user.uid, ...meSnap.data() };
      /* 21단계 — 처음 한 번(약관이 바뀌면 다시) 개인정보 동의 */
      if (!(state.me.consent && state.me.consent.v >= CONSENT_V)) { openConsent(); return; }
      await openHome(); return;
    }
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
      cellId: state.invite.cellId || null, cellIds: state.invite.cellIds || [],
      isLeader: !!state.invite.isLeader, jinIds: state.invite.jinIds || [],
      active:true, createdAt: serverTimestamp()
    });
    /* 명부에서 역할을 받아 초대됐으면, 그 명부 카드에 내 계정을 잇습니다 */
    if (state.invite.memberId) {
      const inv = state.invite;
      try { await updateDoc(doc(db, "members", inv.memberId), { uid: u.uid,
        role: (inv.role === "coach" && inv.isLeader) ? "coachleader" : inv.role, updatedAt: serverTimestamp() }); }
      catch {}
    }
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
  /* 담당 교역자는 맡은 진 여러 개를 진마다 따로 읽어 합칩니다 */
  const multi = (col) => Promise.all((me.jinIds||[]).map(j => getDocs(query(collection(db, col), where("jinId","==",j)))))
    .then(rs => ({ docs: rs.flatMap(r => r.docs) }));
  const mine = (col) => isSuper ? getDocs(collection(db, col))
    : me.role === "pastor" ? (col === "invites" ? Promise.resolve({ docs:[] }) : multi(col))
    : getDocs(query(collection(db, col), where("jinId","==",me.jinId)));
  try {
    const [jins, cells, users, invites, courses, mtypes, members] = await Promise.all([
      getDocs(collection(db,"jins")), mine("cells"), mine("users"), mine("invites"),
      getDocs(collection(db,"courses")), getDocs(collection(db,"meetTypes")),
      (me.jinId || isSuper || me.role === "pastor") ? mine("members") : Promise.resolve({ docs:[] })
    ]);
    state.dir = pack(members).sort((a,b)=>(a.name||"").localeCompare(b.name||"","ko"));
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
    /* 코치 · 진장은 '계정과 이어지지 않은 카드'만 목록으로 읽습니다(linked == false).
       그래야 서버가 '이 목록에 내 카드가 섞일 수 없다'를 질의만 보고 확인할 수 있어요.
       계정과 이어진 카드(셀리더 카드 · 역할을 받은 사람 카드)는 명부를 보고 한 장씩 엽니다 —
       한 장씩 열 때는 서버가 실제 값으로 '내 카드인지'를 확인합니다. */
    if (me.role === "coach") {
      /* 규칙이 '같은 진'까지 확인하므로 질의에도 진을 함께 겁니다 */
      const res = await Promise.all((me.cellIds||[]).map(cid =>
        getDocs(query(col, where("cellId","==",cid), where("jinId","==",me.jinId), where("linked","==",false)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "jinjang")
      push(pack(await getDocs(query(col, where("jinId","==",me.jinId), where("linked","==",false)))));
    /* 담당 교역자 — 카드를 맡은 사람이 '교역자에게 보이기'로 둔 것만 */
    if (me.role === "pastor") {
      const res = await Promise.all((me.jinIds||[]).map(j =>
        getDocs(query(col, where("jinId","==",j), where("pastorShare","==",true), where("linked","==",false)))));
      res.forEach(r => push(pack(r)));
    }
    if (me.role === "coach" || me.role === "jinjang" || me.role === "pastor") {
      const want = new Set();
      (state.dir||[]).forEach(m => {
        if (m.active === false || m.uid === me.id) return;
        if (!(m.uid || m.linkedEmail || (m.role && m.role !== "member"))) return;
        if (me.role === "coach" && !(me.cellIds||[]).includes(m.cellId)) return;
        if (me.role === "pastor" && !(me.jinIds||[]).includes(m.jinId)) return;
        (m.soulIds||[]).forEach(id => { if (!seen[id]) want.add(id); });
      });
      const got = await Promise.all([...want].map(id => getDoc(doc(db,"souls",id))
        .then(d => d.exists() ? { id:d.id, ...d.data() } : null).catch(() => null)));
      push(got.filter(Boolean));
    }
    state.souls = mergeDir(out.filter(s=>s.active!==false)).sort(bySeq);
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
    if (me.role === "pastor") {
      const res = await Promise.all((me.jinIds||[]).map(j =>
        getDocs(query(col, where("jinId","==",j), where("share","==","pastor")))));
      res.forEach(r => push(pack(r)));
    }
    state.meetings = out.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
    state.meetingsAt = Date.now();
  } catch (e) { state.meetings=[]; toast(msgOf(e)); }
}
async function loadRecords(soulId, canSeeAll) {
  const col = collection(db,"souls",soulId,"records");
  try {
    let rows = [];
    if (canSeeAll) {
      const parts = await Promise.all(recQueries(col, true));
      rows = parts.flatMap(pack);
    } else rows = (await Promise.all(recQueries(col, false))).flatMap(pack);
    const seen = {};
    state.records = rows.filter(r => seen[r.id] ? false : (seen[r.id]=true))
      .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  } catch (e) { state.records=[]; toast(msgOf(e)); }
}
/* 한 사람 카드의 기록 — 규칙이 허락하는 세 갈래(내가 쓴 것 · 담당 공개 · 코치 공유)로 나눠 읽습니다.
   조건 없이 한 번에 읽으면 서버가 질의를 거절합니다. */
async function fetchRecords(soulId, canSeeAll) {
  const col = collection(db,"souls",soulId,"records");
  const parts = await Promise.all(recQueries(col, canSeeAll));
  const seen = {};
  return parts.flatMap(pack).filter(r => seen[r.id] ? false : (seen[r.id] = true));
}
/* 내 영혼들의 기록을 한꺼번에 (검색 · 캘린더용) */
/* 19단계 — 예전에는 영혼 한 명씩 차례로 읽어서(한 명 끝나야 다음 사람) 영혼이 늘수록
   홈이 늦게 떴습니다. 이제 모든 영혼을 한꺼번에 요청하고, 이미 읽는 중이면 그걸 같이 기다립니다. */
async function loadAllRecords(force) {
  if (state.allRecords && !force) return state.allRecords;
  if (state.recP && !force) return state.recP;
  const souls = state.souls.slice();
  state.recP = (async () => {
    const parts = await Promise.all(souls.map(async (s) => {
      try {
        const rows = await fetchRecords(s.id, isLeaderOf(s));
        return rows.map(r => ({ ...r, soulId:s.id, soulName:s.name }));
      } catch { return []; }
    }));
    state.allRecords = parts.flat().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
    return state.allRecords;
  })();
  try { return await state.recP; } finally { state.recP = null; }
}
async function loadAllTrainings(force) {
  if (state.allTrainings && !force) return state.allTrainings;
  if (state.trP && !force) return state.trP;
  const souls = state.souls.slice();
  state.trP = (async () => {
    const parts = await Promise.all(souls.map(s =>
      getDocs(collection(db,"souls",s.id,"trainings"))
        .then(r => pack(r).map(t => ({ ...t, soulId:s.id, soulName:s.name }))).catch(() => [])));
    state.allTrainings = parts.flat();
    return state.allTrainings;
  })();
  try { return await state.trP; } finally { state.trP = null; }
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
  state.allRecords = null; state.allTrainings = null; state.recP = null; state.trP = null;
  state.soulsAt = 0; state.meetingsAt = 0;
  if (typeof gcalSoon === "function") gcalSoon();   // 27단계 — 고치면 구글 캘린더도 따라서
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

/* ════════ 홈 — 20단계 '전시실' ════════
   위에서부터: 오늘의 전시(기도할 영혼 · 코치는 셀 보고) → 오늘 챙길 사람 → 전시실(방 타일) → 관리 서랍.
   자주 쓰는 것은 방으로 크게, 가끔 쓰는 것은 서랍에 넣었습니다. */
async function openHome() {
  const me = state.me;
  startLive(); renderVerCard(); checkVersion(); noteUpdated(); renderWelcome();
  const now = new Date(), days = ["일","월","화","수","목","금","토"];
  $("home-date").textContent = `${now.getMonth()+1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;
  /* 19단계 — 홈은 '조직 · 영혼 · 셀모임'만 기다리고 바로 보여줍니다.
     기록(곧 만날 사람 · 1:1) · 명부 정리 · 인계 요청은 홈이 뜬 뒤 뒤에서 채웁니다. */
  const sees = canLead() || ["coach","jinjang","pastor"].includes(me.role);
  const [orgSnap] = await Promise.all([
    state.orgName ? Promise.resolve(null) : getDoc(doc(db,"org","main")).catch(() => null),
    loadOrg(), sees ? loadMeetings() : Promise.resolve()
  ]);
  if (orgSnap && orgSnap.exists()) state.orgName = orgSnap.data().name;
  $("home-title").textContent = state.orgName || APP_NAME;
  $("home-role").textContent = ROLE[me.role] || me.role;
  if (sees) await loadSouls(); else { state.souls=[]; state.meetings=[]; }

  const jin = state.jins.find(j=>j.id===me.jinId);
  const cell = state.cells.find(c=>c.id===me.cellId);
  const where1 = (me.role==="super" && !me.isLeader) ? "전체" : (cell?cell.name:(jin?jin.name:""));
  $("home-where").textContent = where1; $("home-where").hidden = !where1;
  $("side-who").innerHTML = `${esc(me.name||"")}<br>${esc(ROLE[me.role]||"")}${where1?" · "+esc(where1):""}`
    + `<br><button type="button" id="side-ver" style="background:none;border:none;padding:0;margin-top:4px;color:var(--faint);font:inherit;font-size:11px;cursor:pointer">버전 ${esc(APP_VERSION)}</button>`;
  $("home-ver").textContent = `버전 ${APP_VERSION.split(" ")[0]}`;
  $("btn-quick-add").hidden = !canLead();

  if (canLead()) { renderPray(); renderCare(); }
  else if (["coach","jinjang","pastor"].includes(me.role)) { renderReports(); renderCoachCare(); }
  else {
    $("home-pray").innerHTML = card("영혼 카드는 담당 리더만 열람해요",
      "수퍼 관리자는 사람과 진을 배치해요. 셀을 직접 맡고 있다면 리더 관리에서 '나도 셀을 맡아요'를 켜주세요.");
    $("home-soon").innerHTML = "";
  }
  renderRooms();
  $("btn-manage").hidden = !(me.role==="super" || me.role==="jinjang");
  $("btn-home-cellmgr").hidden = !isManager();
  $("btn-home-org").hidden = me.role !== "super";
  $("btn-home-import").hidden = me.role !== "super";
  $("btn-home-leaders").hidden = me.role !== "super";
  $("drawer-sub").textContent = [
    me.role==="super" ? "조직 구성" : "", isManager() ? "셀 관리" : "",
    (me.role==="super"||me.role==="jinjang") ? "리더 관리" : "", "교회 명부 · 알림 · 설정"
  ].filter(Boolean).join(" · ");
  renderHomeHand();
  markSide("home"); show("s-home");
  homeBackground();
  /* 기기 알림을 눌러 앱이 새로 열렸으면 바로 소식함으로 */
  if (state.openInboxOnStart) { state.openInboxOnStart = false; openInbox(); }
}
/* 홈이 뜬 뒤 — 명부 정리 · 인계 요청 · 기록(곧 만날 사람 · 1:1). 그 사이 다른 화면으로 가도 괜찮게 */
async function homeBackground() {
  const onHome = () => !$("s-home").hidden;
  try {
    await Promise.all([ensureDirectory(), loadHandovers()]);
    if (onHome()) { renderHomeHand(); renderRooms(); }
    if (canLead()) syncMyReports().catch(e => console.warn("보고 사본", e));
    if (canLead()) fillFromNotion().catch(e => console.warn("명단 채우기", e));
    if (canLead()) {
      await loadAllRecords();
      if (onHome()) { renderCare(); renderRooms(); }
      planAlarms();
      syncCalShare().catch(e => console.warn("캘린더 공유", e));
      gcalDoc().then(() => { renderGcal(); if (gcalTok()) gcalSync().catch(() => {}); });
    }
  } catch (e) { console.warn("홈 뒤 작업", e); }
}
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
/* 예전 이름을 부르는 곳이 남아 있어도 되게 */
function renderSoon() { renderCare(); }

const tile = (k,v) => `<div class="tile"><p class="k">${k}</p><p class="v">${v}</p></div>`;
const card = (h,b) => `<div class="card"><h3 class="serif" style="font-size:17px;font-weight:600">${h}</h3>
  <p class="muted" style="margin-top:8px">${b}</p></div>`;

/* ── 오늘의 전시 · 기도할 영혼 ──
   '기도했어요'를 누르면 오늘은 빠지고, 다 하면 '오늘 다 기도했어요'로 바뀝니다.
   다음 날이 되면 다시 떠요. 카드에서 아예 사라지는 건 기도제목이 모두 응답됐을 때예요. */
const prayList = () => state.souls.filter(s=>(s.prayOpen||0)>0 && isLeaderOf(s))
  .sort((a,b)=>String(a.lastPrayedAt||"").localeCompare(String(b.lastPrayedAt||"")));
const prayTodo = () => prayList().filter(s => s.lastPrayedAt !== todayStr());
function renderPray() {
  const all = prayList(), list = prayTodo();
  if (!all.length) {
    $("home-pray").innerHTML = card("기도제목을 적어보세요",
      "영혼 카드에서 기도제목을 추가하면, 여기에 오늘 기도할 영혼이 한 명씩 떠요."); return;
  }
  if (!list.length) {
    $("home-pray").innerHTML = `
      <section class="card" style="border-radius:20px;padding:20px">
        <span style="font-size:12px;letter-spacing:.06em;color:var(--brand)">오늘의 전시 · 기도할 영혼</span>
        <h2 class="serif" style="font-size:19px;font-weight:600;margin-top:12px">오늘 ${all.length}명 모두 기도했어요</h2>
        <p class="muted" style="margin-top:6px;font-size:13px">내일 아침에 다시 한 명씩 떠요.</p>
      </section>`;
    return;
  }
  if (state.prayIdx >= list.length) state.prayIdx = 0;
  const s = list[state.prayIdx], top = s.prayTop || {};
  $("home-pray").innerHTML = `
    <section class="card" style="border-radius:20px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;letter-spacing:.06em;color:var(--brand)">오늘의 전시 · 기도할 영혼</span>
        <span style="font-size:11px;color:var(--dim)">남은 ${list.length}명 / ${all.length}명</span>
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
      <p style="margin-top:14px;font-size:15px;line-height:1.75;color:var(--body-tx)">${esc(top.text||"기도제목을 적어주세요.")}</p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" style="height:48px" data-pray="${s.id}">기도했어요</button>
        ${list.length>1?`<button class="btn-ghost" style="width:48px;height:48px;flex-shrink:0;padding:0" data-next="1" aria-label="다음 영혼">›</button>`:""}
      </div>
    </section>`;
}
function openTodos() {
  const out = [];
  state.souls.filter(isLeaderOf).forEach(s =>
    (s.todos||[]).filter(t=>!t.done).forEach(t=>out.push({...t,soulId:s.id,soulName:s.name})));
  return out.sort((a,b)=>String(a.due||"9999").localeCompare(String(b.due||"9999")));
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

/* ── 오늘 챙길 사람 ──
   흩어져 있던 '곧 만날 사람 · 연속 결석 · 챙길 일 · 기념일'에
   20단계의 '결석 돌봄(연락 단계)'과 '1:1 오래된 사람'을 더해 한 장에 모읍니다. */
const careRow = (o) => `<div class="crow">
    <i class="dot" style="background:${o.dot||"var(--brand)"}"></i>
    <div class="grow" ${o.go||""}><p class="nm">${o.nm}</p>${o.sub?`<p class="sub">${o.sub}</p>`:""}</div>
    ${o.act?`<div class="cact">${o.act}</div>`:""}</div>`;
function careGroup(key, label, rows, limit) {
  if (!rows.length) return "";
  const n = limit || 4, open = state.careMore && state.careMore[key];
  const shown = open ? rows : rows.slice(0, n);
  return `<p class="care-g"><span>${label}</span><span>${rows.length}</span></p>${shown.join("")}${
    rows.length > n ? `<button class="more-btn" data-cmore="${key}">${open?"접기":`${rows.length-n}명 더 보기`}</button>` : ""}`;
}
function renderCare() {
  const box = $("home-soon"); if (!box) return;
  const recs = state.allRecords;   // 아직 안 왔으면 null
  const when = (d) => { const n = daysUntil(d);
    return n===0 ? "오늘" : n===1 ? "내일" : n===2 ? "모레" : `${fmtDate(d)} · ${n}일 뒤`; };

  /* ① 오늘 · 곧 — 셀모임과 예정된 만남 */
  const soonRows = [];
  state.meetings.filter(m=>{ const d=daysUntil(m.date); return d!==null && d>=0 && d<=7; })
    .sort((a,b)=>String(a.date).localeCompare(String(b.date))).forEach(m=>{
      const c=state.cells.find(x=>x.id===m.cellId);
      soonRows.push(careRow({ go:`data-gomeet2="${m.id}"`, nm:`${esc(c?c.name:"셀")} 셀모임`,
        sub:`${when(m.date)}${m.time?" "+esc(fmtSpan(m.time,m.timeEnd)):""}` }));
    });
  const plans = recs ? oneLinePerGroup(recs.filter(r=>r.planned && r.type==="meet")) : [];
  plans.filter(r=>{ const d=daysUntil(r.date); return d!==null && d>=0 && d<=7; })
    .sort((a,b)=>String(a.date).localeCompare(String(b.date))).forEach(r=>
      soonRows.push(careRow({ dot:"#E8B473", go:`data-gosoul6="${r.soulId}"`, nm:esc(planLine(r)),
        sub:`${when(r.date)}${r.time?" "+esc(fmtSpan(r.time,r.timeEnd)):""}${r.place?" · "+esc(r.place):""}` })));
  plans.filter(r=>{ const d=daysUntil(r.date); return d!==null && d<0; })
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,3).forEach(r=>
      soonRows.push(careRow({ dot:"var(--faint)", go:`data-gosoul6="${r.soulId}"`, nm:esc(planLine(r)),
        sub:`${fmtDate(r.date)} — 만나셨으면 기록을 채워주세요`, act:`<span class="chip warn">기록 비어 있음</span>` })));

  /* ② 결석 — 연락할 때 (다시 나오면 저절로 빠짐) */
  const absRows = state.souls.map(careDue).filter(Boolean)
    .sort((a,b)=>b.n-a.n).map(d=>{
      const s = d.s, tel = (s.phone||"").replace(/\D/g,""), last = (d.care.log||[]).slice(-1)[0];
      const stepNm = STEPS[d.step][1];
      const link = tel && d.step < 2
        ? `<a class="btn-sm" href="${d.step===0?"sms":"tel"}:${tel}" aria-label="${stepNm}">${d.step===0?"문자 열기":"전화 걸기"}</a>` : "";
      return careRow({ dot:"#E8B473", go:`data-gosoul="${s.id}"`, nm:`${esc(s.name)} · 결석 ${d.n}주`,
        sub:`${esc(whyText(d.why))}${last?` · 지난 연락: ${STEPNAME[last.step]||"연락"} ${fmtDate(last.at)}`:" · 아직 연락 전"}`,
        act:`${link}<button class="btn-sm" data-care="${s.id}" data-how="${STEPS[d.step][0]}">${stepNm}했어요</button>
             <button class="btn-sm" data-care="${s.id}" data-how="later" aria-label="일주일 뒤에 다시">1주 뒤</button>` });
    });

  /* ③ 1:1 오래된 사람 */
  const oneRows = !recs ? [] : state.souls.filter(s=>isLeaderOf(s) && !isLeaderCard(s))
    .map(s=>({ s, n: oneDays(s) })).filter(x=>x.n===null || x.n>=ONE_DUE)
    .sort((a,b)=>(b.n===null?-1:b.n)-(a.n===null?-1:a.n)).sort((a,b)=>(a.n===null)-(b.n===null))
    .map(({s,n})=>careRow({ dot:"#199e70", go:`data-gosoul="${s.id}"`, nm:esc(s.name),
      sub: n===null ? "1:1 기록이 아직 없어요" : `1:1 만난 지 ${n}일 지났어요`,
      act:`<button class="btn-sm" data-one="${s.id}">1:1 잡기</button>` }));

  /* ④ 챙길 일 · ⑤ 기념일 */
  const todoRows = openTodos().map(t=>careRow({ dot:"#9A8CF0", go:`data-gosoul="${t.soulId}"`,
    nm:`${esc(t.soulName)} · ${esc(t.text)}`,
    sub: t.due ? `${daysUntil(t.due)<0?"지남 · ":""}${fmtDate(t.due)}까지` : "날짜 없음",
    act:`<button class="btn-sm" data-done="${t.id}" data-soul="${t.soulId}">완료</button>` }));
  const annRows = upcomingAnnivs().map(a=>careRow({ dot:"#F24557", go:`data-gosoul="${a.id}"`,
    nm:`${esc(a.name)} ${a.label}`, sub:`${fmtDate(a.date)} · ${a.d===0?"오늘":"D-"+a.d}` }));

  /* ⑥ 셀리더 + 코치 · 진장 — 내가 돌보는 셀의 보고 확인 · 결석 (읽기만) */
  const lead2 = ["coach","jinjang"].includes(state.me.role);
  const cn = (id) => (state.cells.find(c=>c.id===id)||{}).name || "셀";
  const ckRows = !lead2 ? [] : state.meetings.filter(m=>m.leaderUid!==uid() && m.reportedAt && !m.check)
    .map(m=>careRow({ go:`data-gomeet2="${m.id}"`, nm:`${esc(cn(m.cellId))} · ${fmtDate(m.date)} 셀모임`,
      sub:`${fmtDate(m.reportedAt)} 보고`, act:`<button class="btn-sm" data-gomeet2="${m.id}">확인하기</button>` }));
  const otherRows = !lead2 ? [] : state.souls.filter(s=>!isLeaderOf(s) && !isLeaderCard(s)).map(s=>{
      const st = careStreak(attKey(s), attCell(s)); return st.n>=CARE_AT ? { s, st } : null; }).filter(Boolean)
    .sort((a,b)=>b.st.n-a.st.n).map(({s,st})=>careRow({ dot:"#E8B473", go:`data-gosoul="${s.id}"`,
      nm:`${esc(s.name)} · 결석 ${st.n}주`, sub:`${esc(cn(s.cellId))} · ${esc(whyText(st.why))}` }));
  const total = absRows.length + oneRows.length + todoRows.length + annRows.length + soonRows.length + ckRows.length + otherRows.length;
  box.innerHTML = `
    <section class="card" style="margin-top:14px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h3 style="font-size:15px;font-weight:600">오늘 챙길 사람</h3>
        <span class="muted" style="font-size:12px">${recs ? "" : "기록 불러오는 중…"}</span>
      </div>
      ${total ? "" : `<p class="muted" style="margin-top:10px;font-size:13px">오늘은 따로 챙길 사람이 없어요.</p>`}
      ${careGroup("ck", "확인할 셀 보고", ckRows)}
      ${careGroup("abs", "결석 — 연락할 때", absRows)}
      ${careGroup("soon", "오늘 · 곧", soonRows, 5)}
      ${careGroup("one", `1:1 만난 지 ${ONE_DUE}일 넘은 사람`, oneRows, 3)}
      ${careGroup("todo", "챙길 일", todoRows)}
      ${careGroup("anniv", "이번 주 기념일", annRows)}
      ${careGroup("oabs", "돌보는 셀 — 연달아 결석", otherRows)}
    </section>`;
}

/* ── 코치 · 진장 홈 ── 오늘의 전시 = 셀 보고 확인, 챙길 사람 = 맡은 셀의 결석 */
function renderReports() {
  const pastor = state.me.role === "pastor";
  const mine = state.meetings.filter(m => daysSince(m.date) !== null && daysSince(m.date) >= 0 && daysSince(m.date) <= 30
    && m.leaderUid !== uid());
  const wait = pastor ? mine.filter(m => m.reportedAt) : mine.filter(m => m.reportedAt && !m.check);
  const cellsSeen = seenCells();
  const quiet = pastor ? [] : cellsSeen.filter(c => !state.meetings.some(m => m.cellId === c.id
    && daysSince(m.date) !== null && daysSince(m.date) >= 0 && daysSince(m.date) <= 8));
  const cn = (id) => (state.cells.find(c=>c.id===id)||{}).name || "셀";
  $("home-pray").innerHTML = `
    <section class="card" style="border-radius:20px;padding:20px">
      <span style="font-size:12px;letter-spacing:.06em;color:var(--brand)">오늘의 전시 · 셀 보고</span>
      <h2 class="serif" style="font-size:19px;font-weight:600;margin-top:12px">${
        pastor ? (wait.length ? `최근 30일 셀 보고 ${wait.length}건` : "공유된 셀 보고가 아직 없어요")
        : wait.length ? `확인을 기다리는 보고 ${wait.length}건` : "기다리는 보고가 없어요"}</h2>
      <div style="margin-top:8px">
        ${wait.map(m=>careRow({ go:`data-gomeet2="${m.id}"`, nm:`${esc(cn(m.cellId))} · ${fmtDate(m.date)} 셀모임`,
          sub:`출석 ${Object.values(m.attendance||{}).filter(v=>v&&v!=="absent").length}명 · ${fmtDate(m.reportedAt)} 보고${m.check?` · ${esc(m.check.name||"")} 확인`:""}`,
          act:`<button class="btn-sm" data-gomeet2="${m.id}">${pastor?"보기":"확인하기"}</button>` })).join("")}
        ${quiet.length ? careGroup("quiet", "최근 8일 셀모임 기록 없음",
          quiet.map(c=>careRow({ dot:"var(--faint)", nm:esc(c.name), sub:esc(leaderLabel(c.id)) })), 4) : ""}
      </div>
    </section>`;
}
function renderCoachCare() {
  const rows = state.souls.filter(s => !isLeaderCard(s)).map(s => {
    const st = careStreak(attKey(s), attCell(s)); return st.n >= CARE_AT ? { s, st } : null;
  }).filter(Boolean).sort((a,b)=>b.st.n-a.st.n).map(({s,st})=>{
    const c = state.cells.find(x=>x.id===s.cellId);
    const last = (s.care && s.care.ep === st.ep && (s.care.log||[]).slice(-1)[0]) || null;
    return careRow({ dot:"#E8B473", go:`data-gosoul="${s.id}"`, nm:`${esc(s.name)} · 결석 ${st.n}주`,
      sub:`${esc(c?c.name:"")} · ${esc(whyText(st.why))}${last?` · 셀리더 연락: ${STEPNAME[last.step]||"연락"} ${fmtDate(last.at)}`:" · 셀리더 연락 전"}` });
  });
  $("home-soon").innerHTML = `
    <section class="card" style="margin-top:14px">
      <h3 style="font-size:15px;font-weight:600">${state.me.role==="jinjang"?"우리 진에서":state.me.role==="pastor"?"공유된 카드 중":"맡은 셀에서"} 챙길 사람</h3>
      ${rows.length ? careGroup("cabs", `${CARE_AT}주 이상 연달아 결석`, rows, 6)
        : `<p class="muted" style="margin-top:10px;font-size:13px">연달아 빠진 사람이 없어요.</p>`}
    </section>`;
}

/* ── 전시실 — 방 타일 ── */
function renderRooms() {
  const me = state.me, room = (k, label, big, small, hot) =>
    `<button class="room" data-room="${k}"><span class="k">${label}</span>
      <span class="v"><b>${big}</b>${small?`<span class="${hot?"hot":""}">${small}</span>`:""}</span></button>`;
  const recs = state.allRecords;
  const weekEv = () => {
    let n = state.meetings.filter(m=>{ const d=daysUntil(m.date); return d!==null && d>=0 && d<=7; }).length;
    if (recs) n += oneLinePerGroup(recs.filter(r=>r.planned && r.type==="meet"))
      .filter(r=>{ const d=daysUntil(r.date); return d!==null && d>=0 && d<=7; }).length;
    return n;
  };
  const rate8 = () => {
    const recent = state.meetings.filter(m=>daysSince(m.date)!==null && daysSince(m.date)>=0).slice(0,8);
    return recent.length ? Math.round(recent.reduce((sum,m)=>{
      const v = Object.values(m.attendance||{}); return sum + (v.length ? v.filter(x=>x!=="absent").length/v.length : 0);
    },0)/recent.length*100)+"%" : "—";
  };
  const interns = () => state.souls.filter(s=>s.intern && !isLeaderCard(s)).length;
  let html = "";
  if (canLead()) {
    const mine = state.souls.filter(isLeaderOf);
    const careN = mine.filter(s=>careDue(s) || s.status==="care").length;
    const checkN = ["coach","jinjang"].includes(me.role)
      ? state.meetings.filter(m=>m.leaderUid!==uid() && m.reportedAt && !m.check).length : 0;
    const unrep = state.meetings.filter(m=>m.leaderUid===uid() && !m.reportedAt
      && daysSince(m.date)!==null && daysSince(m.date)>=0 && daysSince(m.date)<=14).length;
    const monthMeets = recs ? recs.filter(r=>r.type==="meet" && !r.planned && !r.away
      && String(r.date||"").slice(0,7)===todayStr().slice(0,7)).length : "—";
    html = room("souls","영혼들", mine.length, careN?`돌봄 필요 ${careN}`:"명", careN>0)
      + room("meet","셀모임", rate8(), checkN?`확인할 보고 ${checkN}`:unrep?`보고 전 ${unrep}`:"최근 출석률", unrep>0||checkN>0)
      + room("reports","셀 보고 모아보기", "진", "모든 셀 보고")
      + room("cal","캘린더", weekEv(), "이번 주 일정")
      + room("health","셀 건강", interns(), "인턴")
      + room("dir","교회 명부", dirCountTxt(), `셀 ${state.cells.length}개`)
      + room("train","훈련 현황", state.courses.length, "과정")
      + room("stats","활동 통계", monthMeets, "이번 달 만남")
      + room("photos","사진", "보기", "셀모임 · 만남 사진")
      + room("orgchart","조직도", "보기", "진장 · 코치 · 셀")
      + (me.role === "super" ? room("leaders","셀리더 명단", leaderSeatStats().n, leaderSeatStats().txt, leaderSeatStats().noe > 0) : "");
  } else if (["coach","jinjang","pastor"].includes(me.role)) {
    const pastor = me.role === "pastor";
    const wait = state.meetings.filter(m=>m.reportedAt && (pastor || !m.check) && m.leaderUid!==uid()).length;
    const careN = state.souls.filter(s=>!isLeaderCard(s) && careStreak(attKey(s),attCell(s)).n>=CARE_AT).length;
    html = room("souls", pastor?"공유된 카드":"영혼들", state.souls.length, careN?`결석 돌봄 ${careN}`:"명", careN>0)
      + room("meet","셀 보고", wait, pastor?"공유된 보고":wait?"확인 기다림":"기다리는 보고 없음", !pastor && wait>0)
      + room("reports","셀 보고 모아보기", "진", pastor ? "공유된 셀 보고" : "모든 셀 보고")
      + room("health","셀 건강", seenCells().length, `셀 · 인턴 ${interns()}`)
      + room("dir","교회 명부", dirCountTxt(), `셀 ${state.cells.length}개`)
      + room("train","훈련 현황", state.courses.length, "과정")
      + room("cal","캘린더", weekEv(), "이번 주 셀모임")
      + room("orgchart","조직도", "보기", "진장 · 코치 · 셀");
  } else {
    const pendingN = state.invites.filter(i=>i.status==="pending").length;
    html = room("dir","교회 명부", dirCountTxt(), "명")
      + room("leaders","셀리더 명단", leaderSeatStats().n, leaderSeatStats().txt, leaderSeatStats().noe > 0)
      + room("org","조직 구성", state.cells.length, `셀 · 초대 중 ${pendingN}`, pendingN>0)
      + room("orgchart","조직도", "보기", "진장 · 코치 · 셀")
      + room("cellmgr","셀 관리", state.jins.length, "진")
      + room("reports","셀 보고 모아보기", "보기", "모든 진 셀 보고")
      + room("usage","사용 현황", "보기", "기기 · 시간대");
  }
  $("home-rooms").innerHTML = html;
}
/* 내가 볼 수 있는 셀 — 셀리더는 내 셀, 코치는 맡은 셀, 진장은 진 전체 */
function seenCells() {
  const me = state.me;
  if (me.role === "jinjang") return state.cells.filter(c=>c.jinId===me.jinId);
  if (me.role === "pastor") return state.cells.filter(c=>(me.jinIds||[]).includes(c.jinId) && c.active!==false);
  if (me.role === "coach") {
    const ids = new Set([...(me.cellIds||[]), ...(canLead() ? ownCells().map(c=>c.id) : [])]);
    return state.cells.filter(c=>ids.has(c.id));
  }
  return ownCells();
}

$("s-home").addEventListener("click", async (ev) => {
  const rm = ev.target.closest("[data-room]");
  if (rm) {
    const k = rm.dataset.room;
    ({ souls:openSouls, meet:openMeet, cal:openCal, health:openHealth, dir:openDir, train:openTrainBoard,
       stats:openStats, photos:openPhotos, org:openOrg, orgchart:openOrgChart, cellmgr:openCellMgr, usage:openUsage,
       reports:()=>openReports(""), leaders:openLeaders }[k] || (()=>{}))();
    return;
  }
  const more = ev.target.closest("[data-cmore]");
  if (more) { state.careMore = state.careMore || {}; state.careMore[more.dataset.cmore] = !state.careMore[more.dataset.cmore];
    if (canLead()) renderCare(); else { renderReports(); renderCoachCare(); } return; }
  const cr = ev.target.closest("[data-care]");
  if (cr) {
    cr.disabled = true;
    try { await markCare(cr.dataset.care, cr.dataset.how);
      toast(cr.dataset.how === "later" ? "일주일 뒤에 다시 띄울게요." : "적어 두었어요. 그래도 안 나오면 일주일 뒤 다음 단계로 떠요.");
      renderCare(); renderRooms(); }
    catch (e) { toast(msgOf(e)); cr.disabled = false; }
    return;
  }
  const one = ev.target.closest("[data-one]");
  if (one) { state.soul = state.souls.find(x=>x.id===one.dataset.one) || state.soul;
    openLog(one.dataset.one, null, { kind:"one" }); return; }
  if (ev.target.closest("a[href^='tel:'],a[href^='sms:']")) return;
  const go = ev.target.closest("[data-gosoul]"); if (go) { openSoul(go.dataset.gosoul); return; }
  const g6 = ev.target.closest("[data-gosoul6]"); if (g6) { openSoul(g6.dataset.gosoul6); return; }
  const gm = ev.target.closest("[data-gomeet2]"); if (gm) { openMeeting(gm.dataset.gomeet2); return; }
  const next = ev.target.closest("[data-next]");
  if (next) { const n=prayTodo().length; state.prayIdx=(state.prayIdx+1)%Math.max(n,1); renderPray(); return; }
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
      s.todos = todos; toast("완료 처리했어요."); renderCare();
    } catch (e) { toast(msgOf(e)); }
  }
});
/* 관리 서랍을 열어 두면 다음에도 열린 채로 (이 기기에서만) */
try { $("home-drawer").open = localStorage.getItem("mokja-drawer") === "1"; } catch {}
$("home-drawer").addEventListener("toggle", () => {
  try { localStorage.setItem("mokja-drawer", $("home-drawer").open ? "1" : "0"); } catch {} });
$("btn-home-photos").onclick = () => openPhotos();
$("btn-home-notify").onclick = () => $("btn-notify-set").click();
$("btn-home-more").onclick = () => openMore();
$("btn-manage").onclick = () => openManage();
$("btn-back").onclick = () => openHome();
$("btn-quick-add").onclick = () => {
  const mine = state.souls.filter(isLeaderOf);
  if (!mine.length) { toast("먼저 영혼 카드를 하나 만들어 주세요."); openSouls(); return; }
  openLog(null, null);
};

/* ════════ 영혼 목록 ════════ */
async function openSouls() {
  if (!canMakeSoul() && !["coach","jinjang","pastor"].includes(state.me.role)) {
    toast("영혼 카드는 담당 리더만 볼 수 있어요. 리더 관리에서 '나도 셀을 맡아요'를 켤 수 있어요."); return;
  }
  show("s-loading");
  await loadOrg(); await loadSouls(); await loadMeetings();
  if (canLead()) await loadSelfCard();
  await ensureDirectory();
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
  /* 27단계 — 명함처럼: 같은 크기 카드 · 같은 자리에 같은 정보 (만남 · 1:1 · 출석 · 기도) */
  const dago = (n) => n === null ? "없음" : n <= 0 ? "오늘" : n === 1 ? "어제" : `${n}일 전`;
  const tone = (r) => r === null ? "" : r >= 75 ? "good" : r >= 50 ? "mid" : "low";
  const stat = (k, v, cls) => `<div class="sc-st ${cls || ""}"><span>${k}</span><b>${v}</b></div>`;
  const scard = (o) => `<div class="scard${o.cls ? " " + o.cls : ""}" ${o.attr} style="cursor:pointer">
      <div class="sc-top">${o.ava}
        <div class="sc-id"><p class="sc-nm">${o.name}</p><p class="sc-sub">${o.sub || "&nbsp;"}</p></div>
        <span class="chip ${o.chipCls || ""}">${o.chip}</span></div>
      <div class="sc-stats">${o.stats.join("")}</div>
      <div class="sc-foot">${o.foot.filter(Boolean).join("") || `<span class="sc-ok">특별히 챙길 일 없음</span>`}</div>
    </div>`;
  $("list-souls").innerHTML = list.map(s=>{
    const n = daysSince(s.lastMetAt), st = absentStreak(attKey(s),attCell(s));
    const rate = attendRate(attKey(s), attCell(s)), pray = s.prayOpen || 0;
    if (newView) {
      /* 새가족은 '등록하고 몇 주 지났나'가 제일 중요한 숫자입니다.
         반갑게 맞고는 정신없이 지내다 보면 석 달이 지나 있거든요. */
      const days = daysSince(s.registeredAt);
      const weeks = days === null ? null : Math.floor(days / 7) + 1;
      const met = metCount[s.id] || 0;
      const slow = weeks !== null && weeks >= 4 && met < 2;
      return scard({ attr: `data-open="${s.id}"`, ava: avatar(s, 52), name: esc(s.name),
        sub: weeks === null ? "교회 등록일을 적어주세요" : `등록 ${weeks}주차`,
        chip: slow ? "챙길 때" : "새가족", chipCls: slow ? "warn" : "rose",
        stats: [stat("등록", weeks === null ? "—" : `${weeks}주차`), stat("만남", `${met}번`),
          stat("출석", rate === null ? "—" : rate + "%", tone(rate)), stat("기도", pray ? pray : "—")],
        foot: [slow ? `<span class="tpill streak">4주가 지났는데 만남이 적어요</span>` : "",
          st >= 2 ? `<span class="tpill streak">결석 ${st}주</span>` : ""] });
    }
    const bt = birthText(s), bd = annivIn(s.birth), od = isLeaderCard(s) ? null : oneDays(s);
    return scard({ attr: `data-open="${s.id}"`, ava: avatar(s, 52), name: esc(s.name) + (s.intern ? ` <span class="chip intern" style="font-size:10.5px;padding:2px 8px;vertical-align:2px">인턴</span>` : ""),
      sub: (bt ? esc(bt) : "생일 미입력") + (bd !== null && bd <= 14 ? ` · 🎂 ${bd === 0 ? "오늘" : "D-" + bd}` : ""),
      chip: isLeaderCard(s) ? KINDLABEL[s.kind] : esc(STATUS[s.status] || "—"),
      chipCls: isLeaderCard(s) ? "" : s.status === "care" ? "warn" : "rose",
      stats: [stat("만남", dago(n), n !== null && n >= 30 ? "mid" : ""), stat("1:1", isLeaderCard(s) ? "—" : dago(od), od !== null && od >= 30 ? "mid" : ""),
        stat("출석", rate === null ? "—" : rate + "%", tone(rate)), stat("기도", pray ? pray : "—")],
      foot: [st >= 2 ? `<span class="tpill streak">결석 ${st}주</span>` : "",
        s.status === "care" ? `<span class="tpill warnp">돌봄 필요</span>` : ""] });
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
    $("list-souls").insertAdjacentHTML("afterbegin", scard({ cls: "me", attr: `data-mine="1"`, ava: meAvatar(52),
      name: esc(state.me.name || "나"), sub: "내 카드 — 최근 3개월", chip: "나 · 셀리더", chipCls: "rose",
      stats: [stat("셀모임 출석", a.marked ? `${a.came}/${a.marked}` : "—"), stat("함께한 모임", `${a.met}번`),
        stat("1:1", `${a.one}번`), stat("훈련", `${a.train}번`)],
      foot: [`<span class="tpill">기본은 나만 봐요</span>`] }));
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
let orderList = [], orderAfter = null, orderIntern = {};
function openOrderDlg(cellId, after) {
  const mine = state.souls.filter(s=>isLeaderOf(s) && (!cellId || s.cellId === cellId));
  if (!mine.length) { toast("순서를 정할 영혼이 없어요."); return; }
  orderList = mine.slice(); orderAfter = after || null;
  orderIntern = Object.fromEntries(mine.map(s => [s.id, !!s.intern]));
  $("order-err").textContent = ""; renderOrder(); dlgOrder.showModal();
}
function renderOrder() {
  $("order-list").innerHTML = orderList.map((s,i)=>`
    <div class="ordrow">
      <span class="no">${i+1}</span>
      <span class="who">${esc(s.name)}</span>
      <button type="button" class="int${orderIntern[s.id]?" on":""}" data-int="${s.id}" aria-pressed="${!!orderIntern[s.id]}">인턴</button>
      <button type="button" class="top" data-top="${i}" aria-label="맨 위로"${i===0?" disabled":""}>맨 위</button>
      <button type="button" data-up="${i}" aria-label="위로"${i===0?" disabled":""}>↑</button>
      <button type="button" data-down="${i}" aria-label="아래로"${i===orderList.length-1?" disabled":""}>↓</button>
    </div>`).join("");
}
$("order-list").addEventListener("click",(ev)=>{
  const it = ev.target.closest("[data-int]");
  if (it) { orderIntern[it.dataset.int] = !orderIntern[it.dataset.int]; renderOrder(); return; }
  const tp = ev.target.closest("[data-top]");
  if (tp) { const i = Number(tp.dataset.top); orderList.unshift(...orderList.splice(i, 1)); renderOrder(); return; }
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
    const writes = [], today = todayStr();
    orderList.forEach((s,i)=>{
      const p = {};
      if (s.seq !== i+1) p.seq = i+1;
      const iv = !!orderIntern[s.id];
      if (!!s.intern !== iv) { p.intern = iv; p.internSince = iv ? (s.internSince || today) : ""; }
      if (Object.keys(p).length) writes.push(updateDoc(doc(db,"souls",s.id), p).then(() => Object.assign(s, p)));
    });
    await Promise.all(writes);
    state.soulsAt = 0;
    orderList.forEach((s,i)=>{
      s.seq = i+1;
      const inList = state.souls.find(x=>x.id===s.id); if (inList) { inList.seq = i+1; inList.intern = s.intern; inList.internSince = s.internSince; }
    });
    await syncRankToDir(orderList).catch(e => console.warn("명부 순서", e));   // 29단계 — 명부에도 같은 순서 · 인턴
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
  state.alerts = [];
  await Promise.all([loadRecords(soulId, isLeaderOf(s)), loadTrainings(soulId), loadAlerts(soulId, isLeaderOf(s))]);
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
    + (s.intern?`<span class="chip ok">인턴</span>`:"")
    + (careDue(s)?`<span class="chip warn">결석 ${careDue(s).n}주 · 연락할 때</span>`:"")
    + (cell?`<span class="chip">${esc(cell.name)}${isLeaderCard(s)?" 담당":""}</span>`:"");
  const tel = (s.phone||"").replace(/\D/g,"");
  $("soul-contact").innerHTML = tel ? `
    <div style="display:flex;gap:8px;max-width:420px">
      <a class="btn-ghost" href="tel:${tel}" style="height:44px;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--text);font-size:13px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5h3l1.4 3.5-2 1.4a10.5 10.5 0 0 0 5.2 5.2l1.4-2 3.5 1.4v3a1.6 1.6 0 0 1-1.8 1.6C11.3 18.2 5.8 12.7 5.4 6.3A1.6 1.6 0 0 1 7 4.5Z"/></svg>전화</a>
      <a class="btn-ghost" href="sms:${tel}" style="height:44px;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--text);font-size:13px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5.5h15v11h-9l-4 3.5v-3.5h-2z"/></svg>문자</a>
    </div>` : "";
  $("soul-contact").insertAdjacentHTML("beforeend", shareBar(s));
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
    + (isLeaderCard(s)?"":` · ${oneText(s)}`)
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
  const cls = (scope==="coach"||scope==="pastor") ? "rose" : scope==="private" ? "lock" : "";
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
      ${(r.scope==="coach"||r.scope==="pastor") && !showSoul && state.me.role!=="pastor"?`<button class="btn-sm" data-cmt="${r.id}">댓글</button>`:""}
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
        <circle cx="42" cy="42" r="${R}" fill="none" style="stroke:var(--track)" stroke-width="9"/>
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
      <span><i class="present" style="background:var(--ok-strong);border-color:var(--ok-strong)"></i>출석</span>
      <span><i class="online" style="background:var(--online-bg);border-color:var(--online-line)"></i>온라인</span>
      <span><i class="absent" style="background:var(--rose-bg);border-color:var(--rose-line2)"></i>결석</span>
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
      ${alertBlock(s)}
      ${isLeaderCard(s) && !s.linkedUid ? "" : attendBlock(attKey(s), attCell(s))}
      ${state.shared.length ? `<div class="card" style="margin-bottom:12px;background:var(--rose-bg);border-color:var(--rose-line)">
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
          ${mine?`<button class="icon-btn" style="width:34px;height:34px;color:${t.done?"#F24557":"var(--faint)"}" data-tgl="${t.id}" aria-label="완료 전환">
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
      await loadTrainings(s.id); invalidate(); renderSoulBody(); toast("지웠어요."); syncMemberTrain(s.id); }
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
  $("log-scope").value = rec?rec.scope:(sharePrefs().recScope||"leader");
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
      /* 20단계 — 1:1 은 따로 '마지막 1:1'도 (홈의 '1:1 만난 지 ○일') */
      if (L.kind === "one" && date <= todayStr()) for (const soulId of [...new Set(touched)]) {
        const s = state.souls.find(x=>x.id===soulId);
        if (s && String(s.lastOneAt||"") >= date) continue;
        await updateDoc(doc(db,"souls",soulId), { lastOneAt: date });
        if (s) s.lastOneAt = date;
      }
    }
    /* 훈련 모임이면 피후원자마다 훈련 이력의 그 회차를 체크(또는 예정)합니다 */
    if (train) {
      for (const sid of base.sponseeIds) {
        await markSession(sid, course, L.sessionNo, date, !planned, base);
        syncMemberTrain(sid, true);
      }
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
  if (!editingRecId) $("r-scope").value = recKind==="heart"?"private":(sharePrefs().recScope||"leader");
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
  await saveSoulField({ baptizedAt:"" }); syncMemberField(state.soul, { baptizedAt:"" });
  dlgBap.close(); invalidate(); renderSoulBody(); toast("침례 날짜를 지웠어요.");
};
$("bp-save").onclick = async () => {
  const raw = $("bp-date").value.trim();
  if (!raw) { $("bap-err").textContent = "날짜를 적어주세요."; return; }
  const parsed = parseDateLoose(raw);
  if (parsed === null) {
    $("bap-err").textContent = "날짜 형식을 확인해 주세요. 2024-5-19 처럼 적어주세요."; return;
  }
  await saveSoulField({ baptizedAt: parsed }); syncMemberField(state.soul, { baptizedAt: parsed });
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
    await loadTrainings(state.soul.id); invalidate(); bump("trainSave"); syncMemberTrain(state.soul.id);
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
    syncMemberTrain(state.soul.id);
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
  if (calOther()) await loadOtherCal(state.calWho);
  renderCal(); markSide("cal"); show("s-cal");
  gcalDoc().then(() => renderGcal());
  if (canLead()) syncCalShare().catch(e => console.warn("캘린더 공유", e));
}
function calEvents() {
  if (calOther()) return otherCalEvents();
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
  renderCalWho();
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
  $("btn-cal-add").hidden = calOther() || !canLead();
  $("btn-ics").hidden = calOther();
  if (calOther()) { renderOtherDay(list); return; }
  $("cal-day-list").innerHTML = list.length ? list.map((e,i)=>`
    <div class="row">
      <i style="width:8px;height:8px;border-radius:999px;background:${e.color};flex-shrink:0"></i>
      <div class="grow"><p class="nm">${esc(e.title)}</p>
        <p class="sub">${[fmtSpan(e.time,e.timeEnd),e.place,e.sub]
          .filter(Boolean).map(esc).join(" · ")||"&nbsp;"}</p></div>
      <button class="btn-sm" data-gcal="${i}">캘린더에</button>
      ${ds >= todayStr() ? `<button class="btn-sm" data-ics="${i}">알림 넣기</button>` : ""}
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
  const ic=ev.target.closest("[data-ics]");
  if (ic) {
    const list = calEvents().filter(e=>e.date===state.calPick)
      .sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
    const e = list[Number(ic.dataset.ics)]; if (e) icsOne(e);
    return;
  }
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
$("btn-go-cal-help").onclick = async () => { await openCal(); setTimeout(() => $("gcal-box").scrollIntoView({ behavior: "smooth", block: "center" }), 200); };
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
  const myCells = activeCells().filter(c=>c.jinId===state.me.jinId);
  let use = myCells.length?myCells:activeCells();
  /* 셀리더는 자기 셀에만 새 사람을 넣습니다 (다른 셀로 옮기는 건 진장 · 코치가 '셀 관리'에서) */
  if (!isManager() && state.me.cellId)
    use = use.filter(c => c.id === state.me.cellId || (s && c.id === s.cellId));
  $("e-cell").innerHTML = use.length?use.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")
    :`<option value="">아직 셀이 없어요</option>`;
  const canAddCell = state.me.role==="super"||state.me.role==="jinjang";
  $("no-cell-help").innerHTML = use.length?"":`
    <div class="card" style="margin-bottom:14px;background:var(--warn-bg);border-color:var(--warn-line);max-width:560px">
      <p style="font-size:13px;line-height:1.7;color:var(--warn-sub)">셀이 아직 없어요. 셀이 없어도 저장은 되지만, 출석 체크를 하려면 셀이 필요해요.</p>
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
  /* 한 번 이어진 계정은 바꿀 수 없습니다 — 풀면 그분이 자기 카드를 보게 될 수 있어서 */
  $("e-link").disabled = !!(s && s.linkedUid);
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
  leader: "출석 명단에는 안 나와요. 진장이 봅니다(카드에서 '담당 코치에게 보임'을 켜면 그 셀 코치도). 본인은 못 봐요.",
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
  const old = state.editingId ? (state.souls.find(x=>x.id===state.editingId)||{}) : {};
  if (kind === "member") {
    /* 이어진 계정(linkedUid)은 건드리지 않습니다 — 지우면 본인 차단이 풀려요 */
    data.kind = "member"; data.cellId = $("e-cell").value || null;
    data.ofCellId = null;
  } else {
    /* 셀리더·코치 카드는 cellId 를 비워둡니다. 그래야 그 셀의 출석
       명단에 안 들어가고, 코치에게는 ofCellId 로만 열립니다. */
    data.kind = kind; data.cellId = null;
    data.ofCellId = kind === "leader" ? ($("e-ofcell").value || null) : null;
    if (!old.linkedUid) data.linkedUid = $("e-link").value || "";
    if (data.linkedUid && data.linkedUid === state.me.id) {
      $("edit-err").textContent = "내 계정을 연결할 수는 없어요. 자기 카드는 자기가 가질 수 없습니다.";
      $("btn-save-soul").disabled = false; return;
    }
    /* 이으면 그분 이메일로도 막고, 그분 명부 카드와도 잇습니다 */
    const lu = data.linkedUid && userOf(data.linkedUid);
    if (lu && !old.subjectEmail) data.subjectEmail = lu.email || "";
    const lm = data.linkedUid && memberOfUid(data.linkedUid);
    if (lm) data.memberId = lm.id;
  }
  data.linked = linkedData({ ...old, ...data });
  $("btn-save-soul").disabled=true;
  try {
    let soulId=state.editingId;
    if(soulId) await updateDoc(doc(db,"souls",soulId),data);
    else {
      const ref=await addDoc(collection(db,"souls"),{ linkedUid:"", subjectEmail:"", ...shareDefaults(data.kind||"member"), ...data,
        jinId:state.me.jinId, leaderUid:state.me.id,
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
      data.thumb = state.editThumb || "";
    } else data.thumb = old.thumb || "";
    /* 명부(바깥 겹)도 같이 맞춥니다 — 이름 · 사진 · 연락처 같은 기본 사항만 */
    await syncMemberFromSoul(soulId, { ...old, ...data, jinId: old.jinId || state.me.jinId });
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
  if(!canLead() && !["coach","jinjang","pastor"].includes(state.me.role)){
    toast("셀모임은 셀을 맡은 분과 코치·진장 · 담당 교역자가 볼 수 있어요."); return; }
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
      ${m.check?`<span class="chip ok">확인됨</span>`:m.reportedAt?`<span class="chip warn">보고함</span>`:""}
      <span class="chip">${v.length?Math.round(ok/v.length*100)+"%":"—"}</span></div>`;
  }).join("") || `<p class="muted">아직 모임 기록이 없어요. 오른쪽 위 + 를 눌러 이번 주 모임을 만들어요.</p>`;
  $("btn-meet-new").hidden = !canLead();
  $("btn-meet-all").hidden = !state.me.jinId && state.me.role !== "pastor" && state.me.role !== "super";
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

  /* 셀원 + (진장이 보면) 셀리더 목양 카드 — 셀리더 출석은 계정 ID로 셉니다 */
  const souls = state.souls.filter(s=>attCell(s) && cellMeetings(attCell(s)).length);
  const sortLow = state.meetSort === "low";
  let people = souls.map(s=>({ s, rate: attendRate(attKey(s), attCell(s)) }))
    .filter(x=>x.rate!==null);
  /* 기본은 셀리더가 정한 순서(영혼들 '순서'와 같음), 셀리더 카드는 맨 위 */
  if (sortLow) people.sort((a,b)=>a.rate-b.rate);
  else people.sort((a,b)=>(isLeaderCard(b.s)?1:0)-(isLeaderCard(a.s)?1:0));
  /* 나(셀리더) — 내 셀모임에서 내 출석 */
  const myMs = state.meetings.filter(m=>m.leaderUid===uid() && (m.attendance||{})[uid()]);
  const myRate = canLead() && myMs.length
    ? Math.round(myMs.filter(m=>m.attendance[uid()]!=="absent").length/myMs.length*100) : null;
  if (myRate !== null) {
    const me = { s:{ id:"__me", name:(state.me.name||"나") }, rate:myRate, me:true };
    if (sortLow) { people.push(me); people.sort((a,b)=>a.rate-b.rate); } else people.unshift(me);
  }

  box.innerHTML = `
    <div class="card" style="margin-top:14px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
        <h3 style="font-size:13px;font-weight:600">주차별 출석률</h3>
        <span class="muted" style="font-size:12px;display:inline-flex;align-items:center;gap:5px">
          최근 ${recent.length}회
          <i style="width:14px;border-top:1px dashed var(--faint);display:inline-block"></i>평균 ${avg}%
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
        <span style="display:flex;gap:6px;align-items:center">
          <span class="seg" style="margin:0" id="meet-sort">
            <button type="button" data-ms="seq" class="${sortLow?"":"on"}" style="padding:6px 10px;font-size:12px">정한 순서</button>
            <button type="button" data-ms="low" class="${sortLow?"on":""}" style="padding:6px 10px;font-size:12px">낮은 순</button>
          </span>
          ${canLead()?`<button type="button" class="btn-sm" id="btn-meet-order">순서 정하기</button>`:""}
        </span>
      </div>
      <div class="hbars">${people.map(({s,rate,me})=>`
        <div class="hb${rate<60?" low":""}" ${me?`data-gomine="1"`:`data-gosoul5="${s.id}"`} style="cursor:pointer">
          <span class="who">${esc(s.name)}${me?` <span class="chip rose" style="font-size:10px;padding:1px 6px">나</span>`
            : isLeaderCard(s)?` <span class="chip" style="font-size:10px;padding:1px 6px">셀리더</span>`:""}</span>
          <span class="track"><i style="width:${Math.max(rate,2)}%"></i></span>
          <span class="pct">${rate}%</span>
        </div>`).join("")}</div>
      <p class="muted" style="font-size:11px;margin-top:12px">
        이름을 누르면 그 사람 카드가 열려요. 60%가 안 되면 숫자를 노란색으로 표시했어요.</p>
    </div>` : ""}`;
}
$("meet-chart").addEventListener("click",(ev)=>{
  const so = ev.target.closest("[data-ms]");
  if (so) { state.meetSort = so.dataset.ms; renderMeetChart(); return; }
  if (ev.target.closest("#btn-meet-order")) { openOrderDlg(null, () => renderMeetChart()); return; }
  if (ev.target.closest("[data-gomine]")) { openMine(); return; }
  const b = ev.target.closest("[data-gosoul5]"); if(!b) return; openSoul(b.dataset.gosoul5);
});
$("btn-meet-new").onclick=()=>openMeeting(null);
$("btn-meet-all").onclick=()=>openReports("");
$("meeting-back").onclick=()=>
  (state.meeting && state.meeting.back==="cal") ? openCal()
  : (state.meeting && state.meeting.back==="rep") ? openReports() : openMeet();

function openMeeting(id, opts) {
  const o = opts || {};
  const m = id?state.meetings.find(x=>x.id===id):null;
  const cells = myCells();
  if(!m && !cells.length){ toast("먼저 셀을 만들어 주세요. 리더 관리에서 추가할 수 있어요."); return; }
  state.meeting = m ? { attendance:{}, reasons:{}, notes:{}, reasonKinds:{}, ...m } : {
    id:null, cellId:defaultCellId(), jinId:state.me.jinId, date:o.date||todayStr(), time:"",
    timeEnd:"", place:"", topic:"", note:"", visitors:"",
    attendance:{}, reasons:{}, notes:{}, reasonKinds:{}, open:{} };
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
  state.meeting.reasonKinds = { ...(state.meeting.reasonKinds||{}) };
  renderReportBox();
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
      ${v==="absent"?`<div class="rsn">${Object.entries(REASON).map(([k,l])=>
          `<button data-rk="${s.id}" data-k="${k}" class="${(mt.reasonKinds[s.id]||"")===k?"on":""}" ${mine?"":"disabled"}>${l}</button>`).join("")}</div>
        <input data-reason="${s.id}" value="${esc(mt.reasons[s.id]||"")}"
        placeholder="한 줄 메모 (선택)" style="height:40px;margin-top:8px;font-size:14px" ${mine?"":"disabled"}>`:""}
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
  const rk=ev.target.closest("[data-rk]");
  if(rk){ const id=rk.dataset.rk, k=rk.dataset.k, R=state.meeting.reasonKinds;
    if (R[id]===k) delete R[id]; else R[id]=k; renderAttendance(true); return; }
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
    reasonKinds:Object.fromEntries(Object.entries(mt.reasonKinds||{}).filter(([k])=>mt.attendance[k]==="absent")),
    recRefs: mt.recRefs||{}, share: sharePrefs().meetPastor ? "pastor" : "", updatedAt:serverTimestamp() };
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
    try { await syncReport(mid, { ...data, recRefs:refs }); } catch (e) { console.warn("보고 사본", e); }
    await loadMeetings(); invalidate(); toast("저장했어요."); bump("meetingSave");
    if (mt.back === "cal") openCal(); else if (mt.back === "rep") openReports(); else openMeet();
  } catch(e){ $("meeting-err").textContent=msgOf(e); }
  finally { $("btn-meeting-save").disabled=false; }
};
$("meeting-del").onclick=async()=>{
  if(!state.meeting.id) return;
  if(!confirm("이 모임 기록을 지울까요? 각자 카드에 쌓인 나눔은 남아요.")) return;
  try { const gone = state.meeting.id; await deleteDoc(doc(db,"meetings",gone)); await dropReport(gone);
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
    absent.length?`결석: ${absent.map(s=>{ const why=[REASON[(mt.reasonKinds||{})[s.id]],mt.reasons[s.id]].filter(Boolean).join(" · ");
      return why?`${s.name}(${why})`:s.name; }).join(", ")}`:"",
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
  $("btn-go-cellmgr").hidden = !isManager();
  $("btn-manage-org") && ($("btn-manage-org").hidden = me.role !== "super");
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
/* 31단계 — 설치 안내는 도우미 › 홈 화면에 바로가기로 */
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
  await loadOrg(true); await syncBadges();
  $("btn-manage-org").hidden = state.me.role !== "super";
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
      : m.role==="coach"?`${m.isLeader?`맡은 셀 ${cellName(m.cellId)||"미정"} · `:""}담당 셀 ${(m.cellIds||[]).length}개`
      : jinName(m.jinId)+(m.isLeader?" · 셀 겸직":"");
    const canEdit = m.id!==state.me.id && m.role!=="super" && (isSuper||state.me.role==="jinjang");
    const roleOptions=(isSuper?["jinjang","coach","leader"]:["coach","leader"])
      .map(r=>`<option value="${r}"${m.role===r?" selected":""}>${ROLE[r]}</option>`).join("");
    return `<div class="row ${m.active?"":"off"}" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="grow"><p class="nm">${esc(m.name)} ${m.active?"":"· 중지됨"}</p>
          <p class="sub">${esc(m.email)}</p></div>
        <span class="chip ${m.role==="super"?"":"rose"}">${m.role==="coach"&&m.isLeader?"셀리더 + 코치":(ROLE[m.role]||m.role)}</span>
      </div>
      ${where1?`<p class="sub" style="margin-top:6px">${esc(where1)}</p>`:""}
      ${canEdit?`<div class="acts">
        <select class="btn-sm" data-act="role" data-uid="${m.id}" style="width:auto;padding:0 10px">${roleOptions}</select>
        ${m.role==="leader"?`<button class="btn-sm" data-act="lead" data-uid="${m.id}">맡은 셀 바꾸기</button>`:""}
        ${m.role==="coach"?`<button class="btn-sm" data-act="cells" data-uid="${m.id}">담당 셀</button>
          <button class="btn-sm" data-act="lead" data-uid="${m.id}">${m.isLeader?"맡은 셀":"자기 셀도 맡기"}</button>`:""}
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
  if(act==="lead") openLeadDlg(el.dataset.uid);
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
  /* 셀리더를 코치로 바꿔도 자기 셀은 계속 맡도록(셀 겸직을 켭니다) */
  const tm=state.members.find(x=>x.id===el.dataset.uid)||{};
  const patch={role:el.value};
  if(el.value==="coach" && tm.role==="leader") patch.isLeader=true;
  try{ await updateDoc(doc(db,"users",el.dataset.uid),patch);
    Object.assign(tm, patch); await syncBadges();
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
$("btn-cell-add").onclick=()=>openCellMgr();
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
  /* 우리 교회는 셀리더 중 한두 명이 코치를 겸합니다 — 그래서 '셀리더 + 코치'를 따로 둡니다 */
  $("iv-role").innerHTML=[
      ...(isSuper?[["jinjang","진장"]]:[]),
      ["leader","셀리더"], ["coachleader","셀리더 + 코치 (자기 셀도 맡고 다른 셀도 돌봄)"],
      ["coach","코치만 (셀은 안 맡음)"]]
    .map(([v,l])=>`<option value="${v}">${l}</option>`).join("");
  $("iv-role").value="leader";
  $("iv-jin-wrap").hidden=!isSuper;
  $("iv-jin").innerHTML=state.jins.map(j=>`<option value="${j.id}">${esc(j.name)}</option>`).join("");
  fillInviteCells(); $("iv-role").onchange=syncRole; $("iv-jin").onchange=()=>{ fillInviteCells(); fillInviteMembers(); };
  fillInviteMembers();
  syncRole(); dlg.showModal();
};
/* 명부에 이미 있는 분(아직 계정 없음)을 고르면 그 카드와 이어서 초대합니다 */
function fillInviteMembers() {
  const jinId=state.me.role==="super"?$("iv-jin").value:state.me.jinId;
  const list=(state.dir||[]).filter(m=>m.jinId===jinId && m.active!==false && !m.uid && !m.linkedEmail);
  $("iv-member").innerHTML=`<option value="">— 명부에 없는 새 사람 —</option>`
    + list.map(m=>`<option value="${m.id}">${esc(m.name)}${m.cellId?" · "+esc(cellNameOf(m.cellId)):""}</option>`).join("");
}
$("iv-member").onchange=()=>{
  const m=memberById($("iv-member").value);
  if(m){ $("iv-name").value=m.name||""; if(m.cellId && [...$("iv-cell").options].some(o=>o.value===m.cellId)) $("iv-cell").value=m.cellId; }
};
function fillInviteCells() {
  const jinId=state.me.role==="super"?$("iv-jin").value:state.me.jinId;
  const list=state.cells.filter(c=>c.jinId===jinId);
  $("iv-cell").innerHTML=(list.length?list.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")
    :"")+`<option value="">아직 안 정함 (나중에 셀 관리에서)</option>`;
}
const ROLEHINT = {
  jinjang:"진 전체를 봅니다. 셀리더 · 코치를 초대하고, 셀리더 목양 카드를 씁니다.",
  leader:"자기 셀의 영혼 카드 · 셀모임 · 만남을 기록합니다.",
  coachleader:"자기 셀도 맡고, 진장이 정해준 담당 셀의 '코치 공유' 기록도 봅니다. 담당 셀은 가입 뒤 '담당 셀'에서 정해요.",
  coach:"셀은 맡지 않고, 진장이 정해준 담당 셀만 돌봅니다."
};
function syncRole(){
  const v=$("iv-role").value;
  $("iv-cell-wrap").hidden=!(v==="leader"||v==="coachleader");
  $("iv-role-hint").textContent=ROLEHINT[v]||"";
}
$("iv-cancel").onclick=()=>dlg.close();
$("iv-send").onclick=async()=>{
  const name=$("iv-name").value.trim(), email=$("iv-email").value.trim().toLowerCase();
  const pick=$("iv-role").value;
  const role=pick==="coachleader"?"coach":pick;
  const isLeader=pick==="coachleader";
  const jinId=state.me.role==="super"?$("iv-jin").value:state.me.jinId;
  const cellId=(pick==="leader"||pick==="coachleader")?($("iv-cell").value||null):null;
  $("invite-err").textContent="";
  if(!name||!email){ $("invite-err").textContent="이름과 이메일을 적어주세요."; return; }
  if(!email.includes("@")){ $("invite-err").textContent="이메일 형식을 확인해 주세요."; return; }
  if(!jinId){ $("invite-err").textContent="먼저 진을 만들어 주세요."; return; }
  $("iv-send").disabled=true;
  try{
    const r=await sendInvite({ name, email, pick, jinId, cellId, memberId:$("iv-member").value||"" });
    if(r.err){ $("invite-err").textContent=r.err; return; }
    dlg.close(); toast(r.msg); openManage();
  }catch(e){ $("invite-err").textContent=msgOf(e); }
  finally{ $("iv-send").disabled=false; }
};
/* 초대 — '리더 초대하기'와 명부의 '역할 주기'가 같이 씁니다.
   명부 카드와 이어서 초대하면, 초대장을 만들기 '전에' 그분 목양 카드에 이메일 차단부터 겁니다.
   (그분이 로그인해 코치 · 진장 역할을 받는 순간 이미 막혀 있어야 하니까요) */
async function sendInvite({ name, email, pick, jinId, cellId, memberId, cellIds }) {
  const role = pick === "coachleader" ? "coach" : pick;
  const isLeader = pick === "coachleader";
  let exist = null;
  try { exist = await getDoc(doc(db,"invites",email)); } catch {}
  if (exist && exist.exists() && exist.data().status === "accepted") return { err:"이미 가입한 사람이에요." };
  if ((state.members||[]).some(u => (u.email||"").toLowerCase() === email))
    return { err:"이미 계정이 있는 이메일이에요. 명부에서 '역할 바꾸기'를 써주세요." };
  let warn = 0;
  if (memberId) {
    const m = memberById(memberId);
    for (const sid of (m && m.soulIds) || []) {
      try { await updateDoc(doc(db,"souls",sid), { subjectEmail: email, linked: true, memberId }); }
      catch { warn++; }
    }
    await updateDoc(doc(db,"members",memberId), { linkedEmail: email, invitedRole: pick, updatedAt: serverTimestamp() });
    if (m) Object.assign(m, { linkedEmail: email, invitedRole: pick });
  }
  await setDoc(doc(db,"invites",email),{ email, name, role, jinId, cellId, isLeader, cellIds: cellIds || [], status:"pending",
    ...(memberId ? { memberId } : {}), invitedBy:state.me.id, invitedAt:serverTimestamp() });
  await log("초대", email, role);
  return { msg: warn
    ? "초대했어요. 목양 카드 몇 장은 그 카드를 맡은 셀리더가 앱을 열 때 차단이 걸려요."
    : "초대했어요. 그분이 같은 이메일로 로그인하면 바로 들어와요." };
}

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
  search:"기록 검색", manage:"리더 관리", usage:"사용 현황", edit:"영혼 수정",
  dir:"교회 명부", cellmgr:"셀 관리", org:"조직 구성", inbox:"소식", photos:"사진 모아보기", stats:"활동 통계", mine:"내 카드" };
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
async function doHandover(soulId, toUid, pick, extra) {
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
    const sd = state.souls.find(x=>x.id===soulId) || {};
    const flag = linkedData(sd) ? { linked:true } : (sd.linked === undefined ? { linked:false } : {});
    await updateDoc(doc(db,"souls",soulId), { leaderUid: toUid, ...flag, ...(extra||{}) });
    /* 명부의 '목양 담당'도 새 사람으로 */
    if (sd.memberId) { try { await updateDoc(doc(db,"members",sd.memberId), { careUid: toUid }); } catch {} }
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
      meetingId, cellId, jinId: state.me.jinId, leaderUid: state.me.id, peers: repPhotos(),
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
  if (phOther()) await loadOtherPhotos(state.phWho);
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
  renderPhWho();
  if (phOther()) { renderOtherPhotos(); return; }
  $("ph-cells").hidden = false; document.querySelector('#ph-tabs [data-pht="meet"]').hidden = false;
  const ids = [...new Set([...state.souls.map(cellOfSoul), ...state.meetings.map(m=>m.cellId)]
    .filter(Boolean))];
  const cells = ids.map(id=>state.cells.find(c=>c.id===id)).filter(Boolean);
  if (state.phCell !== "all" && !ids.includes(state.phCell)) state.phCell = "all";
  $("ph-cells").innerHTML = `<button type="button" data-phc="all">전체</button>`
    + cells.map(c=>`<button type="button" data-phc="${c.id}">${cellChipIn(c)}</button>`).join("");
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
  if (stOther()) await loadOtherStats(state.stWho);
  renderStats(); show("s-stats");
}
function statsFrom(per) {
  if (per === "all") return "0000-00-00";
  const d = new Date();
  if (per === "y") return `${d.getFullYear()}-01-01`;
  d.setMonth(d.getMonth() - Number(per)); return ymd(d);
}
function renderStats() {
  whoChips("st-who", "st-who-hint", state.stWho, canLead() ? "내 통계" : "나",
    (u) => `${cellNameOf(u.cellId) || ""} ${u.name} 님 셀 — 셀모임 · 출석은 셀 보고에서, 만남은 횟수 · 종류만 (누구와 · 내용은 안 보여요).`);
  ["st-cells", "st-opts", "st-people"].forEach(id => { $(id).hidden = stOther(); });
  if (stOther()) { $("st-period").querySelectorAll("[data-per]").forEach(b => b.classList.toggle("on", b.dataset.per === state.st.per)); renderOtherStats(); return; }
  const S = state.st, from = statsFrom(S.per), to = todayStr();
  const inP = (d) => !!d && d >= from && d <= to;
  $("st-period").querySelectorAll("[data-per]").forEach(b=>b.classList.toggle("on", b.dataset.per===S.per));
  const ids = [...new Set(state.souls.map(cellOfSoul).filter(Boolean))];
  const cells = ids.map(id=>state.cells.find(c=>c.id===id)).filter(Boolean);
  if (S.cell !== "all" && !ids.includes(S.cell)) S.cell = "all";
  $("st-cells").innerHTML = `<button type="button" data-stc="all">전체</button>`
    + cells.map(c=>`<button type="button" data-stc="${c.id}">${cellChipIn(c)}</button>`).join("");
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
const meAvatar = (px) => avatar({ name: state.me.name,
  thumb: (state.selfCard && state.selfCard.thumb) || ((memberOfUid(uid())||{}).thumb) }, px);
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
    /* 명부의 내 카드에도 — 사진 · 연락처 · 생일(월 · 일) · 직분 · 등록일 · 침례 */
    const mm = memberOfUid(uid());
    if (mm) {
      const patch = { name: data.name, thumb: data.thumb, phone: data.phone, birthMD: mdOf(data.birth),
        lunar: data.lunar, position: data.position, registeredAt: data.registeredAt||"",
        baptizedAt: data.baptizedAt||"", updatedAt: serverTimestamp() };
      try { await updateDoc(doc(db,"members",mm.id), patch); Object.assign(mm, patch); } catch {}
    }
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
    const accM = memberOfUid(acc);
    await updateDoc(doc(db,"souls",s.id), {
      kind:"leader", cellId:null, ofCellId: $("pm-cell").value || null, linkedUid: acc,
      ...(s.subjectEmail ? {} : { subjectEmail: (m.email||"").toLowerCase() }), linked: true,
      ...(accM ? { memberId: accM.id } : {}) });
    /* 셀원으로 있던 명부 카드는 그분 계정의 명부 카드로 합칩니다 */
    if (accM) {
      try { await updateDoc(doc(db,"members",accM.id), { soulIds:[...new Set([...(accM.soulIds||[]), s.id])] }); } catch {}
      if (s.memberId && s.memberId !== accM.id) {
        try { await updateDoc(doc(db,"members",s.memberId), { active:false, mergedInto: accM.id, updatedAt: serverTimestamp() }); } catch {}
      }
    }
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
  { v:"31.0", d:"2026-11-10", items:[
    "도우미 — 그림과 짧은 단계로 보는 사용 안내 (처음 시작 · 홈 · 영혼 카드 · 셀모임 · 캘린더 · 명부 · 셀 건강 · 조직도 · 보안 · 자주 묻는 질문)",
    "홈 화면에 바로가기 — 아이폰 · 안드로이드 · 컴퓨터별 그림 안내, 바로 설치할 수 있는 기기는 [지금 설치]",
    "홈 위 (?) · 사이드바 '도우미' · 더보기에서 열기, 처음 쓰는 분께 홈에 한 줄 안내" ] },
  { v:"30.0", d:"2026-11-10", items:[
    "조직도 — 교회 → 진 → 진장 → 코치(맡은 셀) → 셀(셀리더 · 셀원 수 · 인턴 · 출석률)을 한 그림으로",
    "홈 전시실 · 관리 서랍 · 조직 구성에서 '조직도' 열기, 사람을 누르면 명부 카드 · 셀을 누르면 그 셀 명부",
    "교회 명부 목록(셀원 · 리더들 · 찾기) — '한눈에 보기' 비율 막대: 침례 · 새로운 삶 · 제자의 삶 · 정회원, 막대를 누르면 그 사람들만",
    "정렬 더 — 셀 번호순 · 가나다순 · 나이순 · 젊은순 · 출석률순 · 생일순(다가오는 순)" ] },
  { v:"29.0", d:"2026-11-09", items:[
    "셀원 순서 · 인턴 — 한 창에서 영적 순서(맨 위 · ↑ · ↓)와 인턴을 함께, 영혼 목록 · 출석 · 교회 명부 · 셀 건강에 모두 같은 순서",
    "인턴 표시 — 영혼 카드 이름 옆 · 교회 명부 카드에 '인턴'",
    "교회 명부 — 목록 보기에서 셀 번호순 · 가나다순 · 나이순 정렬",
    "교회 명부 › 통계 · 그래프 — 평균 나이 · 연령대 · 평균 출석률 · 출석률 분포 · 수료 현황 · 셀별 표 · 이번 달 생일",
    "셀 건강 — 사람 줄을 '순서대로' 또는 '자주 빠지는 순'으로" ] },
  { v:"28.0", d:"2026-11-09", items:[
    "구글 캘린더 — 오류가 'c.includes…'로 가려지던 문제 고침, 무엇이 빠졌는지(API 켜기 · 캘린더 허용) 그대로 알려줘요",
    "셀 건강 — 창이 아니라 화면으로, 고리 + 숫자 4칸 + 8주 출석 막대, 자주 빠지는 사람이 위로, 인턴은 눌러서",
    "캘린더 · 사진 · 활동 통계 — 같은 진 셀이 모두 보이고, 아직 가입 전인 셀리더는 흐리게",
    "홈 위 · 사이드바 아래에 버전" ] },
  { v:"27.0", d:"2026-11-09", items:[
    "다크 · 라이트 두 가지 화면 (더보기 › 화면 — 기기 설정 따르기도)",
    "셀 고르는 칸을 깔끔한 탭 상자로 — 셀 번호 아래 늘 셀리더 이름",
    "홈 · 더보기 — 폰 · 패드 · 컴퓨터마다 칸 배치",
    "영혼 카드 — 명함처럼 같은 크기, 만남 · 1:1 · 출석 · 기도가 같은 자리에",
    "교회 명부 — 셀리더 카드도 셀원과 같은 크기 (빨간 띠로 구분), 줄 맞춤",
    "셀 보고 — 셀을 고르면 옆에 출석 그래프 · 셀모임 캘린더, 모든 셀은 셀별 출석률 막대",
    "셀 건강 — 출석률 고리 · 8주 출석 막대 · 사람별 출석 줄",
    "활동 통계 — 같은 진 다른 셀 보기 (셀모임 · 출석 · 만남 횟수만)",
    "구글 캘린더 자동 넣기 — 한 번 연결하면 앱 일정이 내 구글 캘린더 '목자의 삶'에" ] },
  { v:"26.0", d:"2026-11-09", items:[
    "교회 명부 — 화면 넓이에 맞춰 1 · 2 · 3줄 (컴퓨터 · 패드 · 휴대폰), 셀리더 · 셀원 카드 크기를 고르게",
    "카드마다 칸이 정해진 정보 — 생년 · 생일 · 연락처 · 수료 훈련 · 최근 3개월 출석률",
    "명부 카드를 누르면 — 출석률 · 최근 셀모임 12번 출석 줄 · 연속 결석 · 기본 사항을 칸마다 깔끔하게",
    "캘린더 · 사진 — 같은 진 셀리더 · 코치 · 진장이 서로의 캘린더(셀모임 · 만남 일정)와 셀모임 사진을 봐요",
    "만남 일정은 날짜 · 시간 · 종류만 (누구와 · 내용은 안 보임), 공유 설정에서 끌 수 있어요" ] },
  { v:"25.0", d:"2026-11-09", items:[
    "셀이 어디서나 번호 순서대로 (1B01 · 1B03 · 1B05 …)",
    "셀 관리 — 셀마다 담당 셀리더 카드 (사진 · 몇 년생 · 생일 · 연락처 · 가족 · 수료 훈련)",
    "교회 명부 — 셀마다 맨 위에 셀리더, 그 아래로 셀원이 가지처럼 이어진 카드 배열 (넓은 화면은 두 줄)",
    "가입 전 셀리더도 '셀 없음'이 아니라 자기 셀 맨 위에" ] },
  { v:"24.0", d:"2026-11-09", items:[
    "셀리더 명단 (수퍼) — 셀마다 셀리더 · 가입 상태를 한눈에, 구글 이메일을 넣고 한꺼번에 초대",
    "초대받은 셀리더가 그 구글 계정으로 로그인하면 바로 그 셀 셀리더로 — 셀원 목양 카드가 생기고 노션 명단으로 채워져요",
    "홈 '교회 명부' 숫자가 가입한 계정 수가 아니라 명부 사람 수로" ] },
  { v:"23.0", d:"2026-11-09", items:[
    "보고서 가져오기에 명단도 — 연락처 · 생일 · 수료 훈련은 명부에, 가족 · 차량 · 기도제목은 잠긴 칸에",
    "잠긴 칸은 그 셀 셀리더 · 진장 · 코치 · 수퍼만 (본인과 다른 셀 셀리더는 못 봄 — 보안 규칙)",
    "셀리더가 앱을 열면 목양 카드에 생년월일 · 가족 · 메모 · 인턴 표시 · 기도제목이 저절로 채워져요 (빈 칸만)",
    "명부 카드에 '노션 명단' 칸 (볼 수 있는 사람에게만)" ] },
  { v:"22.0", d:"2026-11-09", items:[
    "셀 보고 모아보기 — 같은 진 셀리더 · 코치 · 진장이 다른 셀 보고(출석 · 주제 · 나눔)도 봐요",
    "사람별 나눔은 그 사람이 나중에 계정을 받아도 본인에게는 안 보여요 (보안 규칙)",
    "공유 설정에 '셀모임 나눔을 같은 진 셀리더에게' (기본 켜짐)",
    "보고서 가져오기 (수퍼) — 노션 셀 보고서를 한 번에. 가입 전 셀리더는 '이름만' 자리로, 나중에 이메일을 넣으면 초대",
    "가져올 때 이름 바꾸기 (동명이인 구분)" ] },
  { v:"21.0", d:"2026-11-08", items:[
    "셀리더 카드는 기본으로 진장만 — 진장이 고르면 그 셀 담당 코치 · 담당 교역자에게도",
    "공유 설정 — 새 기록의 기본 공개 범위, 셀모임 · 카드를 교역자에게 보일지 한 번에 정하기",
    "기록 공개 범위에 '교역자까지' 추가",
    "담당 교역자 — 진장 위 단계. 맡은 진에서 공유된 카드 · 기록 · 셀 보고만 봐요",
    "기관 소유자 — 수퍼 관리자를 세우고 빼기 · 소유권 넘기기 (목양 카드는 못 봄)",
    "처음 쓸 때 개인정보 동의 (동의하지 않아도 적은 내용은 그대로)",
    "셀리더 + 코치도 홈에서 확인할 셀 보고 · 돌보는 셀 결석이 보여요" ] },
  { v:"20.0", d:"2026-11-05", items:[
    "홈을 '전시실'로 — 오늘의 전시 · 오늘 챙길 사람 · 방 타일 · 관리 서랍",
    "결석 돌봄 — 연달아 빠지면 '연락할 때'에 뜨고 문자 → 전화 → 만남 순서로, 다시 나오면 저절로 빠져요",
    "결석 사유 고르기 — 아파서 · 집안 일 · 근무·출장 · 여행 · 모름 (출장 · 여행은 돌봄에 안 셈)",
    "1:1 만난 지 ○일 — 카드 · 영혼 목록 · 홈에",
    "민감 메모 — 카드 맨 위 빨간 표시, 눌러야 보여요 (나만 / 담당 / 코치까지)",
    "셀 건강 · 인턴 체크 — 8주 모임 · 평균 출석 · 새 방문자 · 인턴",
    "셀 보고 · 코치 확인 — 보고하면 코치 · 진장에게 소식, 확인과 한 줄 격려가 셀리더에게",
    "일정 미리 알림 — 폰 캘린더에 알림째 넣기, 앱이 켜져 있으면 1시간 전에 알려요",
    "기도했어요를 누르면 오늘은 빠지고, 다 하면 '오늘 모두 기도했어요'" ] },
  { v:"19.0", d:"2026-11-05", items:[
    "로그인 · 홈이 훨씬 빨리 떠요 — 꼭 필요한 것만 먼저 읽고, 나머지는 홈이 뜬 뒤에",
    "영혼들의 기록을 한 명씩 차례로 읽던 것을 한꺼번에 (영혼이 많아도 느려지지 않게)",
    "조직 구성 (수퍼) — 진 · 셀 · 진장 · 코치 · 셀리더 자리를 먼저 짜고 자리마다 구글 이메일",
    "가입 전인 분도 자리에 '초대 보냄'으로 보여서 구조가 바로 잡혀요",
    "여러 셀 한꺼번에 — 셀 이름 / 셀리더 / 이메일을 붙여넣기" ] },
  { v:"18.0", d:"2026-10-28", items:[
    "교회 명부 — 같은 진 사람을 이름 · 연락처로 찾기 (셀별 · 리더들 · 셀원)",
    "멤버 카드 두 겹: 명부(기본 사항)는 같은 진 리더 모두, 목양 카드는 맡은 사람만",
    "셀 관리 — 담당 셀리더 바꾸기 · 분가 · 멤버 옮기기 (진장 · 코치 · 수퍼)",
    "목양 카드는 지금 맡은 셀리더가 '얼마나 넘길지' 골라 넘김 (홈 맨 위에 요청이 떠요)",
    "명부에서 역할 주기 — 초대하는 순간부터 그분 목양 카드에 본인 차단",
    "보안: 목록으로 읽을 때도 내 카드가 섞이지 않게 (17단계 빈틈 막음)" ] },
  { v:"17.0", d:"2026-10-23", items:[
    "셀모임 사람별 출석률에 셀리더 본인('나')도",
    "사람별 출석률을 셀리더가 정한 순서로 (낮은 순으로도 볼 수 있음)",
    "초대할 때 '셀리더 + 코치' — 자기 셀도 맡고 다른 셀도 돌보는 역할",
    "리더 관리에서 코치에게 자기 셀 맡기기 · 셀리더 맡은 셀 바꾸기",
    "보안: 가입할 때 담당 셀 · 셀 겸직은 초대장에 적힌 그대로만" ] },
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
        <div class="grow"><p class="nm" style="white-space:normal">${n.kind==="handover"
            ? `${esc(n.fromName||"")} 님 — <b>${esc(n.title||"")}</b>`
            : `${esc(n.fromName||"")} 님이 <b>${esc(n.title||"")}</b>에 댓글을 남겼어요`}</p>
          <p class="sub" style="white-space:normal;margin-top:4px">“${esc(n.snippet||"")}” · ${fmtAgo(n.atMs)}</p></div>
      </div>`).join("") || `<p class="muted">아직 소식이 없어요. 내 셀모임이나 '코치 공유' 기록에 댓글이 달리거나, 셀 담당이 바뀌어 카드를 넘길 일이 생기면 여기 모여요.</p>`;
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
  if (t.kind === "handover") { if (isManager() && state.me.id !== t.fromUid) openCellMgr(); else openHome(); return; }
  if (t.kind === "meeting") {
    await loadMeetings(true);
    const m = state.meetings.find(x=>x.id===t.id);
    if (!m) { toast("지금은 볼 수 없는 모임이에요."); return; }
    openMeeting(m.id); if (!t.report) openComments(meetTarget(m));
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
const notifyPrefs = () => ({ comment:true, dm:true, device:false, plan:true, ...((state.me && state.me.notifyPrefs) || {}) });
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
  const title = kind === "dm" ? `${r.fromName||""} 님의 쪽지`
    : (r.kind === "handover" || r.kind === "report") ? `${r.fromName||""} 님 — ${r.title||"셀 관리"}` : `${r.fromName||""} 님이 댓글을 남겼어요`;
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
  $("nt-plan").checked = P.plan !== false;
  $("nt-err").textContent = "";
  if (!("Notification" in window)) { $("nt-device").disabled = true;
    $("nt-device-hint").textContent = "이 브라우저는 기기 알림을 지원하지 않아요. 아이폰은 홈 화면에 추가한 앱에서만 돼요."; }
  dlgNt.showModal();
};
$("nt-cancel").onclick = () => dlgNt.close();
$("nt-save").onclick = async () => {
  const p = { comment:$("nt-comment").checked, dm:$("nt-dm").checked, device:$("nt-device").checked, plan:$("nt-plan").checked };
  if (p.device && "Notification" in window && Notification.permission !== "granted") {
    try { const r = await Notification.requestPermission();
      if (r !== "granted") { p.device = false; $("nt-err").textContent = "기기 알림이 허용되지 않았어요. 브라우저 설정에서 허용한 뒤 다시 켜주세요."; } }
    catch { p.device = false; }
  }
  try { await updateDoc(doc(db,"users",state.me.id), { notifyPrefs: p }); state.me.notifyPrefs = p;
        planAlarms();
        if (!$("nt-err").textContent) { dlgNt.close(); toast("알림 설정을 저장했어요."); } }
  catch (e) { $("nt-err").textContent = msgOf(e); }
};

/* ════════ 코치가 자기 셀도 맡기 (셀리더 + 코치) ════════ */
const dlgLead=$("dlg-lead");
let leadTargetUid=null;
function openLeadDlg(targetUid) {
  leadTargetUid=targetUid;
  const m=state.members.find(x=>x.id===targetUid)||{};
  const isLeaderRole = m.role==="leader";
  $("ld-sub").textContent = isLeaderRole
    ? `${m.name||""} 님이 맡을 셀을 바꿉니다. 이미 만든 영혼 카드는 그대로 그분 담당이에요 (옮기려면 카드에서 '다른 리더에게 넘기기').`
    : `${m.name||""} 님이 담당 셀을 돌보면서 자기 셀도 맡게 합니다. 셀 출석 · 영혼 카드를 직접 기록할 수 있어요.`;
  const cells=state.cells.filter(c=>c.jinId===m.jinId && c.active!==false);
  $("ld-cell").innerHTML=(isLeaderRole?"":`<option value="">셀은 안 맡음 (코치만)</option>`)
    + cells.map(c=>`<option value="${c.id}"${(isLeaderRole||m.isLeader)&&m.cellId===c.id?" selected":""}>${esc(c.name)}</option>`).join("");
  $("ld-err").textContent=""; dlgLead.showModal();
}
$("ld-cancel").onclick=()=>dlgLead.close();
$("ld-save").onclick=async()=>{
  const cellId=$("ld-cell").value||null;
  const m=state.members.find(x=>x.id===leadTargetUid)||{};
  const patch = m.role==="leader" ? { cellId } : { isLeader:!!cellId, cellId };
  try{ await updateDoc(doc(db,"users",leadTargetUid),patch);
    await log(cellId?"코치 셀 겸직":"코치 셀 겸직 해제",leadTargetUid,cellId||"");
    dlgLead.close(); await loadOrg(true); await syncBadges(); toast("저장했어요."); openManage(); }
  catch(e){ $("ld-err").textContent=msgOf(e); }
};

/* ════════════════════════════════════════════════════════════
   18단계 · 교회 명부 — 멤버 카드의 바깥 겹
   ────────────────────────────────────────────────────────────
   사람마다 카드는 하나이고 두 겹입니다.
     명부(members) — 이름 · 사진 · 셀 · 역할 · 연락처 · 생일(월 · 일) · 등록일 · 침례 · 직분 · 수료한 훈련.
                     같은 진 리더라면 누구나 찾아봅니다.
     목양(souls)   — 상태 · 메모 · 기도제목 · 근황 · 만남 기록. 맡은 사람만 봅니다.
   본인은 자기 목양 카드를 어떤 경로로도 못 봅니다(보안 규칙이 막음).
   ════════════════════════════════════════════════════════════ */
const ROLEBADGE = { member:"셀원", leader:"셀리더", coachleader:"셀리더 + 코치", coach:"코치",
  jinjang:"진장", super:"수퍼 관리자", pastor:"담당 교역자" };
const badgeOf = (u) => (u && u.role === "coach" && u.isLeader === true) ? "coachleader" : ((u && u.role) || "member");
/* 셀 관리(담당 바꾸기 · 분가 · 옮기기)는 진장 · 코치 · 수퍼 — 코치는 진장의 손발 */
const isManager = () => !!state.me && ["super","jinjang","coach"].includes(state.me.role);
/* 역할 주기(초대)는 진장 · 수퍼 */
const canGiveRole = () => !!state.me && (state.me.role === "super" || state.me.role === "jinjang");
/* 25단계 — 셀은 어디서나 번호 순서대로 (1B01 · 1B03 … 1B21) */
const cellOrder = (a, b) => (a.name || "").localeCompare(b.name || "", "ko", { numeric: true });
const activeCells = () => state.cells.filter(c => c.active !== false).sort(cellOrder);
const leadersOf = (cellId) => (state.members||[]).filter(u => u.cellId === cellId && u.active !== false
  && (u.role === "leader" || u.isLeader === true));
const userOf = (id) => (state.members||[]).find(u => u.id === id)
  || (state.me && state.me.id === id ? state.me : null);
const userName = (id) => (userOf(id) || {}).name || "";
const memberOfUid = (id) => (state.dir||[]).find(m => m.uid === id && m.active !== false) || null;
const memberById = (id) => (state.dir||[]).find(m => m.id === id) || null;
const mdOf = (birth) => { const p = String(birth||"").split("-");
  return (p.length >= 3 && p[1] !== "00" && p[2] !== "00") ? `${p[1]}-${p[2]}` : ""; };
const mdText = (md, lunar) => { if (!md) return ""; const [m, d] = md.split("-").map(Number);
  return `${m}월 ${d}일${lunar ? " (음력)" : ""}`; };
/* 계정과 이어진 카드인가 — 이어진 카드는 linked = true 로 표시해야 규칙이 받아줍니다 */
const linkedData = (s) => !!(s.linkedUid || s.subjectEmail || (s.kind && s.kind !== "member"));
const myEmail = () => ((state.me && state.me.email) || "").toLowerCase();
const DIRK = ["name","thumb","gender","phone","position","registeredAt","baptizedAt"];
function dirFields(s) {
  return { name: s.name || "", thumb: s.thumb || "", gender: s.gender || "", phone: s.phone || "",
    position: s.position || "", registeredAt: s.registeredAt || "", baptizedAt: s.baptizedAt || "",
    birthMD: mdOf(s.birth), lunar: !!s.lunar };
}
/* 목양 카드에 명부의 기본 사항을 덧입힙니다 (진장이 명부에서 연락처를 고쳤으면 그게 보이게) */
function mergeDir(list) {
  const by = {}; (state.dir||[]).forEach(m => { by[m.id] = m; });
  list.forEach(s => { const m = s.memberId && by[s.memberId]; if (m) DIRK.forEach(k => { if (m[k]) s[k] = m[k]; }); });
  return list;
}
function coursesDone(rows) {
  const names = new Set(rows.filter(t => t.status === "done").map(t => t.courseName).filter(Boolean));
  const ord = (n) => { const i = state.courses.findIndex(c => c.name === n); return i < 0 ? 99 : i; };
  return [...names].sort((a,b) => ord(a) - ord(b));
}
const doneCourses = (soulId) => coursesDone((state.allTrainings||[]).filter(t => t.soulId === soulId));

/* ── 명부로 옮겨오기 · 새 사람 카드 · 배지 맞추기 ──
   새 버전을 처음 열 때 각자 '자기가 맡은 카드'만 옮깁니다. 수퍼라도 남의 목양 카드는 못 읽으니까요. */
async function ensureDirectory() {
  if (state.dirP) return state.dirP;
  state.dirP = ensureDirectoryOnce();
  try { return await state.dirP; } finally { state.dirP = null; }
}
async function ensureDirectoryOnce() {
  const me = state.me; if (!me || !me.jinId || me.role === "pastor") return;
  let touched = false;
  /* ① 내 명부 카드 */
  if (!state.dirSelfDone) {
    state.dirSelfDone = true;
    if (!memberOfUid(me.id)) {
      const sc = await loadSelfCard();
      const d = { uid: me.id, name: me.name || "", jinId: me.jinId, cellId: me.cellId || null, role: badgeOf(me),
        linkedEmail: myEmail(), careUid: "", soulIds: [], trainingsDone: [], active: true,
        thumb: (sc && sc.thumb) || "", phone: (sc && sc.phone) || "", gender: "",
        birthMD: mdOf(sc && sc.birth), lunar: !!(sc && sc.lunar), position: (sc && sc.position) || "",
        registeredAt: (sc && sc.registeredAt) || "", baptizedAt: (sc && sc.baptizedAt) || "",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try { const ref = await addDoc(collection(db,"members"), d); state.dir.push({ id: ref.id, ...d }); }
      catch (e) { console.warn("내 명부 카드", e); }
    }
  }
  /* ② 진장 · 코치 · 수퍼 — 계정은 있는데 명부에 없는 사람 · 역할 배지 맞추기 */
  if (isManager()) await syncBadges();
  /* ③ 내가 맡은 목양 카드 → 명부 */
  const mine = state.souls.filter(s => s.leaderUid === me.id && s.active !== false);
  const sameAsMe = (s) => (s.name||"").trim() && (s.name||"").trim() === (me.name||"").trim();
  if (mine.some(s => !s.memberId && !isLeaderCard(s) && !sameAsMe(s))) await loadAllTrainings();
  for (const s of mine) {
    const patch = {};
    let m = s.memberId ? memberById(s.memberId) : null;
    if (!m) {
      if (s.linkedUid) m = memberOfUid(s.linkedUid);
      if (m) patch.memberId = m.id;
      else if (!isLeaderCard(s)) {
        /* 예전에 나 자신을 영혼 카드로 만들어 둔 경우 — 명부에 나를 두 번 올리지 않습니다 */
        if ((s.name||"").trim() && (s.name||"").trim() === (me.name||"").trim()) { state.selfDup = s; continue; }
        const d = { ...dirFields(s), jinId: s.jinId, cellId: s.cellId || null, uid: "", role: "member",
          linkedEmail: "", careUid: me.id, soulIds: [s.id], trainingsDone: doneCourses(s.id), active: true,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        try { const ref = await addDoc(collection(db,"members"), d); m = { id: ref.id, ...d };
          state.dir.push(m); patch.memberId = ref.id; }
        catch (e) { console.warn("명부로 옮기기", s.name, e); }
      } else if (isManager()) {
        /* 계정이 아직 없는 분의 셀리더 · 코치 카드 (진장이 미리 만든 것) */
        const d = { ...dirFields(s), jinId: s.jinId, cellId: s.ofCellId || null, uid: "",
          role: s.kind === "coach" ? "coach" : "leader", linkedEmail: s.subjectEmail || "", careUid: me.id,
          soulIds: [s.id], trainingsDone: [], active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        try { const ref = await addDoc(collection(db,"members"), d); m = { id: ref.id, ...d };
          state.dir.push(m); patch.memberId = ref.id; } catch {}
      }
    }
    if (m && !(m.soulIds||[]).includes(s.id)) {
      const ids = [...(m.soulIds||[]), s.id];
      try { await updateDoc(doc(db,"members",m.id), { soulIds: ids }); m.soulIds = ids; } catch {}
    }
    if (m && m.uid === me.id) { state.selfDup = s; continue; }
    if (m && !m.uid && ((m.rank || 0) !== (s.seq || 0) || !!m.intern !== !!s.intern)) {
      try { await updateDoc(doc(db, "members", m.id), { rank: s.seq || 0, intern: !!s.intern }); m.rank = s.seq || 0; m.intern = !!s.intern; } catch {}
    }
    /* 명부 쪽에서 계정 · 초대가 이어졌으면 이 카드에도 본인 차단을 겁니다 */
    if (m && m.uid && !s.linkedUid) patch.linkedUid = m.uid;
    if (m && m.linkedEmail && m.linkedEmail !== myEmail() && !s.subjectEmail) patch.subjectEmail = m.linkedEmail;
    const flag = linkedData({ ...s, ...patch });
    if (flag && s.linked !== true) patch.linked = true;
    else if (!flag && s.linked === undefined) patch.linked = false;
    if (Object.keys(patch).length) {
      try { await updateDoc(doc(db,"souls",s.id), patch); Object.assign(s, patch); touched = true; }
      catch (e) { console.warn("카드 표시", s.name, e); }
    }
  }
  /* ④ 내 셀에 새로 등록된 사람 — 목양 카드를 내가 만듭니다 */
  if (canLead() && me.cellId) {
    const fresh = state.dir.filter(x => x.cellId === me.cellId && !x.uid && x.active !== false
      && !(x.soulIds||[]).length && x.linkedEmail !== myEmail() && (!x.careUid || x.careUid === me.id)
      && !x.pendingSeat && !x.invitedRole);
    for (const m of fresh) {
      try {
        const ref = await addDoc(collection(db,"souls"), soulFromMember(m, me.cellId));
        await updateDoc(doc(db,"members",m.id), { soulIds: [ref.id], careUid: me.id });
        m.soulIds = [ref.id]; m.careUid = me.id; touched = true;
      } catch (e) { console.warn("새 사람 카드", m.name, e); }
    }
  }
  if (touched) { state.soulsAt = 0; invalidate(); await loadSouls(true); }
}
function soulFromMember(m, cellId) {
  return { name: m.name || "", phone: m.phone || "", gender: m.gender || "", position: m.position || "",
    registeredAt: m.registeredAt || "", baptizedAt: m.baptizedAt || "", thumb: m.thumb || "", lunar: !!m.lunar,
    birth: m.birthMD ? `0000-${m.birthMD}` : "", status: "new", contactCycle: 0,
    cellId, jinId: state.me.jinId, leaderUid: state.me.id, kind: "member", memberId: m.id,
    linkedUid: "", subjectEmail: m.linkedEmail || "", linked: !!m.linkedEmail,
    family: [], todos: [], lastMetAt: null, lastPrayedAt: null, prayOpen: 0, prayTop: null,
    active: true, createdBy: state.me.id, createdAt: serverTimestamp(), ...shareDefaults("member") };
}
/* 계정(users)의 역할 · 맡은 셀을 명부 배지에 맞춥니다 — 진장 · 코치 · 수퍼만 */
async function syncBadges() {
  if (!isManager()) return;
  for (const u of (state.members||[])) {
    if (u.active === false || !u.jinId) continue;
    if (state.me.role !== "super" && u.jinId !== state.me.jinId) continue;
    const m = (state.dir||[]).find(x => x.uid === u.id);
    if (!m) {
      if (u.id === state.me.id) continue;
      const d = { uid: u.id, name: u.name || "", jinId: u.jinId, cellId: u.cellId || null, role: badgeOf(u),
        linkedEmail: (u.email||"").toLowerCase(), careUid: "", soulIds: [], trainingsDone: [], active: true,
        thumb: "", phone: "", gender: "", birthMD: "", lunar: false, position: "", registeredAt: "", baptizedAt: "",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try { const ref = await addDoc(collection(db,"members"), d); state.dir.push({ id: ref.id, ...d }); } catch {}
      continue;
    }
    const patch = {};
    if (m.role !== badgeOf(u)) patch.role = badgeOf(u);
    if ((u.role === "leader" || u.isLeader === true) && u.cellId && m.cellId !== u.cellId) patch.cellId = u.cellId;
    if (Object.keys(patch).length && m.jinId === u.jinId) {
      try { await updateDoc(doc(db,"members",m.id), { ...patch, updatedAt: serverTimestamp() }); Object.assign(m, patch); }
      catch {}
    }
  }
}
/* 영혼 카드를 저장하면 명부도 — 기본 사항만 */
async function syncMemberFromSoul(soulId, d) {
  if (isLeaderCard(d)) {
    /* 셀리더 카드는 그분이 직접 고치는 명부를 덮어쓰지 않고, 잇기만 합니다 */
    const m = d.memberId && memberById(d.memberId);
    if (m && !(m.soulIds||[]).includes(soulId)) {
      const ids = [...(m.soulIds||[]), soulId];
      try { await updateDoc(doc(db,"members",m.id), { soulIds: ids }); m.soulIds = ids; } catch {}
    }
    return;
  }
  const f = { ...dirFields(d), updatedAt: serverTimestamp() };
  const m = d.memberId ? memberById(d.memberId) : null;
  try {
    if (m) {
      if (isManager() && d.cellId && m.cellId !== d.cellId && !m.uid) f.cellId = d.cellId;
      await updateDoc(doc(db,"members",m.id), f); Object.assign(m, f);
    } else {
      const nd = { ...f, jinId: d.jinId, cellId: d.cellId || null, uid: "", role: "member", linkedEmail: "",
        careUid: uid(), soulIds: [soulId], trainingsDone: [], active: true, createdAt: serverTimestamp() };
      const ref = await addDoc(collection(db,"members"), nd);
      state.dir.push({ id: ref.id, ...nd });
      await updateDoc(doc(db,"souls",soulId), { memberId: ref.id });
    }
  } catch (e) { console.warn("명부 맞추기", e); }
}
async function syncMemberField(s, patch) {
  const m = s && s.memberId && memberById(s.memberId);
  if (!m || isLeaderCard(s)) return;
  try { await updateDoc(doc(db,"members",m.id), { ...patch, updatedAt: serverTimestamp() }); Object.assign(m, patch); }
  catch {}
}
async function syncMemberTrain(soulId, fresh) {
  const s = state.souls.find(x => x.id === soulId);
  const m = s && s.memberId && memberById(s.memberId);
  if (!m || isLeaderCard(s)) return;
  let rows = (!fresh && state.soul && state.soul.id === soulId) ? state.trainings : null;
  if (!rows) { try { rows = pack(await getDocs(collection(db,"souls",soulId,"trainings"))); } catch { return; } }
  const done = coursesDone(rows);
  if (JSON.stringify(done) === JSON.stringify(m.trainingsDone || [])) return;
  try { await updateDoc(doc(db,"members",m.id), { trainingsDone: done, updatedAt: serverTimestamp() });
        m.trainingsDone = done; } catch {}
}

/* ════════ 명부 화면 ════════ */
const canRegister = () => isManager() || (canLead() && !!state.me.cellId);
async function openDir() {
  show("s-loading"); markSide("dir");
  await loadOrg();
  if (canLead() || ["coach","jinjang","pastor"].includes(state.me.role)) await loadSouls();
  await loadHandovers();
  state.dirCell = state.dirCell || "all"; state.dirRole = state.dirRole || "all";
  $("btn-dir-new").hidden = !canRegister();
  $("btn-dir-cellmgr").hidden = !isManager();
  renderDir(); show("s-dir");
}
const dirCellsShown = () => state.me.role === "super" ? activeCells() : activeCells().filter(c => c.jinId === state.me.jinId);
function dirPool() {
  const me = state.me;
  return (state.dir||[]).filter(m => m.active !== false && (me.role === "super" || m.jinId === me.jinId));
}
const pendingInvite = (m) => !m.uid && m.linkedEmail
  && (state.invites||[]).some(i => i.status === "pending" && i.email === m.linkedEmail);
const handPendingFor = (m) => (state.handovers||[]).some(h => h.status === "pending" && (h.memberIds||[]).includes(m.id));
const DROLES = [["all","전체"],["lead","리더들"],["member","셀원"],["new","목양 카드 없음"]];
function renderDir() {
  const me = state.me, pool = dirPool(), cells = dirCellsShown();
  const LM = leadMemberMap(cells); state.dirLM = LM;      // 셀리더 명부 카드 → 그 셀 (가입 전이라 셀이 비어 있어도)
  const cellOfM = (m) => (m.cellId && cells.some(c => c.id === m.cellId)) ? m.cellId : (LM.get(m.id) || "");
  const kw = $("dir-search").value.trim(), kwd = kw.replace(/\D/g, "");
  const hasNone = pool.some(m => !cellOfM(m));
  if (state.dirCell !== "all" && state.dirCell !== "none" && !cells.some(c => c.id === state.dirCell)) state.dirCell = "all";
  $("dir-cells").innerHTML = `<button type="button" data-dc="all">전체</button>`
    + cells.map(c => `<button type="button" data-dc="${c.id}">${cellChipIn(c)}</button>`).join("")
    + (hasNone ? `<button type="button" data-dc="none">셀 없음</button>` : "");
  $("dir-cells").querySelectorAll("[data-dc]").forEach(b => b.classList.toggle("on", b.dataset.dc === state.dirCell));
  $("dir-roles").innerHTML = DROLES.map(([k,l]) => `<button type="button" data-dr="${k}" class="${state.dirRole===k?"on":""}">${l}</button>`).join("");
  const isLead = (m) => (m.role && m.role !== "member") || LM.has(m.id);
  state.dirView = state.dirView || "list";
  $("dir-view").querySelectorAll("[data-dv]").forEach(b => b.classList.toggle("on", b.dataset.dv === state.dirView));
  $("dir-roles").hidden = state.dirView === "stats";
  if (state.dirView === "stats") {
    $("dir-sort").hidden = true; $("dir-ratio").innerHTML = "";
    const scope = state.dirCell === "all" ? pool : state.dirCell === "none" ? pool.filter(m => !cellOfM(m)) : pool.filter(m => cellOfM(m) === state.dirCell);
    renderDirStats(scope, cells, cellOfM, LM);
    return;
  }
  let list = pool;
  if (state.dirCell === "none") list = list.filter(m => !cellOfM(m));
  else if (state.dirCell !== "all") list = list.filter(m => cellOfM(m) === state.dirCell);
  if (state.dirRole === "lead") list = list.filter(isLead);
  if (state.dirRole === "member") list = list.filter(m => !isLead(m));
  if (state.dirRole === "new") list = list.filter(m => !m.uid && !(m.soulIds||[]).length);
  if (kw) list = list.filter(m => (m.name||"").includes(kw) || (kwd.length >= 3 && String(m.phone||"").replace(/\D/g,"").includes(kwd)));
  /* 30단계 — 침례 · 새로운 삶 · 제자의 삶 · 정회원으로 거르기 (목록 보기) */
  const listMode = !(!kw && state.dirRole === "all" && state.dirCell !== "none");
  const preF = list;
  if (listMode) list = list.filter(m => dirAttrPass(m));
  const rank = (m) => LM.has(m.id) ? 0 : isLead(m) ? 1 : 2;
  const grouped = !kw && state.dirRole === "all" && state.dirCell !== "none";
  /* 29단계 — 셀 안에서는 셀리더가 정한 영적 순서(rank) → 이름 / 목록 보기는 고른 정렬 */
  const byRank = (a, b) => ((a.rank || 999) - (b.rank || 999)) || (a.name||"").localeCompare(b.name||"", "ko");
  const cellIdx = (m) => { const i = cells.findIndex(c => c.id === cellOfM(m)); return i < 0 ? 999 : i; };
  if (grouped) list = list.slice().sort((a,b) => rank(a) - rank(b) || byRank(a, b));
  else {
    state.dirSort = state.dirSort || (state.dirRole === "lead" ? "cell" : "name");
    const ds = state.dirSort, by = state.bdate || {};
    const nm = (a, b) => (a.name||"").localeCompare(b.name||"", "ko");
    const attR = (m) => { const r = attStats(m.id, cellOfM(m)).rate; return r == null ? -1 : r; };
    const bdk = (m) => { if (!m.birthMD) return "99-99"; const t = todayStr().slice(5); const k = String(m.birthMD); return (k >= t ? "0" : "1") + k; };
    list = list.slice().sort(ds === "cell" ? (a, b) => cellIdx(a) - cellIdx(b) || rank(a) - rank(b) || byRank(a, b)
      : ds === "age" ? (a, b) => String(by[a.id] || "9999").localeCompare(String(by[b.id] || "9999")) || nm(a, b)
      : ds === "young" ? (a, b) => String(by[b.id] || "0000").localeCompare(String(by[a.id] || "0000")) || nm(a, b)
      : ds === "att" ? (a, b) => attR(b) - attR(a) || nm(a, b)
      : ds === "bday" ? (a, b) => bdk(a).localeCompare(bdk(b)) || nm(a, b)
      : nm);
  }
  $("dir-sort").hidden = grouped;
  renderDirRatio(listMode ? preF : null, list.length);
  $("dir-sort").querySelectorAll("[data-ds]").forEach(b => b.classList.toggle("on", b.dataset.ds === state.dirSort));
  const showCells = state.dirCell === "all" ? cells : cells.filter(c => c.id === state.dirCell);
  $("dir-count").textContent = `${list.length}명${state.dirCell === "all" && !kw ? ` · 셀 ${cells.length}개` : ""}`;
  const card = (m, o) => memCardHTML(m, { ...o, cellName: cellNameOf(cellOfM(m)), lead: LM.has(m.id) ? "셀리더" : "" });
  if (grouped) {
    const jinName = (c) => me.role === "super" && state.jins.length > 1 ? ((state.jins.find(j => j.id === c.jinId) || {}).name || "") : "";
    const myCellIds = new Set(canLead() ? ownCells().map(c => c.id) : []);
    const none = state.dirCell === "all" ? list.filter(m => !cellOfM(m)) : [];
    const secs = showCells.map(c => {
      const ents = cellLeadEntries(c);
      const lids = new Set(ents.map(e => e.m && e.m.id).filter(Boolean));
      const ms = list.filter(m => cellOfM(m) === c.id && !lids.has(m.id));
      const leadH = ents.length ? ents.map(e => e.m ? card(e.m, { leadEnt: e }) : leadGhostHTML(e)).join("")
          : `<div class="mcard lead empty"><span class="ava" style="width:48px;height:48px">?</span>
              <div class="mc-body"><p class="mc-role">셀리더</p><p class="mc-nm" style="color:var(--dim);font-weight:500">아직 정해지지 않았어요</p></div></div>`;
      const single = state.dirCell !== "all";   // 셀 하나만 볼 땐 셀리더도 같은 크기 카드로 한 판에
      return `<section class="cgrp">
        <div class="cgh"><span class="cbadge">${esc(c.name)}</span>
          <span class="cgm">${esc(jinName(c))}</span>${myCellIds.has(c.id) ? `<button type="button" class="btn-sm" data-ordcell="${c.id}" style="height:30px;font-size:12px;padding:0 10px">순서 · 인턴</button>` : ""}<span class="cgc" data-cellatt="${c.id}">셀원 ${ms.length}명</span></div>
        ${single ? `<div class="mgrid one">${leadH}${ms.map(m => card(m, { rank: true })).join("")}</div>`
          : `${leadH}${ms.length ? `<div class="twigs">${ms.map(m => card(m, { twig: true, rank: true })).join("")}</div>`
          : `<p class="muted twig-empty">아직 등록된 셀원이 없어요.</p>`}`}
      </section>`;
    });
    if (none.length) secs.push(`<section class="cgrp">
        <div class="cgh"><span class="cbadge plain">셀 없음</span><span class="cgm">진장 · 코치 등</span><span class="cgc">${none.length}명</span></div>
        <div class="mlist">${none.map(m => card(m, {})).join("")}</div></section>`);
    /* 화면 넓이에 맞춰 1 · 2 · 3줄 — 번호가 왼→오로 읽히게 차례로 나눠 담아요 */
    const n = secs.length <= 1 ? 1 : dirCols();
    state.dirColsNow = n;
    const cols = Array.from({ length: n }, () => []);
    secs.forEach((h, i) => cols[i % n].push(h.replace('<section class="cgrp">', `<section class="cgrp" style="order:${i}">`)));
    $("dir-list").innerHTML = `<div class="ctree${n === 1 && secs.length <= 1 ? " one" : ""}" style="--cols:${n}">${cols.map(c => `<div class="ccol">${c.join("")}</div>`).join("")}</div>`;
  } else {
    state.dirColsNow = 0;
    $("dir-list").innerHTML = list.length ? `<div class="mgrid">${list.map(m => card(m, { showCell: true })).join("")}</div>`
      : `<p class="muted" style="margin-top:10px">${kw ? "찾는 사람이 없어요." : "이 조건에 맞는 사람이 없어요."}</p>`;
  }
  fillCardsPriv($("dir-list"));
  loadAttReps().then(() => fillAtt($("dir-list"))).catch(() => {});
}
$("dir-search").oninput = () => renderDir();
$("dir-cells").addEventListener("click", (ev) => { const b = ev.target.closest("[data-dc]"); if (!b) return;
  state.dirCell = b.dataset.dc; renderDir(); });
$("dir-roles").addEventListener("click", (ev) => { const b = ev.target.closest("[data-dr]"); if (!b) return;
  state.dirRole = b.dataset.dr; state.dirSort = ""; renderDir(); });
$("dir-list").addEventListener("click", (ev) => { const r = ev.target.closest("[data-mem]"); if (r) openMember(r.dataset.mem); });
$("btn-dir-new").onclick = () => openMEdit(null, state.dirCell !== "all" && state.dirCell !== "none" ? state.dirCell : null);
$("btn-dir-cellmgr").onclick = () => openCellMgr();
$("btn-home-dir").onclick = () => openDir();
$("btn-go-dir").onclick = () => openDir();
$("btn-home-cellmgr").onclick = () => openCellMgr();
$("btn-go-cellmgr").onclick = () => openCellMgr();

/* ── 명부 카드 보기 ── */
function canEditMember(m) {
  const me = state.me; if (!m || m.active === false) return false;
  if (m.uid === me.id) return true;
  if (isManager() && (me.role === "super" || m.jinId === me.jinId)) return true;
  return canLead() && ((!!me.cellId && m.cellId === me.cellId && !m.uid) || m.careUid === me.id);
}
const soulOfMember = (m) => state.souls.find(s => s.active !== false
  && ((m.soulIds||[]).includes(s.id) || s.memberId === m.id));
const dlgMb = $("dlg-member");
function openMember(id) {
  const m = memberById(id); if (!m) return;
  state.mb = m;
  const me = state.me, mine = m.uid === me.id;
  $("mb-ava").style.backgroundImage = m.thumb ? `url(${m.thumb})` : "";
  $("mb-ava").textContent = m.thumb ? "" : initial(m.name);
  $("mb-name").textContent = m.name || "";
  $("mb-chips").innerHTML = [
    `<span class="chip ${m.role && m.role !== "member" ? "rose" : ""}">${esc(ROLEBADGE[m.role] || "셀원")}</span>`,
    m.cellId ? `<span class="chip">${esc(cellNameOf(m.cellId))}</span>` : "",
    mine ? `<span class="chip rose">나</span>` : "",
    pendingInvite(m) ? `<span class="chip warn">초대 중</span>` : "",
    handPendingFor(m) ? `<span class="chip warn">카드 넘어가는 중</span>` : ""].join("");
  const tel = String(m.phone||"").replace(/\D/g, "");
  $("mb-contact").innerHTML = tel && !mine ? `<div style="display:flex;gap:8px">
    <a class="btn-ghost" href="tel:${tel}" style="height:42px;display:flex;align-items:center;justify-content:center;text-decoration:none;color:var(--text);font-size:13px">전화 ${esc(m.phone)}</a>
    <a class="btn-ghost" href="sms:${tel}" style="height:42px;width:92px;flex-shrink:0;display:flex;align-items:center;justify-content:center;text-decoration:none;color:var(--text);font-size:13px">문자</a></div>` : "";
  const rows = [
    ["연락처", mine ? m.phone : ""], ["생일", mdText(m.birthMD, m.lunar)], ["성별", m.gender], ["직분", m.position],
    ["교회 등록일", fmtDate(m.registeredAt, true)], ["침례", fmtDate(m.baptizedAt, true)],
    ["수료한 훈련", (m.trainingsDone||[]).join(" · ")],
    ["목양 담당", m.careUid ? (m.careUid === me.id ? "나" : userName(m.careUid)) : ""],
    ["초대 이메일", canGiveRole() && !m.uid ? m.linkedEmail : ""]
  ].filter(([,v]) => v);
  const trs = m.trainingsDone || [];
  $("mb-rows").innerHTML = `<p class="mb-sec">기본 사항</p>` + (rows.length ? `<div class="fgrid">${rows.filter(([k]) => k !== "수료한 훈련")
      .map(([k,v]) => fbox(k, v)).join("")}${trs.length ? `<div class="fbox fwide"><p class="fk">수료한 훈련</p><p class="fv">${trs.map(t => `<span class="tpill">${esc(t)}</span>`).join("")}</p></div>` : ""}</div>`
    : `<p class="muted">아직 적힌 기본 사항이 없어요.</p>`);
  showMbAtt(m);
  showPriv(m);
  const sv = !mine && soulOfMember(m);
  $("mb-note").textContent = mine
    ? "진장 · 코치가 나를 위해 적는 목양 카드는 나에게 보이지 않아요. 여기는 교회 명부에 보이는 내 기본 사항이에요."
    : sv ? "" : "목양 내용(상태 · 메모 · 기도제목 · 만남 기록)은 맡은 사람만 봐요.";
  const acts = [];
  if (sv) acts.push(`<button class="btn-sm" data-mact="soul">목양 카드 열기</button>`);
  if (mine) acts.push(`<button class="btn-sm" data-mact="mine">내 카드</button>`);
  if (canEditMember(m)) acts.push(`<button class="btn-sm" data-mact="edit">${mine ? "내 명부 고치기" : "명부 고치기"}</button>`);
  if (isManager() && !m.uid && m.active !== false) acts.push(`<button class="btn-sm" data-mact="move">다른 셀로 옮기기</button>`);
  if (canGiveRole() && !mine && m.role !== "super") {
    if (!m.uid) acts.push(`<button class="btn-sm" data-mact="role">${pendingInvite(m) ? "초대 다시 보내기" : "역할 주기 · 초대"}</button>`);
    else acts.push(`<button class="btn-sm" data-mact="role">역할 바꾸기</button>`);
    if (!m.uid && !pendingInvite(m)) acts.push(`<button class="btn-sm" data-mact="link">계정 있는 분과 잇기</button>`);
  }
  if (!mine && !m.uid && canEditMember(m)) acts.push(`<button class="btn-sm danger" data-mact="archive">명부에서 빼기</button>`);
  $("mb-acts").innerHTML = acts.join("");
  $("mb-err").textContent = "";
  if (!dlgMb.open) dlgMb.showModal();
}
$("mb-close").onclick = () => dlgMb.close();
$("mb-acts").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-mact]"); if (!b) return;
  const m = state.mb, a = b.dataset.mact;
  if (a === "soul") { const sv = soulOfMember(m); dlgMb.close(); if (sv) openSoul(sv.id); return; }
  if (a === "mine") { dlgMb.close(); openMine(); return; }
  if (a === "edit") { dlgMb.close(); openMEdit(m); return; }
  if (a === "move") { dlgMb.close(); openMoveDlg(m); return; }
  if (a === "role") { dlgMb.close(); openRoleDlg(m); return; }
  if (a === "link") { dlgMb.close(); openLinkDlg(m); return; }
  if (a === "archive") {
    const sv = soulOfMember(m);
    if (!confirm(`${m.name} 님을 명부에서 뺄까요?${sv && isLeaderOf(sv) ? "\n내가 맡은 목양 카드도 같이 보관돼요. 기록은 지워지지 않아요." : ""}`)) return;
    try {
      await updateDoc(doc(db,"members",m.id), { active:false, updatedAt: serverTimestamp() }); m.active = false;
      if (sv && isLeaderOf(sv)) { await updateDoc(doc(db,"souls",sv.id), { active:false }); invalidate(); }
      await log("명부에서 빼기", m.name);
      dlgMb.close(); toast("명부에서 뺐어요."); renderDir();
    } catch (e) { $("mb-err").textContent = msgOf(e); }
  }
});

/* ── 명부 등록 · 고치기 ── */
const dlgMd = $("dlg-medit");
let mdPhoto;   // undefined = 그대로, null = 빼기, {big, small} = 새 사진
function openMEdit(m, cellId) {
  const me = state.me, mine = !!(m && m.uid === me.id);
  if (!m && !canRegister()) { toast("명부 등록은 셀리더(자기 셀) · 진장 · 코치가 해요."); return; }
  state.mdEdit = m || null; mdPhoto = undefined;
  $("md-title").textContent = m ? (mine ? "내 명부 카드 고치기" : "명부 고치기") : "명부에 새 사람 등록";
  const cells = isManager() ? dirCellsShown() : activeCells().filter(c => c.id === me.cellId);
  $("md-cell").innerHTML = cells.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")
    || `<option value="">셀이 없어요</option>`;
  $("md-cell-wrap").hidden = !!m;
  if (!m) $("md-cell").value = (cellId && cells.some(c => c.id === cellId)) ? cellId
    : (cells.some(c => c.id === me.cellId) ? me.cellId : ((cells[0]||{}).id || ""));
  const md = m && m.birthMD ? m.birthMD.split("-").map(Number).join("-") : "";
  $("md-name").value = m ? (m.name||"") : ""; $("md-phone").value = m ? (m.phone||"") : "";
  $("md-gender").value = m ? (m.gender||"") : ""; $("md-birth").value = md; $("md-lunar").checked = !!(m && m.lunar);
  $("md-position").value = m ? (m.position||"") : "";
  $("md-reg").value = m && m.registeredAt ? fmtRaw(m.registeredAt) : "";
  $("md-bap").value = m && m.baptizedAt ? fmtRaw(m.baptizedAt) : "";
  syncMdAva(m && m.thumb);
  syncMdHint();
  $("md-err").textContent = "";
  dlgMd.showModal();
  setTimeout(() => { if (!m) $("md-name").focus(); }, 120);
}
function syncMdHint() {
  const m = state.mdEdit, me = state.me;
  if (m) { $("md-hint").textContent = m.uid === me.id ? "교회 명부에 보이는 내 기본 사항이에요. 같은 진 리더들이 봅니다." : ""; return; }
  const cid = $("md-cell").value;
  $("md-hint").textContent = canLead() && cid && cid === me.cellId
    ? "등록하면 이분 목양 카드가 내 영혼들에 바로 생겨요."
    : leadersOf(cid).length ? `${leadersOf(cid).map(u=>u.name).join(", ")} 님이 앱을 열면 그분 영혼들에 목양 카드가 생겨요.`
    : "이 셀은 아직 담당 셀리더가 없어요. 담당이 정해지면 그분께 목양 카드가 생겨요.";
}
$("md-cell").onchange = syncMdHint;
function syncMdAva(src) {
  $("md-ava").style.backgroundImage = src ? `url(${src})` : "";
  $("md-ava").textContent = src ? "" : initial($("md-name").value || "?");
}
$("md-phone").addEventListener("input", (ev) => { ev.target.value = fmtPhone(ev.target.value); });
$("md-photo").onclick = () => $("md-photo-input").click();
$("md-photo-rm").onclick = () => { mdPhoto = null; syncMdAva(""); };
$("md-photo-input").onchange = async (ev) => {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (!f) return;
  try { const [big, small] = await Promise.all([shrinkFit(f, PHOTO.face, 700000), shrinkFit(f, PHOTO.faceTh, 12000)]);
        mdPhoto = { big, small }; syncMdAva(big); }
  catch (e) { $("md-err").textContent = e.message || "사진을 넣지 못했어요."; }
};
$("md-cancel").onclick = () => dlgMd.close();
$("md-save").onclick = async () => {
  const me = state.me, m = state.mdEdit;
  const name = $("md-name").value.trim();
  $("md-err").textContent = "";
  if (!name) { $("md-err").textContent = "이름은 꼭 적어주세요."; return; }
  const braw = $("md-birth").value.trim(), bp = braw ? parseDateLoose(braw) : "";
  const md = bp ? mdOf(bp) : "";
  if (braw && !md) { $("md-err").textContent = "생일은 월-일로 적어주세요. 예) 3-5"; return; }
  const dates = {};
  for (const [id, key, label] of [["md-reg","registeredAt","교회 등록일"],["md-bap","baptizedAt","침례일"]]) {
    const v = parseDateLoose($(id).value);
    if (v === null) { $("md-err").textContent = `${label} 형식을 확인해 주세요. 2024-3-10 처럼 적어주세요.`; return; }
    dates[key] = v;
  }
  const f = { name, phone: fmtPhone($("md-phone").value), gender: $("md-gender").value, birthMD: md,
    lunar: $("md-lunar").checked, position: $("md-position").value.trim(), ...dates, updatedAt: serverTimestamp() };
  if (mdPhoto !== undefined) f.thumb = mdPhoto ? mdPhoto.small : "";
  if (!m) {
    const dup = dirPool().find(x => (x.name||"").trim() === name);
    if (dup && !confirm(`${name} 님이 이미 명부에 있어요${dup.cellId ? ` (${cellNameOf(dup.cellId)})` : ""}.\n다른 분이면 그대로 등록할까요?`)) return;
  }
  $("md-save").disabled = true;
  try {
    if (m) {
      await updateDoc(doc(db,"members",m.id), f); Object.assign(m, f);
      /* 내가 맡은 목양 카드도 같이 맞춥니다 */
      for (const s of state.souls.filter(x => isLeaderOf(x) && !isLeaderCard(x) && ((m.soulIds||[]).includes(x.id) || x.memberId === m.id))) {
        const yr = String(s.birth||"").split("-")[0];
        const sp = { name, phone: f.phone, gender: f.gender, position: f.position, lunar: f.lunar, ...dates,
          ...(md ? { birth: `${yr && yr.length === 4 ? yr : "0000"}-${md}` } : {}) };
        if (mdPhoto !== undefined) {
          sp.thumb = f.thumb;
          await setDoc(doc(db,"photos",s.id), { self: mdPhoto ? mdPhoto.big : null }, { merge: true });
          state.photoCache[s.id] = mdPhoto ? mdPhoto.big : null;
        }
        await updateDoc(doc(db,"souls",s.id), sp); Object.assign(s, sp);
      }
      invalidate();
      toast("명부를 고쳤어요.");
    } else {
      const cellId = $("md-cell").value || null;
      const cell = state.cells.find(c => c.id === cellId);
      const own = canLead() && !!cellId && cellId === me.cellId;
      const d = { ...f, thumb: f.thumb || "", jinId: (cell && cell.jinId) || me.jinId, cellId, uid: "", role: "member",
        linkedEmail: "", careUid: own ? me.id : "", soulIds: [], trainingsDone: [], active: true,
        createdBy: me.id, createdAt: serverTimestamp() };
      const ref = await addDoc(collection(db,"members"), d);
      const nm = { id: ref.id, ...d }; state.dir.push(nm);
      if (own) {
        /* 내 셀이면 목양 카드를 바로 — 담당은 나 */
        const sref = await addDoc(collection(db,"souls"), soulFromMember(nm, cellId));
        if (mdPhoto) await setDoc(doc(db,"photos",sref.id), { self: mdPhoto.big }, { merge: true });
        await updateDoc(doc(db,"members",ref.id), { soulIds: [sref.id] }); nm.soulIds = [sref.id];
        invalidate(); bump("soulCreate");
      }
      await log("명부 등록", name, cellNameOf(cellId));
      toast(own ? `${name} 님을 등록했어요. 내 영혼들에도 생겼어요.` : `${name} 님을 명부에 등록했어요.`);
    }
    dlgMd.close();
    if (!$("s-dir").hidden) renderDir();
  } catch (e) { $("md-err").textContent = msgOf(e); }
  finally { $("md-save").disabled = false; }
};

/* ── 다른 셀로 옮기기 (진장 · 코치 · 수퍼) ── */
const dlgMv = $("dlg-move");
function openMoveDlg(m) {
  state.mvM = m;
  $("mv-sub").textContent = `${m.name} 님 — 지금 ${cellNameOf(m.cellId) || "셀 없음"}`;
  const cells = activeCells().filter(c => c.jinId === m.jinId && c.id !== m.cellId);
  $("mv-cell").innerHTML = cells.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")
    || `<option value="">옮길 셀이 없어요</option>`;
  const sync = () => {
    const to = $("mv-cell").value, ls = leadersOf(to);
    $("mv-hint").textContent = !to ? "" : !m.careUid
      ? "아직 목양 카드가 없는 분이에요. 옮긴 셀의 셀리더가 앱을 열면 카드가 생겨요."
      : ls.length ? `목양 카드는 지금 맡은 ${userName(m.careUid) || "셀리더"} 님이 앱을 열어 ${ls[0].name} 님에게 넘겨요. 그 전까지는 지금처럼 맡아요.`
      : "옮길 셀에 담당 셀리더가 없어요. 담당이 정해지면 '담당 바꾸기'로 카드가 넘어가요.";
  };
  $("mv-cell").onchange = sync; sync();
  $("mv-err").textContent = "";
  dlgMv.showModal();
}
$("mv-cancel").onclick = () => dlgMv.close();
$("mv-save").onclick = async () => {
  const m = state.mvM, to = $("mv-cell").value;
  if (!to) { $("mv-err").textContent = "옮길 셀을 골라주세요."; return; }
  $("mv-save").disabled = true;
  try {
    const from = m.cellId;
    await updateDoc(doc(db,"members",m.id), { cellId: to, updatedAt: serverTimestamp() }); m.cellId = to;
    const lead = leadersOf(to)[0];
    let mineH = null;
    if (m.careUid && lead && lead.id !== m.careUid) {
      const cell = state.cells.find(c => c.id === to) || {};
      const h = await makeHandover({ kind:"move", jinId: cell.jinId, cellId: from, toCellId: to,
        fromUid: m.careUid, toUid: lead.id, memberIds: [m.id] });
      if (h && h.fromUid === uid()) mineH = h;
    }
    await log("셀 옮기기", m.name, `${cellNameOf(from)} → ${cellNameOf(to)}`);
    dlgMv.close(); toast(`${m.name} 님을 ${cellNameOf(to)}로 옮겼어요.`);
    if (!$("s-dir").hidden) renderDir();
    if (!$("s-cellmgr").hidden) renderCellMgr();
    if (mineH) openHrun(mineH.id);
  } catch (e) { $("mv-err").textContent = msgOf(e); }
  finally { $("mv-save").disabled = false; }
};

/* ── 역할 주기 · 바꾸기 (진장 · 수퍼) ── */
const dlgRl = $("dlg-role");
function openRoleDlg(m) {
  state.rlM = m;
  const has = !!m.uid, u = has ? userOf(m.uid) : null, isSuper = state.me.role === "super";
  if (has && !u) { toast("이 계정을 찾지 못했어요. 리더 관리에서 바꿔주세요."); return; }
  $("rl-sub").textContent = has ? `${m.name} 님의 역할을 바꿔요.`
    : `${m.name} 님에게 역할을 주고 초대해요. 그분이 같은 구글 계정으로 로그인하면 이 명부 카드와 이어져요.`;
  $("rl-role").innerHTML = [...(isSuper ? [["jinjang","진장"]] : []), ["leader","셀리더"],
    ["coachleader","셀리더 + 코치 (자기 셀도 맡고 다른 셀도 돌봄)"], ["coach","코치만 (셀은 안 맡음)"]]
    .map(([v,l]) => `<option value="${v}">${l}</option>`).join("");
  const cur = has ? badgeOf(u) : (m.invitedRole || "leader");
  $("rl-role").value = [...$("rl-role").options].some(o => o.value === cur) ? cur : "leader";
  const cells = activeCells().filter(c => c.jinId === m.jinId);
  /* 셀원을 셀리더로 세울 때는 보통 분가로 새 셀을 맡으니, 기본은 '아직 안 정함' */
  $("rl-cell").innerHTML = `<option value="">아직 안 정함 — 분가하거나 담당을 바꿀 때 정해요</option>`
    + cells.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const want = has ? u.cellId : "";
  $("rl-cell").value = want && cells.some(c => c.id === want) ? want : "";
  $("rl-email-wrap").hidden = has;
  $("rl-email").value = m.linkedEmail || "";
  $("rl-err").textContent = "";
  syncRl(); dlgRl.showModal();
}
function syncRl() {
  const v = $("rl-role").value;
  $("rl-cell-wrap").hidden = !(v === "leader" || v === "coachleader");
  $("rl-role-hint").textContent = ROLEHINT[v] || "";
}
$("rl-role").onchange = syncRl;
$("rl-cancel").onclick = () => dlgRl.close();
$("rl-save").onclick = async () => {
  const m = state.rlM, pick = $("rl-role").value;
  const leads = pick === "leader" || pick === "coachleader";
  const cellId = leads ? ($("rl-cell").value || null) : null;
  $("rl-err").textContent = "";
  $("rl-save").disabled = true;
  try {
    if (!m.uid) {
      const email = $("rl-email").value.trim().toLowerCase();
      if (!email || !email.includes("@")) { $("rl-err").textContent = "그분의 구글 이메일을 적어주세요."; return; }
      const r = await sendInvite({ name: m.name, email, pick, jinId: m.jinId, cellId, memberId: m.id });
      if (r.err) { $("rl-err").textContent = r.err; return; }
      await loadOrg(true);
      dlgRl.close(); toast(r.msg);
    } else {
      const u = userOf(m.uid);
      const patch = { role: pick === "coachleader" ? "coach" : pick, isLeader: pick === "coachleader" };
      if (leads) patch.cellId = cellId;
      await updateDoc(doc(db,"users",u.id), patch); Object.assign(u, patch);
      await syncBadges();
      await log("역할 변경", u.id, pick);
      dlgRl.close(); toast(`${m.name} 님 역할을 ${ROLEBADGE[pick]}(으)로 바꿨어요.`);
    }
    if (!$("s-dir").hidden) renderDir();
  } catch (e) { $("rl-err").textContent = msgOf(e); }
  finally { $("rl-save").disabled = false; }
};

/* ── 같은 사람 — 계정 있는 명부 카드와 잇기 (진장 · 수퍼) ──
   '리더 초대하기'를 명부에서 고르지 않고 보내면, 같은 분이 명부에 둘(셀원 카드 · 계정 카드)이 됩니다.
   그럴 때 둘을 잇고, 목양 카드에 그 계정으로 본인 차단을 겁니다. */
const dlgLk = $("dlg-link");
function openLinkDlg(m) {
  state.lkM = m;
  const accs = dirPool().filter(x => x.uid && x.uid !== state.me.id && x.jinId === m.jinId);
  $("lk-sub").textContent = `${m.name} 님 (${cellNameOf(m.cellId) || "셀 없음"})이 이미 계정이 있는 분이면 골라주세요.`;
  $("lk-acc").innerHTML = `<option value="">— 골라주세요 —</option>` + accs.map(x =>
    `<option value="${x.id}"${(x.name||"").trim() === (m.name||"").trim() ? " selected" : ""}>${esc(x.name)} · ${esc(ROLEBADGE[x.role]||"")} · ${esc(x.linkedEmail||"")}</option>`).join("");
  $("lk-err").textContent = "";
  dlgLk.showModal();
}
$("lk-cancel").onclick = () => dlgLk.close();
$("lk-save").onclick = async () => {
  const m = state.lkM, acc = memberById($("lk-acc").value);
  if (!acc) { $("lk-err").textContent = "같은 분의 계정을 골라주세요."; return; }
  const u = userOf(acc.uid) || {};
  if (!confirm(`${m.name} 명부 카드를 ${acc.name} (${u.email || acc.linkedEmail || ""}) 계정과 이을까요?\n되돌릴 수 없어요.`)) return;
  $("lk-save").disabled = true;
  try {
    let warn = 0;
    for (const sid of (m.soulIds||[])) {
      try { await updateDoc(doc(db,"souls",sid), { subjectEmail: (u.email || acc.linkedEmail || "").toLowerCase(),
        linkedUid: acc.uid, linked: true, memberId: acc.id }); }
      catch { warn++; }
    }
    const fill = {};
    ["thumb","phone","gender","birthMD","position","registeredAt","baptizedAt"].forEach(k => { if (!acc[k] && m[k]) fill[k] = m[k]; });
    if (!acc.trainingsDone || !acc.trainingsDone.length) fill.trainingsDone = m.trainingsDone || [];
    await updateDoc(doc(db,"members",acc.id), { ...fill, soulIds: [...new Set([...(acc.soulIds||[]), ...(m.soulIds||[])])],
      ...(acc.careUid ? {} : { careUid: m.careUid || "" }), updatedAt: serverTimestamp() });
    Object.assign(acc, fill, { soulIds: [...new Set([...(acc.soulIds||[]), ...(m.soulIds||[])])] });
    await updateDoc(doc(db,"members",m.id), { active: false, mergedInto: acc.id, updatedAt: serverTimestamp() });
    m.active = false;
    await log("명부 잇기", m.name, acc.name);
    dlgLk.close();
    toast(warn ? "이었어요. 목양 카드 몇 장은 그 카드를 맡은 셀리더가 앱을 열 때 차단이 걸려요." : "이었어요. 목양 카드에 본인 차단도 걸었어요.");
    invalidate(); renderDir();
  } catch (e) { $("lk-err").textContent = msgOf(e); }
  finally { $("lk-save").disabled = false; }
};

/* ════════ 인계 요청 ════════ */
async function loadHandovers() {
  const me = state.me, col = collection(db,"handovers"), out = [], seen = {};
  const push = (rows) => rows.forEach(r => { if (!seen[r.id]) { seen[r.id] = true; out.push(r); } });
  try {
    const rs = await Promise.all([
      me.role === "super" ? getDocs(col)
        : (isManager() && me.jinId) ? getDocs(query(col, where("jinId","==",me.jinId))) : Promise.resolve({ docs:[] }),
      getDocs(query(col, where("fromUid","==",me.id))),
      getDocs(query(col, where("toUid","==",me.id)))]);
    rs.forEach(r => push(pack(r)));
  } catch (e) { console.warn("인계 요청", e); }
  state.handovers = out.sort((a,b) => (b.atMs||0) - (a.atMs||0));
}
function handTitle(h) {
  const c = cellNameOf(h.toCellId || h.cellId) || "셀";
  return h.kind === "leader" ? `${c} 담당 변경` : h.kind === "split" ? `${cellNameOf(h.cellId)}에서 ${c} 분가` : `${c}로 옮김`;
}
async function makeHandover(h) {
  if (!h.fromUid || !h.toUid || h.fromUid === h.toUid) return null;
  const row = { jinId: h.jinId || state.me.jinId, kind: h.kind, cellId: h.cellId || null, toCellId: h.toCellId || null,
    fromUid: h.fromUid, toUid: h.toUid, memberIds: h.memberIds || [], wholeCell: !!h.wholeCell,
    status: "pending", by: uid(), byName: state.me.name || "", atMs: Date.now(), at: serverTimestamp() };
  const ref = await addDoc(collection(db,"handovers"), row);
  const r = { id: ref.id, ...row };
  state.handovers = [r, ...(state.handovers||[])];
  if (h.fromUid !== uid()) {
    try { await addDoc(collection(db,"notices"), { to: h.fromUid, from: uid(), fromName: state.me.name || "",
      kind: "handover", target: { kind: "handover", id: ref.id, fromUid: h.fromUid }, title: handTitle(r),
      snippet: `목양 카드를 ${userName(h.toUid)} 님에게 넘겨주세요 — 앱을 열면 홈 맨 위에 떠요.`,
      atMs: Date.now(), at: serverTimestamp(), read: false }); } catch {}
  }
  await log("인계 요청", handTitle(r), `${userName(h.fromUid)} → ${userName(h.toUid)}`);
  return r;
}
/* 이 요청에 걸린, 내가 맡은 카드 */
function handTargets(h) {
  const ids = new Set(h.memberIds || []);
  return state.souls.filter(s => isLeaderOf(s) && s.active !== false
    && ((s.memberId && ids.has(s.memberId)) || (h.wholeCell && !isLeaderCard(s) && s.cellId === h.cellId)));
}
/* 이 카드가 그 사람 본인에 대한 것인가 */
function isAboutUid(s, who) {
  const u = userOf(who), m = s.memberId && memberById(s.memberId);
  return s.linkedUid === who || (!!u && !!s.subjectEmail && s.subjectEmail === (u.email||"").toLowerCase())
    || (!!m && m.uid === who);
}
function renderHomeHand() {
  const me = uid(), parts = [];
  (state.handovers||[]).filter(h => h.status === "pending" && h.fromUid === me).forEach(h => {
    const n = handTargets(h).length;
    parts.push(`<div class="card" style="margin-bottom:12px;background:var(--rose-bg);border-color:var(--rose-line)">
      <p style="font-size:13px;font-weight:600;color:var(--rose-tx)">${esc(handTitle(h))}</p>
      <p class="muted" style="margin-top:6px">${esc(h.byName || "")} 님이 요청했어요 — 내가 맡은 목양 카드 ${n}장을
        <b style="color:var(--text)">${esc(userName(h.toUid))}</b> 님에게 넘겨주세요.</p>
      <button class="btn-sm" data-hrun="${h.id}" style="margin-top:10px">${n ? "넘기기" : "확인 — 넘길 카드 없음"}</button>
    </div>`);
  });
  const inc = (state.handovers||[]).filter(h => h.status === "pending" && h.toUid === me && h.fromUid !== me);
  if (inc.length) parts.push(`<div class="card" style="margin-bottom:12px">
      <p style="font-size:13px;font-weight:600">목양 카드가 넘어올 거예요</p>
      <p class="muted" style="margin-top:6px">${inc.map(h => `${esc(handTitle(h))} — ${esc(userName(h.fromUid))} 님이 앱을 열어 넘기면 내 영혼들에 생겨요.`).join("<br>")}</p>
    </div>`);
  if (state.selfDup && state.selfDup.active !== false) parts.push(`<div class="card" style="margin-bottom:12px">
      <p style="font-size:13px;font-weight:600">영혼 카드에 '${esc(state.selfDup.name)}' — 나와 같은 이름이 있어요</p>
      <p class="muted" style="margin-top:6px">나를 위해 만들어 둔 카드라면 그 카드에서 '보관하기'를 눌러주세요.
        이제 나는 영혼들 맨 위 '나'와 교회 명부에 따로 있어요. 다른 분이면 그대로 두셔도 돼요(명부에는 안 올라가요).</p>
      <button class="btn-sm" data-gosoul="${state.selfDup.id}" style="margin-top:10px">카드 열기</button>
    </div>`);
  $("home-hand").innerHTML = parts.join("");
}
$("home-hand").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-hrun]"); if (b) openHrun(b.dataset.hrun);
});

/* ── 넘기기 (지금 카드를 맡은 셀리더) ── */
const dlgHr = $("dlg-hrun");
function openHrun(id) {
  const h = (state.handovers||[]).find(x => x.id === id); if (!h) return;
  state.hr = h; state.hrPick = "summary";
  const T = handTargets(h);
  $("hr-sub").textContent = `${handTitle(h)} — ${h.byName || ""} 님 요청. ${userName(h.toUid)} 님에게 넘깁니다.`;
  $("hr-names").innerHTML = T.map(s => `<div class="row">${avatar(s, 30)}<div class="grow"><p class="nm">${esc(s.name)}${
      isAboutUid(s, h.toUid) ? ` <span class="chip rose">새 셀리더 본인</span>` : ""}</p></div></div>`).join("")
    || `<p class="muted">지금 내가 맡은 카드 중에 넘길 것이 없어요. '넘기기'를 누르면 요청을 마무리해요.</p>`;
  const self = T.filter(s => isAboutUid(s, h.toUid));
  const jj = (state.members||[]).find(u => u.role === "jinjang" && u.active !== false && u.jinId === h.jinId && u.id !== uid());
  state.hrJJ = jj ? jj.id : null;
  $("hr-lead-wrap").innerHTML = self.length ? `<div class="card" style="background:var(--lock-bg);border-color:var(--track)">
      <p style="font-size:13px;line-height:1.7">${esc(self.map(s => s.name).join(", "))} 님 카드는 본인에게 넘기지 않아요.
        '셀리더 카드'로 바뀌고, 본인은 어떤 경로로도 못 봐요.</p>
      ${jj ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="hr-tojj" checked> 진장(${esc(jj.name)})에게 넘기기</label>`
           : `<p class="muted" style="margin-top:6px">진장이 없어서 내가 계속 맡아요.</p>`}</div>` : "";
  renderHrScope();
  $("hr-scope").parentElement && ($("hr-scope").previousElementSibling.hidden = !T.length);
  $("hr-scope").hidden = !T.length;
  $("hr-err").textContent = "";
  dlgHr.showModal();
}
function renderHrScope() {
  $("hr-scope").innerHTML = HAND.map(x => `
    <div class="row" data-hrp="${x.id}" style="cursor:pointer;${state.hrPick === x.id ? "border-color:var(--brand)" : ""}">
      <span style="width:18px;height:18px;border-radius:999px;flex-shrink:0;border:2px solid ${
        state.hrPick === x.id ? "var(--brand)" : "var(--line)"};background:${state.hrPick === x.id ? "var(--brand)" : "transparent"}"></span>
      <div class="grow"><p class="nm">${x.name}</p><p class="sub" style="white-space:normal">${x.sub}</p></div>
    </div>`).join("");
}
$("hr-scope").addEventListener("click", (ev) => { const b = ev.target.closest("[data-hrp]"); if (!b) return;
  state.hrPick = b.dataset.hrp; renderHrScope(); });
$("hr-later").onclick = () => dlgHr.close();
$("hr-go").onclick = async () => {
  const h = state.hr, pick = state.hrPick, T = handTargets(h);
  $("hr-go").disabled = true; $("hr-err").textContent = "";
  try {
    let n = 0;
    for (const s of T) {
      if (isAboutUid(s, h.toUid)) {
        /* 새 셀리더 본인 카드 — 본인에게 가지 않고 셀리더 카드로 */
        const to = userOf(h.toUid) || {};
        const p = { kind: "leader", cellId: null, ofCellId: h.toCellId || null, linked: true };
        if (!s.linkedUid) p.linkedUid = h.toUid;
        if (!s.subjectEmail && to.email) p.subjectEmail = (to.email||"").toLowerCase();
        await updateDoc(doc(db,"souls",s.id), p); Object.assign(s, p);
        const tj = $("hr-tojj");
        if (tj && tj.checked && state.hrJJ) await doHandover(s.id, state.hrJJ, pick, {});
        continue;
      }
      await doHandover(s.id, h.toUid, pick, { cellId: h.toCellId || s.cellId || null });
      n++;
    }
    await updateDoc(doc(db,"handovers",h.id), { status: "done", doneAt: serverTimestamp(), doneBy: uid(), pick });
    h.status = "done";
    for (const to of new Set([h.by, h.toUid])) {
      if (!to || to === uid()) continue;
      try { await addDoc(collection(db,"notices"), { to, from: uid(), fromName: state.me.name || "", kind: "handover",
        target: { kind: "handover", id: h.id }, title: handTitle(h), snippet: `목양 카드 ${n}장을 ${userName(h.toUid)} 님에게 넘겼어요.`,
        atMs: Date.now(), at: serverTimestamp(), read: false }); } catch {}
    }
    await log("인계 완료", handTitle(h), `${n}장 · ${(HAND.find(x => x.id === pick)||{}).name || ""}`);
    bump("handover");
    dlgHr.close(); invalidate(); await loadSouls(true);
    toast(n ? `${n}장을 ${userName(h.toUid)} 님에게 넘겼어요.` : "요청을 마무리했어요.");
    if (!$("s-home").hidden) renderHomeHand();
    if (!$("s-cellmgr").hidden) renderCellMgr();
  } catch (e) { $("hr-err").textContent = msgOf(e); }
  finally { $("hr-go").disabled = false; }
};

/* ════════ 셀 관리 (진장 · 코치 · 수퍼) ════════ */
async function openCellMgr() {
  if (!isManager()) { toast("셀 관리는 진장 · 코치 · 수퍼 관리자가 해요."); return; }
  show("s-loading");
  await loadOrg(true); await syncBadges(); await loadHandovers();
  if (canLead() || ["coach","jinjang"].includes(state.me.role)) await loadSouls();
  renderCellMgr(); show("s-cellmgr");
}
$("cellmgr-back").onclick = () => openHome();
function renderCellMgr() {
  const pend = (state.handovers||[]).filter(h => h.status === "pending");
  const me = state.me;
  $("cm-pending").innerHTML = pend.length ? `<div class="card" style="margin-top:6px">
      <h3 style="font-size:13px;font-weight:600">넘어가는 중인 목양 카드 ${pend.length}건</h3>
      <p class="muted" style="font-size:12px;margin-top:4px">지금 카드를 맡은 셀리더가 앱을 열어 넘기면 끝나요.</p>
      <div class="list" style="margin-top:10px">${pend.map(h => `<div class="row" style="flex-direction:column;align-items:stretch">
        <p class="nm">${esc(handTitle(h))}</p>
        <p class="sub">${esc(userName(h.fromUid))} → ${esc(userName(h.toUid))} · ${(h.memberIds||[]).length ? h.memberIds.length + "명" : "셀 전체"} · ${fmtAgo(h.atMs)} 요청</p>
        <div class="acts">
          ${h.fromUid === uid() ? `<button class="btn-sm" data-hrun="${h.id}">내가 넘기기</button>` : ""}
          ${me.role === "jinjang" && h.fromUid !== uid() ? `<button class="btn-sm" data-hforce="${h.id}">바로 넘기기 (전부)</button>` : ""}
          <button class="btn-sm danger" data-hcancel="${h.id}">요청 취소</button>
        </div></div>`).join("")}</div></div>` : "";
  const cells = dirCellsShown();
  $("cm-list").innerHTML = cells.map(c => {
    const ents = cellLeadEntries(c);
    const lids = new Set(ents.map(e => e.m && e.m.id).filter(Boolean));
    const ms = (state.dir||[]).filter(m => m.cellId === c.id && m.active !== false && !lids.has(m.id));
    const jn = me.role === "super" ? ((state.jins.find(j => j.id === c.jinId)||{}).name || "") : "";
    return `<div class="cmc">
      <div class="cmh"><span class="cbadge">${esc(c.name)}</span>
        <div class="grow"><p class="sub" style="margin:0">${jn ? esc(jn) + " · " : ""}셀원 ${ms.length}명</p></div>
        <button class="btn-sm" data-cmview="${c.id}">명부</button></div>
      ${ents.length ? ents.map(e => e.m ? memCardHTML(e.m, { leadEnt: e, mgr: true, cellId: c.id }) : leadGhostHTML(e)).join("")
        : `<div class="mcard lead empty"><span class="ava" style="width:52px;height:52px">?</span>
            <div class="mc-body"><p class="mc-role">담당 셀리더</p><p class="mc-nm" style="color:var(--warn-tx);font-size:13px;font-weight:500">없음 — '담당 바꾸기'나 셀리더 명단에서 넣어 주세요</p></div></div>`}
      <div class="acts">
        <button class="btn-sm" data-cmlead="${c.id}">담당 바꾸기</button>
        <button class="btn-sm" data-cmsplit="${c.id}">분가</button>
        <button class="btn-sm" data-cmrename="${c.id}">이름</button>
        <button class="btn-sm danger" data-cmclose="${c.id}">보관</button>
      </div></div>`;
  }).join("") || `<p class="muted">아직 셀이 없어요. 오른쪽 위 '＋ 새 셀'로 만들어요.</p>`;
  fillCardsPriv($("cm-list"));
  loadAttReps().then(() => fillAtt($("cm-list"))).catch(() => {});
}
$("btn-cm-new").onclick = () => openSplit(null);
$("s-cellmgr").addEventListener("click", async (ev) => {
  const g = (k) => { const b = ev.target.closest(`[data-${k}]`); return b ? b.dataset[k.replace(/-([a-z])/g, (_, x) => x.toUpperCase())] : null; };
  let id;
  if ((id = g("hrun"))) { openHrun(id); return; }
  if ((id = g("hforce"))) { const h = state.handovers.find(x => x.id === id); if (h) forceHandover(h); return; }
  if ((id = g("hcancel"))) {
    if (!confirm("이 인계 요청을 취소할까요? 카드는 지금 맡은 셀리더에게 그대로 있어요.")) return;
    try { await updateDoc(doc(db,"handovers",id), { status: "canceled", doneAt: serverTimestamp(), doneBy: uid() });
      const h = state.handovers.find(x => x.id === id); if (h) h.status = "canceled";
      await log("인계 요청 취소", id); renderCellMgr(); toast("취소했어요."); }
    catch (e) { toast(msgOf(e)); }
    return;
  }
  const cell = (k) => { const v = g(k); return v ? state.cells.find(c => c.id === v) : null; };
  let c;
  if ((c = cell("cmview"))) { state.dirCell = c.id; state.dirRole = "all"; $("dir-search").value = ""; openDir(); return; }
  if ((c = cell("cmlead"))) { openClDlg(c); return; }
  if ((c = cell("cmsplit"))) { openSplit(c); return; }
  if ((c = cell("cmrename"))) {
    const name = prompt("셀 이름", c.name); if (!name || !name.trim() || name.trim() === c.name) return;
    try { await updateDoc(doc(db,"cells",c.id), { name: name.trim() }); await log("셀 이름 변경", c.name, name.trim());
      c.name = name.trim(); renderCellMgr(); toast("이름을 바꿨어요."); }
    catch (e) { toast(msgOf(e)); }
    return;
  }
  if ((c = cell("cmclose"))) {
    const n = (state.dir||[]).filter(m => m.cellId === c.id && m.active !== false).length;
    if (n) { toast(`이 셀에 ${n}명이 있어요. 먼저 다른 셀로 옮겨주세요.`); return; }
    if (leadersOf(c.id).length) { toast("담당 셀리더가 있어요. '담당 바꾸기'에서 담당을 비운 뒤 보관해 주세요."); return; }
    if (!confirm(`${c.name}을 보관할까요? 목록에서만 빠지고, 지난 셀모임 기록은 그대로 남아요.`)) return;
    try { await updateDoc(doc(db,"cells",c.id), { active: false }); c.active = false;
      await log("셀 보관", c.name); renderCellMgr(); toast("보관했어요."); }
    catch (e) { toast(msgOf(e)); }
  }
});
/* 셀을 맡길 수 있는 사람 — 코치는 셀리더 · 코치에게만 (규칙과 같게) */
function leaderCandidates(jinId) {
  const strong = state.me.role === "super" || state.me.role === "jinjang";
  return (state.members||[]).filter(u => u.active !== false && u.jinId === jinId
    && (u.role === "leader" || u.role === "coach" || (strong && (u.role === "jinjang" || u.role === "super"))))
    .sort((a,b) => (a.name||"").localeCompare(b.name||"", "ko"));
}
const candText = (u) => `${u.name} · ${ROLEBADGE[badgeOf(u)] || ""}${u.cellId && (u.role === "leader" || u.isLeader) ? " · 지금 " + cellNameOf(u.cellId) : ""}`;

/* ── 담당 셀리더 바꾸기 ── */
const dlgCl = $("dlg-cl");
function openClDlg(c) {
  state.clCell = c;
  const ls = leadersOf(c.id);
  $("cl-sub").textContent = `${c.name} — 지금 담당: ${ls.length ? ls.map(u => u.name).join(", ") : "없음"}. 셀 이름은 그대로예요.`;
  $("cl-to").innerHTML = `<option value="">담당 비우기 — 셀만 남겨두기</option>`
    + leaderCandidates(c.jinId).map(u => `<option value="${u.id}">${esc(candText(u))}</option>`).join("");
  $("cl-to").value = ls[0] ? ls[0].id : "";
  $("cl-hint").textContent = "바꾸면 이전 담당의 '맡은 셀'이 비워지고, 이 셀 사람들의 목양 카드는 지금 맡은 셀리더가 앱을 열어 "
    + "얼마나 넘길지(전부 · 요약만 · 지금부터) 골라 새 담당에게 넘겨요. 지난 셀모임 출석은 이 셀에 그대로 남아요.";
  $("cl-err").textContent = "";
  dlgCl.showModal();
}
$("cl-cancel").onclick = () => dlgCl.close();
$("cl-save").onclick = async () => {
  const c = state.clCell, toUid = $("cl-to").value || "";
  const olds = leadersOf(c.id).filter(u => u.id !== toUid);
  if (toUid && !olds.length && leadersOf(c.id).some(u => u.id === toUid)) { dlgCl.close(); return; }
  $("cl-save").disabled = true; $("cl-err").textContent = "";
  try {
    if (toUid) {
      const u = userOf(toUid), p = { cellId: c.id };
      if (u.role !== "leader") p.isLeader = true;
      await updateDoc(doc(db,"users",toUid), p); Object.assign(u, p);
      if (toUid === state.me.id) Object.assign(state.me, p);
    }
    for (const o of olds) {
      const p = { cellId: null, ...(o.role === "coach" ? { isLeader: false } : {}) };
      await updateDoc(doc(db,"users",o.id), p); Object.assign(o, p);
      if (o.id === state.me.id) Object.assign(state.me, p);
    }
    await syncBadges();
    const mineH = toUid ? await requestCellHandovers(c, toUid, olds) : [];
    await log("셀 담당 변경", c.name, `${olds.map(u => u.name).join(", ") || "없음"} → ${userName(toUid) || "없음"}`);
    dlgCl.close();
    toast(toUid ? `${c.name} 담당을 ${userName(toUid)} 님으로 바꿨어요.` : `${c.name} 담당을 비웠어요.`);
    renderCellMgr();
    if (mineH.length) openHrun(mineH[0].id);
  } catch (e) { $("cl-err").textContent = msgOf(e); }
  finally { $("cl-save").disabled = false; }
};
/* 이 셀 사람들의 목양 카드를 지금 맡은 사람마다 '넘겨주세요' 요청 */
async function requestCellHandovers(c, toUid, olds) {
  const groups = {};
  (state.dir||[]).filter(m => m.cellId === c.id && m.active !== false && !m.uid).forEach(m => {
    if (m.careUid && m.careUid !== toUid) (groups[m.careUid] = groups[m.careUid] || []).push(m.id);
  });
  (olds||[]).forEach(o => { if (o.id !== toUid && !groups[o.id]) groups[o.id] = []; });
  const mine = [];
  for (const [from, ids] of Object.entries(groups)) {
    const r = await makeHandover({ kind: "leader", jinId: c.jinId, cellId: c.id, toCellId: c.id,
      fromUid: from, toUid, memberIds: ids, wholeCell: true });
    if (r && r.fromUid === uid()) mine.push(r);
  }
  return mine;
}

/* ── 새 셀 · 분가 ── */
const dlgSp = $("dlg-split");
function openSplit(c) {
  const me = state.me;
  state.spCell = c || null;
  state.spJin = c ? c.jinId : (me.role === "super" ? (me.jinId || (state.jins[0]||{}).id) : me.jinId);
  $("sp-title").textContent = c ? `분가 — ${c.name}에서 새 셀` : "새 셀 만들기";
  $("sp-sub").textContent = c ? "새 셀 이름과 담당 셀리더를 정하고, 새 셀로 옮길 사람을 골라요."
    : "셀 이름과 담당 셀리더를 정해요. 담당은 나중에 '담당 바꾸기'로 정해도 돼요.";
  $("sp-name").value = "";
  $("sp-leader").innerHTML = `<option value="">아직 안 정함</option>`
    + leaderCandidates(state.spJin).map(u => `<option value="${u.id}">${esc(candText(u))}</option>`).join("");
  $("sp-members-wrap").hidden = !c;
  if (c) {
    const lids = new Set(leadersOf(c.id).map(u => u.id));
    const ms = (state.dir||[]).filter(m => m.cellId === c.id && m.active !== false && !(m.uid && lids.has(m.uid)));
    $("sp-members").innerHTML = ms.map(m => `<label><input type="checkbox" value="${m.id}"> <span class="grow">${esc(m.name)}</span>${
      m.role && m.role !== "member" ? `<span class="chip">${esc(ROLEBADGE[m.role])}</span>` : ""}</label>`).join("")
      || `<p class="muted">이 셀 명부에 사람이 없어요.</p>`;
  }
  $("sp-hint").textContent = c ? "새 담당 셀리더가 원래 이 셀 사람이면 함께 체크해 주세요 — 그분 카드는 본인에게 가지 않고 '셀리더 카드'가 돼요." : "";
  $("sp-err").textContent = "";
  dlgSp.showModal();
}
$("sp-leader").onchange = () => {
  const m = memberOfUid($("sp-leader").value);
  if (!m) return;
  const box = $("sp-members").querySelector(`input[value="${m.id}"]`); if (box) box.checked = true;
};
$("sp-cancel").onclick = () => dlgSp.close();
$("sp-save").onclick = async () => {
  const c = state.spCell, name = $("sp-name").value.trim(), toUid = $("sp-leader").value || "";
  if (!name) { $("sp-err").textContent = "새 셀 이름을 적어주세요."; return; }
  if (activeCells().some(x => x.jinId === state.spJin && x.name === name)) { $("sp-err").textContent = "같은 이름의 셀이 이미 있어요."; return; }
  const picked = c ? [...$("sp-members").querySelectorAll("input:checked")].map(i => i.value) : [];
  $("sp-save").disabled = true; $("sp-err").textContent = "";
  try {
    const data = { name, jinId: state.spJin, active: true, ...(c ? { parentCellId: c.id } : {}), createdAt: serverTimestamp() };
    const ref = await addDoc(collection(db,"cells"), data);
    const nc = { id: ref.id, ...data }; state.cells.push(nc);
    if (toUid) {
      const u = userOf(toUid), p = { cellId: nc.id };
      if (u.role !== "leader") p.isLeader = true;
      await updateDoc(doc(db,"users",toUid), p); Object.assign(u, p);
      if (toUid === state.me.id) Object.assign(state.me, p);
    }
    for (const id of picked) {
      await updateDoc(doc(db,"members",id), { cellId: nc.id, updatedAt: serverTimestamp() });
      const m = memberById(id); if (m) m.cellId = nc.id;
    }
    await syncBadges();
    const mine = [];
    if (c && toUid && picked.length) {
      const groups = {};
      picked.map(memberById).filter(Boolean).forEach(m => {
        if (m.careUid && m.careUid !== toUid) (groups[m.careUid] = groups[m.careUid] || []).push(m.id);
      });
      for (const [from, ids] of Object.entries(groups)) {
        const r = await makeHandover({ kind: "split", jinId: nc.jinId, cellId: c.id, toCellId: nc.id,
          fromUid: from, toUid, memberIds: ids });
        if (r && r.fromUid === uid()) mine.push(r);
      }
    }
    await log(c ? "분가" : "셀 추가", name, c ? `${c.name}에서 ${picked.length}명` : "");
    dlgSp.close();
    toast(c ? `${name}을 만들고 ${picked.length}명을 옮겼어요.` : `${name}을 만들었어요.`);
    renderCellMgr();
    if (mine.length) openHrun(mine[0].id);
  } catch (e) { $("sp-err").textContent = msgOf(e); }
  finally { $("sp-save").disabled = false; }
};

/* ── 바로 넘기기 (진장) — 카드를 맡은 셀리더가 떠나 앱을 열 수 없을 때 ── */
async function forceHandover(h) {
  if (!confirm(`${userName(h.fromUid)} 님이 아직 넘기지 않은 카드를 지금 바로 ${userName(h.toUid)} 님에게 넘길까요?\n`
    + `지난 기록은 '나만 보기'를 빼고 전부 넘어가요.`)) return;
  try {
    state.soulsAt = 0; await loadSouls(true);
    const ids = new Set(h.memberIds || []);
    const list = state.souls.filter(s => s.leaderUid === h.fromUid && s.active !== false
      && ((s.memberId && ids.has(s.memberId)) || (h.wholeCell && !isLeaderCard(s) && s.cellId === h.cellId)));
    let n = 0, skip = 0;
    for (const s of list) {
      if (isAboutUid(s, h.toUid)) { skip++; continue; }
      await updateDoc(doc(db,"souls",s.id), { leaderUid: h.toUid, cellId: h.toCellId || s.cellId || null,
        ...(linkedData(s) ? { linked: true } : (s.linked === undefined ? { linked: false } : {})) });
      if (s.memberId) { try { await updateDoc(doc(db,"members",s.memberId), { careUid: h.toUid }); } catch {} }
      n++;
    }
    await updateDoc(doc(db,"handovers",h.id), { status: "forced", doneAt: serverTimestamp(), doneBy: uid() });
    h.status = "forced";
    try { await addDoc(collection(db,"notices"), { to: h.toUid, from: uid(), fromName: state.me.name || "", kind: "handover",
      target: { kind: "handover", id: h.id }, title: handTitle(h), snippet: `목양 카드 ${n}장이 넘어왔어요.`,
      atMs: Date.now(), at: serverTimestamp(), read: false }); } catch {}
    await log("인계 바로 넘김", handTitle(h), `${n}장`);
    invalidate(); state.soulsAt = 0; await loadSouls(true); renderCellMgr();
    toast(`${n}장을 넘겼어요.${skip ? ` 새 셀리더 본인 카드 ${skip}장은 그대로 뒀어요.` : ""}`);
  } catch (e) { toast(msgOf(e)); }
}

/* ════════════════════════════════════════════════════════════
   19단계 · 조직 구성 — 기관 관리자가 자리를 먼저 짭니다
   ────────────────────────────────────────────────────────────
   진 → 진장 · 코치 · 셀 → 셀리더 자리를 만들고, 자리마다 이름과 구글 이메일을 넣습니다.
   이메일을 넣으면 그 순간 초대가 걸리고(명부 카드와 이어져 본인 차단도 같이),
   그분이 가입하기 전에도 자리는 '초대 보냄'으로 보입니다.
   이메일을 모르면 이름만 넣어 둡니다(명부 카드의 pendingSeat).
   ════════════════════════════════════════════════════════════ */
const SEATNAME = { jinjang:"진장", coach:"코치", leader:"셀리더" };
/* 자리에 앉은 사람 — 가입함(acc) · 초대 보냄(inv) · 이름만(noe) */
function seatList(kind, jinId, cellId) {
  const out = [], seenEmail = new Set();
  const us = (state.members||[]).filter(u => u.active !== false && u.jinId === jinId);
  const inv = (state.invites||[]).filter(i => i.status === "pending" && i.jinId === jinId);
  const ph = (state.dir||[]).filter(m => m.active !== false && m.jinId === jinId && !m.uid
    && m.pendingSeat && !pendingInvite(m));
  const cellsTxt = (ids) => (ids||[]).map(cellNameOf).filter(Boolean).join(" · ");
  const addU = (u, sub) => { seenEmail.add((u.email||"").toLowerCase()); out.push({ t:"acc", name:u.name, uid:u.id, sub }); };
  const addI = (i, sub) => { if (seenEmail.has(i.email)) return; out.push({ t:"inv", name:i.name, email:i.email, inv:i, sub }); };
  const addP = (m, sub) => out.push({ t:"noe", name:m.name, m, sub });
  if (kind === "jinjang") {
    us.filter(u => u.role === "jinjang").forEach(u => addU(u));
    inv.filter(i => i.role === "jinjang").forEach(i => addI(i));
    ph.filter(m => m.pendingSeat.role === "jinjang").forEach(m => addP(m));
  } else if (kind === "coach") {
    us.filter(u => u.role === "coach").forEach(u => addU(u, cellsTxt(u.cellIds)));
    inv.filter(i => i.role === "coach").forEach(i => addI(i, cellsTxt(i.cellIds)));
    ph.filter(m => ["coach","coachleader"].includes(m.pendingSeat.role)).forEach(m => addP(m, cellsTxt(m.pendingSeat.cellIds)));
  } else {
    leadersOf(cellId).forEach(u => addU(u, u.role === "coach" ? "코치 겸함" : ""));
    inv.filter(i => i.cellId === cellId && (i.role === "leader" || (i.role === "coach" && i.isLeader)))
      .forEach(i => addI(i, i.role === "coach" ? "코치 겸함" : ""));
    ph.filter(m => m.pendingSeat.cellId === cellId && ["leader","coachleader"].includes(m.pendingSeat.role))
      .forEach(m => addP(m, m.pendingSeat.role === "coachleader" ? "코치 겸함" : ""));
  }
  return out;
}
/* 명부 · 셀 관리의 '담당 OO' — 가입 전인 분도 같이 */
function leaderLabel(cellId) {
  const c = state.cells.find(x => x.id === cellId); if (!c) return "";
  return seatList("leader", c.jinId, cellId)
    .map(p => p.name + (p.t === "inv" ? " (초대 중)" : p.t === "noe" ? " (가입 전)" : "")).join(", ");
}
async function openOrg() {
  if (!state.me || state.me.role !== "super") { toast("조직 구성은 수퍼 관리자가 해요."); return; }
  show("s-loading");
  await loadOrg(true);
  if (!state.orgName) { try { const o = await getDoc(doc(db,"org","main")); if (o.exists()) state.orgName = o.data().name; } catch {} }
  await loadOwner();
  renderOrg(); show("s-org");
}
function renderOrg() {
  $("org-church").textContent = state.orgName || "교회 이름을 정해 주세요";
  renderOrgTop();
  state.orgSeats = [];
  const chip = (p, kind, jinId, cellId) => {
    const i = state.orgSeats.push({ ...p, kind, jinId, cellId }) - 1;
    const tag = p.t === "inv" ? " <i>✉ 초대 보냄</i>" : p.t === "noe" ? " <i>이메일 없음</i>" : "";
    return `<button type="button" class="pchip ${p.t}" data-oseat="${i}">${esc(p.name||"")}${tag}${p.sub ? ` <i>${esc(p.sub)}</i>` : ""}</button>`;
  };
  const add = (kind, jinId, cellId) => `<button type="button" class="pchip add" data-oadd="${kind}" data-jin="${jinId}" data-cell="${cellId||""}">＋ ${SEATNAME[kind]}</button>`;
  const jins = state.jins.filter(j => j.active !== false);
  $("org-jins").innerHTML = jins.map(j => {
    const cells = activeCells().filter(c => c.jinId === j.id);
    const jj = seatList("jinjang", j.id), co = seatList("coach", j.id);
    return `<div class="card" style="margin-top:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <h3 class="grow" style="font-size:16px;font-weight:600">${esc(j.name)}</h3>
        <button class="btn-sm" data-ojrename="${j.id}">이름</button>
      </div>
      <div class="seat"><span class="lb">진장</span><div class="ppl">${jj.map(p => chip(p, "jinjang", j.id)).join("")}${jj.length ? "" : add("jinjang", j.id)}</div></div>
      <div class="seat"><span class="lb">코치</span><div class="ppl">${co.map(p => chip(p, "coach", j.id)).join("")}${add("coach", j.id)}</div></div>
      <div style="display:flex;align-items:center;gap:6px;margin:14px 0 2px;flex-wrap:wrap">
        <p class="grow" style="font-size:13px;font-weight:600">셀 ${cells.length}개</p>
        <button class="btn-sm" data-obulk="${j.id}">여러 셀 한꺼번에</button>
        <button class="btn-sm" data-ocell="${j.id}">＋ 셀</button>
      </div>
      ${cells.map(c => {
        const ls = seatList("leader", j.id, c.id);
        const n = (state.dir||[]).filter(m => m.cellId === c.id && m.active !== false).length;
        return `<div class="ocell"><span class="cn" data-ocview="${c.id}" title="명부에서 보기">${esc(c.name)}</span>
          <div class="ppl" style="display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0">${ls.map(p => chip(p, "leader", j.id, c.id)).join("")}${ls.length ? "" : add("leader", j.id, c.id)}</div>
          <span class="cnt">${n}명</span></div>`;
      }).join("") || `<p class="muted" style="font-size:12px;padding:8px 0">아직 셀이 없어요. '＋ 셀'이나 '여러 셀 한꺼번에'로 만들어요.</p>`}
    </div>`;
  }).join("") || `<p class="muted" style="margin-top:14px">아직 진이 없어요. 오른쪽 위 '＋ 진'으로 만들어요.</p>`;
}
$("org-back").onclick = () => openHome();
$("btn-home-org").onclick = () => openOrg();
$("btn-manage-org").onclick = () => openOrg();
$("btn-org-church").onclick = async () => {
  const name = prompt("교회 이름", state.orgName || ""); if (!name || !name.trim()) return;
  try { await updateDoc(doc(db,"org","main"), { name: name.trim() }); state.orgName = name.trim();
    await log("교회 이름 변경", name.trim()); renderOrg(); toast("바꿨어요."); }
  catch (e) { toast(msgOf(e)); }
};
$("btn-org-jin").onclick = async () => {
  const name = prompt("새 진 이름", `${state.jins.length + 1}진`); if (!name || !name.trim()) return;
  try { const ref = await addDoc(collection(db,"jins"), { name: name.trim(), jinjangUid: null, active: true, createdAt: serverTimestamp() });
    state.jins.push({ id: ref.id, name: name.trim(), jinjangUid: null, active: true });
    await log("진 추가", name.trim()); renderOrg(); toast(`${name.trim()}을 만들었어요.`); }
  catch (e) { toast(msgOf(e)); }
};
$("s-org").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-oseat],[data-oadd],[data-ojrename],[data-obulk],[data-ocell],[data-ocview]"); if (!b) return;
  const d = b.dataset;
  if (d.oseat !== undefined) {
    const p = state.orgSeats[+d.oseat]; if (!p) return;
    if (p.t === "acc") { const m = memberOfUid(p.uid); if (m) openMember(m.id); else toast("명부 카드가 아직 없어요. 그분이 앱을 한 번 열면 생겨요."); return; }
    openSeat({ kind: p.kind, jinId: p.jinId, cellId: p.cellId, entry: p });
    return;
  }
  if (d.oadd) { openSeat({ kind: d.oadd, jinId: d.jin, cellId: d.cell || null }); return; }
  if (d.ocview) { state.dirCell = d.ocview; state.dirRole = "all"; $("dir-search").value = ""; openDir(); return; }
  if (d.ojrename) {
    const j = state.jins.find(x => x.id === d.ojrename);
    const name = prompt("진 이름", j.name); if (!name || !name.trim() || name.trim() === j.name) return;
    try { await updateDoc(doc(db,"jins",j.id), { name: name.trim() }); j.name = name.trim(); renderOrg(); toast("바꿨어요."); }
    catch (e) { toast(msgOf(e)); }
    return;
  }
  if (d.ocell) {
    const name = prompt("새 셀 이름", ""); if (!name || !name.trim()) return;
    if (activeCells().some(c => c.jinId === d.ocell && c.name === name.trim())) { toast("같은 이름의 셀이 이미 있어요."); return; }
    try { const data = { name: name.trim(), jinId: d.ocell, active: true, createdAt: serverTimestamp() };
      const ref = await addDoc(collection(db,"cells"), data); state.cells.push({ id: ref.id, ...data });
      await log("셀 추가", name.trim()); renderOrg(); }
    catch (e) { toast(msgOf(e)); }
    return;
  }
  if (d.obulk) openBulk(d.obulk);
});

/* ── 자리에 사람 넣기 ── */
const dlgSt = $("dlg-seat");
function openSeat(S) {
  state.seat = S;
  const j = state.jins.find(x => x.id === S.jinId) || {}, c = S.cellId && state.cells.find(x => x.id === S.cellId);
  const e = S.entry;
  $("sx-title").textContent = `${c ? c.name : j.name} ${SEATNAME[S.kind]}`;
  $("sx-sub").textContent = e && e.t === "inv" ? `${e.name} 님께 ${e.email}로 초대를 보냈어요. 이메일을 고쳐 다시 보내거나 빼낼 수 있어요.`
    : e && e.t === "noe" ? `${e.name} 님 — 이메일을 넣으면 초대가 걸려요.`
    : S.kind === "leader" ? "이 셀을 맡을 분이에요. 셀 이름은 그대로 두고 사람만 바뀔 수 있어요."
    : S.kind === "coach" ? "진장을 도와 여러 셀을 돌보는 분이에요. 돌볼 셀을 골라 주세요."
    : "이 진을 맡는 분이에요.";
  const members = (state.dir||[]).filter(m => m.active !== false && m.jinId === S.jinId && !m.uid && !pendingInvite(m));
  const accs = (state.members||[]).filter(u => u.active !== false && u.jinId === S.jinId
    && !(S.kind === "jinjang" && u.role === "super"));
  $("sx-pick").innerHTML = `<option value="new">새로 넣기 — 이름 · 이메일</option>`
    + (members.length ? `<optgroup label="명부에 있는 분 (아직 계정 없음)">${members.map(m =>
        `<option value="m:${m.id}">${esc(m.name)}${m.cellId ? " · " + esc(cellNameOf(m.cellId)) : ""}${m.pendingSeat ? " · 자리 대기" : ""}</option>`).join("")}</optgroup>` : "")
    + (accs.length && !(e && e.t !== "acc") ? `<optgroup label="이미 가입한 분">${accs.map(u =>
        `<option value="u:${u.id}">${esc(u.name)} · ${esc(ROLEBADGE[badgeOf(u)]||"")}</option>`).join("")}</optgroup>` : "");
  $("sx-pick").value = e && e.t === "noe" ? `m:${e.m.id}` : "new";
  $("sx-name2").value = e ? (e.name || "") : "";
  $("sx-email").value = e && e.t === "inv" ? e.email : "";
  $("sx-coach-wrap").hidden = S.kind !== "leader";
  $("sx-coach").checked = !!(e && e.sub === "코치 겸함");
  $("sx-cells-wrap").hidden = S.kind !== "coach";
  if (S.kind === "coach") {
    const pre = new Set((e && e.t === "inv" && e.inv.cellIds) || (e && e.t === "noe" && e.m.pendingSeat.cellIds) || []);
    $("sx-cells").innerHTML = activeCells().filter(x => x.jinId === S.jinId).map(x =>
      `<label><input type="checkbox" value="${x.id}"${pre.has(x.id) ? " checked" : ""}> ${esc(x.name)}</label>`).join("")
      || `<p class="muted">이 진에 셀이 아직 없어요.</p>`;
  }
  $("sx-del").hidden = !(e && (e.t === "inv" || e.t === "noe"));
  $("sx-err").textContent = "";
  syncSeatPick();
  dlgSt.showModal();
}
function syncSeatPick() {
  const v = $("sx-pick").value, S = state.seat;
  const isAcc = v.startsWith("u:");
  $("sx-new").hidden = isAcc;
  if (v.startsWith("m:")) { const m = memberById(v.slice(2)); if (m) $("sx-name2").value = m.name || ""; }
  $("sx-hint").textContent = isAcc
    ? (S.kind === "leader" ? "가입한 분을 셀리더로 앉혀요. 이 셀 사람들의 목양 카드는 지금 맡은 셀리더가 앱을 열어 넘겨요."
       : "가입한 분의 역할을 바로 바꿔요.")
    : $("sx-email").value.trim() ? "넣으면 이 이메일로 초대가 걸려요. 그분이 같은 구글 계정으로 로그인하면 이 자리로 바로 들어와요."
    : "이메일을 비워 두면 이름만 자리에 넣어 둬요. 나중에 이 자리를 눌러 이메일을 채우면 초대가 걸려요.";
  $("sx-save").textContent = isAcc ? "앉히기" : ($("sx-email").value.trim() ? "넣고 초대하기" : "이름만 넣기");
}
$("sx-pick").onchange = syncSeatPick;
$("sx-email").oninput = syncSeatPick;
$("sx-cancel").onclick = () => dlgSt.close();
$("sx-del").onclick = async () => {
  const S = state.seat, e = S.entry; if (!e) return;
  if (!confirm(`${e.name} 님을 이 자리에서 뺄까요?${e.t === "inv" ? "\n보낸 초대도 취소돼요." : ""}`)) return;
  try {
    if (e.t === "inv") {
      await deleteDoc(doc(db,"invites",e.email));
      state.invites = state.invites.filter(i => i.email !== e.email);
      if (e.inv.memberId) { try { await updateDoc(doc(db,"members",e.inv.memberId), { invitedRole: null, pendingSeat: null }); } catch {} }
    } else if (e.t === "noe") {
      await updateDoc(doc(db,"members",e.m.id), { pendingSeat: null }); e.m.pendingSeat = null;
    }
    await log("자리에서 빼기", e.name, SEATNAME[S.kind]);
    dlgSt.close(); await loadOrg(true); renderOrg(); toast("뺐어요.");
  } catch (err) { $("sx-err").textContent = msgOf(err); }
};
$("sx-save").onclick = async () => {
  const S = state.seat, v = $("sx-pick").value;
  const pick = S.kind === "leader" ? ($("sx-coach").checked ? "coachleader" : "leader") : S.kind;
  const cellIds = S.kind === "coach" ? [...$("sx-cells").querySelectorAll("input:checked")].map(i => i.value) : [];
  const cellId = S.kind === "leader" ? S.cellId : null;
  $("sx-err").textContent = "";
  $("sx-save").disabled = true;
  try {
    if (v.startsWith("u:")) {
      /* 이미 가입한 분 — 역할 · 맡은 셀을 바로 */
      const u = userOf(v.slice(2)), p = {};
      if (S.kind === "jinjang") Object.assign(p, { role: "jinjang", jinId: S.jinId });
      if (S.kind === "coach") Object.assign(p, { role: "coach", jinId: S.jinId, cellIds,
        isLeader: !!(u.isLeader || (u.role === "leader" && u.cellId)) });
      if (S.kind === "leader") {
        if (leadersOf(cellId).some(x => x.id !== u.id)) {
          $("sx-err").textContent = "이 셀에는 이미 담당 셀리더가 있어요. 셀 관리의 '담당 바꾸기'로 바꿔 주세요."; return; }
        p.cellId = cellId;
        if (pick === "coachleader" && u.role !== "super") Object.assign(p, { role: "coach", isLeader: true });
        else if (u.role !== "leader") p.isLeader = true;
      }
      await updateDoc(doc(db,"users",u.id), p); Object.assign(u, p);
      if (u.id === state.me.id) Object.assign(state.me, p);
      if (S.kind === "jinjang") { try { await updateDoc(doc(db,"jins",S.jinId), { jinjangUid: u.id }); } catch {} }
      await syncBadges();
      if (S.kind === "leader") {
        const c = state.cells.find(x => x.id === cellId);
        const mine = await requestCellHandovers(c, u.id, []);
        if (mine.length) toast("이 셀 카드 중 내가 맡은 것이 있어요 — 홈에서 넘겨 주세요.");
      }
      await log("자리 앉히기", u.name, SEATNAME[S.kind]);
    } else {
      /* 새 분 · 명부에 있는 분 — 이메일이 있으면 초대, 없으면 이름만 */
      let m = v.startsWith("m:") ? memberById(v.slice(2)) : null;
      const name = (m ? m.name : $("sx-name2").value.trim()) || $("sx-name2").value.trim();
      const email = $("sx-email").value.trim().toLowerCase();
      if (!name) { $("sx-err").textContent = "이름을 적어주세요."; return; }
      if (email && !email.includes("@")) { $("sx-err").textContent = "이메일 형식을 확인해 주세요."; return; }
      if (email && (state.members||[]).some(u => (u.email||"").toLowerCase() === email)) {
        $("sx-err").textContent = "이미 가입한 분이에요. '누구를'에서 '이미 가입한 분'으로 골라 주세요."; return; }
      const e = S.entry;
      if (!m && e && e.t === "inv" && e.inv.memberId) m = memberById(e.inv.memberId);
      if (!m) {
        const d = { name, jinId: S.jinId, cellId: null, uid: "", role: "member", linkedEmail: "", careUid: "",
          soulIds: [], trainingsDone: [], active: true, thumb: "", phone: "", gender: "", birthMD: "", lunar: false,
          position: "", registeredAt: "", baptizedAt: "", createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        const ref = await addDoc(collection(db,"members"), d);
        m = { id: ref.id, ...d }; state.dir.push(m);
      }
      const seat = { role: pick, cellId: cellId || null, cellIds };
      if (email) {
        /* 고친 이메일로 다시 보내면 예전 초대는 지웁니다 */
        if (e && e.t === "inv" && e.email !== email) { try { await deleteDoc(doc(db,"invites",e.email)); } catch {} }
        const r = await sendInvite({ name, email, pick, jinId: S.jinId, cellId: seat.cellId, cellIds, memberId: m.id });
        if (r.err) { $("sx-err").textContent = r.err; return; }
        await updateDoc(doc(db,"members",m.id), { pendingSeat: null }); m.pendingSeat = null;
      } else {
        await updateDoc(doc(db,"members",m.id), { pendingSeat: seat, name, updatedAt: serverTimestamp() });
        Object.assign(m, { pendingSeat: seat, name });
      }
      await log(email ? "자리 초대" : "자리에 이름만", name, SEATNAME[S.kind]);
    }
    dlgSt.close(); await loadOrg(true); renderOrg();
    toast(v.startsWith("u:") ? "앉혔어요." : $("sx-email").value.trim() ? "자리에 넣고 초대했어요." : "이름만 자리에 넣어 뒀어요.");
  } catch (err) { $("sx-err").textContent = msgOf(err); }
  finally { $("sx-save").disabled = false; }
};

/* ── 여러 셀 한꺼번에 ── */
const dlgBk = $("dlg-bulk");
function bulkRows() {
  return $("bk-text").value.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/\t|\s*\/\s*|\s*,\s*/).map(x => x.trim());
    return { cell: parts[0] || "", name: parts[1] || "", email: (parts[2] || "").toLowerCase() };
  }).filter(r => r.cell);
}
function openBulk(jinId) {
  state.bkJin = jinId;
  const j = state.jins.find(x => x.id === jinId) || {};
  $("bk-sub").textContent = `${j.name}에 셀을 여러 개 만들어요. 이미 있는 셀 이름이면 그 셀에 셀리더만 넣어요.`;
  $("bk-text").value = ""; $("bk-err").textContent = ""; renderBulk();
  dlgBk.showModal();
}
function renderBulk() {
  const rows = bulkRows(), jinId = state.bkJin;
  $("bk-preview").innerHTML = rows.map(r => {
    const exists = activeCells().some(c => c.jinId === jinId && c.name === r.cell);
    const bad = r.email && !r.email.includes("@");
    return `<div class="row"><div class="grow"><p class="nm">${esc(r.cell)} ${exists ? `<span class="chip">있는 셀</span>` : `<span class="chip rose">새 셀</span>`}</p>
      <p class="sub">${r.name ? `셀리더 ${esc(r.name)}${r.email ? ` · ${esc(r.email)}` : " · 이메일 없음"}` : "셀리더는 나중에"}${bad ? ` <span style="color:var(--rose-tx)">이메일 확인</span>` : ""}</p></div></div>`;
  }).join("");
  $("bk-save").textContent = rows.length ? `${rows.length}줄 만들기` : "만들기";
}
$("bk-text").oninput = renderBulk;
$("bk-cancel").onclick = () => dlgBk.close();
$("bk-save").onclick = async () => {
  const rows = bulkRows(), jinId = state.bkJin;
  if (!rows.length) { $("bk-err").textContent = "한 줄에 셀 하나씩 적어 주세요."; return; }
  if (rows.some(r => r.email && !r.email.includes("@"))) { $("bk-err").textContent = "이메일 형식을 확인해 주세요."; return; }
  $("bk-save").disabled = true; $("bk-err").textContent = "";
  let nCell = 0, nInv = 0, nName = 0; const errs = [];
  try {
    for (const r of rows) {
      let c = activeCells().find(x => x.jinId === jinId && x.name === r.cell);
      if (!c) {
        const data = { name: r.cell, jinId, active: true, createdAt: serverTimestamp() };
        const ref = await addDoc(collection(db,"cells"), data); c = { id: ref.id, ...data }; state.cells.push(c); nCell++;
      }
      if (!r.name) continue;
      if (seatList("leader", jinId, c.id).length) { errs.push(`${r.cell}: 이미 셀리더가 있어 건너뜀`); continue; }
      if (r.email && (state.members||[]).some(u => (u.email||"").toLowerCase() === r.email)) {
        errs.push(`${r.cell}: ${r.email}은 이미 가입한 분 — 자리를 눌러 '이미 가입한 분'으로 앉혀 주세요`); continue; }
      const d = { name: r.name, jinId, cellId: null, uid: "", role: "member", linkedEmail: "", careUid: "",
        soulIds: [], trainingsDone: [], active: true, thumb: "", phone: "", gender: "", birthMD: "", lunar: false,
        position: "", registeredAt: "", baptizedAt: "", createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        pendingSeat: r.email ? null : { role: "leader", cellId: c.id, cellIds: [] } };
      const ref = await addDoc(collection(db,"members"), d); const m = { id: ref.id, ...d }; state.dir.push(m);
      if (r.email) {
        const res = await sendInvite({ name: r.name, email: r.email, pick: "leader", jinId, cellId: c.id, memberId: m.id });
        if (res.err) errs.push(`${r.cell}: ${res.err}`); else nInv++;
      } else nName++;
    }
    await log("여러 셀 만들기", (state.jins.find(x => x.id === jinId)||{}).name || "", `셀 ${nCell} · 초대 ${nInv} · 이름만 ${nName}`);
    dlgBk.close(); await loadOrg(true); renderOrg();
    toast(`새 셀 ${nCell}개 · 초대 ${nInv}명 · 이름만 ${nName}명${errs.length ? ` · 건너뜀 ${errs.length}` : ""}`);
    if (errs.length) setTimeout(() => alert(errs.join("\n")), 300);
  } catch (e) { $("bk-err").textContent = msgOf(e); }
  finally { $("bk-save").disabled = false; }
};

/* ════════════════════════════════════════════════════════════
   20단계 — 돌봄 (결석 · 1:1 · 민감 메모 · 셀 건강 · 셀 보고 · 일정 알림)
   ════════════════════════════════════════════════════════════ */
/* 결석 사유 — 출석 체크에서 고릅니다.
   근무·출장 · 여행처럼 미리 알고 있는 결석은 '챙길 사람'에 세지 않아요. */
const REASON = { sick:"아파서", family:"집안 일", work:"근무·출장", trip:"여행", unknown:"모름" };
const REASON_OK = ["work","trip"];
const CARE_AT = 2;      // 이만큼 연달아 빠지면 '결석 — 연락할 때'에 뜹니다
const ONE_DUE = 30;     // 1:1 만난 지 이만큼 지나면 '챙길 사람'에
const STEPS = [["sms","문자"],["call","전화"],["meet","만남"]];
const STEPNAME = { sms:"문자", call:"전화", meet:"만남" };

/* 연달아 빠진 횟수 — 출석하면 끊기고, 미리 알린 결석은 건너뜁니다.
   ep 는 이번 결석이 시작된 모임 날짜예요. 다시 나왔다가 또 빠지면 ep 가 바뀌어
   지난번 연락 기록과 섞이지 않습니다(= 출석하면 저절로 끝). */
function careStreak(key, cellId) {
  let n = 0, ep = null; const why = [];
  for (const m of cellMeetings(cellId)) {
    if (daysUntil(m.date) > 0) continue;              // 앞으로 할 모임은 빼고
    const v = m.attendance && m.attendance[key];
    if (!v) continue;
    if (v !== "absent") break;
    const k = (m.reasonKinds || {})[key] || "";
    if (REASON_OK.includes(k)) continue;
    n++; ep = m.date; why.push(k || "unknown");
  }
  return { n, ep, why };
}
function whyText(why) {
  const ks = [...new Set(why || [])].filter(k => k && k !== "unknown");
  return ks.length ? ks.map(k => REASON[k] || k).join(" · ") : "사유 모름";
}
/* 담당 리더 화면에 띄울지 — 연락하거나 미루면 일주일 쉬었다가, 그래도 안 나오면 다음 단계로 */
function careDue(s) {
  if (!isLeaderOf(s)) return null;
  const st = careStreak(attKey(s), attCell(s));
  if (st.n < CARE_AT) return null;
  const care = (s.care && s.care.ep === st.ep) ? s.care : { ep: st.ep, log: [], snooze: "" };
  if (care.snooze && care.snooze > todayStr()) return null;
  return { s, n: st.n, why: st.why, care, step: Math.min((care.log || []).length, STEPS.length - 1) };
}
async function markCare(soulId, how) {
  const s = state.souls.find(x => x.id === soulId); if (!s) return;
  const d = careDue(s); if (!d) return;
  const log = [...(d.care.log || [])];
  if (how !== "later") log.push({ step: how, at: todayStr() });
  const care = { ep: d.care.ep, log: log.slice(-10), snooze: plusDays(7) };
  await updateDoc(doc(db, "souls", soulId), { care });
  s.care = care;
  if (how !== "later") bump("careContact");
}

/* ── 1:1 만난 지 얼마나 ── 내가 직접 함께한 1:1만 셉니다(예정 · 나 없이 들은 것 빼고) */
function lastOneAt(s) {
  let d = s.lastOneAt || "";
  (state.allRecords || []).forEach(r => {
    if (r.soulId === s.id && r.type === "meet" && r.kind === "one" && !r.planned && !r.away
        && String(r.date || "") > d && daysUntil(r.date) <= 0) d = r.date;
  });
  (state.soul && state.soul.id === s.id ? state.records : []).forEach(r => {
    if (r.type === "meet" && r.kind === "one" && !r.planned && !r.away
        && String(r.date || "") > d && daysUntil(r.date) <= 0) d = r.date;
  });
  return d || null;
}
function oneDays(s) { const d = lastOneAt(s); return d ? daysSince(d) : null; }
function oneText(s) {
  const n = oneDays(s);
  return n === null ? "1:1 기록 없음" : n === 0 ? "오늘 1:1" : `1:1 만난 지 ${n}일`;
}

/* ════════ 셀 건강 · 인턴 ════════
   셀교회에서 쓰는 지표 몇 가지만 — 모임을 꾸준히 했는지, 얼마나 나오는지,
   새 사람이 오는지, 다음 셀리더(인턴)가 자라고 있는지. 인턴은 셀리더가 직접 체크합니다. */
function ownCells() {
  const ids = new Set([state.me.cellId, ...state.souls.filter(s => isLeaderOf(s) && !isLeaderCard(s)).map(s => s.cellId)]
    .filter(Boolean));
  state.meetings.filter(m => m.leaderUid === uid()).forEach(m => ids.add(m.cellId));
  return state.cells.filter(c => ids.has(c.id));
}
function cellHealth(cellId) {
  const ms = cellMeetings(cellId).filter(m => { const n = daysSince(m.date); return n !== null && n >= 0 && n < 56; });
  const people = state.souls.filter(s => s.cellId === cellId && !isLeaderCard(s));
  const came = ms.map(m => Object.values(m.attendance || {}).filter(v => v && v !== "absent").length);
  const marked = ms.map(m => Object.values(m.attendance || {}).filter(Boolean).length);
  const avg = came.length ? Math.round(came.reduce((a, b) => a + b, 0) / came.length * 10) / 10 : null;
  const rate = marked.reduce((a, b) => a + b, 0) ? Math.round(came.reduce((a, b) => a + b, 0) / marked.reduce((a, b) => a + b, 0) * 100) : null;
  const visitors = ms.reduce((n, m) => n + String(m.visitors || "").split(/[,，·、\n]/).map(x => x.trim()).filter(Boolean).length, 0);
  const interns = people.filter(s => s.intern);
  const care = people.filter(s => careStreak(attKey(s), attCell(s)).n >= CARE_AT).length;
  const notes = [];
  if (ms.length < 4) notes.push(["warn", "모임이 뜸해요"]);
  if (interns.length && avg !== null && avg >= 10) notes.push(["ok", "분가를 준비해 볼 때"]);
  else if (!interns.length && avg !== null && avg >= 8) notes.push(["warn", "인턴을 세울 때"]);
  if (rate !== null && rate >= 75 && ms.length >= 6) notes.push(["ok", "꾸준해요"]);
  if (care) notes.push(["warn", `연달아 결석 ${care}명`]);
  return { ms: ms.length, avg, rate, visitors, people, interns, care, notes };
}
async function openHealth() {
  if (!canLead() && !["coach", "jinjang", "pastor"].includes(state.me.role)) { toast("셀을 맡은 분과 코치 · 진장 · 담당 교역자가 볼 수 있어요."); return; }
  await Promise.all([loadSouls(), loadMeetings()]);
  renderHealth(); $("hl-err").textContent = ""; markSide("health"); show("s-health");
}
function renderHealth() {
  state.hlSort = state.hlSort || "seq";
  document.querySelectorAll("#hl-sort [data-hs]").forEach(b => b.classList.toggle("on", b.dataset.hs === state.hlSort));
  const own = new Set(ownCells().map(c => c.id));
  const cells = canLead() && !["coach", "jinjang", "pastor"].includes(state.me.role) ? ownCells() : seenCells();
  $("hl-body").innerHTML = cells.map(c => healthCard(c, cellHealth(c.id), own.has(c.id))).join("")
    || `<p class="muted">볼 수 있는 셀이 없어요.</p>`;
}
/* 28단계 — 셀 하나 = 카드 하나: [고리 + 숫자 4칸] [8주 출석 막대] / 사람별 출석 / 인턴 */
function healthCard(c, h, mine) {
  const ms = cellMeetings(c.id).filter(m => { const n = daysSince(m.date); return n !== null && n >= 0 && n < 56; })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const R = 34, C = 2 * Math.PI * R, rate = h.rate;
  const col = rate == null ? "var(--faint)" : rate >= 75 ? "var(--ok-strong)" : rate >= 50 ? "var(--warn-tx)" : "var(--brand)";
  const ring = `<svg viewBox="0 0 84 84" width="104" height="104" style="flex-shrink:0" aria-label="출석률 ${rate == null ? "기록 없음" : rate + "%"}">
      <circle cx="42" cy="42" r="${R}" fill="none" style="stroke:var(--track)" stroke-width="9"/>
      ${rate == null ? "" : `<circle cx="42" cy="42" r="${R}" fill="none" style="stroke:${col}" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${C * rate / 100} ${C}" transform="rotate(-90 42 42)"/>`}
      <text x="42" y="45" text-anchor="middle" style="fill:var(--text);font-size:18px;font-weight:600">${rate == null ? "—" : rate + "%"}</text>
      <text x="42" y="59" text-anchor="middle" style="fill:var(--dim);font-size:8.5px">출석률</text></svg>`;
  const cnt = (m) => { const v = Object.values(m.attendance || {}); return { ok: v.filter(x => x && x !== "absent").length, all: v.filter(Boolean).length }; };
  const max = Math.max(1, ...ms.map(m => cnt(m).all));
  const md = (d) => { const p = String(d).split("-"); return `${Number(p[1])}/${Number(p[2])}`; };
  const chart = ms.length ? `<div class="vbars" style="height:130px">${ms.map(m => { const k = cnt(m);
      return `<div class="vb${k.all && k.ok / k.all < .5 ? " low" : ""}" title="${esc(fmtDate(m.date, true))} 출석 ${k.ok}/${k.all}">
        <i class="all" style="height:${k.all / max * 100}%"></i><i class="ok" style="height:${k.ok / max * 100}%"></i></div>`; }).join("")}</div>
      <div class="vlabels">${ms.map(m => `<span>${md(m.date)} · ${cnt(m).ok}명</span>`).join("")}</div>`
    : `<p class="muted" style="font-size:12px;padding:46px 0;text-align:center">최근 8주 셀모임 기록이 없어요</p>`;
  const ppl = h.people.map(s => {
    const k = attKey(s), cells = ms.map(m => (m.attendance || {})[k] || "");
    const okn = cells.filter(v => v && v !== "absent").length, rec = cells.filter(Boolean).length;
    const r = rec ? Math.round(okn / rec * 100) : null, tone = r == null ? "" : r >= 75 ? "good" : r >= 50 ? "mid" : "low";
    return { s, cells, r, tone };
  });
  if (state.hlSort === "low") ppl.sort((a, b) => (a.r == null ? 101 : a.r) - (b.r == null ? 101 : b.r));   // 빠지는 사람이 위로
  const canTick = mine && h.people.some(isLeaderOf);
  return `<div class="hc">
    <div class="hc-h"><span class="cbadge">${esc(c.name)}</span>
      <span class="who">${esc(cellLeadName(c) ? cellLeadName(c) + " 셀리더" : leaderLabel(c.id))}</span>
      <span class="notes">${h.notes.map(([k, t]) => `<span class="chip ${k}">${esc(t)}</span>`).join("") || `<span class="chip">기록이 더 쌓이면 보여요</span>`}</span></div>
    <div class="hc-top">
      <div class="hc-sum">${ring}
        <div class="hc-kpi">
          <div><p>8주 셀모임</p><b>${h.ms}회</b></div>
          <div><p>평균 출석</p><b>${h.avg === null ? "—" : h.avg + "명"}</b></div>
          <div><p>새 방문자</p><b>${h.visitors}명</b></div>
          <div><p>연달아 결석</p><b style="color:${h.care ? "var(--warn-tx)" : "inherit"}">${h.care}명</b></div>
        </div></div>
      <div class="hc-chart"><p class="t"><b>8주 출석</b><span>초록 = 온 사람 · 회색 = 체크한 인원</span></p>${chart}</div>
    </div>
    ${ppl.length && ms.length ? `<p class="hc-sec">사람별 출석 <span>최근 8주 · ${state.hlSort === "low" ? "자주 빠지는 사람이 위에" : "셀리더가 정한 순서"}</span></p>
      <div class="hppl">${ppl.map(p => `<div class="hp ${p.tone}">
        <span class="nm" title="${esc(p.s.name)}">${esc(p.s.name)}</span>
        <span class="dd">${p.cells.map((v, i) => `<i class="${v || "nr"}" title="${esc(md(ms[i].date))} ${v ? ATT[v] : "기록 없음"}"></i>`).join("")}</span>
        <span class="rt"><b>${p.r == null ? "—" : p.r + "%"}</b><span class="at-bar"><i style="width:${p.r || 0}%"></i></span></span></div>`).join("")}</div>
      <p class="hlegend"><span><i style="background:var(--ok-strong)"></i>출석</span><span><i style="background:#7FA8E8"></i>온라인</span><span><i style="background:var(--brand)"></i>결석</span><span><i style="box-shadow:inset 0 0 0 1.5px var(--line3)"></i>기록 없음</span></p>` : ""}
    <p class="hc-sec">인턴 (예비 셀리더) ${h.interns.length}명 <span>${canTick ? "눌러서 세우거나 빼요 · 순서는 '순서 · 인턴'에서" : ""}</span></p>
    ${canTick ? `<div class="hints">${h.people.filter(isLeaderOf).map(s => `
        <label class="${s.intern ? "on" : ""}"><input type="checkbox" data-intern="${s.id}" ${s.intern ? "checked" : ""}>${esc(s.name)}${s.intern && s.internSince ? `<span class="muted" style="font-size:11px">${fmtDate(s.internSince)}~</span>` : ""}</label>`).join("")}</div>`
      : `<p style="font-size:14px">${h.interns.map(s => esc(s.name)).join(", ") || "아직 없어요"}</p>`}
  </div>`;
}
$("hl-body").addEventListener("change", async (ev) => {
  const cb = ev.target.closest("[data-intern]"); if (!cb) return;
  const s = state.souls.find(x => x.id === cb.dataset.intern); if (!s || !isLeaderOf(s)) return;
  const patch = cb.checked ? { intern: true, internSince: s.internSince || todayStr() } : { intern: false, internSince: "" };
  cb.disabled = true;
  try { await updateDoc(doc(db, "souls", s.id), patch); Object.assign(s, patch);
        syncRankToDir([s]).catch(() => {});
        toast(cb.checked ? `${s.name} 님을 인턴으로 세웠어요.` : "인턴 표시를 뺐어요."); renderHealth(); renderRooms(); }
  catch (e) { cb.checked = !cb.checked; $("hl-err").textContent = msgOf(e); }
  finally { cb.disabled = false; }
});
$("hl-close").onclick = () => openHome();

/* ════════ 민감 메모 ════════
   기록과 따로 둡니다(souls/{id}/alerts). 검색 · 캘린더 · 통계 어디에도 섞이지 않고,
   카드 맨 위에 빨간 표시로만 보이며 눌러야 펼쳐져요. 누가 볼지는 기록과 같은 세 단계.
   본인 차단은 규칙에서 — 카드 주인공은 어떤 단계로도 못 봅니다. */
async function loadAlerts(soulId, canSeeAll) {
  if (state.me.role === "pastor") { state.alerts = []; return; }   // 민감 메모는 교역자에게 안 열려요
  const col = collection(db, "souls", soulId, "alerts");
  try {
    const parts = canSeeAll
      ? await Promise.all([getDocs(query(col, where("by", "==", uid()))),
          getDocs(query(col, where("scope", "==", "leader"))), getDocs(query(col, where("scope", "==", "coach")))])
      : [await getDocs(query(col, where("scope", "==", "coach")))];
    const seen = {};
    state.alerts = parts.flatMap(pack).filter(r => seen[r.id] ? false : (seen[r.id] = true))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  } catch { state.alerts = []; }
}
function alertBlock(s) {
  const mine = isLeaderOf(s), list = state.alerts || [];
  if (!list.length) return mine ? `<button class="btn-sm" data-alnew="1" style="margin-bottom:12px">민감 메모 추가</button>` : "";
  const open = state.alertOpen === s.id;
  return `<div class="alertc">
    <button class="hd" data-altgl="1" aria-expanded="${open}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9.2v4m0 2.9h.01"/><path d="M10.4 4.3 3 17.2A1.8 1.8 0 0 0 4.6 20h14.8a1.8 1.8 0 0 0 1.6-2.8L13.6 4.3a1.8 1.8 0 0 0-3.2 0Z"/></svg>
      <span style="flex:1">민감 메모 ${list.length}개 — ${open ? "접기" : "눌러서 보기"}</span></button>
    ${open ? list.map(a => `<div class="it">
      <p>${esc(a.body)}</p>
      <div style="display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${scopeChip(a.scope)}<span class="muted" style="font-size:12px">${esc(a.byName || "")} · ${fmtDate(a.date)}</span>
        ${a.by === uid() ? `<button class="btn-sm" data-aledit="${a.id}" style="margin-left:auto;height:32px">고치기</button>` : ""}
      </div></div>`).join("") + (mine ? `<button class="btn-sm" data-alnew="1" style="margin-top:10px">하나 더</button>` : "") : ""}
  </div>`;
}
function openAlertDlg(id) {
  const a = id ? (state.alerts || []).find(x => x.id === id) : null;
  state.alertEdit = a ? a.id : null;
  $("al-text").value = a ? a.body : ""; $("al-scope").value = a ? a.scope : "private";
  $("al-del").hidden = !a; $("al-err").textContent = "";
  $("dlg-alert").showModal();
}
$("al-cancel").onclick = () => $("dlg-alert").close();
$("al-save").onclick = async () => {
  const body = $("al-text").value.trim(), scope = $("al-scope").value, s = state.soul;
  if (!body) { $("al-err").textContent = "내용을 적어주세요."; return; }
  $("al-save").disabled = true;
  try {
    if (state.alertEdit) await updateDoc(doc(db, "souls", s.id, "alerts", state.alertEdit), { body, scope });
    else await addDoc(collection(db, "souls", s.id, "alerts"),
      { body, scope, date: todayStr(), by: uid(), byName: state.me.name || "", createdAt: serverTimestamp() });
    await loadAlerts(s.id, isLeaderOf(s)); state.alertOpen = s.id;
    $("dlg-alert").close(); toast("민감 메모를 저장했어요."); renderSoulBody();
  } catch (e) { $("al-err").textContent = msgOf(e); }
  finally { $("al-save").disabled = false; }
};
$("al-del").onclick = async () => {
  if (!state.alertEdit || !confirm("이 민감 메모를 지울까요?")) return;
  try { await deleteDoc(doc(db, "souls", state.soul.id, "alerts", state.alertEdit));
        await loadAlerts(state.soul.id, isLeaderOf(state.soul));
        $("dlg-alert").close(); toast("지웠어요."); renderSoulBody(); }
  catch (e) { $("al-err").textContent = msgOf(e); }
};
$("soul-body").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-altgl]")) { state.alertOpen = state.alertOpen === state.soul.id ? null : state.soul.id; renderSoulBody(); return; }
  if (ev.target.closest("[data-alnew]")) { openAlertDlg(null); return; }
  const e = ev.target.closest("[data-aledit]"); if (e) openAlertDlg(e.dataset.aledit);
});

/* ════════ 셀 보고 · 코치 확인 ════════
   셀리더가 '보고하기'를 누르면 담당 코치 · 진장에게 소식이 가고,
   코치 · 진장은 '확인했어요'와 한 줄 격려를 남깁니다(셀리더에게 소식).
   확인 칸(check)은 코치 · 진장만 쓸 수 있고, 셀리더는 못 고칩니다(규칙). */
function overseers(cellId, jinId) {
  return (state.members || []).filter(u => u.active !== false && u.id !== uid() && u.jinId === jinId
    && (u.role === "jinjang" || (u.role === "coach" && (u.cellIds || []).includes(cellId))));
}
async function sendNotices(toList, payload) {
  for (const to of toList) {
    try { await addDoc(collection(db, "notices"), { to, from: uid(), fromName: state.me.name || "",
      ...payload, atMs: Date.now(), at: serverTimestamp(), read: false }); } catch {}
  }
}
function renderReportBox() {
  const box = $("m-report"), m = state.meeting && state.meeting.id ? state.meetings.find(x => x.id === state.meeting.id) : null;
  if (!m) { box.hidden = true; return; }
  const mine = m.leaderUid === uid(), ck = m.check;
  const seer = !mine && ["coach", "jinjang"].includes(state.me.role);
  const ckLine = ck ? `<p style="font-size:14px;margin-top:8px"><b>${esc(ck.name || "")}</b> 님이 ${fmtDate(ck.at)}에 확인했어요${
    ck.note ? `<br><span style="color:var(--body-tx)">“${esc(ck.note)}”</span>` : ""}</p>` : "";
  let html = `<p style="font-size:13px;font-weight:600">셀 보고</p>`;
  if (mine) {
    html += m.reportedAt
      ? `<p class="muted" style="font-size:13px;margin-top:6px">${fmtDate(m.reportedAt)}에 보고했어요.${ck ? "" : " 코치 · 진장 확인을 기다리는 중이에요."}</p>${ckLine}`
      : `<p class="muted" style="font-size:13px;margin-top:6px">출석과 나눔을 다 적었으면 코치 · 진장에게 알려요.</p>
         <button class="btn-sm" id="btn-m-report" style="margin-top:10px">코치에게 보고하기</button>`;
  } else if (seer) {
    html += `<p class="muted" style="font-size:13px;margin-top:6px">${m.reportedAt ? `${fmtDate(m.reportedAt)}에 보고됨` : "아직 보고 전이에요 (기록은 볼 수 있어요)"}</p>${ckLine}`
      + (ck && ck.by !== uid() ? "" : `
        <input id="m-ck-note" maxlength="200" placeholder="셀리더에게 한 줄 (선택) — 예) 수고했어요, 민지 같이 기도할게요"
          value="${esc(ck && ck.by === uid() ? ck.note || "" : "")}" style="height:44px;margin-top:10px">
        <button class="btn-sm" id="btn-m-check" style="margin-top:8px">${ck ? "다시 남기기" : "확인했어요"}</button>`);
  } else html += m.reportedAt ? `<p class="muted" style="font-size:13px;margin-top:6px">${fmtDate(m.reportedAt)}에 보고됨</p>${ckLine}` : "";
  box.innerHTML = html; box.hidden = false;
  const rb = $("btn-m-report");
  if (rb) rb.onclick = async () => {
    rb.disabled = true;
    try {
      await updateDoc(doc(db, "meetings", m.id), { reportedAt: todayStr() });
      m.reportedAt = todayStr();
      const cn = (state.cells.find(c => c.id === m.cellId) || {}).name || "셀";
      await sendNotices(overseers(m.cellId, m.jinId).map(u => u.id), { kind: "report",
        target: { kind: "meeting", id: m.id, report: true }, title: `${cn} ${fmtDate(m.date)} 셀 보고`,
        snippet: `출석 ${Object.values(m.attendance || {}).filter(v => v && v !== "absent").length}명${m.topic ? " · " + m.topic : ""}` });
      toast("보고했어요. 코치 · 진장에게 소식이 갔어요."); bump("meetingReport"); renderReportBox();
    } catch (e) { toast(msgOf(e)); rb.disabled = false; }
  };
  const cb = $("btn-m-check");
  if (cb) cb.onclick = async () => {
    cb.disabled = true;
    const check = { by: uid(), name: state.me.name || "", at: todayStr(), note: $("m-ck-note").value.trim().slice(0, 200) };
    try {
      await updateDoc(doc(db, "meetings", m.id), { check });
      m.check = check;
      const cn = (state.cells.find(c => c.id === m.cellId) || {}).name || "셀";
      await sendNotices([m.leaderUid], { kind: "report", target: { kind: "meeting", id: m.id, report: true },
        title: `${cn} ${fmtDate(m.date)} 셀 보고 확인`, snippet: check.note || "확인했어요" });
      toast("확인을 남겼어요."); renderReportBox();
    } catch (e) { toast(msgOf(e)); cb.disabled = false; }
  };
}

/* ════════ 일정 미리 알림 ════════
   무료 요금제에는 서버가 없어서, 앱을 완전히 닫으면 앱이 직접 울릴 수 없어요. 그래서 두 갈래로 합니다.
   ① 폰 캘린더에 알림째 넣기(.ics) — 폰이 대신 울려줍니다. 앱을 닫아도 울려요.
   ② 앱이 켜져 있거나 뒤에 떠 있으면 1시간 전에 앱이 직접 알려요. */
function icsBuild(evs) {
  const esc2 = (s) => String(s || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//목자의 삶//KO", "CALSCALE:GREGORIAN", "X-WR-CALNAME:목자의 삶"];
  evs.forEach((e, i) => {
    const d = e.date.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:mokja-${e.id || i}-${d}@mokyang-note`, `DTSTAMP:${todayStr().replace(/-/g, "")}T000000Z`);
    if (e.time) {
      const [hh, mm] = e.time.split(":").map(Number);
      lines.push(`DTSTART:${d}T${pad2(hh)}${pad2(mm)}00`, `DTEND:${endStamp(e)}`);
    } else {
      const nx = new Date(e.date + "T00:00:00"); nx.setDate(nx.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${ymd(nx).replace(/-/g, "")}`);
    }
    lines.push(`SUMMARY:${esc2(e.title)}`);
    if (e.sub) lines.push(`DESCRIPTION:${esc2(e.sub)}`);
    if (e.place) lines.push(`LOCATION:${esc2(e.place)}`);
    (ALARM[e.kind] || ["-PT1H"]).forEach(t => lines.push("BEGIN:VALARM", "ACTION:DISPLAY",
      `TRIGGER:${t}`, `DESCRIPTION:${esc2(e.title)}`, "END:VALARM"));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function icsOne(e) {
  download(`목자의삶_${e.date}_${String(e.title).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 24)}.ics`, icsBuild([e]), "text/calendar");
  toast("파일을 열면 폰 캘린더에 알림째 들어가요.");
}
$("btn-ics-meeting").onclick = () => {
  const cellId = $("m-cell").value || state.meeting.cellId;
  const c = state.cells.find(x => x.id === cellId);
  icsOne({ kind: "meeting", id: state.meeting.id || "new", date: $("m-date").value || todayStr(),
    time: $("m-time").value || "", timeEnd: $("m-time-end").value || "",
    title: `${c ? c.name : "셀"} 셀모임`, sub: $("m-topic").value.trim(), place: $("m-place").value.trim() });
};
/* 앱이 켜져 있는 동안 — 앞으로 하루 안의 일정을 1시간 전에 */
function upcomingPlans() {
  const out = [];
  state.meetings.forEach(m => {
    if (!m.time) return; const c = state.cells.find(x => x.id === m.cellId);
    out.push({ key: "m" + m.id, at: new Date(`${m.date}T${m.time}:00`), title: `${c ? c.name : "셀"} 셀모임`, place: m.place || "" });
  });
  oneLinePerGroup((state.allRecords || []).filter(r => r.planned && r.type === "meet" && r.time)).forEach(r => {
    out.push({ key: "r" + (r.groupId || r.id), at: new Date(`${r.date}T${r.time}:00`), title: planLine(r), place: r.place || "" });
  });
  return out.filter(e => !isNaN(e.at));
}
function planAlarms() {
  (state.alarmT || []).forEach(clearTimeout); state.alarmT = [];
  if (notifyPrefs().plan === false) return;
  const now = Date.now();
  upcomingPlans().forEach(e => {
    const fire = e.at.getTime() - 60 * 60 * 1000, wait = fire - now;
    if (wait < -10 * 60 * 1000 || wait > 24 * 60 * 60 * 1000) return;   // 지났거나 하루보다 멀면
    state.alarmT.push(setTimeout(() => remindPlan(e), Math.max(wait, 0)));
  });
}
function remindPlan(e) {
  const seen = (() => { try { return JSON.parse(localStorage.getItem("mokja-reminded") || "{}"); } catch { return {}; } })();
  const id = e.key + "@" + e.at.getTime(); if (seen[id]) return;
  seen[id] = 1; try { localStorage.setItem("mokja-reminded", JSON.stringify(seen)); } catch {}
  const title = `1시간 뒤 — ${e.title}`, body = `${fmtTime(`${pad2(e.at.getHours())}:${pad2(e.at.getMinutes())}`)}${e.place ? " · " + e.place : ""}`;
  toast(`${title} · ${body}`);
  if (notifyPrefs().device && "Notification" in window && Notification.permission === "granted") {
    (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null))
      .then(reg => reg ? reg.showNotification(title, { body, tag: "mokja-plan-" + e.key, icon: "./icons/icon-192.png" })
                       : new Notification(title, { body }))
      .catch(() => {});
  }
}

/* ════════════════════════════════════════════════════════════
   21단계 — 개인정보 동의 · 공유 설정 · 담당 교역자 · 기관 소유자
   ════════════════════════════════════════════════════════════ */

/* ── 개인정보 동의 ──
   앱을 처음 쓸 때 한 번. 약관을 고치면 CONSENT_V 를 올려 다시 받습니다.
   동의하지 않으면 앱을 쓸 수 없지만, 그동안 적은 것은 지우지 않아요(메모장이라). */
const CONSENT_V = 1;
const CONSENT_HTML = `
  <p><b>무엇을 적나요</b><br>셀 식구의 이름 · 연락처 · 생일 · 가족 · 사진, 기도제목, 만남과 셀모임 기록, 훈련 이력.
    리더인 나에 대해서도 이름 · 연락처 · 사용한 기기 종류와 시간대를 남겨요(접속 위치는 모으지 않아요).</p>
  <p style="margin-top:10px"><b>왜 적나요</b><br>셀 식구를 기억하고 기도하며 돌보기 위해서만 써요. 다른 목적으로 쓰거나 밖으로 내보내지 않아요.</p>
  <p style="margin-top:10px"><b>누가 보나요</b><br>카드를 맡은 리더가 보고, 내가 고른 만큼만 코치 · 진장 · 담당 교역자에게 보여요('공유 설정').
    카드의 주인공 본인은 어떤 경우에도 자기 카드를 볼 수 없어요. 수퍼 관리자 · 소유자도 남의 카드는 못 봐요.</p>
  <p style="margin-top:10px"><b>얼마나 두나요</b><br>교회 공동체 안에서 쓰는 동안 보관해요. 지워 달라고 하면 담당 리더나 관리자가 정리해요.</p>
  <p style="margin-top:10px"><b>지켜 주세요</b><br>여기서 알게 된 이야기는 그 사람을 돌보는 일에만 쓰고, 다른 사람에게 옮기지 않아요.</p>`;
function openConsent() {
  $("consent-text").innerHTML = CONSENT_HTML;
  $("cs-1").checked = false; $("cs-2").checked = false; $("consent-err").textContent = "";
  show("s-consent");
}
$("btn-consent").onclick = async () => {
  if (!$("cs-1").checked || !$("cs-2").checked) { $("consent-err").textContent = "두 가지 모두 체크해 주세요."; return; }
  $("btn-consent").disabled = true;
  try {
    const consent = { v: CONSENT_V, at: todayStr() };
    await updateDoc(doc(db, "users", state.me.id), { consent });
    state.me.consent = consent;
    await openHome();
  } catch (e) { $("consent-err").textContent = msgOf(e); }
  finally { $("btn-consent").disabled = false; }
};
$("btn-consent-no").onclick = async () => {
  toast("동의하지 않으면 앱을 쓸 수 없어요. 적어 둔 내용은 그대로 있어요.");
  await signOut(auth);
};

/* ── 공유 설정 ──
   한 번 정해 두면 새 카드 · 새 기록 · 셀모임에 그대로 쓰입니다. 카드마다 따로 바꿀 수도 있어요.
   - 셀을 맡은 분: 새 기록의 기본 공개 범위, 셀모임을 교역자에게, 내 영혼 카드를 교역자에게
   - 진장: 셀리더 카드를 담당 코치에게(기본은 진장만), 셀리더 · 코치 카드를 교역자에게 */
const sharePrefs = () => ({ recScope: "leader", meetPastor: true, meetPeers: true, soulPastor: false,
  leaderCoach: false, leaderPastor: false, ...((state.me && state.me.sharePrefs) || {}) });
function shareDefaults(kind) {
  const P = sharePrefs();
  if (kind === "leader") return { coachShare: !!P.leaderCoach, pastorShare: !!P.leaderPastor };
  if (kind === "coach") return { coachShare: false, pastorShare: !!P.leaderPastor };
  return { pastorShare: !!P.soulPastor };
}
/* 기록 읽기 — 규칙이 허락하는 갈래마다 따로 묻습니다(조건 없이 한 번에 읽으면 서버가 거절) */
function recQueries(col, holder) {
  const r = state.me.role;
  if (holder) return ["by", "leader", "coach", "pastor"].map(k =>
    getDocs(k === "by" ? query(col, where("by", "==", uid())) : query(col, where("scope", "==", k))));
  if (r === "pastor") return [getDocs(query(col, where("scope", "==", "pastor")))];
  return [getDocs(query(col, where("scope", "==", "coach"))), getDocs(query(col, where("scope", "==", "pastor")))];
}
function openShare() {
  const P = sharePrefs(), me = state.me, lead = canLead(), jj = me.role === "jinjang";
  const sel = (id, v) => `<select id="${id}">${[["leader","담당 리더 — 나와 다음 담당자"],["coach","코치 공유 — 코치 · 진장도 봄"],
    ["pastor","교역자까지 — 코치 · 진장 · 담당 교역자"],["private","나만 보기"]].map(([k,l]) =>
    `<option value="${k}"${v===k?" selected":""}>${l}</option>`).join("")}</select>`;
  const ck = (id, on, label) => `<label class="check"><input type="checkbox" id="${id}"${on?" checked":""}> ${label}</label>`;
  let html = "";
  if (lead) html += `<div class="card shr-sec">
      <h3>내가 쓰는 기록 · 셀모임</h3>
      <div class="field" style="margin-top:10px"><label for="sh-rec">새 기록의 기본 공개 범위</label>${sel("sh-rec", P.recScope)}
        <p class="hint">기록할 때마다 바꿀 수 있어요. 받은 마음은 늘 '나만 보기'로 시작해요.</p></div>
      ${ck("sh-peers", P.meetPeers !== false, "셀모임 나눔(사람별 근황 · 기도제목)을 같은 진 셀리더 · 코치 · 진장에게 보이기")}
      <p class="hint" style="margin-top:4px">출석 · 주제는 늘 같은 진에 보여요. 나눔 속 그 사람 본인에게는 어떤 경우에도 안 보여요.</p>
      ${ck("sh-photos", P.meetPhotos !== false, "셀모임 사진을 같은 진 셀리더 · 코치 · 진장에게 보이기")}
      ${ck("sh-cal", P.calPeers !== false, "내 캘린더의 만남 일정을 같은 진에 보이기 (날짜 · 시간 · 종류만 — 누구와 · 내용은 안 보여요)")}
      ${ck("sh-meet", P.meetPastor, "셀모임(출석 · 나눔 · 보고)을 담당 교역자에게 보이기")}
      ${ck("sh-soul", P.soulPastor, "내 영혼 카드(기본 사항 · 출석)를 담당 교역자에게 보이기")}
      <p class="hint" style="margin-top:6px">카드를 보여도 기록은 '교역자까지'로 적은 것만 보여요.</p>
      <button class="btn-sm" id="sh-open-old" style="margin-top:10px">지금까지 '코치 공유'로 적은 기록도 교역자까지 열기</button>
    </div>`;
  if (jj) html += `<div class="card shr-sec">
      <h3>셀리더 · 코치 목양 카드 (진장이 맡은 카드)</h3>
      ${ck("sh-lcoach", P.leaderCoach, "셀리더 카드를 그 셀 담당 코치에게 보이기")}
      <p class="hint" style="margin-top:6px">기본은 진장만 봐요. 켜면 그 셀을 돌보는 코치가 카드와 '코치 공유' 기록을 봐요.</p>
      ${ck("sh-lpastor", P.leaderPastor, "셀리더 · 코치 카드를 담당 교역자에게 보이기")}
    </div>`;
  if (!html) html = `<div class="card"><p class="muted">지금 역할에서는 따로 정할 공유가 없어요.</p></div>`;
  $("share-body").innerHTML = html; $("share-err").textContent = "";
  $("btn-share-save").hidden = !(lead || jj);
  const old = $("sh-open-old");
  if (old) old.onclick = openOldToPastor;
  show("s-share");
}
async function openOldToPastor() {
  await loadSouls(); await loadAllRecords(true);
  const rows = (state.allRecords || []).filter(r => r.by === uid() && r.scope === "coach");
  if (!rows.length) { toast("'코치 공유'로 적은 기록이 없어요."); return; }
  if (!confirm(`'코치 공유' 기록 ${rows.length}개를 '교역자까지'로 바꿀까요?\n교역자에게 공유한 카드의 기록만 교역자에게 보여요.`)) return;
  try {
    for (const r of rows) await updateDoc(doc(db, "souls", r.soulId, "records", r.id), { scope: "pastor" });
    invalidate(); toast(`${rows.length}개를 바꿨어요.`);
  } catch (e) { $("share-err").textContent = msgOf(e); }
}
$("share-back").onclick = () => openHome();
$("btn-home-share").onclick = () => openShare();
$("btn-share-save").onclick = async () => {
  const P = { ...sharePrefs() };
  if ($("sh-rec")) Object.assign(P, { recScope: $("sh-rec").value, meetPastor: $("sh-meet").checked,
    meetPeers: $("sh-peers").checked, soulPastor: $("sh-soul").checked,
    meetPhotos: $("sh-photos").checked, calPeers: $("sh-cal").checked });
  if ($("sh-lcoach")) Object.assign(P, { leaderCoach: $("sh-lcoach").checked, leaderPastor: $("sh-lpastor").checked });
  $("btn-share-save").disabled = true;
  try {
    await updateDoc(doc(db, "users", state.me.id), { sharePrefs: P });
    const before = sharePrefs(); state.me.sharePrefs = P;
    await loadSouls(true);
    const held = state.souls.filter(isLeaderOf);
    const want = (s) => ({ ...shareDefaults(s.kind || "member") });
    const diff = held.filter(s => Object.entries(want(s)).some(([k, v]) => !!s[k] !== v));
    if (diff.length && confirm(`지금 맡고 있는 카드 ${diff.length}장도 이 설정으로 맞출까요?\n(카드마다 따로 바꿔 둔 것도 이 설정으로 바뀌어요. '취소'를 누르면 새 카드부터 적용돼요.)`)) {
      for (const s of diff) { const p = want(s); await updateDoc(doc(db, "souls", s.id), p); Object.assign(s, p); }
    }
    if (canLead() && before.meetPastor !== P.meetPastor) {
      await loadMeetings(true);
      for (const m of state.meetings.filter(x => x.leaderUid === uid()))
        await updateDoc(doc(db, "meetings", m.id), { share: P.meetPastor ? "pastor" : "" });
      state.meetingsAt = 0;
    }
    if (canLead() && (before.meetPastor !== P.meetPastor || before.meetPeers !== P.meetPeers
        || (before.meetPhotos !== false) !== (P.meetPhotos !== false))) {
      await loadMeetings(true); await syncMyReports(true);
    }
    if (canLead() && (before.calPeers !== false) !== (P.calPeers !== false)) await syncCalShare(true);
    toast("공유 설정을 저장했어요."); openHome();
  } catch (e) { $("share-err").textContent = msgOf(e); }
  finally { $("btn-share-save").disabled = false; }
};

/* ── 카드마다 공유 (카드를 맡은 사람만) ── */
function shareBar(s) {
  if (!isLeaderOf(s)) return "";
  const btn = (k, on, label) => `<button type="button" data-shr="${k}" class="${on ? "on" : ""}" aria-pressed="${on}">${label} ${on ? "보임" : "안 보임"}</button>`;
  return `<div class="sharebar"><span>공유</span>
    ${s.kind === "leader" ? btn("coachShare", !!s.coachShare, "담당 코치에게") : ""}
    ${btn("pastorShare", !!s.pastorShare, "담당 교역자에게")}</div>`;
}
$("soul-contact").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-shr]"); if (!b || !state.soul || !isLeaderOf(state.soul)) return;
  const k = b.dataset.shr, s = state.soul, v = !s[k];
  b.disabled = true;
  try { await updateDoc(doc(db, "souls", s.id), { [k]: v }); s[k] = v;
        toast(v ? (k === "coachShare" ? "담당 코치에게 이 카드를 보여요." : "담당 교역자에게 이 카드를 보여요.") : "이제 안 보여요.");
        $("soul-contact").querySelector(".sharebar").outerHTML = shareBar(s); }
  catch (e) { toast(msgOf(e)); b.disabled = false; }
});

/* ── 기관 소유자 · 수퍼 관리자 · 담당 교역자 (조직 구성 맨 위) ── */
async function loadOwner() {
  try {
    const [o, b] = await Promise.all([getDoc(doc(db, "org", "main")), getDoc(doc(db, "system", "bootstrap"))]);
    state.ownerUid = (o.exists() && o.data().ownerUid) || (b.exists() && b.data().by) || "";
  } catch { state.ownerUid = ""; }
}
const isOwnerMe = () => !!state.me && state.me.role === "super" && state.ownerUid === state.me.id;
function renderOrgTop() {
  const us = (state.members || []).filter(u => u.active !== false);
  const supers = us.filter(u => u.role === "super");
  const pastors = us.filter(u => u.role === "pastor");
  const pinv = (state.invites || []).filter(i => i.status === "pending" && i.role === "pastor");
  const jn = (ids) => (ids || []).map(id => (state.jins.find(j => j.id === id) || {}).name).filter(Boolean).join(" · ");
  const own = isOwnerMe();
  $("org-top").innerHTML = `
    <div class="seat"><span class="lb">소유자</span><div class="ppl">${supers.filter(u => u.id === state.ownerUid).map(u =>
      `<span class="pchip acc">${esc(u.name)} <i>소유자</i></span>`).join("") || `<span class="muted" style="font-size:12px">—</span>`}
      ${own && supers.length > 1 ? `<button type="button" class="pchip add" data-otransfer="1">소유권 넘기기</button>` : ""}</div></div>
    <div class="seat"><span class="lb">수퍼 관리자</span><div class="ppl">${supers.filter(u => u.id !== state.ownerUid).map(u =>
      `<button type="button" class="pchip acc" data-osuper="${u.id}">${esc(u.name)}</button>`).join("")}
      ${own ? `<button type="button" class="pchip add" data-osuper="">＋ 수퍼 관리자</button>` : ""}</div></div>
    <div class="seat"><span class="lb">담당 교역자</span><div class="ppl">${pastors.map(u =>
      `<button type="button" class="pchip acc" data-opastor="u:${u.id}">${esc(u.name)} <i>${esc(jn(u.jinIds))}</i></button>`).join("")}${
      pinv.map(i => `<button type="button" class="pchip inv" data-opastor="i:${esc(i.email)}">${esc(i.name || i.email)} <i>✉ 초대 보냄 · ${esc(jn(i.jinIds))}</i></button>`).join("")}
      <button type="button" class="pchip add" data-opastor="">＋ 담당 교역자</button></div></div>
    <p class="hint" style="margin-top:8px">${own ? "소유자만 수퍼 관리자를 세우고 빼거나 소유권을 넘길 수 있어요."
      : "수퍼 관리자를 세우고 빼는 일은 소유자가 해요."} 소유자 · 수퍼 관리자도 남의 목양 카드는 볼 수 없어요.</p>`;
}
$("org-top").addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-otransfer]"); if (t) { openSuper("owner"); return; }
  const su = ev.target.closest("[data-osuper]");
  if (su) { if (!isOwnerMe()) { toast("수퍼 관리자는 소유자가 세우고 빼요."); return; }
    su.dataset.osuper ? removeSuper(su.dataset.osuper) : openSuper("add"); return; }
  const pa = ev.target.closest("[data-opastor]"); if (pa) openPastor(pa.dataset.opastor);
});
const dlgSu = $("dlg-super");
function openSuper(mode) {
  state.suMode = mode;
  const us = (state.members || []).filter(u => u.active !== false && u.id !== state.me.id);
  const list = mode === "owner" ? us.filter(u => u.role === "super") : us.filter(u => u.role !== "super" && u.role !== "pastor");
  $("su-title").textContent = mode === "owner" ? "소유권 넘기기" : "수퍼 관리자 세우기";
  $("su-sub").textContent = mode === "owner"
    ? "받는 분이 이 교회의 소유자가 되고, 나는 수퍼 관리자로 남아요. 되돌리려면 그분이 다시 넘겨줘야 해요."
    : "수퍼 관리자는 조직 · 사람 · 설정을 모두 관리해요(목양 카드는 못 봄). 이미 가입한 분 중에서 골라요.";
  $("su-user").innerHTML = list.map(u => `<option value="${u.id}">${esc(u.name)} · ${esc(ROLEBADGE[badgeOf(u)] || "")}</option>`).join("")
    || `<option value="">고를 수 있는 분이 없어요</option>`;
  $("su-err").textContent = ""; dlgSu.showModal();
}
$("su-cancel").onclick = () => dlgSu.close();
$("su-save").onclick = async () => {
  const id = $("su-user").value; if (!id) return;
  const u = userOf(id); $("su-save").disabled = true;
  try {
    if (state.suMode === "owner") {
      if (!confirm(`${u.name} 님에게 소유권을 넘길까요?`)) return;
      await updateDoc(doc(db, "org", "main"), { ownerUid: id, ownerAt: todayStr() });
      state.ownerUid = id; await log("소유권 넘기기", u.name);
    } else {
      await updateDoc(doc(db, "users", id), { role: "super", isLeader: !!(u.isLeader || (u.role === "leader" && u.cellId)) });
      Object.assign(u, { role: "super" }); await log("수퍼 관리자 세우기", u.name);
    }
    dlgSu.close(); await loadOrg(true); renderOrg(); toast("바꿨어요.");
  } catch (e) { $("su-err").textContent = msgOf(e); }
  finally { $("su-save").disabled = false; }
};
async function removeSuper(id) {
  const u = userOf(id); if (!u) return;
  if (!confirm(`${u.name} 님을 수퍼 관리자에서 뺄까요?\n셀리더로 바뀌어요(맡은 셀은 그대로). 다른 역할은 리더 관리 · 조직 구성에서 다시 정해요.`)) return;
  try { await updateDoc(doc(db, "users", id), { role: "leader" }); await log("수퍼 관리자 빼기", u.name);
        await loadOrg(true); renderOrg(); toast("뺐어요."); }
  catch (e) { toast(msgOf(e)); }
}
const dlgPs = $("dlg-pastor");
function openPastor(key) {
  state.psKey = key || "";
  const u = key && key.startsWith("u:") ? userOf(key.slice(2)) : null;
  const iv = key && key.startsWith("i:") ? (state.invites || []).find(i => i.email === key.slice(2)) : null;
  const accs = (state.members || []).filter(x => x.active !== false && x.role !== "super" && x.role !== "pastor");
  $("ps-title").textContent = u ? `${u.name} — 담당 교역자` : iv ? `${iv.name || iv.email} — 초대 보냄` : "담당 교역자 세우기";
  $("ps-pick").innerHTML = u ? `<option value="u:${u.id}">${esc(u.name)} (지금 담당 교역자)</option>`
    : `<option value="new">새로 넣기 — 이름 · 이메일로 초대</option>` + (iv ? "" : accs.map(x =>
      `<option value="u:${x.id}">${esc(x.name)} · ${esc(ROLEBADGE[badgeOf(x)] || "")} (이미 가입)</option>`).join(""));
  $("ps-pick").disabled = !!u;
  $("ps-name").value = iv ? (iv.name || "") : ""; $("ps-email").value = iv ? iv.email : "";
  const pre = new Set((u && u.jinIds) || (iv && iv.jinIds) || []);
  $("ps-jins").innerHTML = state.jins.filter(j => j.active !== false).map(j =>
    `<label><input type="checkbox" value="${j.id}"${pre.has(j.id) ? " checked" : ""}> ${esc(j.name)}</label>`).join("")
    || `<p class="muted">진이 아직 없어요.</p>`;
  $("ps-del").hidden = !(u || iv); $("ps-err").textContent = "";
  syncPs(); dlgPs.showModal();
}
function syncPs() { $("ps-new").hidden = $("ps-pick").value !== "new"; }
$("ps-pick").onchange = syncPs;
$("ps-cancel").onclick = () => dlgPs.close();
$("ps-save").onclick = async () => {
  const v = $("ps-pick").value, jinIds = [...$("ps-jins").querySelectorAll("input:checked")].map(i => i.value);
  if (!jinIds.length) { $("ps-err").textContent = "맡은 진을 하나 이상 골라 주세요."; return; }
  $("ps-save").disabled = true;
  try {
    if (v.startsWith("u:")) {
      const u = userOf(v.slice(2));
      const p = { role: "pastor", jinIds, jinId: jinIds[0], cellIds: [], isLeader: false, cellId: null };
      if (u.role !== "pastor" && !confirm(`${u.name} 님을 담당 교역자로 바꿀까요?\n셀리더 · 코치 역할은 없어지고, 맡던 셀은 담당 바꾸기로 넘겨야 해요.`)) return;
      await updateDoc(doc(db, "users", u.id), p); Object.assign(u, p);
      await log("담당 교역자", u.name, jinIds.join(","));
    } else {
      const name = $("ps-name").value.trim(), email = $("ps-email").value.trim().toLowerCase();
      if (!name || !email.includes("@")) { $("ps-err").textContent = "이름과 구글 이메일을 적어 주세요."; return; }
      if ((state.members || []).some(u => (u.email || "").toLowerCase() === email)) {
        $("ps-err").textContent = "이미 가입한 분이에요. '누구를'에서 그분을 골라 주세요."; return; }
      const old = state.psKey.startsWith("i:") ? state.psKey.slice(2) : "";
      if (old && old !== email) { try { await deleteDoc(doc(db, "invites", old)); } catch {} }
      await setDoc(doc(db, "invites", email), { email, name, role: "pastor", jinId: jinIds[0], jinIds,
        cellId: null, cellIds: [], isLeader: false, status: "pending", by: uid(), createdAt: serverTimestamp() });
      await log("담당 교역자 초대", name, email);
    }
    dlgPs.close(); await loadOrg(true); renderOrg(); toast("저장했어요.");
  } catch (e) { $("ps-err").textContent = msgOf(e); }
  finally { $("ps-save").disabled = false; }
};
$("ps-del").onclick = async () => {
  const k = state.psKey;
  if (!confirm(k.startsWith("u:") ? "담당 교역자에서 뺄까요?\n이 계정은 앱을 더 쓸 수 없게 돼요(기록은 남아요)." : "보낸 초대를 취소할까요?")) return;
  try {
    if (k.startsWith("i:")) await deleteDoc(doc(db, "invites", k.slice(2)));
    else if (k.startsWith("u:")) await updateDoc(doc(db, "users", k.slice(2)), { active: false });
    dlgPs.close(); await loadOrg(true); renderOrg(); toast("뺐어요.");
  } catch (e) { $("ps-err").textContent = msgOf(e); }
};

/* ════════════════════════════════════════════════════════════
   22단계 · 셀 보고 모아보기 — 같은 진 셀리더 · 코치 · 진장이 다른 셀 보고도 봅니다
   ────────────────────────────────────────────────────────────
   셀모임(meetings)은 그대로 맡은 셀리더 · 담당 코치 · 진장만 봅니다.
   저장할 때 '보고 사본(reports)'을 하나 더 만들어 같은 진 모두가 보게 합니다.
   · 사본 본문: 날짜 · 셀 · 주제 · 장소 · 출석(이름)
   · 사람별 나눔(근황 · 기도제목 · 결석 사유)은 사본 아래 사람마다 한 장씩(people/명부ID).
     그 사람이 나중에 계정을 받아도 자기 이야기는 서버가 막아 못 봅니다(보안 규칙).
   · 셀리더 카드 · 민감 메모 · 만남 기록은 사본에 들어가지 않습니다.
   노션에서 가져온 옛 보고서도 같은 사본(imported)으로 들어옵니다.
   ════════════════════════════════════════════════════════════ */
const REP_MONTHS = 3;
const ymOf = (d) => String(d || "").slice(0, 7);
const repPeers = () => sharePrefs().meetPeers !== false;
const repPhotos = () => sharePrefs().meetPhotos !== false;
const repKeyOfSoul = (s) => s.memberId || ("s_" + s.id);
function recentYms(n) {
  const out = [], d = new Date(); d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
/* 이름 → 손님 열쇠 (명부에 없는 사람) */
function guestKey(name) {
  let h = 0; const s = String(name || "").trim();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "g_" + h.toString(36);
}
/* 내 셀모임 하나를 사본으로 */
async function syncReport(mid, m) {
  if (!mid || !m || m.leaderUid !== uid()) return;
  const myM = memberOfUid(uid());
  const lk = m.leaderUid, att = {}, names = {}, people = {};
  for (const [k, v] of Object.entries(m.attendance || {})) {
    if (!v) continue;
    if (k === lk) { const key = myM ? myM.id : "u_" + lk; att[key] = v; names[key] = state.me.name || ""; continue; }
    const s = state.souls.find(x => x.id === k);
    if (!s || isLeaderCard(s)) continue;
    const key = repKeyOfSoul(s); att[key] = v; names[key] = s.name || "";
  }
  if (repPeers()) {
    for (const s of state.souls.filter(x => x.cellId === m.cellId && !isLeaderCard(x))) {
      const key = repKeyOfSoul(s), nt = (m.notes || {})[s.id] || {};
      const absent = att[key] === "absent";
      const up = (nt.update || "").trim(), pr = (nt.pray || "").trim();
      const rk = absent ? ((m.reasonKinds || {})[s.id] || "") : "";
      const rs = absent ? ((m.reasons || {})[s.id] || "").trim() : "";
      if (up || pr || rk || rs) people[key] = { name: s.name || "", update: up, pray: pr, reasonKind: rk, reason: rs,
        blockEmail: (s.subjectEmail || "").toLowerCase(), by: uid() };
    }
  }
  const ref = doc(db, "reports", mid);
  let before = [];
  try { const o = await getDoc(ref); if (o.exists()) before = o.data().peopleIds || []; } catch {}
  await setDoc(ref, { jinId: m.jinId, cellId: m.cellId, cellName: cellNameOf(m.cellId), date: m.date || "",
    ym: ymOf(m.date), time: m.time || "", timeEnd: m.timeEnd || "",
    photos: repPhotos() ? (m.photos || []).filter(p => p && p.id && p.thumb).map(p => ({ id: p.id, thumb: p.thumb })) : [],
    topic: m.topic || "", place: m.place || "", visitors: m.visitors || "",
    note: repPeers() ? (m.note || "") : "", leaderUid: uid(), leaderMemberId: myM ? myM.id : "",
    leaderName: state.me.name || "", att, names, peopleIds: Object.keys(people), peers: repPeers(),
    share: m.share || "", imported: false, src: "app", updatedAt: serverTimestamp() });
  for (const k of before.filter(k => !people[k])) { try { await deleteDoc(doc(db, "reports", mid, "people", k)); } catch {} }
  for (const [k, p] of Object.entries(people)) await setDoc(doc(db, "reports", mid, "people", k), p);
  /* 26단계 — 셀모임 큰 사진도 공유 설정대로 (같은 진에게 보이기 · 안 보이기) */
  for (const ph of (m.photos || []).filter(x => x && x.id)) {
    try { await updateDoc(doc(db, "meetingPhotos", ph.id), { peers: repPhotos() }); } catch (e) { console.warn("사진 공유 표시", e); }
  }
  state.repAt = 0; state.attAt = 0;
}
async function dropReport(mid) {
  try {
    const o = await getDoc(doc(db, "reports", mid));
    if (!o.exists()) return;
    for (const k of (o.data().peopleIds || [])) { try { await deleteDoc(doc(db, "reports", mid, "people", k)); } catch {} }
    await deleteDoc(doc(db, "reports", mid));
  } catch (e) { console.warn("보고 사본 지우기", e); }
  state.repAt = 0;
}
/* 22단계로 처음 열 때 — 지금까지 적은 내 셀모임을 한 번에 사본으로 (한 기기에서 한 번) */
async function syncMyReports(force) {
  if (!canLead() || !state.me || !state.me.jinId) return;
  const key = "mokja-rep26-" + uid();   // 26단계 — 시간 · 사진을 더해 한 번 더
  try { if (!force && localStorage.getItem(key)) return; } catch {}
  await loadMeetings(); await loadSouls();
  const mine = state.meetings.filter(m => m.leaderUid === uid());
  let n = 0;
  for (const m of mine) { try { await syncReport(m.id, m); n++; } catch (e) { console.warn("보고 사본", m.id, e); } }
  try { localStorage.setItem(key, String(Date.now())); } catch {}
  return n;
}

/* ── 읽기 ── */
function repJins() {
  const me = state.me;
  if (me.role === "pastor") return me.jinIds || [];
  if (me.role === "super" && !me.jinId) return state.jins.map(j => j.id);
  return me.jinId ? [me.jinId] : [];
}
async function loadReports(f) {
  const me = state.me, col = collection(db, "reports"), qs = [];
  for (const j of (f.jinId ? [f.jinId] : repJins())) {
    const base = [where("jinId", "==", j)];
    if (me.role === "pastor") base.push(where("share", "==", "pastor"));
    if (f.cellId) qs.push(query(col, ...base, where("cellId", "==", f.cellId)));
    else recentYms(REP_MONTHS).forEach(ym => qs.push(query(col, ...base, where("ym", "==", ym))));
  }
  const rs = await Promise.all(qs.map(q => getDocs(q)));
  const seen = {};
  return rs.flatMap(pack).filter(r => seen[r.id] ? false : (seen[r.id] = true))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
const repCount = (r) => { const v = Object.values(r.att || {}); return { ok: v.filter(x => x && x !== "absent").length, all: v.length }; };
async function openReports(cellId) {
  const me = state.me;
  if (!repJins().length) { toast("진에 속한 분이 셀 보고를 볼 수 있어요."); return; }
  show("s-loading");
  await loadOrg();
  if (canLead() || ["coach","jinjang","pastor"].includes(me.role)) { await loadMeetings(); await loadSouls(); }
  state.repF = { cellId: cellId === undefined ? ((state.repF && state.repF.cellId) || "") : cellId }; state.repCalYm = "";
  if (canLead()) syncMyReports().catch(() => {});
  renderRepChips();
  $("rep-list").innerHTML = `<p class="muted">불러오는 중…</p>`;
  markSide("meet"); show("s-reports");
  try {
    state.reps = await loadReports(state.repF);
    renderRepList();
  } catch (e) { $("rep-list").innerHTML = `<p class="err">${esc(msgOf(e))}</p>`; }
}
function repCells() {
  const js = new Set(repJins());
  return activeCells().filter(c => js.has(c.jinId));
}
function renderRepChips() {
  const f = state.repF || {}, cells = repCells();
  $("rep-chips").innerHTML = `<button type="button" data-repc="" class="${!f.cellId ? "on" : ""}">최근 ${REP_MONTHS}달 · 모든 셀</button>`
    + cells.map(c => `<button type="button" data-repc="${c.id}" class="${f.cellId === c.id ? "on" : ""}">${cellChipIn(c)}</button>`).join("");
}
function renderRepList() {
  renderRepSide();
  const rows = state.reps || [], f = state.repF || {};
  const byMonth = {};
  rows.forEach(r => { (byMonth[ymOf(r.date)] = byMonth[ymOf(r.date)] || []).push(r); });
  const months = Object.keys(byMonth).sort().reverse();
  $("rep-sub").textContent = f.cellId
    ? `${cellNameOf(f.cellId) || "셀"} — 모든 보고 ${rows.length}건`
    : `같은 진 모든 셀의 최근 보고 ${rows.length}건`;
  $("rep-list").innerHTML = months.map(ym => `
    <h3 class="sec-title" style="margin-top:14px">${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월</h3>
    <div class="list">${byMonth[ym].map(r => {
      const c = repCount(r), mine = r.leaderUid === uid() || (r.leaderMemberId && memberOfUid(uid()) && r.leaderMemberId === memberOfUid(uid()).id);
      return `<div class="row" data-rep="${r.id}" data-repdate="${r.date}" style="cursor:pointer">
        <div class="grow"><p class="nm">${fmtDate(r.date)} · ${esc(r.cellName || cellNameOf(r.cellId) || "셀")}${mine ? ` <span class="chip rose" style="font-size:10px;padding:1px 7px">내 셀</span>` : ""}</p>
          <p class="sub">${esc(r.leaderName || "")}${r.topic ? " · " + esc(r.topic) : ""}${(r.peopleIds || []).length ? ` · 나눔 ${(r.peopleIds || []).length}명` : ""}</p></div>
        ${r.imported ? `<span class="chip">노션</span>` : ""}
        <span class="chip">${c.all ? `출석 ${c.ok}/${c.all}` : "—"}</span></div>`;
    }).join("")}</div>`).join("")
    || `<p class="muted" style="margin-top:12px">${f.cellId ? "이 셀의 보고가 아직 없어요." : `최근 ${REP_MONTHS}달 보고가 없어요. 위에서 셀을 고르면 그 셀의 지난 보고를 모두 볼 수 있어요.`}</p>`;
}
$("rep-chips").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-repc]"); if (!b) return;
  state.repF = { cellId: b.dataset.repc }; state.repCalYm = "";
  renderRepChips(); $("rep-list").innerHTML = `<p class="muted">불러오는 중…</p>`;
  try { state.reps = await loadReports(state.repF); renderRepList(); }
  catch (e) { $("rep-list").innerHTML = `<p class="err">${esc(msgOf(e))}</p>`; }
});
$("rep-list").addEventListener("click", (ev) => {
  const r = ev.target.closest("[data-rep]"); if (!r) return;
  const m = state.meetings.find(x => x.id === r.dataset.rep);
  /* 원래 셀모임을 볼 수 있는 분(내 셀 · 담당 코치 · 진장)은 셀모임 화면으로 — 확인 · 댓글도 거기서 */
  if (m) { openMeeting(m.id, { back: "rep" }); return; }
  openReport(r.dataset.rep);
});
$("rep-back").onclick = () => openHome();
async function openReport(id) {
  const r = (state.reps || []).find(x => x.id === id); if (!r) return;
  state.rep = r;
  $("rep1-title").textContent = `${fmtDate(r.date)} · ${r.cellName || cellNameOf(r.cellId) || "셀"}`;
  const grp = { present: [], online: [], absent: [] };
  Object.entries(r.att || {}).forEach(([k, v]) => { if (grp[v]) grp[v].push((r.names || {})[k] || "—"); });
  const line = (k, v) => v ? `<p style="margin-top:6px"><span class="muted" style="display:inline-block;width:64px">${k}</span>${esc(v)}</p>` : "";
  const c = repCount(r);
  $("rep1-body").innerHTML = `
    <div class="card">
      <p class="muted" style="font-size:12px">${esc(r.leaderName || "")} 셀리더${r.imported ? " · 노션에서 가져온 보고" : ""}</p>
      ${line("주제", r.topic)}${line("장소", r.place)}${line("새 방문", r.visitors)}
      ${r.note ? `<p style="margin-top:10px;white-space:pre-wrap">${esc(r.note)}</p>` : ""}
    </div>
    <div class="card" style="margin-top:10px">
      <h3 style="font-size:14px;font-weight:600">출석 ${c.ok} / ${c.all}</h3>
      ${["present", "online", "absent"].map(k => grp[k].length ? `<p style="margin-top:8px"><span class="chip${k === "absent" ? " warn" : ""}">${ATT[k]} ${grp[k].length}</span> ${grp[k].map(esc).join(" · ")}</p>` : "").join("")}
    </div>
    <div id="rep1-people" style="margin-top:10px">${(r.peopleIds || []).length ? `<p class="muted">나눔 불러오는 중…</p>` : ""}</div>`;
  show("s-report");
  const ids = r.peopleIds || [];
  if (!ids.length) return;
  const got = await Promise.all(ids.map(k => getDoc(doc(db, "reports", r.id, "people", k))
    .then(d => d.exists() ? { id: k, ...d.data() } : null).catch(() => null)));
  if (!state.rep || state.rep.id !== r.id) return;
  const ps = got.filter(Boolean);
  $("rep1-people").innerHTML = ps.length ? `<div class="card"><h3 style="font-size:14px;font-weight:600">사람별 나눔</h3>
    ${ps.map(p => `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
      <p class="nm" style="font-weight:600">${esc(p.name || "")}${p.reasonKind || p.reason ? ` <span class="chip warn" style="font-size:10px;padding:1px 7px">결석 ${esc([REASON[p.reasonKind], p.reason].filter(Boolean).join(" · "))}</span>` : ""}</p>
      ${p.update ? `<p style="margin-top:4px;white-space:pre-wrap">${esc(p.update)}</p>` : ""}
      ${p.pray ? `<p style="margin-top:6px;white-space:pre-wrap"><span class="muted">기도 </span>${esc(p.pray)}</p>` : ""}
    </div>`).join("")}</div>` : "";
}
$("rep1-back").onclick = () => { show("s-reports"); };

/* ════════════════════════════════════════════════════════════
   22단계 · 보고서 가져오기 (수퍼) — 노션에서 정리한 파일(.json)을 한 번에 넣습니다
   ────────────────────────────────────────────────────────────
   · 셀: 이름이 같으면 그 셀에, 없으면 새로 만듭니다
   · 사람: 같은 셀에 같은 이름이 있으면 그 명부 카드에 잇고, 없으면 명부에 새로 넣습니다
     (그 셀 셀리더가 앱을 열면 목양 카드가 생겨요)
   · 셀리더: 가입한 분이면 그 계정에, 아니면 '이름만' 자리로 (나중에 조직 구성에서 이메일을 넣으면 초대)
   · 보고서: 노션 페이지마다 하나 (같은 파일을 다시 넣어도 두 번 생기지 않아요)
   ════════════════════════════════════════════════════════════ */
function openImport() {
  if (!state.me || state.me.role !== "super") { toast("보고서 가져오기는 수퍼 관리자가 해요."); return; }
  state.imp = null;
  $("imp-file").value = ""; $("imp-err").textContent = ""; $("imp-log").textContent = "";
  $("imp-preview").innerHTML = ""; $("btn-imp-run").hidden = true;
  show("s-import");
}
$("btn-home-import").onclick = () => openImport();
$("imp-back").onclick = () => openHome();
$("imp-file").onchange = async () => {
  const f = $("imp-file").files[0]; $("imp-err").textContent = "";
  if (!f) return;
  try {
    const J = JSON.parse(await f.text());
    if (!J || !Array.isArray(J.reports)) throw new Error("보고서(reports)가 없는 파일이에요.");
    await loadOrg(true);
    state.imp = J; renderImport();
  } catch (e) { $("imp-err").textContent = "파일을 읽지 못했어요 — " + (e.message || e); }
};
function impJinId() { return $("imp-jin") ? $("imp-jin").value : ""; }
function renderImport() {
  const J = state.imp; if (!J) return;
  const guess = (state.jins.find(j => j.name === J.jin) || state.jins[0] || {}).id || "";
  const jinId = impJinId() || guess;
  const cellsIn = [...new Set([...(J.cells || []).map(c => c.name), ...J.reports.map(r => r.cell)].filter(Boolean))];
  const have = activeCells().filter(c => c.jinId === jinId);
  const newCells = cellsIn.filter(n => !have.some(c => c.name === n));
  const people = new Set(); J.reports.forEach(r => (r.people || []).forEach(p => people.add(r.cell + "|" + p.name)));
  const dates = J.reports.map(r => r.date).filter(Boolean).sort();
  $("imp-preview").innerHTML = `
    <div class="field"><label for="imp-jin">넣을 진</label>
      <select id="imp-jin">${state.jins.map(j => `<option value="${j.id}"${j.id === jinId ? " selected" : ""}>${esc(j.name)}</option>`).join("")}</select></div>
    <div class="tiles" style="margin-top:12px">
      ${tile("보고서", J.reports.length + "건")}${tile("셀", cellsIn.length + "개")}${tile("사람", people.size + "명")}</div>
    <div class="card" style="margin-top:12px;font-size:14px;line-height:1.8">
      <p>기간: ${dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : "—"}</p>
      <p>새로 만들 셀: ${newCells.length ? newCells.map(esc).join(", ") : "없음 (모두 있는 셀)"}</p>
      ${(J.people || []).length ? `<p>명단: ${J.people.length}명 — 연락처 · 생일 · 가족 · 차량 · 기도제목 ${J.people.reduce((n, p) => n + (p.prayers || []).length, 0)}개</p>` : ""}
      ${(J.renames || []).length ? `<p>이름 바꾸기: ${(J.renames || []).map(x => `${esc(x.from)} → ${esc(x.to)}`).join(", ")}</p>` : ""}
      <p class="muted" style="font-size:12px;margin-top:6px">같은 파일을 다시 넣어도 보고서가 두 번 생기지 않고 그 자리에 고쳐져요.</p>
    </div>
    <div class="card" style="margin-top:10px">
      <h3 style="font-size:14px;font-weight:600">셀마다</h3>
      ${cellsIn.map(n => { const rs = J.reports.filter(r => r.cell === n);
        const ls = [...new Set(rs.map(r => r.leader).filter(Boolean))];
        return `<p style="margin-top:8px;font-size:14px"><b>${esc(n)}</b> · 보고 ${rs.length}건 · 셀리더 ${ls.map(esc).join(", ") || "—"}</p>`; }).join("")}
    </div>`;
  $("imp-jin").onchange = renderImport;
  $("btn-imp-run").hidden = false;
}
function impLog(t) { $("imp-log").textContent = t; }
async function applyRenames(list, jinId) {
  let n = 0;
  for (const { from, to } of (list || [])) {
    if (!from || !to || from === to) continue;
    for (const u of (state.members || []).filter(u => u.name === from && (u.jinId === jinId || u.id === uid()))) {
      try { await updateDoc(doc(db, "users", u.id), { name: to }); u.name = to; if (u.id === uid()) state.me.name = to; n++; }
      catch (e) { console.warn("이름 바꾸기(계정)", from, e); }
    }
    if (state.me.name === from) { try { await updateDoc(doc(db, "users", uid()), { name: to }); state.me.name = to; n++; } catch {} }
    for (const m of (state.dir || []).filter(m => m.name === from && m.jinId === jinId)) {
      try { await updateDoc(doc(db, "members", m.id), { name: to, updatedAt: serverTimestamp() }); m.name = to; n++; }
      catch (e) { console.warn("이름 바꾸기(명부)", from, e); }
    }
  }
  return n;
}
$("btn-imp-run").onclick = async () => {
  const J = state.imp, jinId = impJinId();
  if (!J || !jinId) return;
  if (!confirm(`${J.reports.length}건을 ${(state.jins.find(j => j.id === jinId) || {}).name || "진"}에 넣을까요?`)) return;
  $("btn-imp-run").disabled = true; $("imp-err").textContent = "";
  const st = { cells: 0, members: 0, seats: 0, reps: 0, people: 0, ren: 0 };
  try {
    impLog("이름 바꾸는 중…");
    st.ren = await applyRenames(J.renames, jinId);
    /* ① 셀 */
    const cellOf = {};
    const names = [...new Set([...(J.cells || []).map(c => c.name), ...J.reports.map(r => r.cell)].filter(Boolean))];
    for (const n of names) {
      let c = activeCells().find(x => x.jinId === jinId && x.name === n);
      if (!c) {
        const d = { name: n, jinId, active: true, createdAt: serverTimestamp() };
        const ref = await addDoc(collection(db, "cells"), d); c = { id: ref.id, ...d }; state.cells.push(c); st.cells++;
      }
      cellOf[n] = c;
    }
    /* ② 사람 — 명부 카드 찾기 · 만들기 */
    const accByName = (n) => (state.members || []).find(u => u.active !== false && u.jinId === jinId && u.name === n)
      || (state.me.name === n ? state.me : null);
    const memFor = async (name, cell, asLeader) => {
      const acc = accByName(name);
      if (acc) { let m = memberOfUid(acc.id); if (m) return m; }
      let m = (state.dir || []).find(x => x.active !== false && x.jinId === jinId && x.name === name && x.cellId === cell.id)
        || (state.dir || []).find(x => x.active !== false && x.jinId === jinId && x.name === name
             && x.pendingSeat && x.pendingSeat.cellId === cell.id)
        || (asLeader ? (state.dir || []).find(x => x.active !== false && x.jinId === jinId && x.name === name && !x.cellId) : null);
      if (m) return m;
      const d = { name, jinId, cellId: asLeader ? null : cell.id, uid: "", role: "member", linkedEmail: "", careUid: "",
        soulIds: [], trainingsDone: [], active: true, thumb: "", phone: "", gender: "", birthMD: "", lunar: false,
        position: "", registeredAt: "", baptizedAt: "", importedFrom: "notion",
        createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), pendingSeat: null };
      const ref = await addDoc(collection(db, "members"), d); m = { id: ref.id, ...d }; state.dir.push(m); st.members++;
      return m;
    };
    /* 지금 셀리더 — 가입 전이면 '이름만' 자리로 */
    for (const c of (J.cells || [])) {
      const cell = cellOf[c.name]; if (!cell || !c.leader) continue;
      const m = await memFor(c.leader, cell, true);
      if (!m.uid && !seatList("leader", jinId, cell.id).length) {
        const seat = { role: "leader", cellId: cell.id, cellIds: [] };
        await updateDoc(doc(db, "members", m.id), { pendingSeat: seat, updatedAt: serverTimestamp() }); m.pendingSeat = seat; st.seats++;
      }
    }
    for (const c of (J.cells || [])) {
      const cell = cellOf[c.name]; if (!cell) continue;
      for (const n of (c.members || [])) { if (n && n !== c.leader) await memFor(n, cell, false); }
    }
    /* ②-1 명단 — 연락처 · 생일 · 수료 훈련은 명부에, 가족 · 차량 · 기도제목 같은 나머지는 잠긴 칸에 */
    st.priv = 0;
    for (const p of (J.people || [])) {
      const cell = cellOf[p.cell]; if (!cell || !p.name) continue;
      if (st.priv % 5 === 0) impLog(`명단 넣는 중… ${st.priv} / ${J.people.length}`);
      const lead = (J.cells || []).some(c => c.name === p.cell && c.leader === p.name);
      const m = await memFor(p.name, cell, lead);
      try { await applyPerson(m, p); st.priv++; } catch (e) { console.warn("명단", p.name, e); }
    }
    /* ③ 보고서 */
    let i = 0;
    for (const r of J.reports) {
      i++; if (i % 5 === 1) impLog(`보고서 넣는 중… ${i} / ${J.reports.length}`);
      const cell = cellOf[r.cell]; if (!cell || !r.id || !r.date) continue;
      const lm = r.leader ? await memFor(r.leader, cell, true) : null;
      const keep = new Set([...(J.cells || []).filter(c => c.name === r.cell).flatMap(c => c.members || [])]);
      const att = {}, names = {}, people = {};
      for (const p of (r.people || [])) {
        if (!p.name) continue;
        const isLead = p.name === r.leader;
        const m = isLead ? lm : (keep.has(p.name) || accByName(p.name)) ? await memFor(p.name, cell, false)
          : (state.dir || []).find(x => x.active !== false && x.jinId === jinId && x.name === p.name && x.cellId === cell.id);
        const key = m ? m.id : guestKey(r.cell + "|" + p.name);
        if (p.att) att[key] = p.att;
        names[key] = p.name;
        const up = (p.update || "").trim(), pr = (p.pray || "").trim(), rs = (p.reason || "").trim();
        if (up || pr || rs) people[key] = { name: p.name, update: up, pray: pr, reasonKind: p.reasonKind || "", reason: rs,
          blockEmail: (m && m.linkedEmail) || "", by: uid() };
      }
      const rid = "nt_" + String(r.id).replace(/[^A-Za-z0-9_-]/g, "");
      const ref = doc(db, "reports", rid);
      let before = [];
      try { const o = await getDoc(ref); if (o.exists()) before = o.data().peopleIds || []; } catch {}
      await setDoc(ref, { jinId, cellId: cell.id, cellName: cell.name, date: r.date, ym: ymOf(r.date),
        topic: r.topic || "", place: r.place || "", visitors: r.visitors || "", note: r.note || "",
        leaderUid: "", leaderMemberId: lm ? lm.id : "", leaderName: r.leader || "",
        att, names, peopleIds: Object.keys(people), peers: true, share: "pastor",
        imported: true, src: "notion", srcUrl: r.url || "", importedBy: uid(), updatedAt: serverTimestamp() });
      for (const k of before.filter(k => !people[k])) { try { await deleteDoc(doc(db, "reports", rid, "people", k)); } catch {} }
      for (const [k, p] of Object.entries(people)) { await setDoc(doc(db, "reports", rid, "people", k), p); st.people++; }
      st.reps++;
    }
    await log("보고서 가져오기", (state.jins.find(j => j.id === jinId) || {}).name || "",
      `보고 ${st.reps} · 셀 ${st.cells} · 명부 ${st.members} · 이름만 자리 ${st.seats} · 명단 ${st.priv || 0}`);
    impLog(`끝났어요 — 보고서 ${st.reps}건 · 나눔 ${st.people}개 · 새 셀 ${st.cells} · 새 명부 ${st.members}명 · 이름만 자리 ${st.seats}${st.priv ? ` · 명단 ${st.priv}명` : ""}${st.ren ? ` · 이름 바꿈 ${st.ren}` : ""}`);
    state.orgAt = 0; state.repAt = 0; toast("가져왔어요.");
  } catch (e) { $("imp-err").textContent = msgOf(e); }
  finally { $("btn-imp-run").disabled = false; }
};

/* ════════ 23단계 — 노션 명단 (연락처 · 가족 · 차량 · 기도제목) ════════
   명부(members)는 같은 진이면 누구나 읽어요. 그래서 거기엔 원래 보이던 것(연락처 · 생일 · 수료 훈련)만 넣고,
   가족 · 차량 · 생년 · 정회원 · 침례 · 셀역할 · 비고 · 기도제목은 members/{id}/private/notion 에 둡니다.
   그 칸은 보안 규칙이 막아요 — 그 셀 셀리더(또는 목양 담당) · 진장 · 코치 · 수퍼만, 본인은 못 봄.
   셀리더가 앱을 열면 자기 목양 카드의 빈 칸을 이 내용으로 채웁니다. */
const NT_TRAIN = { "새로운삶": "새로운 삶", "새로운 삶": "새로운 삶", "제자의삶": "제자의 삶", "제자의 삶": "제자의 삶" };
async function applyPerson(m, p) {
  const at = new Date().toISOString();
  const patch = { notionAt: at, updatedAt: serverTimestamp() };
  if (p.phone && !m.phone) patch.phone = fmtPhone(p.phone);
  if (p.birth && !m.birthMD) { const md = mdOf(p.birth); if (md) patch.birthMD = md; }
  const tr = (p.trainings || []).map(t => NT_TRAIN[t]).filter(Boolean);
  const merged = [...new Set([...(m.trainingsDone || []), ...tr])];
  if (merged.length !== (m.trainingsDone || []).length) patch.trainingsDone = merged;
  const self = m.uid === uid() || (m.linkedEmail && m.linkedEmail === myEmail());
  if (!self) await setDoc(doc(db, "members", m.id, "private", "notion"), {
    birth: p.birth || "", cars: p.cars || [], spouse: p.spouse || "", children: p.children || [],
    membership: p.membership || "", baptism: p.baptism || [], roles: p.roles || [],
    trainings: p.trainings || [], memo: p.memo || "",
    prayers: (p.prayers || []).map(x => ({ id: String(x.id || ""), date: x.date || "", title: x.title || "", body: x.body || "" })),
    at, by: uid(), updatedAt: serverTimestamp() });
  await updateDoc(doc(db, "members", m.id), patch);
  Object.assign(m, patch);
}
/* 명부 카드 '노션 명단' — 볼 수 있는 사람에게만 (못 보면 규칙이 거절 → 조용히 비움) */
function canSeePriv(m) {
  const me = state.me; if (!m || !me) return false;
  if (m.uid === me.id || (m.linkedEmail && m.linkedEmail === myEmail())) return false;
  if (me.role === "super") return true;
  if (["jinjang", "coach"].includes(me.role) && m.jinId === me.jinId) return true;
  return canLead() && m.jinId === me.jinId && ((!!me.cellId && m.cellId === me.cellId) || m.careUid === me.id);
}
function notionLines(P) {
  const L = [];
  if ((P.cars || []).length) L.push(`차량 ${P.cars.join(" / ")}`);
  const st = [P.membership, ...(P.baptism || [])].filter(Boolean);
  if (st.length) L.push(st.join(" · "));
  const rl = (P.roles || []).filter(r => r !== "셀 리더");
  if (rl.length) L.push(`셀역할 ${rl.join(", ")}`);
  const drop = (P.trainings || []).filter(t => !NT_TRAIN[t]);
  if (drop.length) L.push(drop.join(", "));
  if (P.memo) L.push(P.memo);
  return L;
}
const kidText = (k) => `${k.name}${k.note ? ` (${k.note})` : ""}${k.relation && k.relation !== "자녀" ? ` · ${k.relation}` : ""}`;
async function showPriv(m) {
  const box = $("mb-priv"); if (!box) return;
  box.innerHTML = "";
  if (!canSeePriv(m) || !m.notionAt) return;
  let P;
  try { const d = await getDoc(doc(db, "members", m.id, "private", "notion")); if (!d.exists()) return; P = d.data(); }
  catch { return; }
  if (!state.mb || state.mb.id !== m.id) return;
  const rows = [
    ["생년월일", P.birth ? fmtDate(P.birth, true) : ""], ["배우자", P.spouse],
    ["자녀", (P.children || []).map(kidText).join(", ")], ["차량", (P.cars || []).join(" / ")],
    ["정회원", P.membership], ["침례 · 간증", (P.baptism || []).join(" · ")],
    ["셀역할", (P.roles || []).join(", ")], ["비고", P.memo],
    ["기도제목", (P.prayers || []).length ? `${P.prayers.length}개 (목양 카드에 들어가요)` : ""]
  ].filter(([, v]) => v);
  if (!rows.length) return;
  const wide = new Set(["자녀", "비고", "침례 · 간증"]);
  box.innerHTML = `<p class="mb-sec">노션 명단 <span>🔒 셀리더 · 진장 · 코치만 보여요</span></p>
      <div class="fgrid lock">${rows.map(([k, v]) => fbox(k, v, wide.has(k) ? "fwide" : "")).join("")}</div>`;
}
/* 셀리더 — 내 목양 카드의 빈 칸을 명단으로 채우기 (한 번씩, 다시 가져오면 새것만) */
async function fillFromNotion() {
  const me = state.me; if (!me) return;
  let n = 0;
  for (const s of (state.souls || [])) {
    if (s.active === false || s.leaderUid !== me.id || !s.memberId || s.kind === "leader") continue;
    const m = memberById(s.memberId);
    if (!m || !m.notionAt || s.notionAt === m.notionAt) continue;
    if (m.uid === me.id || (m.linkedEmail && m.linkedEmail === myEmail())) continue;
    let P;
    try { const d = await getDoc(doc(db, "members", m.id, "private", "notion")); if (!d.exists()) continue; P = d.data(); }
    catch { continue; }
    const patch = { notionAt: m.notionAt };
    if (P.birth && (!s.birth || String(s.birth).startsWith("0000-"))) patch.birth = P.birth;
    if (!s.phone && m.phone) patch.phone = m.phone;
    const fam = [...(s.family || [])], has = (nm) => fam.some(f => f.name === nm);
    if (P.spouse && !has(P.spouse)) fam.push({ relation: "배우자", name: P.spouse, birth: "", faith: "", note: "" });
    for (const k of (P.children || [])) if (k.name && !has(k.name))
      fam.push({ relation: k.relation || "자녀", name: k.name, birth: "", faith: "", note: k.note || "" });
    if (fam.length !== (s.family || []).length) patch.family = fam;
    const lines = notionLines(P).filter(l => !String(s.memo || "").includes(l));
    if (lines.length) patch.memo = [s.memo || "", ...lines].filter(Boolean).join("\n");
    if ((P.roles || []).includes("인턴") && !s.intern) { patch.intern = true; patch.internSince = todayStr(); }
    /* 기도제목 → 기도 기록 (이미 넣은 것은 건너뜀) */
    const done = new Set(s.notionPray || []), added = [];
    for (const pr of (P.prayers || [])) {
      if (!pr.id || done.has(pr.id)) continue;
      const body = [pr.title, pr.body].filter(Boolean).join("\n");
      if (!body) continue;
      try {
        await setDoc(doc(db, "souls", s.id, "records", "np_" + pr.id.replace(/[^A-Za-z0-9_-]/g, "")), {
          type: "pray", scope: sharePrefs().recScope || "leader", date: pr.date || todayStr(), body,
          prayStatus: "praying", by: uid(), byName: me.name || "", fromNotion: true, createdAt: serverTimestamp() });
        done.add(pr.id); added.push({ date: pr.date || todayStr(), text: body });
      } catch (e) { console.warn("기도제목", s.name, e); }
    }
    if (added.length) {
      patch.notionPray = [...done];
      patch.prayOpen = (s.prayOpen || 0) + added.length;
      const oldest = added.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
      if (!s.prayTop || String(oldest.date) < String(s.prayTop.since || "9999")) patch.prayTop = { text: oldest.text, since: oldest.date };
    }
    try { await updateDoc(doc(db, "souls", s.id), patch); Object.assign(s, patch); n++; }
    catch (e) { console.warn("명단 → 카드", s.name, e); }
  }
  if (n) { invalidate(); if (!$("s-home").hidden) renderRooms(); }
}

/* ════════ 24단계 — 셀리더 명단 (수퍼) ════════
   셀마다 셀리더 자리를 한 줄로: 가입함 · 초대 보냄 · 이메일 없음 · 비어 있음.
   이메일 칸에 구글 이메일을 넣고 [초대 보내기]를 누르면 조직 구성의 '자리에 사람 넣기'와 똑같이 초대가 걸립니다.
   그분이 그 구글 계정으로 로그인하면 바로 그 셀 셀리더가 되고, 셀원 목양 카드가 생기며 노션 명단으로 채워져요. */
function dirCountTxt() { return (state.dir && state.dir.length) ? dirPool().length : "—"; }
function leaderSeatCells() {
  const jins = state.jins.filter(j => j.active !== false).map(j => j.id);
  return activeCells().filter(c => jins.includes(c.jinId) && (state.me.role === "super" || c.jinId === state.me.jinId))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko", { numeric: true }));
}
function leaderSeatStats() {
  const st = { n: 0, acc: 0, inv: 0, noe: 0, none: 0 };
  for (const c of leaderSeatCells()) {
    st.n++;
    const ls = seatList("leader", c.jinId, c.id);
    if (!ls.length) st.none++;
    else if (ls.some(p => p.t === "acc")) st.acc++;
    else if (ls.some(p => p.t === "inv")) st.inv++;
    else st.noe++;
  }
  st.txt = st.n ? `가입 ${st.acc} · 초대 ${st.inv} · 이메일 없음 ${st.noe + st.none}` : "셀이 아직 없어요";
  return st;
}
async function openLeaders() {
  if (!state.me || state.me.role !== "super") { toast("셀리더 명단은 수퍼 관리자가 해요."); return; }
  show("s-loading");
  await loadOrg(true);
  $("ld-err").textContent = ""; $("ld-log").textContent = "";
  renderLeaders(); show("s-leaders");
}
function renderLeaders() {
  const st = leaderSeatStats();
  $("ld-sum").innerHTML = `${tile("셀", st.n + "개")}${tile("가입", st.acc + "명")}${tile("초대 보냄", st.inv + "명")}${tile("이메일 없음", (st.noe + st.none) + "곳")}`;
  state.ldRows = [];
  const jins = state.jins.filter(j => j.active !== false);
  $("ld-list").innerHTML = jins.map(j => {
    const cells = leaderSeatCells().filter(c => c.jinId === j.id);
    if (!cells.length) return "";
    return `<div class="card" style="margin-top:12px">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:4px">${esc(j.name)} <span class="muted" style="font-size:12px;font-weight:400">셀 ${cells.length}개</span></h3>
      ${cells.map(c => {
        const ls = seatList("leader", j.id, c.id);
        const n = (state.dir || []).filter(m => m.cellId === c.id && m.active !== false).length;
        const entries = ls.length ? ls : [{ t: "none", name: "" }];
        return entries.map((p, k) => {
          const i = state.ldRows.push({ ...p, jinId: j.id, cellId: c.id }) - 1;
          const head = `<span class="cn">${k ? "" : esc(c.name)}</span>`;
          if (p.t === "acc") return `<div class="lrow">${head}<div class="grow"><p class="nm">${esc(p.name)} <span class="chip ok">가입함</span>${p.sub ? ` <span class="chip">${esc(p.sub)}</span>` : ""}</p>
              <p class="sub">${esc((userOf(p.uid) || {}).email || "")}</p></div><span class="cnt">${k ? "" : n + "명"}</span></div>`;
          if (p.t === "inv") return `<div class="lrow">${head}<div class="grow"><p class="nm">${esc(p.name)} <span class="chip warn">초대 보냄</span></p>
              <p class="sub">${esc(p.email)} · 이 구글 계정으로 로그인하면 바로 들어와요</p></div><span class="cnt">${k ? "" : n + "명"}</span></div>`;
          return `<div class="lrow">${head}<div class="grow ld-in">
              <input data-ldname="${i}" value="${esc(p.name || "")}" placeholder="셀리더 이름" aria-label="${esc(c.name)} 셀리더 이름">
              <input data-ldmail="${i}" type="email" inputmode="email" autocomplete="off" placeholder="구글 이메일" aria-label="${esc(c.name)} 셀리더 구글 이메일">
              <p class="muted" style="font-size:12px">${p.t === "noe" ? "가입 전 — 이메일을 넣으면 초대돼요" : "셀리더 자리가 비어 있어요"}</p>
            </div><span class="cnt">${k ? "" : n + "명"}</span></div>`;
        }).join("");
      }).join("")}
    </div>`;
  }).join("") || `<p class="muted" style="margin-top:14px">아직 셀이 없어요. 조직 구성에서 셀을 만들어 주세요.</p>`;
  syncLeadersBtn();
}
function leaderEdits() {
  const out = [];
  document.querySelectorAll("#ld-list [data-ldname]").forEach(inp => {
    const i = +inp.dataset.ldname, r = state.ldRows[i];
    const name = inp.value.trim(), email = document.querySelector(`#ld-list [data-ldmail="${i}"]`).value.trim().toLowerCase();
    if (!name && !email) return;
    if (!email && r.t === "noe" && name === (r.name || "")) return;   // 바뀐 게 없음
    out.push({ i, r, name, email });
  });
  return out;
}
function syncLeadersBtn() {
  const ed = leaderEdits(), inv = ed.filter(e => e.email).length, only = ed.length - inv;
  $("btn-ld-run").hidden = !ed.length;
  $("btn-ld-run").textContent = inv ? `초대 보내기 (${inv}명)${only ? ` · 이름만 ${only}` : ""}` : `이름만 넣기 (${only})`;
}
$("ld-list").addEventListener("input", () => syncLeadersBtn());
$("ld-back").onclick = () => openHome();
$("btn-home-leaders").onclick = () => openLeaders();
$("btn-ld-org").onclick = () => openOrg();
$("btn-ld-run").onclick = async () => {
  const ed = leaderEdits(); if (!ed.length) return;
  $("ld-err").textContent = "";
  const bad = ed.find(e => !e.name) || ed.find(e => e.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email));
  if (bad) { $("ld-err").textContent = !bad.name ? `${cellNameOf(bad.r.cellId)} — 이름을 적어 주세요.` : `${bad.name} — 이메일 형식을 확인해 주세요.`; return; }
  const mails = ed.filter(e => e.email).map(e => e.email);
  const dup = mails.find((m, k) => mails.indexOf(m) !== k);
  if (dup) { $("ld-err").textContent = `같은 이메일이 두 번 있어요: ${dup}`; return; }
  const inv = mails.length;
  if (inv && !confirm(`${inv}명에게 초대를 걸까요?\n그분이 그 구글 계정으로 로그인하면 바로 그 셀 셀리더로 들어와요.`)) return;
  $("btn-ld-run").disabled = true;
  const fails = []; let okInv = 0, okName = 0;
  for (const e of ed) {
    $("ld-log").textContent = `처리 중… ${okInv + okName + fails.length + 1} / ${ed.length}`;
    try {
      const { r, name, email } = e;
      let m = r.t === "noe" ? r.m : null;
      if (!m) m = (state.dir || []).find(x => x.active !== false && x.jinId === r.jinId && !x.uid && x.name === name
                  && (x.cellId === r.cellId || !x.cellId) && !pendingInvite(x)) || null;
      if (!m) {
        const d = { name, jinId: r.jinId, cellId: null, uid: "", role: "member", linkedEmail: "", careUid: "",
          soulIds: [], trainingsDone: [], active: true, thumb: "", phone: "", gender: "", birthMD: "", lunar: false,
          position: "", registeredAt: "", baptizedAt: "", createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        const ref = await addDoc(collection(db, "members"), d); m = { id: ref.id, ...d }; state.dir.push(m);
      }
      if (m.name !== name) { await updateDoc(doc(db, "members", m.id), { name, updatedAt: serverTimestamp() }); m.name = name; }
      if (email) {
        const res = await sendInvite({ name, email, pick: "leader", jinId: r.jinId, cellId: r.cellId, cellIds: [], memberId: m.id });
        if (res.err) { fails.push(`${name}: ${res.err}`); continue; }
        await updateDoc(doc(db, "members", m.id), { pendingSeat: null }); m.pendingSeat = null;
        await log("셀리더 명단 초대", name, cellNameOf(r.cellId)); okInv++;
      } else {
        const seat = { role: "leader", cellId: r.cellId, cellIds: [] };
        await updateDoc(doc(db, "members", m.id), { pendingSeat: seat, updatedAt: serverTimestamp() }); m.pendingSeat = seat;
        await log("셀리더 명단 이름만", name, cellNameOf(r.cellId)); okName++;
      }
    } catch (err) { fails.push(`${e.name}: ${msgOf(err)}`); }
  }
  $("btn-ld-run").disabled = false;
  await loadOrg(true); renderLeaders();
  $("ld-log").textContent = `끝났어요 — 초대 ${okInv}명${okName ? ` · 이름만 ${okName}` : ""}${fails.length ? ` · 못 한 것 ${fails.length}` : ""}`;
  if (fails.length) $("ld-err").textContent = fails.join(" / ");
  toast(okInv ? "초대를 걸었어요." : "넣었어요.");
};

/* ════════ 25단계 — 셀리더 카드 (셀 관리 · 교회 명부) ════════
   셀마다 셀리더를 맨 위에 사진 · 몇 년생 · 생일 · 연락처 · 가족 · 수료 훈련으로 보여줍니다.
   몇 년생 · 가족은 잠긴 칸(노션 명단)에서 오므로, 잠긴 칸을 볼 수 있는 사람(수퍼 · 그 진 진장 · 코치 ·
   그 셀 셀리더)에게만 보이고 — 본인 것은 본인에게 안 보여요. 보안 규칙이 서버에서 한 번 더 막습니다. */
function cellLeadEntries(c) {
  return seatList("leader", c.jinId, c.id).map(p => {
    let m = null;
    if (p.t === "acc") m = memberOfUid(p.uid);
    else if (p.t === "inv") m = (p.inv && p.inv.memberId && memberById(p.inv.memberId))
      || (state.dir || []).find(x => x.active !== false && x.linkedEmail && x.linkedEmail === p.email) || null;
    else m = p.m || null;
    if (m && m.active === false) m = null;
    return { p, m, cellId: c.id };
  });
}
function leadMemberMap(cells) {
  const mp = new Map();
  for (const c of cells) for (const e of cellLeadEntries(c)) if (e.m && !mp.has(e.m.id)) mp.set(e.m.id, c.id);
  return mp;
}
state.privCache = state.privCache || {};
function privOf(m) {
  if (!canSeePriv(m) || !m.notionAt) return Promise.resolve(null);
  const k = m.id + "|" + m.notionAt;
  if (!state.privCache[k]) state.privCache[k] = getDoc(doc(db, "members", m.id, "private", "notion"))
    .then(d => d.exists() ? d.data() : null).catch(() => null);
  return state.privCache[k];
}
$("cm-list").addEventListener("click", (ev) => {
  if (ev.target.closest("button")) return;
  const r = ev.target.closest("[data-mem]"); if (r) openMember(r.dataset.mem);
});

/* ════════ 26단계 — 화면 넓이에 맞춘 명부 · 칸이 정해진 카드 · 출석 · 진 안에서 캘린더 · 사진 보기 ════════ */
/* 명부 줄 수 — 휴대폰 1줄 · 패드 2줄 · 넓은 컴퓨터 3줄 */
function dirCols() {
  const el = $("dir-list");
  const w = (el && el.clientWidth) || Math.min(1600, window.innerWidth - (window.innerWidth >= 880 ? 224 : 0) - 40);
  return w >= 1180 ? 3 : w >= 700 ? 2 : 1;
}
let dirRz = 0;
window.addEventListener("resize", () => {
  clearTimeout(dirRz);
  dirRz = setTimeout(() => {
    if (!$("s-dir").hidden && state.dirColsNow && dirCols() !== state.dirColsNow) renderDir();
  }, 180);
});
const fbox = (k, v, cls) => v ? `<div class="fbox ${cls || ""}"><p class="fk">${esc(k)}</p><p class="fv">${esc(v)}</p></div>` : "";

/* 카드 한 장 — 자리가 정해진 칸: [생년] [생일] [연락처] (+ 셀) · 수료 훈련 · 출석률 */
const MI_ICON = {
  yr: "",
  bd: `<svg class="mic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6M8 12V9m4 3V9m4 3V9M8 6.5v.01M12 6.5v.01M16 6.5v.01"/></svg>`,
  ph: `<svg class="mic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/></svg>`,
  cl: `<svg class="mic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10.5" r="2.3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 19a4 4 0 0 1 7 0"/></svg>`
};
function memCardHTML(m, o) {
  const me = state.me, e = o.leadEnt, lead = !!e || !!o.lead;
  const chips = [];
  if (e) {
    if (e.p.t === "inv") chips.push(`<span class="chip warn">초대 중</span>`);
    else if (e.p.t === "noe") chips.push(`<span class="chip lock">가입 전</span>`);
    else if (o.mgr) chips.push(`<span class="chip ok">가입함</span>`);
    if (e.p.sub) chips.push(`<span class="chip">${esc(e.p.sub)}</span>`);
  }
  if (m.uid === me.id) chips.push(`<span class="chip rose">나</span>`);
  if (m.intern && !lead) chips.push(`<span class="chip intern">인턴</span>`);
  if (!e && pendingInvite(m)) chips.push(`<span class="chip warn">초대 중</span>`);
  if (handPendingFor(m)) chips.push(`<span class="chip warn">카드 넘어가는 중</span>`);
  const role = lead ? "셀리더" : (m.role && m.role !== "member" ? (ROLEBADGE[m.role] || "") : "");
  const bd = mdText(m.birthMD, m.lunar);
  const yr = canSeePriv(m) && !!m.notionAt;
  const slot = (cls, k, v, attr) => `<div class="mi ${cls}"${attr || ""} title="${k}">${cls in MI_ICON ? MI_ICON[cls] : `<span class="mk">${k}</span>`}<span class="mv">${v ? esc(v) : "<em>—</em>"}</span>${cls === "yr" ? `<span class="mk">년생</span>` : ""}</div>`;
  const cellId = o.cellId || (state.dirLM && state.dirLM.get(m.id)) || m.cellId || "";
  const trs = (m.trainingsDone || []).map(t => `<span class="tpill">${esc(t)}</span>`).join("");
  return `<div class="mcard${lead ? " lead" : ""}${o.twig ? " twig" : ""}" data-mem="${m.id}" data-cell="${cellId}">
    ${avatar(m, lead ? 48 : 44)}
    <div class="mc-body">
      <div class="mc-top">
        <div class="mc-id">${role ? `<p class="mc-role">${esc(role)}${chips.length ? " " + chips.join(" ") : ""}</p>` : ""}
          <p class="mc-nm">${o.rank && m.rank && !lead ? `<span class="rk" title="셀 안 순서">${m.rank}</span>` : ""}${esc(m.name || "")}${!role && chips.length ? " " + chips.join(" ") : ""}</p></div>
        <div class="mc-att" data-att="${m.id}"></div>
      </div>
      <div class="mc-info">
        ${yr ? slot("yr", "생년", "…", ` data-yr="${m.id}"`) : ""}${slot("bd", "생일", bd)}${slot("ph", "연락처", m.phone)}${o.showCell ? slot("cl", "셀", o.cellName) : ""}
      </div>
      <div class="mc-tags" data-tags="${m.id}">${trs}</div>
    </div>
  </div>`;
}
/* 명부 카드가 아직 없는 초대 (이름 · 이메일만) */
function leadGhostHTML(e) {
  return `<div class="mcard lead">
    <span class="ava" style="width:52px;height:52px;font-size:20px">${esc(initial(e.p.name || ""))}</span>
    <div class="mc-body"><div class="mc-top"><div class="mc-id">
      <p class="mc-role">셀리더 <span class="chip warn">초대 중</span></p><p class="mc-nm">${esc(e.p.name || "")}</p></div></div>
      <div class="mc-info"><div class="mi ph"><span class="mk">초대 이메일</span><span class="mv">${esc(e.p.email || "")}</span></div></div></div>
  </div>`;
}
/* 잠긴 칸에서 오는 생년 · 가족 — 볼 수 있는 사람에게만 (본인 · 다른 셀 셀리더는 안 읽어요) */
async function fillCardsPriv(root) {
  const ids = [...new Set([...root.querySelectorAll("[data-yr],[data-fam]")].map(el => el.dataset.yr || el.dataset.fam))];
  await Promise.all(ids.map(async id => {
    const m = memberById(id); if (!m) return;
    const P = await privOf(m); if (!root.isConnected) return;
    const y = String((P && P.birth) || "").slice(0, 4), okY = /^(19|20)\d\d$/.test(y);
    root.querySelectorAll(`[data-yr="${id}"] .mv`).forEach(el => { el.innerHTML = okY ? `${y}` : "<em>—</em>"; });
    if (!P) return;
    const kids = (P.children || []).filter(k => k.name);
    const fam = [P.spouse ? `배우자 ${P.spouse}` : "", kids.length ? `자녀 ${kids.map(k => k.name).join(", ")}` : ""].filter(Boolean);
    root.querySelectorAll(`[data-fam="${id}"]`).forEach(el => { if (fam.length) { el.innerHTML = `<span class="mk">가족</span>${esc(fam.join(" · "))}`; el.hidden = false; } });
  }));
}

/* ── 출석 — 셀 보고 사본(같은 진이 원래 보는 것)에서 셈 ── */
const ATT_DAYS = 92;
async function loadAttReps(force) {
  const me = state.me; if (!me || me.role === "pastor") return [];
  if (!force && state.attRep && Date.now() - (state.attAt || 0) < 10 * 60 * 1000) return state.attRep;
  if (state.attP) return state.attP;
  const jins = me.role === "super" ? [...new Set(dirCellsShown().map(c => c.jinId))] : (me.jinId ? [me.jinId] : []);
  state.attP = (async () => {
    const col = collection(db, "reports"), yms = recentYms(6);
    const rs = await Promise.all(jins.flatMap(j => yms.map(ym =>
      getDocs(query(col, where("jinId", "==", j), where("ym", "==", ym))).then(pack).catch(() => []))));
    const seen = {};
    state.attRep = rs.flat().filter(r => seen[r.id] ? false : (seen[r.id] = true));
    state.attAt = Date.now();
    return state.attRep;
  })();
  try { return await state.attP; } finally { state.attP = null; }
}
const daysAgo26 = (ds) => Math.round((new Date(todayStr()) - new Date(ds)) / 864e5);
const agoText26 = (ds) => { const d = daysAgo26(ds); return d <= 0 ? "오늘" : d < 7 ? `${d}일 전` : d < 60 ? `${Math.round(d / 7)}주 전` : `${Math.round(d / 30)}달 전`; };
function attStats(mid, cellId) {
  const today = todayStr(), from = ymd(new Date(Date.now() - ATT_DAYS * 864e5));
  const reps = (state.attRep || []).filter(r => r.date && r.date <= today
      && ((cellId && r.cellId === cellId) || (r.att && r.att[mid])))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const rec = reps.filter(r => r.att && r.att[mid]);
  const recent = rec.filter(r => r.date >= from);
  const ok = recent.filter(r => r.att[mid] !== "absent").length;
  let streak = 0; for (const r of rec) { if (r.att[mid] === "absent") streak++; else break; }
  const last = rec.find(r => r.att[mid] !== "absent");
  return { n: recent.length, ok, ab: recent.length - ok, rate: recent.length ? Math.round(ok / recent.length * 100) : null,
    streak, last: last ? last.date : "", strip: reps.slice(0, 12).reverse().map(r => ({ date: r.date, v: (r.att || {})[mid] || "" })) };
}
const attTone = (rate) => rate == null ? "none" : rate >= 75 ? "good" : rate >= 50 ? "mid" : "low";
function fillAtt(root) {
  if (!state.attRep || !root.isConnected) return;
  root.querySelectorAll("[data-att]").forEach(el => {
    const card = el.closest("[data-cell]"), id = el.dataset.att;
    const st = attStats(id, card ? card.dataset.cell : "");
    el.className = `mc-att ${attTone(st.rate)}`;
    el.innerHTML = st.rate == null ? `<span class="at-none">출석 기록 없음</span>`
      : `<span class="at-row"><small>${st.ok}/${st.n}</small><b>${st.rate}%</b></span><span class="at-bar"><i style="width:${st.rate}%"></i></span>`;
    el.title = st.rate == null ? "최근 3개월 셀모임 출석 기록이 없어요" : `최근 3개월 셀모임 ${st.n}번 중 ${st.ok}번 출석`;
    const tg = root.querySelector(`[data-tags="${id}"]`);
    if (tg && st.streak >= 2 && !tg.querySelector(".streak"))
      tg.insertAdjacentHTML("afterbegin", `<span class="tpill streak">${st.streak}번 연속 결석</span>`);
  });
  root.querySelectorAll("[data-cellatt]").forEach(el => {
    const cid = el.dataset.cellatt, from = ymd(new Date(Date.now() - ATT_DAYS * 864e5));
    const reps = state.attRep.filter(r => r.cellId === cid && r.date && r.date >= from && r.date <= todayStr());
    let ok = 0, all = 0;
    reps.forEach(r => Object.values(r.att || {}).forEach(v => { if (!v) return; all++; if (v !== "absent") ok++; }));
    const base = el.textContent.split(" · ")[0];
    if (reps.length) { el.textContent = `${base} · 셀모임 ${reps.length}번 · 평균 출석 ${Math.round(ok / Math.max(all, 1) * 100)}%`; el.classList.remove("warn"); return; }
    const lastRep = state.attRep.filter(r => r.cellId === cid && r.date && r.date <= todayStr()).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const md = lastRep ? lastRep.date.split("-") : null;
    el.textContent = `${base} · 최근 3개월 셀 보고 없음${md ? ` (마지막 ${Number(md[1])}/${Number(md[2])})` : ""}`;
    el.classList.add("warn");
  });
}
/* 명부 카드 — 출석 현황 */
async function showMbAtt(m) {
  const box = $("mb-att"); if (!box) return;
  box.innerHTML = "";
  if (state.me.role === "pastor") return;
  const cellId = m.cellId || (state.dirLM && state.dirLM.get(m.id)) || "";
  box.innerHTML = `<p class="mb-sec">셀모임 출석 <span>최근 3개월</span></p><p class="muted" style="font-size:12px">불러오는 중…</p>`;
  await loadAttReps();
  if (!state.mb || state.mb.id !== m.id) return;
  const st = attStats(m.id, cellId);
  if (!st.strip.length && !st.n) { box.innerHTML = `<p class="mb-sec">셀모임 출석</p><p class="muted" style="font-size:12px">아직 셀모임 출석 기록이 없어요.</p>`; return; }
  const lab = { present: "출석", online: "온라인", absent: "결석", "": "기록 없음" };
  const md = (d) => { const p = String(d).split("-"); return `${Number(p[1])}/${Number(p[2])}`; };
  box.innerHTML = `<p class="mb-sec">셀모임 출석 <span>최근 3개월</span></p>
    <div class="atiles">
      <div class="atile ${attTone(st.rate)}"><p class="k">출석률</p><p class="v">${st.rate == null ? "—" : st.rate + "%"}</p><p class="s">${st.n ? `${st.ok} / ${st.n}번` : "기록 없음"}</p></div>
      <div class="atile"><p class="k">마지막 출석</p><p class="v">${st.last ? md(st.last) : "—"}</p><p class="s">${st.last ? agoText26(st.last) : "&nbsp;"}</p></div>
      <div class="atile ${st.streak >= 2 ? "low" : ""}"><p class="k">연속 결석</p><p class="v">${st.streak}번</p><p class="s">${st.streak >= 2 ? "연락해 볼 때예요" : "&nbsp;"}</p></div>
    </div>
    <div class="astrip" aria-label="최근 셀모임 ${st.strip.length}번 출석">
      ${st.strip.map(x => `<span class="ad ${x.v || "nr"}" title="${esc(fmtDate(x.date, true))} ${lab[x.v] || ""}"><i></i><small>${md(x.date)}</small></span>`).join("")}
    </div>
    <p class="alegend"><span class="ad present"><i></i></span>출석 <span class="ad online"><i></i></span>온라인 <span class="ad absent"><i></i></span>결석 <span class="ad nr"><i></i></span>기록 없음</p>`;
}

/* ── 진 안에서 서로의 캘린더 · 사진 ──
   셀모임은 셀 보고 사본(같은 진이 원래 보는 것)에서, 만남 일정은 calShare(날짜 · 시간 · 종류만)에서.
   목양 카드 · 기록 · 1:1 만남 사진은 그대로 맡은 사람만 봐요. */
function peerLeaders() {
  const me = state.me; if (!me || me.role === "pastor") return [];
  return (state.members || []).filter(u => u.active !== false && u.id !== me.id && u.jinId
      && (u.role === "leader" || u.isLeader === true) && (me.role === "super" || u.jinId === me.jinId))
    .sort((a, b) => cellOrder({ name: cellNameOf(a.cellId) || "~" }, { name: cellNameOf(b.cellId) || "~" })
      || (a.name || "").localeCompare(b.name || "", "ko"));
}
/* 28단계 — 같은 진 셀마다 한 칸: 가입한 셀리더는 눌러서 보기, 가입 전은 흐리게 ('가입 전') */
function peerCells() {
  const me = state.me; if (!me || me.role === "pastor") return [];
  return activeCells().filter(c => me.role === "super" || c.jinId === me.jinId).map(c => {
    let e = null; try { e = cellLeadEntries(c)[0]; } catch {}
    if (!e) return null;
    const lu = e.p.t === "acc" ? e.p.uid : "";
    if (lu && lu === me.id) return null;          // 내 셀은 '내 …'
    return { c, uid: lu, name: (e.m && e.m.name) || e.p.name || "", st: e.p.t };
  }).filter(Boolean);
}
function whoChips(elId, hintId, cur, mineLabel, hint) {
  const ps = peerCells(), el = $(elId), h = $(hintId);
  if (!ps.length) { el.hidden = true; h.hidden = true; return; }
  el.hidden = false;
  const mine = !cur || cur === uid();
  el.innerHTML = `<button type="button" data-who="" class="${mine ? "on" : ""}"><span>${mineLabel}</span></button>`
    + ps.map(p => p.uid
      ? `<button type="button" data-who="${p.uid}" class="${cur === p.uid ? "on" : ""}"><span>${esc(p.c.name)}</span><small>${esc(p.name)}</small></button>`
      : `<button type="button" class="wait" data-whowait="${esc(p.name)}" title="${esc(p.name)} 셀리더 — 아직 가입 전"><span>${esc(p.c.name)}</span><small>${esc(p.name)} · ${p.st === "inv" ? "초대 중" : "가입 전"}</small></button>`).join("");
  const u = !mine ? userOf(cur) : null;
  h.hidden = !u; if (u) h.textContent = hint(u);
}
document.addEventListener("click", (ev) => {
  const w = ev.target.closest("[data-whowait]"); if (!w) return;
  toast(`${w.dataset.whowait} 셀리더가 아직 앱에 가입 전이에요. 셀리더 명단에서 초대하고, 그분이 로그인하면 볼 수 있어요.`);
});
async function otherReps(id, force) {
  state.otherReps = state.otherReps || {};
  const c = state.otherReps[id];
  if (!force && c && Date.now() - c.at < 5 * 60 * 1000) return c;
  const u = userOf(id); if (!u) return null;
  const col = collection(db, "reports");
  let reps = [];
  try {
    reps = pack(await getDocs(u.cellId ? query(col, where("jinId", "==", u.jinId), where("cellId", "==", u.cellId))
      : query(col, where("jinId", "==", u.jinId), where("leaderUid", "==", u.id))));
  } catch (e) { toast(msgOf(e)); }
  return (state.otherReps[id] = { at: Date.now(), u, reps });
}
/* 캘린더 */
const calOther = () => !!state.calWho && state.calWho !== uid();
async function loadOtherCal(id) {
  const R = await otherReps(id); if (!R) { state.calWho = ""; return; }
  let items = [], off = false;
  try { const d = await getDoc(doc(db, "calShare", id)); if (d.exists()) { items = d.data().items || []; off = d.data().on === false; } } catch {}
  state.calOtherData = { u: R.u, reps: R.reps, items, off };
}
function otherCalEvents() {
  const D = state.calOtherData; if (!D) return [];
  const ev = [];
  D.reps.forEach(r => ev.push({ date: r.date, kind: "meeting", color: "#F24557", title: `${r.cellName || cellNameOf(r.cellId)} 셀모임`,
    sub: r.topic || "", time: r.time || "", timeEnd: r.timeEnd || "", place: r.place || "", rep: r }));
  D.items.forEach(x => ev.push({ date: x.d, kind: x.p ? "plan" : "record", color: x.p ? "#E8B473" : "#7FCB9B",
    title: `${x.p ? "[예정] " : ""}${x.k || "만남"}`, sub: "", time: x.t || "", timeEnd: x.te || "", place: "" }));
  const y = Number(state.calMonth.split("-")[0]);
  if (D.u.cellId) (state.dir || []).filter(m => m.active !== false && m.cellId === D.u.cellId && m.birthMD).forEach(m => {
    const [mm, dd] = String(m.birthMD).split("-");
    ev.push({ date: `${y}-${mm}-${dd}`, kind: "anniv", color: "#E8B473", title: `${m.name} 생일${m.lunar ? " (음력)" : ""}`, sub: "" });
  });
  return ev;
}
function renderCalWho() {
  whoChips("cal-who", "cal-who-hint", state.calWho, canLead() ? "내 캘린더" : "나",
    (u) => `${cellNameOf(u.cellId) || ""} ${u.name} 님 캘린더 — 셀모임 · 만남 일정 · 셀원 생일. 만남은 날짜 · 시간 · 종류만 보여요.`
      + (state.calOtherData && state.calOtherData.off ? " (만남 일정 공유는 꺼 두셨어요)" : ""));
}
function renderOtherDay(list) {
  $("cal-day-list").innerHTML = list.length ? list.map(e => `
    <div class="row">
      <i style="width:8px;height:8px;border-radius:999px;background:${e.color};flex-shrink:0"></i>
      <div class="grow"><p class="nm">${esc(e.title)}</p>
        <p class="sub">${[fmtSpan(e.time, e.timeEnd), e.place, e.sub].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</p></div>
      ${e.rep ? `<button class="btn-sm" data-gorep="${e.rep.cellId}">보고 보기</button>` : ""}
    </div>`).join("") : `<p class="muted">이 날은 일정이 없어요.</p>`;
}
$("cal-who").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-who]"); if (!b) return;
  state.calWho = b.dataset.who || "";
  if (calOther()) { b.disabled = true; await loadOtherCal(state.calWho); b.disabled = false; }
  renderCal();
});
$("cal-day-list").addEventListener("click", (ev) => {
  const r = ev.target.closest("[data-gorep]"); if (r) openReports(r.dataset.gorep);
});
/* 내 만남 일정 → calShare (날짜 · 시간 · 종류만, 120일 전 ~ 240일 뒤) */
async function syncCalShare(force) {
  const me = state.me; if (!me || !canLead() || !me.jinId || !state.allRecords) return;
  const on = sharePrefs().calPeers !== false;
  const lo = ymd(new Date(Date.now() - 120 * 864e5)), hi = ymd(new Date(Date.now() + 240 * 864e5));
  const seen = new Set(), items = [];
  if (on) for (const r of state.allRecords) {
    if (r.type !== "meet" || r.by !== uid() || r.away || r.meetingId || r.scope === "private" || !r.date || r.date < lo || r.date > hi) continue;
    const k = r.groupId || (r.soulId + "|" + r.id); if (seen.has(k)) continue; seen.add(k);
    items.push({ d: r.date, t: r.time || "", te: r.timeEnd || "", k: String(meetLabel(r) || "만남").slice(0, 40), p: r.planned ? 1 : 0 });
  }
  items.sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
  const out = items.slice(-400), key = JSON.stringify([me.jinId, on, out]);
  if (!force && state.calShareKey === key) return;
  const ref = doc(db, "calShare", uid());
  try { const o = await getDoc(ref);
    if (o.exists()) { const d = o.data(); if (JSON.stringify([d.jinId, d.on, d.items || []]) === key) { state.calShareKey = key; return; } } } catch {}
  await setDoc(ref, { jinId: me.jinId, name: me.name || "", cellId: me.cellId || "", items: out, on, updatedAt: serverTimestamp() });
  state.calShareKey = key;
}
/* 사진 */
const phOther = () => !!state.phWho && state.phWho !== uid();
async function loadOtherPhotos(id) { const R = await otherReps(id); if (!R) state.phWho = ""; else state.phOtherData = R; }
function renderPhWho() {
  whoChips("ph-who", "ph-who-hint", state.phWho, canLead() ? "내 사진" : "나",
    (u) => `${cellNameOf(u.cellId) || ""} ${u.name} 님 셀 — 셀원 얼굴(명부 사진) · 셀모임 사진. 1:1 만남 사진은 맡은 사람만 봐요.`);
}
function renderOtherPhotos() {
  const D = state.phOtherData; if (!D) return;
  $("ph-cells").hidden = true;
  const mt = document.querySelector('#ph-tabs [data-pht="meet"]'); mt.hidden = true;
  if (state.phTab === "meet") state.phTab = "all";
  $("ph-tabs").querySelectorAll("[data-pht]").forEach(b => b.classList.toggle("on", b.dataset.pht === state.phTab));
  const faces = D.u.cellId ? (state.dir || []).filter(m => m.active !== false && m.cellId === D.u.cellId && m.thumb) : [];
  const shots = D.reps.filter(r => (r.photos || []).length).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const nShot = shots.reduce((n, r) => n + r.photos.length, 0);
  $("ph-sum").innerHTML = `<div class="tiles" style="margin-top:14px">${tile("얼굴", faces.length + "명")}${tile("셀모임", nShot + "장")}${tile("셀모임 횟수", shots.length + "번")}</div>`;
  const T = state.phTab, parts = [];
  if ((T === "all" || T === "face") && faces.length) parts.push(`
    <div class="gset"><p class="gh"><span>셀원 얼굴 (명부 사진)</span><span>${faces.length}명</span></p>
      <div class="faces">${faces.map(m => `<button type="button" data-mface="${m.id}" aria-label="${esc(m.name)} 얼굴 크게 보기">${avatar(m, 60)}<span>${esc(m.name)}</span></button>`).join("")}</div></div>`);
  if (T === "all" || T === "cell") shots.forEach(r => parts.push(`
    <div class="gset"><p class="gh"><span>${fmtDate(r.date, true)} · ${esc(r.cellName || cellNameOf(r.cellId))} 셀모임${r.topic ? " · " + esc(r.topic) : ""}</span><span>${r.photos.length}장</span></p>
      <div class="gal">${r.photos.map((p, i) => `<button type="button" data-rpph="${r.id}|${i}" style="background-image:url(${p.thumb})" aria-label="셀모임 사진 ${i + 1} 크게 보기"></button>`).join("")}</div></div>`));
  $("ph-body").innerHTML = parts.join("")
    || `<p class="muted" style="margin-top:18px">아직 볼 수 있는 사진이 없어요. (셀모임 사진이 없거나, 셀리더가 사진 공유를 꺼 두었을 수 있어요)</p>`;
}
$("ph-who").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-who]"); if (!b) return;
  state.phWho = b.dataset.who || "";
  if (phOther()) { b.disabled = true; await loadOtherPhotos(state.phWho); b.disabled = false; }
  renderPhotos();
});
$("ph-body").addEventListener("click", (ev) => {
  const f = ev.target.closest("[data-mface]");
  if (f) { const m = memberById(f.dataset.mface); if (m) { $("pv-img").src = m.thumb; $("photo-view").showModal(); } return; }
  const r = ev.target.closest("[data-rpph]");
  if (r && state.phOtherData) {
    const [rid, i] = r.dataset.rpph.split("|"); const rep = state.phOtherData.reps.find(x => x.id === rid);
    if (rep && rep.photos[Number(i)]) showMeetPhoto(rep.photos[Number(i)]);
  }
});

/* ════════ 27단계 — 화면 밝기 (다크 · 라이트 · 기기 설정) ════════ */
function themePref() { try { return localStorage.getItem("mokja-theme") || "dark"; } catch { return "dark"; } }
function applyTheme(pref) {
  const t = pref === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === "light" ? "#F5F3F2" : "#0F0F0F";
  document.querySelectorAll("#more-theme [data-theme]").forEach(b => b.classList.toggle("on", b.dataset.theme === pref));
}
$("more-theme").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-theme]"); if (!b) return;
  try { localStorage.setItem("mokja-theme", b.dataset.theme); } catch {}
  applyTheme(b.dataset.theme);
});
try { matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (themePref() === "system") applyTheme("system"); }); } catch {}
applyTheme(themePref());

/* 27단계 — 셀 고르는 칸: 셀 번호 아래 늘 셀리더 이름 */
function cellLeadName(c) {
  try { const e = cellLeadEntries(c)[0]; return e ? ((e.m && e.m.name) || e.p.name || "") : ""; } catch { return ""; }
}
function cellChipIn(c) {
  const n = cellLeadName(c);
  return `<span>${esc(c.name)}</span>${n ? `<small>${esc(n)}</small>` : ""}`;
}

/* 27단계 — 셀 보고 옆 칸: 셀 하나 → 셀리더 · 출석 그래프 · 셀모임 캘린더 / 모든 셀 → 셀별 출석률 막대 */
const repTone = (rate) => rate == null ? "" : rate >= 75 ? "" : rate >= 50 ? "mid" : "low";
function renderRepSide() {
  const f = state.repF || {}, rows = (state.reps || []).filter(r => r.date && r.date <= todayStr());
  const side = $("rep-side"), wrap = $("rep-wrap");
  if (!rows.length) { side.innerHTML = ""; wrap.classList.remove("has-side"); return; }
  wrap.classList.add("has-side");
  if (!f.cellId) {
    const by = {};
    rows.forEach(r => { const c = repCount(r); const o = by[r.cellId] = by[r.cellId] || { n: 0, ok: 0, all: 0 }; o.n++; o.ok += c.ok; o.all += c.all; });
    const cells = repCells().filter(c => by[c.id]);
    side.innerHTML = `<div class="rs-card"><div class="rs-h"><b>셀별 출석률</b><span>최근 ${REP_MONTHS}달 보고</span></div>
      ${cells.map(c => { const o = by[c.id], rate = o.all ? Math.round(o.ok / o.all * 100) : null;
        return `<div class="hbar2 ${repTone(rate)}" data-repc2="${c.id}" title="${esc(c.name)} — 보고 ${o.n}건">
          <span class="nm">${esc(c.name)}<small>${esc(cellLeadName(c))} · ${o.n}번</small></span>
          <span class="tr"><i style="width:${rate || 0}%"></i></span><span class="v">${rate == null ? "—" : rate + "%"}</span></div>`; }).join("")}
      <p class="hint" style="margin-top:8px">셀을 누르면 그 셀의 출석 그래프와 캘린더가 보여요.</p></div>`;
    return;
  }
  const c = state.cells.find(x => x.id === f.cellId) || { id: f.cellId, name: cellNameOf(f.cellId) };
  const asc = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = asc.slice(-16);
  const recent = asc.filter(r => r.date >= ymd(new Date(Date.now() - 92 * 864e5)));
  let ok = 0, all = 0; recent.forEach(r => { const k = repCount(r); ok += k.ok; all += k.all; });
  const rate = all ? Math.round(ok / all * 100) : null, avg = recent.length ? Math.round(ok / recent.length * 10) / 10 : null;
  const max = Math.max(1, ...last.map(r => repCount(r).all));
  const md = (d) => { const p = String(d).split("-"); return `${Number(p[1])}/${Number(p[2])}`; };
  const lead = cellLeadName(c);
  const ym = state.repCalYm && rows.some(r => ymOf(r.date) === state.repCalYm) ? state.repCalYm : (state.repCalYm || ymOf(asc[asc.length - 1].date));
  state.repCalYm = ym;
  side.innerHTML = `
    <div class="rs-card">
      <div class="rs-lead"><span class="cbadge">${esc(c.name)}</span><div><p class="nm">${lead ? esc(lead) + " 셀리더" : "셀리더 미정"}</p>
        <p class="sub">보고 ${rows.length}건 · 첫 보고 ${fmtDate(asc[0].date)}</p></div></div>
      <div class="rs-kpi"><div><p>최근 3달 셀모임</p><b>${recent.length}번</b></div>
        <div><p>평균 출석</p><b>${avg == null ? "—" : avg + "명"}</b></div>
        <div><p>출석률</p><b style="color:${rate == null ? "inherit" : rate >= 75 ? "var(--ok-tx)" : rate >= 50 ? "var(--warn-tx)" : "var(--rose-tx)"}">${rate == null ? "—" : rate + "%"}</b></div></div>
    </div>
    <div class="rs-card"><div class="rs-h"><b>출석 그래프</b><span>최근 셀모임 ${last.length}번 · 초록 = 출석, 회색 = 기록한 인원</span></div>
      <div class="vbars">${last.map(r => { const k = repCount(r), lowc = k.all && k.ok / k.all < .5;
        return `<div class="vb${lowc ? " low" : ""}" title="${esc(fmtDate(r.date, true))} 출석 ${k.ok}/${k.all}">
          <i class="all" style="height:${k.all / max * 100}%"></i><i class="ok" style="height:${k.ok / max * 100}%"></i></div>`; }).join("")}</div>
      <div class="vlabels">${last.map((r, i) => `<span>${i % 2 === (last.length - 1) % 2 ? md(r.date) : ""}</span>`).join("")}</div>
    </div>
    <div class="rs-card" id="rep-cal">${repCalHTML(ym, rows)}</div>`;
}
function repCalHTML(ym, rows) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
  const byDay = {}; rows.filter(r => ymOf(r.date) === ym).forEach(r => { byDay[Number(r.date.slice(8, 10))] = r; });
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(`<span></span>`);
  for (let d = 1; d <= days; d++) {
    const r = byDay[d], ds = `${ym}-${pad2(d)}`;
    if (r) { const k = repCount(r), lowc = k.all && k.ok / k.all < .5;
      cells.push(`<button type="button" class="d on${lowc ? " low" : ""}${ds === todayStr() ? " today" : ""}" data-repday="${r.date}" title="${esc(fmtDate(r.date, true))} 출석 ${k.ok}/${k.all}">✓<small>${d} · ${k.ok}명</small></button>`); }
    else cells.push(`<span class="d${ds === todayStr() ? " today" : ""}">${d}</span>`);
  }
  const n = Object.keys(byDay).length;
  return `<div class="rcal-nav"><button type="button" data-repym="-1" aria-label="이전 달">‹</button>
      <b>${y}년 ${m}월 <span class="muted" style="font-weight:400;font-size:12px">셀모임 ${n}번</span></b>
      <button type="button" data-repym="1" aria-label="다음 달">›</button></div>
    <div class="rcal">${["일","월","화","수","목","금","토"].map(w => `<span class="wd">${w}</span>`).join("")}${cells.join("")}</div>`;
}
$("rep-side").addEventListener("click", async (ev) => {
  const nav = ev.target.closest("[data-repym]");
  if (nav) { const [y, m] = state.repCalYm.split("-").map(Number); const d = new Date(y, m - 1 + Number(nav.dataset.repym), 1);
    state.repCalYm = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    $("rep-cal").innerHTML = repCalHTML(state.repCalYm, (state.reps || []).filter(r => r.date && r.date <= todayStr())); return; }
  const day = ev.target.closest("[data-repday]");
  if (day) { const row = $("rep-list").querySelector(`[data-repdate="${day.dataset.repday}"]`);
    if (row) { row.scrollIntoView({ behavior: "smooth", block: "center" }); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1600); } return; }
  const c2 = ev.target.closest("[data-repc2]");
  if (c2) { const b = $("rep-chips").querySelector(`[data-repc="${c2.dataset.repc2}"]`); if (b) b.click(); }
});

/* 27단계 — 같은 진 다른 셀 활동 통계 (셀 보고 사본 + 캘린더 공유의 횟수 · 종류만) */
const stOther = () => !!state.stWho && state.stWho !== uid();
async function loadOtherStats(id) {
  const R = await otherReps(id); if (!R) { state.stWho = ""; return; }
  let items = [], off = false;
  try { const d = await getDoc(doc(db, "calShare", id)); if (d.exists()) { items = d.data().items || []; off = d.data().on === false; } } catch {}
  state.stOtherData = { u: R.u, reps: R.reps, items, off };
}
function renderOtherStats() {
  const D = state.stOtherData; if (!D) return;
  const from = statsFrom(state.st.per), to = todayStr(), inP = (d) => !!d && d >= from && d <= to;
  const reps = D.reps.filter(r => inP(r.date)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let ok = 0, all = 0; reps.forEach(r => { const k = repCount(r); ok += k.ok; all += k.all; });
  const meets = D.items.filter(x => !x.p && inP(x.d));
  const kinds = {}; meets.forEach(x => { kinds[x.k || "만남"] = (kinds[x.k || "만남"] || 0) + 1; });
  const krows = [{ label: "셀모임", n: reps.length, cell: true }, ...Object.entries(kinds).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n)];
  const kmax = Math.max(1, ...krows.map(k => k.n));
  /* 달마다 — 셀모임 · 만남 */
  const months = {}; reps.forEach(r => { const m = ymOf(r.date); (months[m] = months[m] || { c: 0, m: 0 }).c++; });
  meets.forEach(x => { const m = ymOf(x.d); (months[m] = months[m] || { c: 0, m: 0 }).m++; });
  const mk = Object.keys(months).sort().slice(-12), mmax = Math.max(1, ...mk.map(k => months[k].c + months[k].m));
  $("st-tiles").innerHTML = `
    <div class="tiles" style="margin-top:14px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
      ${tile("셀모임", reps.length + "회")}
      ${tile("평균 출석률", all ? Math.round(ok / all * 100) + "%" : "—")}
      ${tile("평균 출석", reps.length ? Math.round(ok / reps.length * 10) / 10 + "명" : "—")}
      ${tile("만남 · 1:1 등", D.off ? "공유 꺼짐" : meets.length + "회")}
    </div>`;
  $("st-kinds").innerHTML = `
    <div class="card" style="margin-top:14px">
      <h3 style="font-size:13px;font-weight:600">종류별 모임 횟수</h3>
      <p class="muted" style="font-size:12px;margin-top:4px">${D.off ? "이 셀리더는 만남 일정 공유를 꺼 두어서 셀모임만 보여요." : "만남은 셀리더가 공유한 날짜 · 종류로만 셉니다."}</p>
      <div style="margin-top:10px">${krows.map(k => `
        <div class="kbar" title="${esc(k.label)} ${k.n}회"><span>${esc(k.label)}</span>
          <div><div class="t" style="width:${Math.max(1, k.n / kmax * 100)}%;background:${k.cell ? "var(--c-cell)" : "var(--c-one)"}"></div></div>
          <span style="text-align:right;font-variant-numeric:tabular-nums">${k.n}</span></div>`).join("")}</div>
    </div>
    ${mk.length ? `<div class="card" style="margin-top:12px">
      <h3 style="font-size:13px;font-weight:600">달마다 — <span style="color:var(--c-cell)">셀모임</span> · <span style="color:var(--c-one)">만남</span></h3>
      <div class="vbars" style="height:110px;margin-top:10px">${mk.map(k => { const o = months[k];
        return `<div class="vb" title="${k} 셀모임 ${o.c} · 만남 ${o.m}"><i class="ok" style="height:${o.m / mmax * 100}%;background:var(--c-one);border-radius:0"></i><i class="ok" style="height:${o.c / mmax * 100}%;background:var(--c-cell)"></i></div>`; }).join("")}</div>
      <div class="vlabels">${mk.map(k => `<span>${Number(k.slice(5))}월</span>`).join("")}</div></div>` : ""}`;
}
$("st-who").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-who]"); if (!b) return;
  state.stWho = b.dataset.who || "";
  if (stOther()) { b.disabled = true; await loadOtherStats(state.stWho); b.disabled = false; }
  renderStats();
});

/* ════════ 27단계 — 구글 캘린더 자동 넣기 ════════
   셀리더가 한 번 '연결'하면, 그 사람 구글 캘린더에 앱이 만든 '목자의 삶' 캘린더가 생기고
   셀모임 · 만남 · 예정 · 훈련 · 기념일이 들어갑니다. 앱에서 고치거나 지우면 구글 캘린더도 따라 바뀌어요.
   권한은 '앱이 만든 캘린더만' (calendar.app.created) — 다른 캘린더는 못 보고 못 건드려요.
   내용(만남 기록 · 기도)은 넣지 않고 제목 · 시간 · 장소만 넣습니다.
   서버가 없어서 구글 허락(토큰)이 1시간이면 끝나요 — 그 뒤엔 한 번 눌러 다시 맞춥니다. */
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const GAPI = "https://www.googleapis.com/calendar/v3";
state.gcal = { doc: null, token: "", exp: 0, busy: false, need: false, last: "", err: "" };
function gcalTok() {
  const g = state.gcal;
  if (g.token && Date.now() < g.exp - 60000) return g.token;
  try { const o = JSON.parse(sessionStorage.getItem("mokja-gtok") || "null");
    if (o && o.uid === uid() && Date.now() < o.exp - 60000) { g.token = o.t; g.exp = o.exp; return o.t; } } catch {}
  return "";
}
function gcalSetTok(t) {
  state.gcal.token = t; state.gcal.exp = Date.now() + 55 * 60 * 1000;
  try { sessionStorage.setItem("mokja-gtok", JSON.stringify({ uid: uid(), t, exp: state.gcal.exp })); } catch {}
}
async function gcalDoc(force) {
  if (!force && state.gcal.doc !== null) return state.gcal.doc;
  try { const d = await getDoc(doc(db, "gcal", uid())); state.gcal.doc = d.exists() ? d.data() : false; }
  catch { state.gcal.doc = false; }
  return state.gcal.doc;
}
/* 반드시 누른 순간에 불러야 해요 (팝업) */
function gcalConnect() {
  const u = auth.currentUser;
  if (!u || !(u.providerData || []).some(p => p.providerId === "google.com"))
    return Promise.reject(new Error("구글 계정으로 로그인한 분만 연결할 수 있어요."));
  const p = new GoogleAuthProvider(); p.addScope(GCAL_SCOPE);
  p.setCustomParameters({ login_hint: (state.me && state.me.email) || u.email || "" });
  return reauthenticateWithPopup(u, p).then(res => {
    const cred = GoogleAuthProvider.credentialFromResult(res);
    if (!cred || !cred.accessToken) throw new Error("구글 캘린더 허락을 받지 못했어요.");
    gcalSetTok(cred.accessToken);
  }).catch(e => {
    if (e && e.code === "auth/user-mismatch") throw new Error("앱에 로그인한 구글 계정으로 골라 주세요.");
    if (e && (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request")) throw new Error("연결을 취소했어요.");
    if (e && e.code === "auth/popup-blocked") throw new Error("팝업이 막혔어요. 브라우저에서 팝업을 허용해 주세요.");
    throw e;
  });
}
async function gapi(method, path, body) {
  const r = await fetch(GAPI + path, { method, headers: { Authorization: "Bearer " + gcalTok(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) {
    state.gcal.token = ""; state.gcal.exp = 0; try { sessionStorage.removeItem("mokja-gtok"); } catch {}
    const e = new Error("구글 연결 시간이 끝났어요"); e.code = 401; throw e;
  }
  if (!r.ok) {
    const t = await r.text().catch(() => ""); let j = null; try { j = JSON.parse(t); } catch {}
    const er = (j && j.error) || {}, why = JSON.stringify(er);
    let msg = `구글 캘린더 오류 ${r.status}${er.message ? " — " + er.message : ""}`;
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used/.test(why))
      msg = "구글 클라우드에서 'Google Calendar API'가 아직 꺼져 있어요. 설정 안내 ①번([사용] 누르기)을 해 주세요. 켠 뒤 몇 분 지나 다시 눌러 주세요.";
    else if (/SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/.test(why)) {
      msg = "구글 창에서 '캘린더' 허용 체크가 빠졌어요. [다시 연결하고 맞추기]를 눌러 캘린더 칸을 체크해 주세요. (설정 안내 ②번 — 범위 추가도 확인)";
      state.gcal.token = ""; state.gcal.exp = 0; try { sessionStorage.removeItem("mokja-gtok"); } catch {}
    }
    else if (r.status === 403 && /rateLimit|quota/i.test(why)) msg = "구글이 잠시 쉬어 가래요. 1분 뒤 다시 눌러 주세요.";
    const e = new Error(msg); e.code = r.status; e.detail = t.slice(0, 300); throw e;
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}
function fnvHex(str) {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (const ch of String(str)) { const c = ch.codePointAt(0); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822507) >>> 0; }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
const GC_COLOR = { meeting: "11", record: "10", plan: "5", anniv: "6", train: "3" };
function gcalAlarms(kind) {
  if (kind === "anniv") return [{ method: "popup", minutes: 15 * 60 }];   // 하루 종일 일정 — 전날 오전 9시
  return (ALARM[kind] || ["-PT1H"]).map(t => {
    const m = /-P(?:T)?(\d+)([DHM])/.exec(t); if (!m) return null;
    const n = Number(m[1]); return { method: "popup", minutes: m[2] === "D" ? n * 1440 : m[2] === "H" ? n * 60 : n };
  }).filter(Boolean);
}
/* 구글 캘린더로 갈 일정 — 60일 전 ~ 400일 뒤 (기념일은 해마다 반복) */
function gcalWant() {
  const saveM = state.calMonth, saveW = state.calWho;
  state.calMonth = `${new Date().getFullYear()}-01`; state.calWho = "";
  let ev; try { ev = calEvents(); } finally { state.calMonth = saveM; state.calWho = saveW; }
  const lo = ymd(new Date(Date.now() - 60 * 864e5)), hi = ymd(new Date(Date.now() + 400 * 864e5));
  const out = [], seen = new Set();
  for (const e of ev) {
    if (!e.date || (e.kind !== "anniv" && (e.date < lo || e.date > hi))) continue;
    const soul = e.soulId ? state.souls.find(x => x.id === e.soulId) : null;
    const lunar = e.kind === "anniv" && soul && soul.lunar && /생일$/.test(e.title);
    const key = e.kind === "meeting" ? `m|${e.id}`
      : (e.kind === "record" || e.kind === "plan") ? `r|${e.r.groupId || (e.r.soulId + "/" + e.r.id)}`
      : e.kind === "anniv" ? `a|${e.soulId}|${e.title}${lunar ? "|" + e.date : ""}`
      : `t|${e.soulId}|${e.title}|${e.date}`;
    if (seen.has(key)) continue; seen.add(key);
    const id = "mj" + fnvHex(key);
    let start, end;
    if (e.time) {
      const st = `${e.date}T${e.time}:00`, en = endStamp(e);
      start = { dateTime: st, timeZone: "Asia/Seoul" };
      end = { dateTime: `${en.slice(0, 4)}-${en.slice(4, 6)}-${en.slice(6, 8)}T${en.slice(9, 11)}:${en.slice(11, 13)}:00`, timeZone: "Asia/Seoul" };
    } else {
      const nx = new Date(e.date + "T00:00:00"); nx.setDate(nx.getDate() + 1);
      start = { date: e.date }; end = { date: ymd(nx) };
    }
    const body = { id, summary: e.title + (lunar ? " (음력)" : ""), start, end,
      description: "목자의 삶 앱이 넣은 일정이에요. 내용은 앱에서 봐요.\nhttps://artist4rhythm-hub.github.io/mokyang-note/",
      colorId: GC_COLOR[e.kind] || "8", reminders: { useDefault: false, overrides: gcalAlarms(e.kind) },
      extendedProperties: { private: { mokja: "1" } } };
    if (e.place) body.location = e.place;
    if (e.kind === "anniv" && !lunar) body.recurrence = ["RRULE:FREQ=YEARLY"];
    out.push({ id, h: fnvHex(JSON.stringify(body)), body });
  }
  return out;
}
async function gcalPool(items, n, fn) {
  let i = 0; const errs = [];
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) { errs.push(e); if (e.code === 401) return; } }
  }));
  return errs;
}
async function gcalSync(again) {
  const g = state.gcal; if (g.busy) return;
  const D = await gcalDoc(); if (!D || !D.on) return;
  if (!gcalTok()) { g.need = true; renderGcal(); return; }
  g.busy = true; g.err = ""; renderGcal();
  try {
    await Promise.all([loadMeetings(), loadSouls()]); await loadAllRecords(); await loadAllTrainings();
    let calId = D.calId;
    if (!calId) {
      const c = await gapi("POST", "/calendars", { summary: "목자의 삶", description: "목자의 삶 앱이 넣는 셀모임 · 만남 일정", timeZone: "Asia/Seoul" });
      calId = c.id; D.map = {};
    }
    const cal = encodeURIComponent(calId), map = D.map || {}, want = gcalWant(), next = {};
    const out = { ...map };   // 성공한 것만 고쳐 적어요 — 실패한 건 다음에 다시
    let add = 0, upd = 0, del = 0, gone = false;
    const todo = want.filter(w => { next[w.id] = w.h; return map[w.id] !== w.h; });
    const e1 = await gcalPool(todo, 4, async (w) => {
      if (map[w.id]) {
        try { await gapi("PUT", `/calendars/${cal}/events/${w.id}`, w.body); upd++; out[w.id] = w.h; return; }
        catch (e) { if (e.code !== 404 && e.code !== 410) throw e; }
      }
      try { await gapi("POST", `/calendars/${cal}/events`, w.body); add++; out[w.id] = w.h; }
      catch (e) {
        if (e.code === 409) { await gapi("PUT", `/calendars/${cal}/events/${w.id}`, w.body); upd++; out[w.id] = w.h; }
        else { if (e.code === 404) gone = true; throw e; }
      }
    });
    if (gone && !again && !add && !upd) {   // 구글에서 '목자의 삶' 캘린더를 지운 경우 — 새로 만들어 다시
      D.calId = ""; D.map = {}; g.busy = false; return gcalSync(true);
    }
    const stale = Object.keys(map).filter(id => !next[id]);
    const e2 = await gcalPool(stale, 4, async (id) => {
      try { await gapi("DELETE", `/calendars/${cal}/events/${id}`); } catch (e) { if (e.code !== 404 && e.code !== 410) throw e; }
      del++; delete out[id];
    });
    const errs = [...e1, ...e2];
    D.calId = calId; D.map = out; D.syncedAt = new Date().toISOString(); D.on = true;
    await setDoc(doc(db, "gcal", uid()), { calId, on: true, map: out, syncedAt: D.syncedAt, email: (state.me && state.me.email) || "" });
    g.need = errs.some(e => e.code === 401);
    g.last = add || upd || del ? `새로 ${add} · 바뀜 ${upd} · 지움 ${del}` : "바뀐 것 없음";
    if (errs.length && !g.need) g.err = `${errs.length}개는 못 넣었어요 — 다음에 다시 해요 (${errs[0].message})`;
  } catch (e) {
    if (e.code === 401) g.need = true; else g.err = msgOf(e);
    if (!gcalTok()) g.need = true;
    console.warn("구글 캘린더", e.code, e.detail || e.message);
  } finally { g.busy = false; renderGcal(); }
}
let gcalT = 0;
function gcalSoon() {
  clearTimeout(gcalT);
  gcalT = setTimeout(() => { if (state.me && state.gcal.doc && state.gcal.doc.on) gcalSync().catch(() => {}); }, 2500);
}
function gcalPendingCount() {
  const D = state.gcal.doc; if (!D || !D.on || !state.allRecords) return 0;
  try { const map = D.map || {}, want = gcalWant(), ids = new Set(want.map(w => w.id));
    return want.filter(w => map[w.id] !== w.h).length + Object.keys(map).filter(id => !ids.has(id)).length; } catch { return 0; }
}
function renderGcal() {
  const box = $("gcal-box"); if (!box) return;
  const g = state.gcal, D = g.doc, me = state.me;
  const lead = me && (canLead() || (state.souls || []).length);
  if (!lead || calOther()) { box.hidden = true; $("home-gcal").innerHTML = ""; return; }
  box.hidden = false;
  const icon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4m8-4v4"/><path d="m9 14.5 2 2 4-4"/></svg>`;
  if (!D || !D.on) {
    box.className = "gcal";
    box.innerHTML = `<div class="gh">${icon}<b>내 구글 캘린더에 자동으로 넣기</b></div>
      <p class="t">한 번 연결하면 셀모임 · 만남 · 예정 · 훈련 · 기념일이 내 구글 캘린더의 <b>'목자의 삶'</b> 캘린더에 들어가요.
        앱에서 고치거나 지우면 구글 캘린더도 따라 바뀌고, 알림도 구글 캘린더가 울려줘요.
        만남 기록 · 기도 내용은 넣지 않아요 (제목 · 시간 · 장소만).</p>
      <div class="acts"><button class="btn" id="gcal-on" style="max-width:260px">구글 캘린더 연결하기</button></div>
      <p class="err" id="gcal-err">${esc(g.err || "")}</p>`;
  } else {
    const pend = gcalPendingCount();
    const when = D.syncedAt ? new Date(D.syncedAt) : null;
    const whenTxt = when ? `${when.getMonth() + 1}월 ${when.getDate()}일 ${pad2(when.getHours())}:${pad2(when.getMinutes())}` : "아직";
    box.className = "gcal" + (g.need && pend ? " need" : "");
    box.innerHTML = `<div class="gh">${icon}<b>구글 캘린더 연결됨</b> <span class="chip ok" style="margin-left:auto">'목자의 삶' 캘린더</span></div>
      <p class="t">${g.busy ? "구글 캘린더에 맞추는 중…" : `마지막으로 맞춘 때 ${whenTxt} · 일정 ${Object.keys(D.map || {}).length}개${g.last ? " · " + esc(g.last) : ""}`}
        ${!g.busy && pend ? `<br><b style="color:var(--warn-tx)">아직 안 보낸 변경 ${pend}개</b>${g.need ? " — 구글 허락이 1시간마다 끝나서, 눌러서 다시 맞춰 주세요." : ""}` : ""}</p>
      <div class="acts"><button class="btn-sm" id="gcal-sync" ${g.busy ? "disabled" : ""}>${g.need || !gcalTok() ? "다시 연결하고 맞추기" : "지금 맞추기"}</button>
        <button class="btn-sm danger" id="gcal-off" ${g.busy ? "disabled" : ""}>연결 끊기</button></div>
      <p class="err" id="gcal-err">${esc(g.err || "")}</p>`;
  }
  /* 홈 — 보낼 변경이 있는데 허락이 끝났으면 한 줄로 */
  const pendH = D && D.on && g.need ? gcalPendingCount() : 0;
  $("home-gcal").innerHTML = pendH ? `<div class="gstrip"><span>구글 캘린더에 아직 안 보낸 일정 변경이 ${pendH}개 있어요</span>
    <button class="btn-sm" data-gcalgo="1">맞추기</button></div>` : "";
}
async function gcalTap(fn) {
  state.gcal.err = "";
  const p = gcalTok() ? Promise.resolve() : gcalConnect();   // 팝업은 누른 그 순간에
  try { await p; await fn(); }
  catch (e) { state.gcal.err = msgOf(e); renderGcal(); }
}
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("#gcal-on, #gcal-sync, #gcal-off, [data-gcalgo]"); if (!t) return;
  if (t.id === "gcal-on") gcalTap(async () => {
    state.gcal.doc = { on: true, calId: (state.gcal.doc && state.gcal.doc.calId) || "", map: (state.gcal.doc && state.gcal.doc.map) || {} };
    await setDoc(doc(db, "gcal", uid()), { on: true, calId: state.gcal.doc.calId, map: state.gcal.doc.map, syncedAt: "", email: state.me.email || "" });
    await gcalSync(); toast("구글 캘린더에 넣었어요. 구글 캘린더 앱에서 '목자의 삶'을 확인해 보세요.");
  });
  if (t.id === "gcal-sync" || t.dataset.gcalgo) gcalTap(() => gcalSync());
  if (t.id === "gcal-off") {
    if (!confirm("구글 캘린더 연결을 끊을까요?\n'목자의 삶' 캘린더와 그 안의 일정도 구글 캘린더에서 지워요.")) return;
    const D = state.gcal.doc || {};
    gcalTap(async () => {
      if (D.calId) { try { await gapi("DELETE", `/calendars/${encodeURIComponent(D.calId)}`); } catch (e) { if (e.code !== 404 && e.code !== 410) throw e; } }
      await setDoc(doc(db, "gcal", uid()), { on: false, calId: "", map: {}, syncedAt: "", email: state.me.email || "" });
      state.gcal.doc = { on: false, calId: "", map: {} }; state.gcal.last = ""; renderGcal(); toast("연결을 끊었어요.");
    });
  }
});

/* 28단계 — 홈 위 · 사이드바 아래에도 버전 */
document.addEventListener("click", (ev) => { if (ev.target.closest("#home-ver, #side-ver")) $("btn-ver").click(); });

/* ════════ 29단계 — 셀원 순서 · 인턴을 명부에도 (같은 진 누구나 보는 명부 카드) ════════
   셀리더는 자기 셀의 (계정 없는) 사람 명부 카드를 고칠 수 있어서 보안 규칙은 그대로예요. */
async function syncRankToDir(souls) {
  const ws = [];
  for (const s of souls) {
    const m = s.memberId ? memberById(s.memberId) : null; if (!m || m.uid) continue;
    const want = { rank: s.seq || 0, intern: !!s.intern };
    if ((m.rank || 0) !== want.rank || !!m.intern !== want.intern)
      ws.push(updateDoc(doc(db, "members", m.id), want).then(() => Object.assign(m, want)).catch(e => console.warn("명부 순서", m.name, e)));
  }
  await Promise.all(ws);
}

/* 29단계 — 명부: 명단 / 통계 · 정렬 */
$("dir-view").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-dv]"); if (!b) return;
  state.dirView = b.dataset.dv; renderDir();
});
$("dir-sort").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-ds]"); if (!b) return;
  state.dirSort = b.dataset.ds;
  if (state.dirSort === "age" || state.dirSort === "young") {
    b.disabled = true;
    const n = await loadBirths(dirPool());
    b.disabled = false;
    if (!n) toast("나이는 노션 명단(잠긴 칸)을 볼 수 있는 분만 정렬돼요.");
  }
  renderDir();
});
/* 생년월일(잠긴 칸) — 볼 수 있는 사람 것만 */
async function loadBirths(list) {
  state.bdate = state.bdate || {};
  await Promise.all(list.map(async m => {
    if (state.bdate[m.id] !== undefined) return;
    const P = await privOf(m); const b = String((P && P.birth) || "");
    state.bdate[m.id] = /^(19|20)\d\d-\d\d-\d\d$/.test(b) ? b : /^(19|20)\d\d/.test(b) ? b.slice(0, 4) + "-07-01" : "";
  }));
  return list.filter(m => state.bdate[m.id]).length;
}
const ageOf = (b) => { if (!b) return null; const t = new Date(todayStr()), d = new Date(b);
  let a = t.getFullYear() - d.getFullYear(); if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--; return a; };
function renderDirStats(scope, cells, cellOfM, LM) {
  $("dir-count").textContent = `${scope.length}명 기준`;
  $("dir-list").innerHTML = `<p class="muted" style="margin-top:14px">통계를 모으는 중…</p>`;
  const tk = state.dirStatsTk = (state.dirStatsTk || 0) + 1;
  Promise.all([loadBirths(scope), loadAttReps().catch(() => [])]).then(() => {
    if (tk !== state.dirStatsTk || state.dirView !== "stats") return;
    $("dir-list").innerHTML = dirStatsHTML(scope, cells, cellOfM, LM);
  });
}
function dirStatsHTML(scope, cells, cellOfM, LM) {
  const by = state.bdate || {}, N = scope.length;
  const ages = scope.map(m => ageOf(by[m.id])).filter(a => a !== null);
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length * 10) / 10 : null;
  const AB = [["20대 이하", a => a < 30], ["30대", a => a >= 30 && a < 40], ["40대", a => a >= 40 && a < 50], ["50대", a => a >= 50 && a < 60], ["60대 이상", a => a >= 60]];
  const ab = AB.map(([l, f]) => ({ l, n: ages.filter(f).length })), abMax = Math.max(1, ...ab.map(x => x.n));
  /* 출석 — 최근 3개월 셀 보고 */
  const at = scope.map(m => ({ m, st: attStats(m.id, cellOfM(m)) }));
  let okS = 0, nS = 0; at.forEach(x => { okS += x.st.ok; nS += x.st.n; });
  const rate = nS ? Math.round(okS / nS * 100) : null;
  const RB = [["75% 이상", "var(--ok-strong)", r => r >= 75], ["50~74%", "var(--warn-tx)", r => r >= 50 && r < 75], ["25~49%", "#E07B5A", r => r >= 25 && r < 50], ["25% 미만", "var(--brand)", r => r < 25]];
  const rated = at.filter(x => x.st.rate !== null), noRec = N - rated.length;
  const rb = RB.map(([l, c, f]) => ({ l, c, n: rated.filter(x => f(x.st.rate)).length }));
  /* 수료 */
  const has = (m, t) => (m.trainingsDone || []).includes(t);
  const both = scope.filter(m => has(m, "새로운 삶") && has(m, "제자의 삶")).length;
  const nl = scope.filter(m => has(m, "새로운 삶")).length, dl = scope.filter(m => has(m, "제자의 삶")).length;
  const onlyN = nl - both, onlyD = dl - both, none = N - both - onlyN - onlyD;
  const pct = (x) => N ? Math.round(x / N * 100) : 0;
  const interns = scope.filter(m => m.intern).length;
  const streak = at.filter(x => x.st.streak >= 2).length;
  /* 생일 — 이번 달 · 다음 달 */
  const mo = Number(todayStr().slice(5, 7)), mo2 = mo % 12 + 1;
  const bd = (mm) => scope.filter(m => m.birthMD && Number(String(m.birthMD).slice(0, 2)) === mm)
    .sort((a, b) => String(a.birthMD).localeCompare(String(b.birthMD)));
  const bdHTML = (mm) => { const l = bd(mm); return l.length ? `<div class="bdays">${l.map(m => `<span>${esc(m.name)} · ${Number(String(m.birthMD).slice(3, 5))}일</span>`).join("")}</div>` : `<p class="muted" style="font-size:12px">없어요</p>`; };
  /* 셀별 */
  const perCell = state.dirCell === "all" ? cells.map(c => {
    const ms = scope.filter(m => cellOfM(m) === c.id); if (!ms.length) return null;
    const ag = ms.map(m => ageOf(by[m.id])).filter(a => a !== null);
    let o = 0, n = 0; ms.forEach(m => { const st = attStats(m.id, c.id); o += st.ok; n += st.n; });
    return { c, n: ms.length, age: ag.length ? Math.round(ag.reduce((a, b) => a + b, 0) / ag.length) : null, rate: n ? Math.round(o / n * 100) : null };
  }).filter(Boolean) : [];
  const nMax = Math.max(1, ...perCell.map(x => x.n));
  return `<div class="dst">
    <div class="dst-kpi">
      <div><p>인원</p><b>${N}명</b><small>${state.dirCell === "all" ? `셀 ${cells.length}개 · 셀당 ${cells.length ? Math.round(N / cells.length * 10) / 10 : 0}명` : esc(cellNameOf(state.dirCell) || "")}</small></div>
      <div><p>평균 나이 (만)</p><b>${avgAge === null ? "—" : avgAge + "세"}</b><small>${ages.length}명 기준</small></div>
      <div><p>평균 출석률</p><b style="color:${rate === null ? "inherit" : rate >= 75 ? "var(--ok-tx)" : rate >= 50 ? "var(--warn-tx)" : "var(--rose-tx)"}">${rate === null ? "—" : rate + "%"}</b><small>최근 3개월 셀 보고</small></div>
      <div><p>새로운 삶 수료</p><b>${pct(nl)}%</b><small>${nl}명</small></div>
      <div><p>제자의 삶 수료</p><b>${pct(dl)}%</b><small>${dl}명</small></div>
      <div><p>인턴 · 연속 결석</p><b>${interns} · <span style="color:${streak ? "var(--warn-tx)" : "inherit"}">${streak}</span></b><small>인턴 ${interns}명 · 2번 넘게 결석 ${streak}명</small></div>
    </div>
    <div class="dst-grid">
      <div class="dst-c"><h3>연령대 <span>만 나이 · ${ages.length}명 (모름 ${N - ages.length}명)</span></h3>
        <div class="agebars">${ab.map(x => `<div class="ab${x.n ? "" : " dim"}"><b>${x.n}</b><i style="height:${Math.max(3, x.n / abMax * 100)}%"></i></div>`).join("")}</div>
        <div class="agelab">${ab.map(x => `<span>${x.l}</span>`).join("")}</div></div>
      <div class="dst-c"><h3>출석률 분포 <span>최근 3개월 · 기록 있는 ${rated.length}명</span></h3>
        <div class="stk">${rb.map(x => x.n ? `<i style="width:${x.n / Math.max(1, rated.length) * 100}%;background:${x.c}" title="${x.l} ${x.n}명"></i>` : "").join("")}</div>
        <div class="lgd">${rb.map(x => `<span><i style="background:${x.c}"></i>${x.l} ${x.n}명</span>`).join("")}<span><i style="background:var(--track)"></i>기록 없음 ${noRec}명</span></div>
        <h3 style="margin-top:18px">수료 현황 <span>새로운 삶 · 제자의 삶</span></h3>
        <div class="stk">${[[both, "var(--ok-strong)"], [onlyN, "#7FA8E8"], [onlyD, "#9A8CF0"]].map(([n, c]) => n ? `<i style="width:${pct(n)}%;background:${c}"></i>` : "").join("")}</div>
        <div class="lgd"><span><i style="background:var(--ok-strong)"></i>둘 다 ${both}명</span><span><i style="background:#7FA8E8"></i>새로운 삶만 ${onlyN}명</span><span><i style="background:#9A8CF0"></i>제자의 삶만 ${onlyD}명</span><span><i style="background:var(--track)"></i>아직 ${none}명</span></div></div>
      ${perCell.length ? `<div class="dst-c" style="grid-column:1/-1"><h3>셀별 <span>인원 · 평균 나이 · 출석률 (최근 3개월)</span></h3>
        <div class="ctab h"><span>셀</span><span>인원</span><span class="v">평균 나이</span><span class="v">출석률</span></div>
        ${perCell.map(x => `<div class="ctab"><span class="nm"><b>${esc(x.c.name)}</b><small>${esc(cellLeadName(x.c))}</small></span>
          <span style="display:flex;align-items:center;gap:8px"><span class="tr" style="flex:1"><i style="width:${x.n / nMax * 100}%;background:var(--brand)"></i></span><span style="width:28px;text-align:right">${x.n}</span></span>
          <span class="v">${x.age === null ? "—" : x.age + "세"}</span>
          <span class="v" style="color:${x.rate === null ? "var(--dim)" : x.rate >= 75 ? "var(--ok-tx)" : x.rate >= 50 ? "var(--warn-tx)" : "var(--rose-tx)"}">${x.rate === null ? "보고 없음" : x.rate + "%"}</span></div>`).join("")}</div>` : ""}
      <div class="dst-c"><h3>이번 달 생일 <span>${mo}월</span></h3>${bdHTML(mo)}<h3 style="margin-top:16px">다음 달 생일 <span>${mo2}월</span></h3>${bdHTML(mo2)}</div>
    </div>
    <p class="hint">나이는 노션 명단(잠긴 칸)의 생년월일로 세요 — 그걸 볼 수 있는 분(수퍼 · 진장 · 코치 · 그 셀 셀리더)에게만 나이가 잡혀요.</p>
  </div>`;
}

$("dir-list").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-ordcell]"); if (!b) return;
  ev.stopPropagation();
  await loadSouls();
  openOrderDlg(b.dataset.ordcell, () => renderDir());
}, true);
/* 셀 건강 — 사람 줄 순서: 셀리더가 정한 순서 / 자주 빠지는 순 */
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("#hl-sort [data-hs]"); if (!b) return;
  state.hlSort = b.dataset.hs; renderHealth();
});

/* ════════ 30단계 — 조직도 ════════
   교회 → 진 → 진장 → 코치(맡은 셀) → 셀(셀리더 · 셀원 수 · 인턴 · 출석률).
   자리는 '조직 구성'(수퍼)에서 짜고, 여기는 누구나(같은 진) 보는 그림이에요. */
async function openOrgChart() {
  if (!state.me || state.me.role === "member") return;
  show("s-loading");
  await loadOrg(true);
  if (!state.orgName) { try { const o = await getDoc(doc(db, "org", "main")); if (o.exists()) state.orgName = o.data().name; } catch {} }
  $("oc-edit").hidden = state.me.role !== "super";
  renderOrgChart(); markSide && markSide(""); show("s-orgchart");
  loadAttReps().then(() => { if (!$("s-orgchart").hidden) renderOrgChart(); }).catch(() => {});
}
function ocPerson(p, role, extraCls) {
  const m = p.t === "acc" ? memberOfUid(p.uid) : p.t === "noe" ? p.m : (p.inv && p.inv.memberId ? memberById(p.inv.memberId) : null);
  const ava = m ? avatar(m, 40) : `<span class="ava" style="width:40px;height:40px;font-size:16px">${esc(initial(p.name || ""))}</span>`;
  const st = p.t === "inv" ? `<span class="chip warn">초대 중</span>` : p.t === "noe" ? `<span class="chip lock">가입 전</span>` : "";
  const mine = p.t === "acc" && p.uid === uid() ? `<span class="chip rose">나</span>` : "";
  return `<button type="button" class="oc-node ${extraCls || ""}${p.t !== "acc" ? " pend" : ""}"${m ? ` data-ocmem="${m.id}"` : ""}>
    ${ava}<span class="t"><span class="r">${role}${st}${mine}</span><span class="n" style="display:block">${esc(p.name || "")}</span>
    ${p.sub ? `<span class="s" style="display:block">${esc(p.sub)}</span>` : ""}</span></button>`;
}
function ocCell(c) {
  const ents = cellLeadEntries(c), e = ents[0];
  const lids = new Set(ents.map(x => x.m && x.m.id).filter(Boolean));
  const ms = (state.dir || []).filter(m => m.cellId === c.id && m.active !== false && !lids.has(m.id));
  const interns = ms.filter(m => m.intern).length;
  let rate = null;
  if (state.attRep) { const from = ymd(new Date(Date.now() - 92 * 864e5));
    let ok = 0, all = 0; state.attRep.filter(r => r.cellId === c.id && r.date >= from && r.date <= todayStr())
      .forEach(r => Object.values(r.att || {}).forEach(v => { if (!v) return; all++; if (v !== "absent") ok++; }));
    rate = all ? Math.round(ok / all * 100) : null; }
  const lm = e && e.m, nm = e ? ((lm && lm.name) || e.p.name || "") : "";
  const st = !e ? "" : e.p.t === "inv" ? `<span class="chip warn">초대 중</span>` : e.p.t === "noe" ? `<span class="chip lock">가입 전</span>` : "";
  return `<button type="button" class="oc-cell" data-occell="${c.id}">
    <span class="h"><span class="cbadge">${esc(c.name)}</span><span class="cnt">셀원 ${ms.length}명</span></span>
    <span class="ld">${lm ? avatar(lm, 30) : `<span class="ava" style="width:30px;height:30px;font-size:13px">${esc(initial(nm || "?"))}</span>`}
      <span class="nm">${nm ? esc(nm) : "셀리더 미정"}</span>${st}</span>
    <span class="ft">${interns ? `<span class="tpill">인턴 ${interns}</span>` : ""}${rate !== null ? `<span>출석 ${rate}%</span>` : `<span>최근 보고 없음</span>`}</span>
  </button>`;
}
function renderOrgChart() {
  const me = state.me;
  const jins = state.jins.filter(j => j.active !== false && (me.role === "super" || j.id === me.jinId));
  const body = jins.map(j => {
    const cells = activeCells().filter(c => c.jinId === j.id);
    const jj = seatList("jinjang", j.id), co = seatList("coach", j.id);
    const people = (state.dir || []).filter(m => m.jinId === j.id && m.active !== false).length;
    /* 코치마다 맡은 셀 */
    const cellIdsOf = (p) => p.t === "acc" ? ((userOf(p.uid) || {}).cellIds || []) : p.t === "inv" ? (p.inv.cellIds || []) : ((p.m && p.m.pendingSeat && p.m.pendingSeat.cellIds) || []);
    const used = new Set();
    const groups = co.map(p => { const ids = cellIdsOf(p).filter(id => cells.some(c => c.id === id)); ids.forEach(id => used.add(id));
      return { p, cells: cells.filter(c => ids.includes(c.id)) }; });
    const rest = cells.filter(c => !used.has(c.id));
    const jjHTML = jj.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${jj.map(p => ocPerson(p, "진장", "oc-jj")).join("")}</div>`
      : `<div class="oc-node empty">진장 자리 비어 있음${me.role === "super" ? " — '자리 고치기'에서 넣어요" : ""}</div>`;
    let lower;
    if (groups.length) {
      const cols = groups.map(g => `<div class="oc-col">${ocPerson({ ...g.p, sub: `맡은 셀 ${g.cells.length}개` }, "코치", "oc-coach")}
          ${g.cells.length ? `<div class="oc-cells${g.cells.length > 8 ? " c3" : g.cells.length > 4 ? " c2" : ""}">${g.cells.map(ocCell).join("")}</div>` : ""}</div>`);
      if (rest.length) cols.push(`<div class="oc-col"><div class="oc-node oc-coach none" style="cursor:default"><span class="t"><span class="r">코치</span>
          <span class="n" style="display:block;color:var(--dim)">코치 미지정</span><span class="s" style="display:block">셀 ${rest.length}개 — 진장이 바로</span></span></div>
          <div class="oc-cells${rest.length > 8 ? " c3" : rest.length > 4 ? " c2" : ""}">${rest.map(ocCell).join("")}</div></div>`);
      lower = `<div class="oc-v"></div><div class="oc-scroll"><div class="oc-cols">${cols.join("")}</div></div>`;
    } else {
      lower = `<div class="oc-v"></div>${cells.length ? `<div class="oc-grid">${cells.map(ocCell).join("")}</div>`
        : `<div class="oc-node empty">아직 셀이 없어요</div>`}`;
    }
    return `<div class="oc-jinwrap">
      <div class="oc-node oc-jin"><span class="t"><span class="r">진</span><span class="n" style="display:block">${esc(j.name)}</span>
        <span class="s" style="display:block">셀 ${cells.length}개 · ${people}명${co.length ? ` · 코치 ${co.length}명` : ""}</span></span></div>
      <div class="oc-v"></div>${jjHTML}${lower}</div>`;
  }).join("");
  $("oc-body").innerHTML = `<div class="oc">
    <div class="oc-node oc-church">${esc(state.orgName || "교회")}</div>
    ${jins.length ? `<div class="oc-v"></div>` : ""}${body || `<p class="muted">아직 진이 없어요.</p>`}</div>`;
}
$("oc-back").onclick = () => openHome();
$("oc-edit").onclick = () => openOrg();
$("btn-home-orgchart").onclick = () => openOrgChart();
$("oc-body").addEventListener("click", (ev) => {
  const p = ev.target.closest("[data-ocmem]"); if (p) { openMember(p.dataset.ocmem); return; }
  const c = ev.target.closest("[data-occell]");
  if (c) { state.dirCell = c.dataset.occell; state.dirView = "list"; state.dirRole = "all"; openDir(); }
});
$("btn-org-chart").onclick = () => openOrgChart();

/* ════════ 30단계 — 명부 목록: 비율 한눈에 + 눌러서 거르기 ════════
   침례 · 정회원은 노션 명단(잠긴 칸)이라 볼 수 있는 분에게만 잡혀요 (명부 카드의 침례일이 있으면 그것도). */
state.dirF = state.dirF || {};
state.pv = state.pv || {};
function pvOf(m) { return state.pv[m.id]; }
async function loadPv(list) {
  const need = list.filter(m => state.pv[m.id] === undefined && canSeePriv(m) && m.notionAt);
  list.forEach(m => { if (state.pv[m.id] === undefined && !(canSeePriv(m) && m.notionAt)) state.pv[m.id] = null; });
  if (!need.length) return false;
  await Promise.all(need.map(async m => { state.pv[m.id] = (await privOf(m)) || null; }));
  return true;
}
const bapOf = (m) => {
  if (m.baptizedAt) return "y";
  const P = pvOf(m); const t = P ? (P.baptism || []).join(" ") : "";
  if (/침례\s*(O|o|○|Yes|예)|침례여부\s*(Yes|예|O)/.test(t)) return "y";
  if (/침례\s*(X|x|No|아니)|침례여부\s*(No|아니|X)/.test(t)) return "n";
  return "u";
};
const memOf = (m) => { const P = pvOf(m); const t = P ? String(P.membership || "") : ""; return /정회원/.test(t) && !/비회원/.test(t) ? "y" : /비회원/.test(t) ? "n" : "u"; };
const trOf = (m, t) => (m.trainingsDone || []).includes(t) ? "y" : "n";
const DIR_ATTR = [
  { k: "bap", label: "침례", f: bapOf, parts: [["y", "받음", "var(--ok-strong)"], ["n", "안 받음", "var(--brand)"], ["u", "모름", ""]] },
  { k: "nl", label: "새로운 삶", f: (m) => trOf(m, "새로운 삶"), parts: [["y", "수료", "#5B8DEF"], ["n", "아직", "#C77A52"]] },
  { k: "dl", label: "제자의 삶", f: (m) => trOf(m, "제자의 삶"), parts: [["y", "수료", "#8C7CF0"], ["n", "아직", "#C77A52"]] },
  { k: "mem", label: "정회원", f: memOf, parts: [["y", "정회원", "#2E9D8F"], ["n", "비회원", "#B08A3E"], ["u", "모름", ""]] },
];
function dirAttrPass(m) { return DIR_ATTR.every(a => !state.dirF[a.k] || a.f(m) === state.dirF[a.k]); }
function renderDirRatio(base, shown) {
  const box = $("dir-ratio");
  if (!base) { box.innerHTML = ""; return; }
  if (base.length && base.some(m => state.pv[m.id] === undefined)) {
    loadPv(base).then(ch => { if (ch && state.dirView !== "stats") renderDir(); });
  }
  const anyF = DIR_ATTR.some(a => state.dirF[a.k]);
  const N = base.length;
  const rows = DIR_ATTR.map(a => {
    const cnt = {}; base.forEach(m => { const v = a.f(m); cnt[v] = (cnt[v] || 0) + 1; });
    const parts = a.parts.filter(([v]) => cnt[v]);
    const known = a.parts.filter(([v]) => v !== "u").reduce((n, [v]) => n + (cnt[v] || 0), 0);
    const yes = cnt.y || 0;
    return `<div class="rr"><span class="lb">${a.label}</span>
      <div class="bar${state.dirF[a.k] ? " dimmed" : ""}">${parts.map(([v, l, c]) => `<button type="button" class="${c ? "" : "unk"}${state.dirF[a.k] === v ? " on" : ""}"
        data-rf="${a.k}:${v}" style="flex:${cnt[v]} 1 0;${c ? `background:${c}` : ""}" title="${a.label} ${l} ${cnt[v]}명 — 눌러서 거르기">${cnt[v] / N >= .12 ? `${l} ${cnt[v]}` : cnt[v]}</button>`).join("")}</div>
      <div class="lg">${a.parts.map(([v, l, c]) => `<span><i style="background:${c || "var(--track)"}"></i>${l} ${cnt[v] || 0}명</span>`).join("")}
        ${known ? `<span style="color:var(--text);font-weight:600">${Math.round(yes / known * 100)}%${a.parts.some(p => p[0] === "u") && cnt.u ? ` (아는 ${known}명 중)` : ""}</span>` : ""}</div></div>`;
  }).join("");
  box.innerHTML = N ? `<div class="rto"><div class="rto-h"><b>한눈에 보기</b><span>${N}명 · 막대를 누르면 그 사람들만 보여요</span>
      ${anyF ? `<button type="button" class="btn-sm" data-rfclear="1" style="height:28px;font-size:12px">거르기 풀기 (${shown}명 보는 중)</button>` : ""}</div>
    <div class="rto-grid">${rows}</div></div>` : "";
}
$("dir-ratio").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-rfclear]")) { state.dirF = {}; renderDir(); return; }
  const b = ev.target.closest("[data-rf]"); if (!b) return;
  const [k, v] = b.dataset.rf.split(":");
  state.dirF[k] = state.dirF[k] === v ? "" : v; renderDir();
});

/* ════════ 31단계 — 도우미 (그림으로 보는 사용 안내 · 홈 화면 바로가기) ════════ */
const HI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const HIC = {
  start: HI('<path d="M5 19c3-1 4-4 5-6l3-3c2-2 5-3 6-3 0 1-1 4-3 6l-3 3c-2 1-5 2-6 5"/><path d="M9 15l-2-2 2-3h3M15 9v3l-3 2"/>'),
  phone: HI('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  home: HI('<path d="M4 10.5 12 4.2l8 6.3V19a1.5 1.5 0 0 1-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/>'),
  souls: HI('<circle cx="9.5" cy="8.5" r="3"/><path d="M4 19.5v-1a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v1M16.5 6.2a3 3 0 0 1 0 4.6M17.5 14.7a4 4 0 0 1 2.5 3.7v1.1"/>'),
  meet: HI('<rect x="4" y="4.5" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'),
  cal: HI('<rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10.5h17M8.5 3.5v4M15.5 3.5v4"/>'),
  dir: HI('<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><circle cx="12" cy="10" r="2.6"/><path d="M8 17c.6-2 2.1-3 4-3s3.4 1 4 3"/>'),
  chart: HI('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  lock: HI('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  org: HI('<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M6 16v-2h12v2"/>'),
  faq: HI('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7M12 16.9v.1"/>'),
  plus: HI('<path d="M12 5v14M5 12h14"/>'),
  pray: HI('<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>'),
  pen: HI('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  check: HI('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  camera: HI('<path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z"/><circle cx="12" cy="13" r="3.2"/>'),
  send: HI('<path d="M4 12 20 4l-5 16-3.5-6.5z"/><path d="m11.5 13.5 3.5-3.5"/>'),
  google: HI('<path d="M20 12.2a8 8 0 1 1-2.4-5.7"/><path d="M20 5v5h-5"/>'),
  eye: HI('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  sort: HI('<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>'),
  star: HI('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>'),
  share: HI('<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M6 11v8.5h12V11"/>'),
  addsq: HI('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  dots: HI('<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>'),
  install: HI('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 7.5v5M9.5 10.5 12 13l2.5-2.5M8 20h8"/>'),
  mail: HI('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>'),
  key: HI('<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2 2"/>'),
  heart: HI('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>'),
  refresh: HI('<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"/>'),
  moon: HI('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
};
const kb = (ic, t) => `<kbd>${ic ? HIC[ic] : ""}${t}</kbd>`;
/* 주제 — 단계는 짧게, 그림(아이콘)과 함께 */
const HELP = [
  { id: "start", ic: "start", c: "#E3354B", t: "처음 시작", s: "초대받은 구글 계정으로 로그인", who: "all",
    steps: [["mail", "초대 받기", `셀리더 명단 · 조직 구성에서 내 <b>구글 이메일</b>로 초대가 와요`],
      ["key", "구글로 로그인", `앱 주소를 열고 ${kb("google", "구글로 시작")}`],
      ["check", "초대 수락 · 동의", `내 자리(셀 · 역할) 확인 → 개인정보 동의`],
      ["home", "홈에서 시작", `오늘 기도할 영혼과 챙길 사람이 바로 보여요`]],
    tips: [["phone", "홈 화면에 바로가기를 만들어 두면 앱처럼 열려요"], ["lock", "초대받은 구글 계정으로만 들어올 수 있어요"]], go: ["install", "홈 화면에 바로가기"] },
  { id: "install", ic: "phone", c: "#2E9D8F", t: "홈 화면에 바로가기", s: "아이폰 · 안드로이드 · 컴퓨터", who: "all", special: "install" },
  { id: "home", ic: "home", c: "#5B8DEF", t: "홈 화면", s: "오늘 할 일이 한눈에", who: "lead",
    steps: [["pray", "오늘의 전시", `기도할 영혼 한 사람 → ${kb("", "기도했어요")}`],
      ["heart", "오늘 챙길 사람", `결석 · 오래 못 만난 사람 · 다가오는 예정`],
      ["chart", "전시실", `영혼들 · 셀모임 · 캘린더 · 명부 … 숫자를 누르면 그 화면`],
      ["dots", "관리 서랍", `조직 구성 · 셀리더 명단 · 보고서 가져오기`]],
    tips: [["plus", "오른쪽 위 ＋ 로 빠른 기록"], ["star", "홈 위 '버전'을 누르면 바뀐 것"]] },
  { id: "souls", ic: "souls", c: "#E07B5A", t: "영혼 카드", s: "만남 · 기도 · 상태를 한 장에", who: "lead",
    steps: [["plus", "영혼 더하기", `영혼들 오른쪽 위 ${kb("plus", "")} — 명부에서 고르거나 새로`],
      ["pen", "만남 기록", `카드를 열고 ${kb("", "만남")} · ${kb("", "1:1")} · 심방`],
      ["pray", "기도제목", `기도 중 → 응답됨으로 바꿔 가며`],
      ["sort", "순서 · 인턴", `${kb("", "순서")} — 영적 순서와 인턴을 한 창에서`]],
    tips: [["lock", "기록마다 공개 범위: 나만 · 코치·진장 · 교역자"], ["star", "명함 카드 네 칸 = 만남 · 1:1 · 출석 · 기도"]], go: ["souls", "영혼들 열기"] },
  { id: "meet", ic: "meet", c: "#7FA8E8", t: "셀모임 · 보고", s: "출석 체크 → 보고까지 한 번에", who: "lead",
    steps: [["plus", "셀모임 열기", `셀모임 ${kb("plus", "")} — 날짜 · 시간 · 장소 · 주제`],
      ["check", "출석 체크", `한 사람씩 ${kb("", "출석")} ${kb("", "온라인")} ${kb("", "결석")}`],
      ["camera", "나눔 · 사진", `사람별 나눔과 셀모임 사진`],
      ["send", "보고", `${kb("send", "보고하기")} → 코치 · 진장이 확인`]],
    tips: [["eye", "보고 사본은 같은 진이 봐요 — 나눔 공유는 공유 설정에서"], ["chart", "셀 보고 모아보기 = 캘린더 · 출석 그래프"]], go: ["meet", "셀모임 열기"] },
  { id: "cal", ic: "cal", c: "#9A8CF0", t: "캘린더", s: "셀모임 · 만남 · 생일", who: "lead",
    steps: [["cal", "날짜 누르기", `그날 일정 · ${kb("plus", "이 날 기록")}`],
      ["souls", "다른 셀 보기", `맨 위 ${kb("", "1B01 김준")} — 같은 진 셀리더 캘린더`],
      ["google", "구글 캘린더", `${kb("", "구글 캘린더 연결하기")} 한 번이면 내 폰 캘린더에`],
      ["refresh", "맞추기", `1시간 뒤 바뀐 건 ${kb("", "맞추기")} 한 번`]],
    tips: [["lock", "다른 셀 만남은 날짜 · 시간 · 종류만 보여요"]], go: ["cal", "캘린더 열기"] },
  { id: "dir", ic: "dir", c: "#C9A227", t: "교회 명부", s: "셀별 가지 · 목록 · 통계", who: "all",
    steps: [["dir", "셀별로", `셀마다 맨 위 셀리더, 아래로 셀원이 가지처럼`],
      ["sort", "목록 · 정렬", `${kb("", "셀원")} ${kb("", "리더들")} → 가나다 · 나이 · 출석률 · 생일순`],
      ["chart", "한눈에 보기", `침례 · 새로운 삶 · 제자의 삶 · 정회원 비율 — 막대를 누르면 거르기`],
      ["chart", "통계 · 그래프", `평균 나이 · 연령대 · 출석률 · 셀별 표`]],
    tips: [["lock", "생년 · 가족 · 침례는 잠긴 칸 — 볼 수 있는 분만"], ["eye", "카드를 누르면 출석 줄 · 기본 사항"]], go: ["dir", "교회 명부 열기"] },
  { id: "health", ic: "chart", c: "#2E7D54", t: "셀 건강 · 통계 · 사진", s: "그래프로 보는 우리 셀", who: "all",
    steps: [["chart", "셀 건강", `출석률 고리 · 8주 막대 · 사람별 출석 줄`],
      ["sort", "자주 빠지는 순", `${kb("", "자주 빠지는 순")} 으로 먼저 챙길 사람`],
      ["chart", "활동 통계", `종류별 모임 · 달마다 — 다른 셀도 골라서`],
      ["camera", "사진 모아보기", `셀모임 사진 · 셀원 얼굴`]],
    go: ["health", "셀 건강 열기"] },
  { id: "org", ic: "org", c: "#B4384A", t: "조직도 · 관리", s: "진장 · 코치 · 셀 자리", who: "manage",
    steps: [["org", "조직도", `교회 → 진 → 진장 → 코치 → 셀을 한 그림으로`],
      ["plus", "자리 넣기", `조직 구성 → ${kb("plus", "진장")} ${kb("plus", "코치")} — 이름 + 구글 이메일`],
      ["mail", "셀리더 초대", `셀리더 명단 → 이메일 넣고 ${kb("send", "초대 보내기")}`],
      ["dir", "셀 관리", `분가 · 담당 바꾸기 · 이름 · 보관`]],
    tips: [["key", "진장은 '교역자'가 아니라 '진장' 자리로"]], go: ["orgchart", "조직도 열기"] },
  { id: "privacy", ic: "lock", c: "#6F6664", t: "누가 무엇을 보나", s: "보안 원칙 한눈에", who: "all", special: "privacy" },
  { id: "faq", ic: "faq", c: "#5F5654", t: "자주 묻는 질문", s: "막힐 때 여기부터", who: "all", special: "faq" },
];
function helpWho(t) {
  const r = state.me ? state.me.role : "";
  if (t.who === "lead") return canLead() || ["coach", "jinjang"].includes(r);
  if (t.who === "manage") return ["super", "jinjang", "coach"].includes(r);
  return true;
}
async function openHelp(topic) {
  state.helpTopic = topic || "";
  renderHelp(); markSide("help"); show("s-help");
  $("s-help").querySelector(".scroll").scrollTop = 0;
}
function renderHelp() {
  const t = HELP.find(x => x.id === state.helpTopic);
  $("hp-title").textContent = t ? t.t : "도우미";
  if (!t) { renderHelpHome(); return; }
  const head = `<button type="button" class="hp-back2" data-hp="">‹ 도우미 처음으로</button>
    <div class="hp-head"><span class="hp-ic" style="background:${t.c}">${HIC[t.ic]}</span><div><h3>${t.t}</h3><p>${t.s}</p></div></div>`;
  if (t.special === "install") { $("hp-body").innerHTML = head + helpInstall(); return; }
  if (t.special === "privacy") { $("hp-body").innerHTML = head + helpPrivacy(); return; }
  if (t.special === "faq") { $("hp-body").innerHTML = head + helpFaq(); return; }
  $("hp-body").innerHTML = head + `<div class="hp-steps">${t.steps.map(([ic, b, d], i) => `
      <div class="hp-step"><span class="no">${i + 1}</span><span class="si">${HIC[ic]}</span><b>${b}</b><p>${d}</p></div>`).join("")}</div>
    ${(t.tips || []).length ? `<div class="hp-tips">${t.tips.map(([ic, x]) => `<span class="hp-tip">${HIC[ic]}<span>${x}</span></span>`).join("")}</div>` : ""}
    ${t.go ? `<div class="hp-go"><button type="button" class="btn" style="max-width:240px" data-hpgo="${t.go[0]}">${t.go[1]}</button></div>` : ""}`;
}
function renderHelpHome() {
  const q = (state.helpQ || "").trim();
  const list = HELP.filter(helpWho).filter(t => !q || (t.t + t.s + JSON.stringify(t.steps || "") + JSON.stringify(t.tips || "")).replace(/<[^>]+>/g, "").includes(q));
  $("hp-body").innerHTML = `
    <div class="hp-hero">
      <svg class="deco" width="140" height="140" viewBox="0 0 140 140" aria-hidden="true"><circle cx="100" cy="40" r="56" fill="var(--rose-bg)"/><circle cx="118" cy="22" r="20" fill="var(--rose-line)" opacity=".6"/></svg>
      <div style="position:relative">
        <h3>무엇을 도와드릴까요?</h3>
        <p>그림과 짧은 단계로 기능을 안내해요. 막히면 '자주 묻는 질문'부터.</p>
        <label class="hp-search">${HIC.faq.replace("<svg", '<svg width="18" height="18" style="color:var(--dim)"')}
          <input id="hp-q" type="search" placeholder="찾기 — 예: 출석, 인턴, 구글" value="${esc(q)}" aria-label="도우미에서 찾기"></label>
        <div class="hp-quick">
          <button type="button" class="pri" data-hp="install">${HIC.phone.replace("<svg", '<svg width="18" height="18"')}홈 화면에 바로가기</button>
          <button type="button" data-hp="start">${HIC.start.replace("<svg", '<svg width="18" height="18"')}처음 시작</button>
          <button type="button" data-hp="faq">${HIC.faq.replace("<svg", '<svg width="18" height="18"')}자주 묻는 질문</button>
        </div>
      </div>
    </div>
    <p class="hp-sec">${q ? `'${esc(q)}' 찾은 결과 ${list.length}개` : "기능별 안내"}</p>
    <div class="hp-grid">${list.map(t => `<button type="button" class="hp-tile" data-hp="${t.id}">
        <span class="hp-ic" style="background:${t.c}">${HIC[t.ic]}</span><span><b>${t.t}</b><span class="s">${t.s}</span></span></button>`).join("")
      || `<p class="muted">찾는 안내가 없어요. 다른 말로 찾아보세요.</p>`}</div>`;
}
function helpDevice() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "pc";
}
function helpInstall() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const dev = state.helpDev || helpDevice();
  const D = {
    ios: { t: "아이폰 · 아이패드", note: "꼭 <b>사파리</b>에서 열어 주세요 (크롬 ✕)",
      steps: [["share", "공유 버튼", `사파리 아래쪽 ${kb("share", "공유")} 누르기`],
        ["addsq", "홈 화면에 추가", `목록을 내려 ${kb("addsq", "홈 화면에 추가")}`],
        ["check", "추가", `오른쪽 위 ${kb("", "추가")} — 끝!`]] },
    android: { t: "안드로이드", note: "<b>크롬</b>에서 열어 주세요",
      steps: [["dots", "메뉴", `크롬 오른쪽 위 ${kb("dots", "")} 누르기`],
        ["install", "앱 설치", `${kb("install", "앱 설치")} 또는 ${kb("addsq", "홈 화면에 추가")}`],
        ["check", "설치", `${kb("", "설치")} — 홈 화면에 아이콘이 생겨요`]] },
    pc: { t: "컴퓨터", note: "<b>크롬 · 엣지</b>에서 열어 주세요",
      steps: [["install", "주소창 아이콘", `주소창 오른쪽 ${kb("install", "설치")} 아이콘 누르기`],
        ["check", "설치", `${kb("", "설치")} — 바탕화면 · 독에서 바로 열려요`],
        ["star", "작업 표시줄 고정", `아이콘을 오른쪽 클릭 → 고정해 두면 편해요`]] },
  }[dev];
  return `${standalone ? `<div class="hp-status ok">${HIC.check}지금 홈 화면 앱으로 쓰고 있어요. 따로 할 일이 없어요.</div>`
      : deferredPrompt ? `<div class="hp-status go">${HIC.install}<span style="flex:1">이 기기는 바로 설치할 수 있어요.</span><button type="button" class="btn-sm" data-hpinstall="1">지금 설치</button></div>` : ""}
    <div class="seg hp-dev">${[["ios", "아이폰"], ["android", "안드로이드"], ["pc", "컴퓨터"]].map(([k, l]) =>
      `<button type="button" data-hpdev="${k}" class="${dev === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="hp-install">
      <div>
        <div class="hp-tips" style="margin:0 0 12px">${`<span class="hp-tip">${HIC.eye}<span>${D.note}</span></span>`}</div>
        <div class="hp-steps">${D.steps.map(([ic, b, d], i) => `<div class="hp-step"><span class="no">${i + 1}</span><span class="si">${HIC[ic]}</span><b>${b}</b><p>${d}</p></div>`).join("")}</div>
        <div class="hp-tips">
          <span class="hp-tip">${HIC.star}설치하면 주소창 없이 앱처럼 · 더 빨리 열려요</span>
          <span class="hp-tip">${HIC.refresh}새 버전은 앱 위쪽 '새 버전' 알림으로 와요</span>
        </div>
      </div>
      <div><div class="phone"><span class="notch"></span><div class="apps">
          ${"<i></i>".repeat(5)}<span class="me"><img src="icons/icon-192.png" alt=""><span>목자의 삶</span></span>${"<i></i>".repeat(6)}
        </div><span class="dock"></span></div><p class="hp-cap">이렇게 홈 화면에 생겨요</p></div>
    </div>`;
}
function helpPrivacy() {
  const W = (ic, c, t, items, k) => `<div class="w${k ? " key" : ""}"><div class="h"><span class="hp-ic" style="background:${c};width:36px;height:36px;border-radius:11px">${HIC[ic]}</span><b>${t}</b></div>
    <ul>${items.map(x => `<li>${x}</li>`).join("")}</ul></div>`;
  return `<div class="hp-who">
    ${W("lock", "#6F6664", "나만 (셀리더)", ["'나만 보기'로 둔 만남 기록", "구글 캘린더 연결 상태", "내 카드 기본 내용"])}
    ${W("souls", "#E3354B", "맡은 셀리더", ["내 셀 영혼 카드 전체 · 기도", "내 셀 사람들의 노션 명단(잠긴 칸)", "순서 · 인턴 정하기"])}
    ${W("eye", "#9A8CF0", "코치 · 진장", ["공개 범위가 '코치 · 진장'인 기록", "진 전체 셀 보고 · 셀 건강", "명부 잠긴 칸 · 조직도"])}
    ${W("dir", "#5B8DEF", "같은 진 누구나", ["교회 명부 (이름 · 사진 · 셀 · 생일 · 연락처 · 수료)", "셀 보고의 출석 · 주제", "공유를 켠 셀모임 사진 · 만남 일정(날짜만)"])}
    ${W("key", "#2E9D8F", "본인은 못 봐요", ["나에 대해 셀리더 · 코치 · 진장이 쓴 기록", "나의 잠긴 칸(노션 명단)", "계정을 받아도 그대로"], 1)}
  </div>
  <div class="hp-tips"><span class="hp-tip">${HIC.lock}이 원칙은 앱 화면이 아니라 서버의 보안 규칙이 막아요</span>
    <span class="hp-tip">${HIC.eye}공유 범위는 더보기 › 공유 설정에서</span></div>`;
}
function helpFaq() {
  const Q = [
    ["새 버전이 안 보여요", `앱 위쪽 '새 버전' 알림의 ${kb("refresh", "지금 새로고침")}. 그래도 안 되면 더보기 › 새로고침.`],
    ["다른 셀 칸이 흐려요", `그 셀리더가 아직 가입 전이에요. 셀리더 명단에서 초대하고 그분이 로그인하면 열려요.`],
    ["구글 캘린더 오류가 나요", `오류 글에 빠진 게 적혀 있어요 — 'API 켜기'면 설정 안내 ①번, '캘린더 허용'이면 다시 연결하며 체크.`],
    ["생년 · 침례가 '—'로 보여요", `노션 명단(잠긴 칸)은 수퍼 · 진장 · 코치 · 그 셀 셀리더만 봐요. 본인 것은 본인에게 안 보여요.`],
    ["화면이 너무 어두워요", `더보기 › 화면에서 ${kb("moon", "라이트")} 또는 '기기 설정 따르기'.`],
    ["셀원 순서를 바꾸고 싶어요", `영혼들 ${kb("", "순서")} · 셀모임 ${kb("", "순서 정하기")} · 명부의 ${kb("", "순서 · 인턴")} — 어디서 바꿔도 모두 같아요.`],
    ["진장님은 어디서 넣나요?", `조직 구성 → 진장 줄 ${kb("plus", "진장")} → 이름 + 구글 이메일. '교역자'가 아니라 '진장' 자리로.`],
    ["사진은 얼마나 올릴 수 있나요?", `사진 모아보기 위쪽에 쓴 용량과 남은 양이 보여요. 셀모임 사진은 대략 4,000장까지.`],
  ];
  return `<div class="hp-faq">${Q.map(([q, a]) => `<details><summary><span class="q">Q</span>${q}</summary><div class="a">${a}</div></details>`).join("")}</div>`;
}
$("hp-back").onclick = () => { if (state.helpTopic) { state.helpTopic = ""; renderHelp(); } else openHome(); };
$("hp-body").addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-hp]");
  if (t) { state.helpTopic = t.dataset.hp; renderHelp(); $("s-help").querySelector(".scroll").scrollTop = 0; return; }
  const d = ev.target.closest("[data-hpdev]"); if (d) { state.helpDev = d.dataset.hpdev; renderHelp(); return; }
  const i = ev.target.closest("[data-hpinstall]");
  if (i && deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; renderHelp(); return; }
  const g = ev.target.closest("[data-hpgo]");
  if (g) { const k = g.dataset.hpgo; ({ souls: openSouls, meet: openMeet, cal: openCal, dir: openDir, health: openHealth, orgchart: openOrgChart }[k] || openHome)(); }
});
$("hp-body").addEventListener("input", (ev) => {
  if (ev.target.id !== "hp-q") return;
  state.helpQ = ev.target.value; const pos = ev.target.selectionStart;
  renderHelpHome(); const n = $("hp-q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch {}
});
$("btn-home-help").onclick = () => openHelp("");
$("btn-go-help").onclick = () => openHelp("");
$("btn-install").onclick = () => openHelp("install");
/* 홈 — 처음 쓰는 분께 한 줄 안내 (닫으면 이 기기에서는 다시 안 떠요) */
function renderWelcome() {
  let off = false; try { off = localStorage.getItem("mokja-welcome-off") === "1"; } catch {}
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("home-welcome").innerHTML = off ? "" : `<div class="hwel"><span class="hp-ic" style="background:#2E9D8F;width:40px;height:40px">${HIC.phone}</span>
    <span class="t"><b>처음이세요?</b><p>${standalone ? "도우미에서 기능을 그림으로 볼 수 있어요." : "홈 화면에 바로가기를 만들면 앱처럼 열려요."}</p></span>
    ${standalone ? "" : `<button type="button" class="btn-sm" data-hwgo="install">바로가기</button>`}
    <button type="button" class="btn-sm" data-hwgo="">도우미</button>
    <button type="button" class="x" data-hwoff="1" aria-label="닫기">×</button></div>`;
}
$("home-welcome").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-hwoff]")) { try { localStorage.setItem("mokja-welcome-off", "1"); } catch {} renderWelcome(); return; }
  const g = ev.target.closest("[data-hwgo]"); if (g) openHelp(g.dataset.hwgo);
});
