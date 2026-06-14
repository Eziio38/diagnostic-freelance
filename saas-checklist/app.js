/* SaaS Daily (Sidian) — juste les tâches du jour.
   Le palier de croissance est déterminé AUTOMATIQUEMENT par les tâches déjà
   réalisées (voir tasks.js). On affiche une courte liste tenant sur un écran,
   sans indicateur de progression ni ajout manuel — uniquement quoi faire. */

(() => {
  "use strict";

  const STORE_KEY = "saasDaily:v3";
  const CATS = window.CATEGORIES;
  const PHASES = window.PHASES;
  const MIN_PHASE = PHASES[0].id;
  const MAX_PHASE = PHASES[PHASES.length - 1].id;
  const ADVANCE_RATIO = 0.7;        // part des tâches propres au palier pour avancer
  const DAILY_COUNT = 8;            // nombre de tâches affichées par jour
  // Ordre de priorité d'affichage des catégories (1 tâche par catégorie / jour).
  const PRIORITY = ["cursor", "tests", "produit", "marketing", "croissance", "strategie", "routine"];

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

  // ---------- Palier automatique ----------
  const isCrossCutting = (task) => task.p.length >= 5;
  const primaryByPhase = {};
  PHASES.forEach((p) => (primaryByPhase[p.id] = []));
  CATS.forEach((cat) => {
    cat.tasks.forEach((task, i) => {
      if (isCrossCutting(task)) return;
      primaryByPhase[Math.min.apply(null, task.p)].push(`${cat.id}#${i}`);
    });
  });
  function phaseValidated(phase, everDone) {
    const list = primaryByPhase[phase] || [];
    if (!list.length) return true;
    return list.filter((k) => everDone[k]).length / list.length >= ADVANCE_RATIO;
  }
  function currentPhase(everDone) {
    for (let p = MIN_PHASE; p < MAX_PHASE; p++) {
      if (!phaseValidated(p, everDone)) return p;
    }
    return MAX_PHASE;
  }

  // ---------- Sélection du jour (liste courte et plate) ----------
  function generateForDate(d, phase) {
    const dn = dayNumber(d);
    // Catégories éligibles au palier, chacune avec son ordre stable + point de départ.
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
    // Round-robin : on répartit entre catégories, sans répéter une tâche dans la journée.
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

  // ---------- Persistance ----------
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || { days: {}, everDone: {} };
    } catch {
      return { days: {}, everDone: {} };
    }
  }
  function saveStore(s) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
  let store = loadStore();
  if (!store.days) store.days = {};
  if (!store.everDone) store.everDone = {};
  for (const key in store.days) {
    const done = store.days[key].done || {};
    for (const k in done) if (done[k]) store.everDone[k] = true;
  }

  function dayState(key) {
    if (!store.days[key]) store.days[key] = { done: {} };
    if (!store.days[key].done) store.days[key].done = {};
    return store.days[key];
  }

  // ---------- État de vue ----------
  let viewDate = new Date();
  const el = (id) => document.getElementById(id);
  const listEl = el("list");

  function frenchDate(d) {
    const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function render() {
    const key = fmtKey(viewDate);
    const ds = dayState(key);
    const phase = currentPhase(store.everDone);
    const items = generateForDate(viewDate, phase);

    // Titre relatif au jour affiché + date complète en sous-titre.
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

      // Taper le texte (ou le chevron) déplie / replie le détail complet.
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

      // Afficher le chevron uniquement si le texte est réellement tronqué.
      if (txt.scrollHeight - txt.clientHeight > 1) row.classList.add("truncated");
    }

    if (total && done === total) celebrate(key);
  }

  function toggle(key, taskKey, checked) {
    const ds = dayState(key);
    if (checked) {
      ds.done[taskKey] = true;
      store.everDone[taskKey] = true; // fait avancer le palier (monotone)
    } else {
      delete ds.done[taskKey];
    }
    saveStore(store);
    render();
  }

  // ---------- Petit feedback de fin de journée ----------
  let lastCelebrated = "";
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

  render();
})();
