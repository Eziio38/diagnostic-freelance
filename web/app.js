"use strict";

const API_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_BYTES = 25 * 1024 * 1024;
const LS = { key: "mt_api_key", lang: "mt_lang", history: "mt_history" };

const $ = (id) => document.getElementById(id);

/* ---------- Storage helpers ---------- */
const getKey = () => (localStorage.getItem(LS.key) || "").trim();
const getLang = () => localStorage.getItem(LS.lang) || "auto";
function getHistory() {
  try { return JSON.parse(localStorage.getItem(LS.history)) || []; }
  catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(LS.history, JSON.stringify(h)); }
  catch (e) { showToast("Stockage plein : impossible d'enregistrer l'historique.", true); }
}

/* ---------- UI feedback ---------- */
function setBusy(on) { $("busy").classList.toggle("hidden", !on); }
let toastTimer;
function showToast(msg, isError) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", !!isError);
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 5000 : 2000);
}
const showError = (msg) => showToast(msg, true);

/* ---------- Tabs ---------- */
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((s) =>
    s.classList.toggle("active", s.id === "tab-" + name));
  document.querySelectorAll(".tabbtn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  if (name === "history") renderHistory();
}
document.querySelectorAll(".tabbtn").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab)));

/* ---------- Time formatting ---------- */
function fmtTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/* ---------- Core: transcription ---------- */
async function transcribe(file, title, sourceType) {
  const key = getKey();
  if (!key) {
    showError("Clé API manquante. Configurez-la dans Réglages.");
    switchTab("settings");
    return;
  }
  if (file.size > MAX_BYTES) {
    showError(`Fichier trop grand (${(file.size / 1048576).toFixed(1)} Mo). Limite : 25 Mo.`);
    return;
  }

  setBusy(true);
  try {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("model", "whisper-1");
    fd.append("response_format", "verbose_json");
    const lang = getLang();
    if (lang && lang !== "auto") fd.append("language", lang);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });

    if (!res.ok) {
      let msg;
      try { msg = (await res.json())?.error?.message; }
      catch { msg = await res.text(); }
      throw new Error(`Erreur API (${res.status}) : ${msg || "inconnue"}`);
    }

    const data = await res.json();
    const t = {
      id: Date.now().toString(),
      title,
      text: data.text || "",
      segments: (data.segments || []).map((s) => ({
        start: s.start, end: s.end, text: (s.text || "").trim(),
      })),
      createdAt: Date.now(),
      sourceType,
    };
    const h = getHistory();
    h.unshift(t);
    saveHistory(h);
    showTranscript(t);
  } catch (e) {
    showError(navigator.onLine ? e.message : "Pas de connexion internet.");
  } finally {
    setBusy(false);
  }
}

/* ---------- Import file ---------- */
$("btn-import").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // allow re-selecting same file
  if (file) transcribe(file, file.name, "file");
});

/* ---------- Recording ---------- */
let mediaRecorder = null;
let recChunks = [];
let recStream = null;

function pickMime() {
  const candidates = ["audio/mp4", "audio/aac", "audio/webm", "audio/mpeg"];
  if (!window.MediaRecorder) return "";
  for (const c of candidates) {
    try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ }
  }
  return "";
}
function extFor(type) {
  if (type.includes("webm")) return "webm";
  if (type.includes("aac")) return "m4a";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("wav")) return "wav";
  return "mp4";
}
function setRecUI(on) {
  $("rec-indicator").classList.toggle("hidden", !on);
  const btn = $("btn-record");
  btn.classList.toggle("recording", on);
  btn.innerHTML = on
    ? '<span class="ico">⏹️</span> Arrêter l\'enregistrement'
    : '<span class="ico">🎙️</span> Enregistrer';
  $("btn-import").disabled = on;
  $("btn-url").disabled = on;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError("L'enregistrement n'est pas supporté par ce navigateur.");
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showError("Accès au micro refusé. Autorisez-le dans les réglages de Safari.");
    return;
  }
  const mime = pickMime();
  recChunks = [];
  try {
    mediaRecorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  } catch {
    mediaRecorder = new MediaRecorder(recStream);
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const type = mediaRecorder.mimeType || mime || "audio/mp4";
    const blob = new Blob(recChunks, { type });
    if (recStream) recStream.getTracks().forEach((tr) => tr.stop());
    recStream = null;
    mediaRecorder = null;
    if (blob.size === 0) { showError("Enregistrement vide."); return; }
    const file = new File([blob], `enregistrement.${extFor(type)}`, { type });
    transcribe(file, `Enregistrement ${nowStr()}`, "recording");
  };
  mediaRecorder.start();
  setRecUI(true);
}
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  setRecUI(false);
}
$("btn-record").addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
  else startRecording();
});

