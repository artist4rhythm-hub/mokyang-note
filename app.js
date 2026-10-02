/* ──────────────────────────────────────────────
   목양노트 — 1단계: 계정 · 조직 · 초대
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

/* ── 공통 도구 ── */
const $ = (id) => document.getElementById(id);
const SCREENS = ["s-loading","s-login","s-verify","s-setup","s-accept","s-pending","s-home","s-manage"];
const show = (id) => SCREENS.forEach(s => $(s).hidden = (s !== id));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

const ROLE = { super:"수퍼 관리자", jinjang:"진장", coach:"코치", leader:"셀리더" };

function msgOf(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "이메일이나 비밀번호가 맞지 않아요.";
  if (c.includes("email-already-in-use")) return "이미 가입된 이메일이에요. 로그인해 주세요.";
  if (c.includes("weak-password")) return "비밀번호는 6자 이상으로 해주세요.";
  if (c.includes("invalid-email")) return "이메일 형식을 확인해 주세요.";
  if (c.includes("too-many-requests")) return "잠시 후 다시 시도해 주세요.";
  if (c.includes("permission-denied")) return "권한이 없어요. 수퍼 관리자 이메일이 보안 규칙과 같은지 확인해 주세요.";
  if (c.includes("popup-closed")) return "로그인 창이 닫혔어요.";
  return (e && e.message) ? e.message : "문제가 생겼어요. 다시 시도해 주세요.";
}

/* ── 상태 ── */
const state = { user:null, me:null, jins:[], cells:[], members:[], invites:[] };

/* ── 로그인 ── */
$("btn-google").onclick = async () => {
  $("login-err").textContent = "";
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (String(e.code).includes("popup")) { await signInWithRedirect(auth, provider); return; }
    $("login-err").textContent = msgOf(e);
  }
};

$("btn-email-login").onclick = async () => {
  $("login-err").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("in-email").value.trim(), $("in-pw").value);
  } catch (e) { $("login-err").textContent = msgOf(e); }
};

$("btn-signup").onclick = async () => {
  $("login-err").textContent = "";
  try {
    const cred = await createUserWithEmailAndPassword(auth, $("in-email").value.trim(), $("in-pw").value);
    await sendEmailVerification(cred.user);
  } catch (e) { $("login-err").textContent = msgOf(e); }
};

$("btn-reset").onclick = async () => {
  const email = $("in-email").value.trim();
  if (!email) { $("login-err").textContent = "이메일을 먼저 적어주세요."; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    $("login-err").textContent = "";
    toast("비밀번호 재설정 메일을 보냈어요.");
  } catch (e) { $("login-err").textContent = msgOf(e); }
};

$("btn-resend").onclick = async () => {
  try { await sendEmailVerification(auth.currentUser); toast("인증 메일을 다시 보냈어요."); }
  catch (e) { $("verify-err").textContent = msgOf(e); }
};

$("btn-verified").onclick = async () => {
  await auth.currentUser.reload();
  if (auth.currentUser.emailVerified) route(auth.currentUser);
  else $("verify-err").textContent = "아직 인증이 확인되지 않았어요. 메일 속 링크를 눌렀는지 확인해 주세요.";
};

["btn-logout-1","btn-logout-2","btn-logout-3","btn-logout-4","btn-logout-5"]
  .forEach(id => $(id).onclick = () => signOut(auth));

$("btn-recheck").onclick = () => route(auth.currentUser);
document.querySelectorAll(".soon").forEach(b => b.onclick = () => toast("다음 단계에서 열려요."));

/* ── 로그인 후 길 찾기 ── */
onAuthStateChanged(auth, (user) => route(user));
getRedirectResult(auth).catch(() => {});

