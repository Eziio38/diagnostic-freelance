/* SaaS Daily (Sidian) — check-list quotidienne.
   « Où j'en suis » est suivi via des JALONS concrets que tu coches au fur et à
   mesure (écran Mon avancement, bouton ⚙︎). L'app en déduit l'étape courante
   et te propose chaque jour une courte liste de tâches adaptées. */

(() => {
  "use strict";

  const STORE_KEY = "saasDaily:v3";
  const CATS = window.CATEGORIES;
  const PHASES = window.PHASES;
  const MILESTONES = window.MILESTONES;
  const MIN_PHASE = PHASES[0].id;
  const MAX_PHASE = PHASES[PHASES.length - 1].id;
  const DAILY_COUNT = 8;
  const PRIORITY = ["cursor", "tests", "produit", "marketing", "croissance", "strategie", "routine"];

  const msByPhase = {};
  PHASES.forEach((p) => (msByPhase[p.id] = MILESTONES.filter((m) => m.phase === p.id)));

  // ---------- Date ----------
  const fmtKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const dayNumber = (d) =>
    Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  const todayKey = () => fmtKey(new Date());

  // ---------- Hash + PRNG ----------
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededOrder(n, seed) {
    const idx = Array.from({ length: n }, (_, i) => i);
    const rnd = mulberry32(seed);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }

  // ---------- Persistance ----------
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveStore() {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }
  let store = loadStore();
  if (!store.days) store.days = {};
  if (!store.milestones) store.milestones = {};

  // ---------- Étape courante = 1ère étape dont les jalons ne sont pas tous faits ----------
  function phaseDone(p) {
    const ms = msByPhase[p] || [];
    if (!ms.length) return true;
    return ms.every((m) => store.milestones[m.id]);
  }
  function currentPhase() {
    for (let p = MIN_PHASE; p < MAX_PHASE; p++) {
      if (!phaseDone(p)) return p;
    }
    return MAX_PHASE;
  }
  const milestonesDoneCount = () => MILESTONES.filter((m) => store.milestones[m.id]).length;

  // ---------- Sélection du jour (liste courte, répartie entre catégories) ----------
  function generateForDate(d, phase) {
    const dn = dayNumber(d);
    const cats = [];
    for (const id of PRIORITY) {
      const cat = CATS.find((c) => c.id === id);
      const eligible = [];
      cat.tasks.forEach((task, i) => {
        if (task.p.includes(phase)) eligible.push(i);
      });
      if (!eligible.length) continue;
      const order = seededOrder(eligible.length, hashStr(cat.id + "@" + phase));
      const start = ((dn % eligible.length) + eligible.length) % eligible.length;
      cats.push({ cat, eligible, order, start, taken: 0 });
    }
    const out = [];
    let progress = true;
    while (out.length < DAILY_COUNT && progress) {
      progress = false;
      for (const c of cats) {
        if (out.length >= DAILY_COUNT) break;
        if (c.taken >= c.eligible.length) continue;
        const idx = c.eligible[c.order[(c.start + c.taken) % c.eligible.length]];
        out.push({ cat: c.cat, key: `${c.cat.id}#${idx}`, text: c.cat.tasks[idx].t });
        c.taken++;
        progress = true;
      }
    }
    return out;
  }

  function dayState(key) {
    if (!store.days[key]) store.days[key] = { done: {} };
    if (!store.days[key].done) store.days[key].done = {};
    return store.days[key];
  }

  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);
  const listEl = el("list");
  const setupEl = el("setup");
  let viewDate = new Date();
  let lastCelebrated = "";

  function frenchDate(d) {
    const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- Écran « Mon avancement » (jalons) ----------
  function setupMode(on) {
    // Masquage infaillible : style inline (prioritaire sur le CSS) + attribut hidden.
    setupEl.hidden = !on;
    listEl.hidden = on;
    setupEl.style.display = on ? "flex" : "none";
    listEl.style.display = on ? "none" : "flex";
    el("dateLabel").style.visibility = on ? "hidden" : "";
    document.querySelectorAll(".daynav .nav").forEach((b) => {
      if (b.id !== "editStage") b.style.display = on ? "none" : "";
    });
  }

  function showSetup(firstRun) {
    el("title").textContent = firstRun ? "Où en es-tu ?" : "Mon avancement";
    setupEl.innerHTML = "";

    const intro = document.createElement("p");
    intro.className = "setup-intro";
    intro.textContent =
      "Coche tout ce que tu as déjà fait. L'app saura précisément où tu en es et te proposera la suite. Reviens cocher un jalon dès qu'il est terminé.";
    setupEl.appendChild(intro);

    for (const ph of PHASES) {
      const group = document.createElement("div");
      group.className = "ms-group";

      const head = document.createElement("div");
      head.className = "ms-head";
      const ms = msByPhase[ph.id] || [];
      const doneN = ms.filter((m) => store.milestones[m.id]).length;
      head.innerHTML =
        `<span class="ms-emoji">${ph.emoji}</span>` +
        `<span class="ms-name">Étape ${ph.id} — ${ph.name}</span>` +
        `<span class="ms-count">${doneN}/${ms.length}</span>`;
      group.appendChild(head);

      for (const m of ms) {
        const checked = !!store.milestones[m.id];
        const row = document.createElement("label");
        row.className = "ms-row" + (checked ? " checked" : "");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = checked;
        box.addEventListener("change", () => {
          if (box.checked) store.milestones[m.id] = true;
          else delete store.milestones[m.id];
          saveStore();
          row.classList.toggle("checked", box.checked);
          head.querySelector(".ms-count").textContent =
            `${ms.filter((x) => store.milestones[x.id]).length}/${ms.length}`;
        });
        const txt = document.createElement("span");
        txt.className = "ms-text";
        txt.textContent = m.t;
        row.appendChild(box);
        row.appendChild(txt);
        group.appendChild(row);
      }
      setupEl.appendChild(group);
    }

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "setup-cta";
    cta.textContent = "Voir mes tâches du jour →";
    cta.addEventListener("click", () => {
      store.setupDone = true;
      saveStore();
      setupMode(false);
      viewDate = new Date();
      lastCelebrated = "";
      render();
    });
    setupEl.appendChild(cta);

    setupMode(true);
  }

  // ---------- Rendu de la liste du jour ----------
  function render() {
    const key = fmtKey(viewDate);
    const ds = dayState(key);
    const phase = currentPhase();
    const items = generateForDate(viewDate, phase);

    const diff = dayNumber(viewDate) - dayNumber(new Date());
    let title;
    if (diff === 0) title = "Aujourd'hui";
    else if (diff === -1) title = "Hier";
    else if (diff === 1) title = "Demain";
    else {
      const wd = viewDate.toLocaleDateString("fr-FR", { weekday: "long" });
      title = wd.charAt(0).toUpperCase() + wd.slice(1);
    }
    el("title").textContent = title;
    el("dateLabel").textContent = frenchDate(viewDate);
    el("nextDay").disabled = key >= todayKey();

    listEl.innerHTML = "";
    let total = 0;
    let done = 0;

    for (const item of items) {
      total++;
      const checked = !!ds.done[item.key];
      if (checked) done++;

      const row = document.createElement("div");
      row.className = "item" + (checked ? " checked" : "");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      box.addEventListener("change", () => toggle(key, item.key, box.checked));

      const emoji = document.createElement("span");
      emoji.className = "item-emoji";
      emoji.textContent = item.cat.emoji;

      const txt = document.createElement("span");
      txt.className = "item-text";
      txt.textContent = item.text;

      const chev = document.createElement("span");
      chev.className = "item-chev";
      chev.textContent = "⌄";
      const expand = (e) => {
        e.preventDefault();
        row.classList.toggle("expanded");
      };
      txt.addEventListener("click", expand);
      chev.addEventListener("click", expand);

      row.appendChild(box);
      row.appendChild(emoji);
      row.appendChild(txt);
      row.appendChild(chev);
      listEl.appendChild(row);

      if (txt.scrollHeight - txt.clientHeight > 1) row.classList.add("truncated");
    }

    if (total && done === total) celebrate(key);
  }

  function toggle(key, taskKey, checked) {
    const ds = dayState(key);
    if (checked) ds.done[taskKey] = true;
    else delete ds.done[taskKey];
    saveStore();
    render();
  }

  // ---------- Feedback ----------
  function celebrate(key) {
    if (lastCelebrated === key) return;
    lastCelebrated = key;
    showToast("🎉 Tout est fait pour aujourd'hui — bravo !");
  }
  let toastTimer;
  function showToast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Navigation ----------
  el("prevDay").addEventListener("click", () => {
    viewDate.setDate(viewDate.getDate() - 1);
    viewDate = new Date(viewDate);
    lastCelebrated = "";
    render();
  });
  el("nextDay").addEventListener("click", () => {
    if (fmtKey(viewDate) >= todayKey()) return;
    viewDate.setDate(viewDate.getDate() + 1);
    viewDate = new Date(viewDate);
    lastCelebrated = "";
    render();
  });
  el("todayBtn").addEventListener("click", () => {
    viewDate = new Date();
    lastCelebrated = "";
    render();
  });
  el("editStage").addEventListener("click", () => showSetup(false));

  // ---------- Installation PWA ----------
  let deferredPrompt = null;
  const installBtn = el("installBtn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("./sw.js").catch(() => {})
    );
  }

  if (store.setupDone) {
    setupMode(false);
    render();
  } else {
    showSetup(true);
  }
})();