function nowStr() {
  return new Date().toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/* ---------- URL ---------- */
$("btn-url").addEventListener("click", () => {
  $("url-input").value = "";
  $("url-sheet").classList.remove("hidden");
  $("url-input").focus();
});
$("btn-url-cancel").addEventListener("click", () => $("url-sheet").classList.add("hidden"));
$("btn-url-go").addEventListener("click", () => {
  const raw = $("url-input").value.trim();
  let url;
  try { url = new URL(raw); } catch { showError("URL invalide."); return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    showError("URL invalide."); return;
  }
  $("url-sheet").classList.add("hidden");
  fromURL(url.href);
});

async function fromURL(href) {
  setBusy(true);
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`Téléchargement échoué (${res.status}).`);
    const blob = await res.blob();
    let name = (href.split("/").pop() || "fichier").split("?")[0] || "fichier";
    if (!name.includes(".")) name += ".mp3";
    const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
    await transcribe(file, name, "url");
  } catch (e) {
    showError(
      "Impossible de récupérer ce fichier. Les liens protégés (YouTube) ou sans autorisation CORS ne fonctionnent pas dans le navigateur."
    );
  } finally {
    setBusy(false);
  }
}

/* ---------- Transcript view ---------- */
let currentTranscript = null;
function showTranscript(t) {
  currentTranscript = t;
  $("transcript-title").textContent = t.title;
  const body = $("transcript-body");
  body.innerHTML = "";
  if (t.segments && t.segments.length > 0) {
    for (const seg of t.segments) {
      const div = document.createElement("div");
      div.className = "segment";
      const ts = document.createElement("div");
      ts.className = "ts";
      ts.textContent = fmtTime(seg.start);
      const txt = document.createElement("div");
      txt.className = "txt";
      txt.textContent = seg.text;
      div.append(ts, txt);
      body.appendChild(div);
    }
  } else {
    const p = document.createElement("div");
    p.className = "plain-text";
    p.textContent = t.text || "(vide)";
    body.appendChild(p);
  }
  $("view-transcript").classList.remove("hidden");
}
$("btn-close-transcript").addEventListener("click", () =>
  $("view-transcript").classList.add("hidden"));

$("btn-copy").addEventListener("click", () => {
  if (currentTranscript) copyText(currentTranscript.text);
});
$("btn-share").addEventListener("click", () => {
  if (currentTranscript) shareText(currentTranscript.title, currentTranscript.text);
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copié !");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); showToast("Copié !"); }
    catch { showError("Copie impossible."); }
    ta.remove();
  }
}
async function shareText(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch { return; /* user cancelled */ }
  }
  copyText(text);
}

/* ---------- History ---------- */
const SRC_ICON = { file: "📄", recording: "🎙️", url: "🔗" };
function renderHistory() {
  const list = $("history-list");
  const empty = $("history-empty");
  const h = getHistory();
  list.innerHTML = "";
  empty.classList.toggle("hidden", h.length > 0);

  for (const t of h) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("del")) return;
      showTranscript(t);
    });

    const h3 = document.createElement("h3");
    h3.textContent = `${SRC_ICON[t.sourceType] || "📄"} ${t.title}`;

    const p = document.createElement("p");
    p.textContent = t.text || "";

    const time = document.createElement("time");
    time.textContent = new Date(t.createdAt).toLocaleString("fr-FR");

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "🗑️";
    del.setAttribute("aria-label", "Supprimer");
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTranscript(t.id);
    });

    item.append(del, h3, p, time);
    list.appendChild(item);
  }
}
function deleteTranscript(id) {
  saveHistory(getHistory().filter((t) => t.id !== id));
  renderHistory();
}

/* ---------- Settings ---------- */
function refreshKeyUI() {
  const stored = getKey();
  $("api-key").value = stored;
  $("btn-delete-key").disabled = !stored;
}
$("btn-save-key").addEventListener("click", () => {
  const v = $("api-key").value.trim();
  if (!v) { showError("Saisissez une clé."); return; }
  localStorage.setItem(LS.key, v);
  refreshKeyUI();
  showToast("Clé enregistrée ✓");
});
$("btn-delete-key").addEventListener("click", () => {
  localStorage.removeItem(LS.key);
  refreshKeyUI();
  showToast("Clé supprimée");
});
$("lang-select").addEventListener("change", (e) => {
  localStorage.setItem(LS.lang, e.target.value);
});

/* ---------- Init ---------- */
function init() {
  refreshKeyUI();
  $("lang-select").value = getLang();
  renderHistory();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* offline shell optional */ });
  }
}
init();