async function route(user) {
  state.user = user;
  if (!user) { show("s-login"); return; }
  show("s-loading");

  if (!user.emailVerified) {
    $("verify-email").textContent = user.email || "";
    show("s-verify");
    return;
  }

  try {
    const meSnap = await getDoc(doc(db, "users", user.uid));
    if (meSnap.exists()) { state.me = { id: user.uid, ...meSnap.data() }; await openHome(); return; }

    const email = (user.email || "").toLowerCase();
    const invSnap = await getDoc(doc(db, "invites", email));
    if (invSnap.exists() && invSnap.data().status === "pending") {
      state.invite = invSnap.data();
      const jinName = await nameOfJin(state.invite.jinId);
      $("accept-info").innerHTML =
        `${esc(jinName)}의 <b>${esc(ROLE[state.invite.role] || state.invite.role)}</b>로 초대받았어요.`;
      $("ac-name").value = state.invite.name || "";
      show("s-accept");
      return;
    }

    const boot = await getDoc(doc(db, "system", "bootstrap"));
    if (!boot.exists()) { show("s-setup"); return; }

    $("pending-email").textContent = user.email || "";
    show("s-pending");
  } catch (e) {
    $("pending-email").textContent = user.email || "";
    show("s-pending");
    toast(msgOf(e));
  }
}

async function nameOfJin(jinId) {
  if (!jinId) return "";
  try {
    const s = await getDoc(doc(db, "jins", jinId));
    return s.exists() ? s.data().name : "";
  } catch { return ""; }
}

/* ── 최초 설정 ── */
$("btn-setup").onclick = async () => {
  const church = $("st-church").value.trim();
  const myName = $("st-name").value.trim();
  const jinName = $("st-jin").value.trim();
  $("setup-err").textContent = "";
  if (!church || !myName || !jinName) { $("setup-err").textContent = "세 칸을 모두 채워주세요."; return; }

  const u = auth.currentUser;
  $("btn-setup").disabled = true;
  try {
    await setDoc(doc(db, "org", "main"), { name: church, createdAt: serverTimestamp() });
    const jinRef = await addDoc(collection(db, "jins"),
      { name: jinName, jinjangUid: null, active: true, createdAt: serverTimestamp() });
    await setDoc(doc(db, "users", u.uid), {
      name: myName, email: (u.email || "").toLowerCase(), role: "super",
      jinId: null, cellId: null, active: true, createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "system", "bootstrap"), { at: serverTimestamp(), by: u.uid });
    toast("설정이 끝났어요.");
    route(u);
  } catch (e) {
    $("setup-err").textContent = msgOf(e);
  } finally { $("btn-setup").disabled = false; }
};

/* ── 초대 수락 ── */
$("btn-accept").onclick = async () => {
  const name = $("ac-name").value.trim();
  $("accept-err").textContent = "";
  if (!name) { $("accept-err").textContent = "이름을 적어주세요."; return; }

  const u = auth.currentUser;
  const email = (u.email || "").toLowerCase();
  $("btn-accept").disabled = true;
  try {
    await setDoc(doc(db, "users", u.uid), {
      name, email, role: state.invite.role, jinId: state.invite.jinId,
      cellId: state.invite.cellId || null, active: true, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "invites", email), {
      status: "accepted", acceptedUid: u.uid, acceptedAt: serverTimestamp()
    });
    route(u);
  } catch (e) {
    $("accept-err").textContent = msgOf(e);
  } finally { $("btn-accept").disabled = false; }
};

/* ── 홈 ── */
async function openHome() {
  const me = state.me;
  const now = new Date();
  const days = ["일","월","화","수","목","금","토"];
  $("home-date").textContent =
    `${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;

  let title = "목양노트";
  try {
    const org = await getDoc(doc(db, "org", "main"));
    if (org.exists()) title = org.data().name;
  } catch {}
  $("home-title").textContent = title;
  $("home-role").textContent = ROLE[me.role] || me.role;

  await loadOrg();

  const jin = state.jins.find(j => j.id === me.jinId);
  $("home-where").textContent = me.role === "super" ? "전체" : (jin ? jin.name : "");
  $("home-where").hidden = !$("home-where").textContent;

  $("t-members").textContent = `${state.members.length}명`;
  $("t-cells").textContent = `${state.cells.length}개`;
  $("t-invites").textContent = `${state.invites.filter(i => i.status === "pending").length}건`;

  const canManage = me.role === "super" || me.role === "jinjang";
  $("btn-manage").hidden = !canManage;
  show("s-home");
}

$("btn-manage").onclick = () => openManage();
$("btn-back").onclick = () => openHome();

/* ── 조직 데이터 읽기 ── */
async function loadOrg() {
  const me = state.me;
  const isSuper = me.role === "super";
  const mine = (col) => isSuper
    ? getDocs(collection(db, col))
    : getDocs(query(collection(db, col), where("jinId", "==", me.jinId)));

  const pack = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));

  try {
    const [jins, cells, users, invites] = await Promise.all([
      getDocs(collection(db, "jins")),
      mine("cells"),
      mine("users"),
      mine("invites")
    ]);
    state.jins = pack(jins);
    state.cells = pack(cells);
    state.members = pack(users).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
    state.invites = pack(invites);
  } catch (e) {
    toast(msgOf(e));
  }
}

/* ── 리더 관리 ── */
async function openManage() {
  show("s-loading");
  await loadOrg();
  const isSuper = state.me.role === "super";

  /* 구성원 */
  const cellName = (id) => (state.cells.find(c => c.id === id) || {}).name || "";
  const jinName  = (id) => (state.jins.find(j => j.id === id) || {}).name || "";

  $("list-members").innerHTML = state.members.map(m => {
    const where = m.role === "leader" ? cellName(m.cellId) : jinName(m.jinId);
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
        ${where ? `<p class="sub" style="margin-top:6px">${esc(where)}</p>` : ""}
        ${canEdit ? `
        <div class="acts">
          <select class="btn-sm" data-act="role" data-uid="${m.id}"
                  style="height:38px;width:auto;padding:0 10px">${roleOptions}</select>
          <button class="btn-sm" data-act="pwreset" data-email="${esc(m.email)}">비번 재설정 메일</button>
          <button class="btn-sm ${m.active ? "danger" : ""}" data-act="toggle"
                  data-uid="${m.id}" data-on="${m.active}">${m.active ? "사용 중지" : "다시 사용"}</button>
        </div>` : ""}
      </div>`;
  }).join("") || `<p class="muted">아직 구성원이 없어요.</p>`;

  /* 초대 */
  const pending = state.invites.filter(i => i.status === "pending");
  $("list-invites").innerHTML = pending.map(i => `
    <div class="row">
      <div class="grow">
        <p class="nm">${esc(i.name || i.email)}</p>
        <p class="sub">${esc(i.email)} · ${ROLE[i.role] || i.role}</p>
      </div>
      <button class="btn-sm danger" data-act="cancel" data-email="${esc(i.email)}">취소</button>
    </div>`).join("") || `<p class="muted">대기 중인 초대가 없어요.</p>`;

  /* 셀 */
  $("list-cells").innerHTML = state.cells.map(c => `
    <div class="row">
      <div class="grow">
        <p class="nm">${esc(c.name)}</p>
        <p class="sub">${esc(jinName(c.jinId))} · 리더 ${state.members.filter(m => m.cellId === c.id).length}명</p>
      </div>
    </div>`).join("") || `<p class="muted">아직 셀이 없어요.</p>`;

  /* 진 (수퍼 관리자만) */
  $("jin-block").hidden = !isSuper;
  if (isSuper) {
    $("list-jins").innerHTML = state.jins.map(j => {
      const head = state.members.filter(m => m.role === "jinjang" && m.jinId === j.id);
      return `
      <div class="row">
        <div class="grow">
          <p class="nm">${esc(j.name)}</p>
          <p class="sub">${head.length ? "진장 " + esc(head.map(h => h.name).join(", ")) : "진장 없음"}</p>
        </div>
      </div>`;
    }).join("") || `<p class="muted">아직 진이 없어요.</p>`;
  }

  show("s-manage");
}

/* 관리 화면 클릭 처리 */
$("s-manage").addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  if (act === "pwreset") {
    try { await sendPasswordResetEmail(auth, el.dataset.email);
      toast("재설정 메일을 보냈어요. 본인 메일함을 확인하라고 알려주세요.");
    } catch (e) { toast(msgOf(e)); }
  }

  if (act === "toggle") {
    const on = el.dataset.on === "true";
    if (!confirm(on ? "이 계정의 사용을 중지할까요?" : "다시 사용하게 할까요?")) return;
    try {
      await updateDoc(doc(db, "users", el.dataset.uid), { active: !on });
      await log(on ? "계정 중지" : "계정 복구", el.dataset.uid);
      openManage();
    } catch (e) { toast(msgOf(e)); }
  }

  if (act === "cancel") {
    if (!confirm("이 초대를 취소할까요?")) return;
    try {
      await deleteDoc(doc(db, "invites", el.dataset.email));
      await log("초대 취소", el.dataset.email);
      openManage();
    } catch (e) { toast(msgOf(e)); }
  }
});

$("s-manage").addEventListener("change", async (ev) => {
  const el = ev.target.closest('[data-act="role"]');
  if (!el) return;
  try {
    await updateDoc(doc(db, "users", el.dataset.uid), { role: el.value });
    await log("역할 변경", el.dataset.uid, el.value);
    toast("역할을 바꿨어요.");
    openManage();
  } catch (e) { toast(msgOf(e)); openManage(); }
});

/* ── 셀 · 진 추가 ── */
$("btn-cell-add").onclick = async () => {
  const name = prompt("셀 이름을 적어주세요 (예: 다니엘 셀)");
  if (!name || !name.trim()) return;
  const jinId = state.me.role === "super"
    ? (state.jins[0] && state.jins[0].id)
    : state.me.jinId;
  if (!jinId) { toast("먼저 진을 만들어 주세요."); return; }
  try {
    await addDoc(collection(db, "cells"),
      { name: name.trim(), jinId, active: true, createdAt: serverTimestamp() });
    await log("셀 추가", name.trim());
    openManage();
  } catch (e) { toast(msgOf(e)); }
};

$("btn-jin-add").onclick = async () => {
  const name = prompt("진 이름을 적어주세요 (예: 2진)");
  if (!name || !name.trim()) return;
  try {
    await addDoc(collection(db, "jins"),
      { name: name.trim(), jinjangUid: null, active: true, createdAt: serverTimestamp() });
    await log("진 추가", name.trim());
    openManage();
  } catch (e) { toast(msgOf(e)); }
};

/* ── 초대 보내기 ── */
const dlg = $("dlg-invite");

$("btn-invite-open").onclick = () => {
  const isSuper = state.me.role === "super";
  $("iv-name").value = ""; $("iv-email").value = ""; $("invite-err").textContent = "";

  $("iv-role").innerHTML = (isSuper ? ["jinjang","coach","leader"] : ["coach","leader"])
    .map(r => `<option value="${r}">${ROLE[r]}</option>`).join("");

  $("iv-jin-wrap").hidden = !isSuper;
  $("iv-jin").innerHTML = state.jins.map(j => `<option value="${j.id}">${esc(j.name)}</option>`).join("");

  fillCells();
  $("iv-role").onchange = syncRole;
  $("iv-jin").onchange = fillCells;
  syncRole();
  dlg.showModal();
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
  const name = $("iv-name").value.trim();
  const email = $("iv-email").value.trim().toLowerCase();
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
      $("invite-err").textContent = "이미 가입한 사람이에요.";
      return;
    }
    await setDoc(doc(db, "invites", email), {
      email, name, role, jinId, cellId, status: "pending",
      invitedBy: state.me.id || auth.currentUser.uid,
      invitedAt: serverTimestamp()
    });
    await log("초대", email, role);
    dlg.close();
    toast("초대했어요. 그분이 같은 이메일로 로그인하면 바로 들어와요.");
    openManage();
  } catch (e) {
    $("invite-err").textContent = msgOf(e);
  } finally { $("iv-send").disabled = false; }
};

/* ── 기록 남기기 ── */
async function log(action, target, detail) {
  try {
    await addDoc(collection(db, "audit"), {
      by: auth.currentUser.uid, byName: state.me ? state.me.name : "",
      action, target: target || "", detail: detail || "", at: serverTimestamp()
    });
  } catch {}
}
