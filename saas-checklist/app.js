/* SaaS Daily (Sidian) — check-list quotidienne adaptée au palier de croissance.
   Génération déterministe par date + filtrage par palier + persistance locale. */

(() => {
  "use strict";

  const STORE_KEY = "saasDaily:v2";
  const CATS = window.CATEGORIES;
  const PHASES = window.PHASES;
  const MAX_PHASE = PHASES[PHASES.length - 1].id;

  // ---------- Utilitaires date ----------
  const fmtKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const dayNumber = (d) =>
    Math.floor(
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000
    );
  const todayKey = () => fmtKey(new Date());

  // ---------- Hash + PRNG déterministe ----------
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

  // Sélection des tâches d'un jour pour un palier donné.
  // On ne garde que les tâches éligibles au palier, puis chaque catégorie a un
  // ordre stable propre (palier inclus dans la graine) ; la fenêtre avance
  // chaque jour pour parcourir tout le réservoir éligible avant de boucler.
  function generateForDate(d, phase) {
    const dn = dayNumber(d);
    const out = [];
    for (const cat of CATS) {
      const eligible = [];
      cat.tasks.forEach((task, i) => {
        if (task.p.includes(phase)) eligible.push(i);
      });
      if (!eligible.length) continue;
      const order = seededOrder(eligible.length, hashStr(cat.id + "@" + phase));
      const count = Math.min(cat.perDay, eligible.length);
      const start = ((dn * count) % eligible.length + eligible.length) % eligible.length;
      const picks = [];
      for (let k = 0; k < count; k++) {
        const taskIndex = eligible[order[(start + k) % eligible.length]];
        picks.push({
          key: `${cat.id}#${taskIndex}`,
          text: cat.tasks[taskIndex].t,
        });
      }
      out.push({ cat, picks });
    }
    return out;
  }

  // Tâche « cap suivant » : une tâche du palier d'après (pas encore éligible
  // aujourd'hui), pour préparer l'objectif futur tout en restant réalisable.
  function horizonForDate(d, phase) {
    const next = phase + 1;
    if (next > MAX_PHASE) return null;
    const candidates = [];
    for (const cat of CATS) {
      cat.tasks.forEach((task, i) => {
        if (task.p.includes(next) && !task.p.includes(phase)) {
          candidates.push({ cat, key: `${cat.id}#${i}`, text: task.t });
        }
      });
    }
    if (!candidates.length) return null;
    const pick = candidates[dayNumber(d) % candidates.length];
    return { ...pick, nextPhase: PHASES.find((p) => p.id === next) };
  }

  // ---------- Persistance ----------
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || { days: {}, phase: 1 };
    } catch {
      return { days: {}, phase: 1 };
    }
  }
  function saveStore(s) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
  let store = loadStore();
  if (typeof store.phase !== "number") store.phase = 1;

  function dayState(key) {
    if (!store.days[key]) store.days[key] = { done: {}, custom: [] };
    if (!store.days[key].done) store.days[key].done = {};
    if (!store.days[key].custom) store.days[key].custom = [];
    return store.days[key];
  }

  function dayHasProgress(key) {
    const ds = store.days[key];
    if (!ds) return false;
    if (Object.values(ds.done || {}).some(Boolean)) return true;
    if ((ds.custom || []).some((c) => c.done)) return true;
    return false;
  }

  function computeStreak() {
    let streak = 0;
    const d = new Date();
    if (!dayHasProgress(fmtKey(d))) d.setDate(d.getDate() - 1);
    for (;;) {
      if (dayHasProgress(fmtKey(d))) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    return streak;
  }

  // ---------- État de vue ----------
  let viewDate = new Date();

  // ---------- Rendu ----------
  const el = (id) => document.getElementById(id);
  const listEl = el("list");

  function frenchDate(d) {
    const opts = { weekday: "long", day: "numeric", month: "long" };
    const s = d.toLocaleDateString("fr-FR", opts);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function isChecked(ds, item) {
    return item.custom
      ? !!ds.custom.find((c) => c.id === item.key)?.done
      : !!ds.done[item.key];
  }

  function makeRow(key, ds, item, accent) {
    const checked = isChecked(ds, item);
    const row = document.createElement("label");
    row.className = "item" + (checked ? " checked" : "");
    if (accent) row.style.setProperty("--cat", accent);

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("change", () => toggle(key, item, box.checked));

    const txt = document.createElement("span");
    txt.className = "item-text";
    txt.textContent = item.text;

    row.appendChild(box);
    row.appendChild(txt);

    if (item.custom) {
      const del = document.createElement("button");
      del.className = "del";
      del.type = "button";
      del.setAttribute("aria-label", "Supprimer");
      del.textContent = "✕";
      del.addEventListener("click", (e) => {
        e.preventDefault();
        removeCustom(key, item.key);
      });
      row.appendChild(del);
    }
    return row;
  }

  function render() {
    const key = fmtKey(viewDate);
    const ds = dayState(key);
    const phase = store.phase;
    const groups = generateForDate(viewDate, phase);
    const horizon = horizonForDate(viewDate, phase);

    // En-tête date
    el("dateLabel").textContent =
      key === todayKey() ? frenchDate(viewDate) + " · aujourd'hui" : frenchDate(viewDate);
    el("nextDay").disabled = key >= todayKey();

    // Palier
    const ph = PHASES.find((p) => p.id === phase);
    el("phaseSelect").value = String(phase);
    el("phaseGoal").textContent = ph.goal;
    el("phaseDone").textContent = "Palier validé quand : " + ph.done;

    listEl.innerHTML = "";
    let total = 0;
    let done = 0;

    for (const { cat, picks } of groups) {
      const section = document.createElement("section");
      section.className = "cat";
      section.style.setProperty("--cat", cat.color);

      const head = document.createElement("div");
      head.className = "cat-head";
      head.innerHTML = `<span class="cat-emoji">${cat.emoji}</span><h2>${cat.name}</h2>`;
      section.appendChild(head);

      const items = document.createElement("div");
      items.className = "items";

      const customForCat = ds.custom.filter((c) => c.catId === cat.id);
      const all = [
        ...picks.map((p) => ({ ...p, custom: false })),
        ...customForCat.map((c) => ({ key: c.id, text: c.text, custom: true })),
      ];

      for (const item of all) {
        total++;
        if (isChecked(ds, item)) done++;
        items.appendChild(makeRow(key, ds, item, null));
      }

      section.appendChild(items);
      listEl.appendChild(section);
    }

    // Carte « cap suivant »
    if (horizon) {
      total++;
      if (isChecked(ds, horizon)) done++;
      const section = document.createElement("section");
      section.className = "cat horizon";
      section.style.setProperty("--cat", "#eab308");
      const head = document.createElement("div");
      head.className = "cat-head";
      head.innerHTML =
        `<span class="cat-emoji">🔭</span><h2>Cap suivant — préparer « ${horizon.nextPhase.emoji} ${horizon.nextPhase.name} »</h2>`;
      section.appendChild(head);
      const items = document.createElement("div");
      items.className = "items";
      items.appendChild(makeRow(key, ds, { ...horizon, custom: false }, "#eab308"));
      section.appendChild(items);
      listEl.appendChild(section);
    }

    const pct = total ? Math.round((done / total) * 100) : 0;
    el("progressFill").style.width = pct + "%";
    el("progressText").textContent = `${done} / ${total}`;
    el("streakCount").textContent = computeStreak();

    if (total && done === total) celebrate();
  }

  function toggle(key, item, checked) {
    const ds = dayState(key);
    if (item.custom) {
      const c = ds.custom.find((x) => x.id === item.key);
      if (c) c.done = checked;
    } else {
      if (checked) ds.done[item.key] = true;
      else delete ds.done[item.key];
    }
    saveStore(store);
    render();
  }

  function removeCustom(key, id) {
    const ds = dayState(key);
    ds.custom = ds.custom.filter((c) => c.id !== id);
    saveStore(store);
    render();
  }

  function addCustom(catId, text) {
    const key = fmtKey(viewDate);
    const ds = dayState(key);
    ds.custom.push({
      id: "custom#" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      catId,
      text,
      done: false,
    });
    saveStore(store);
    render();
  }

  // ---------- Feedback ----------
  let lastCelebrated = "";
  function celebrate() {
    const key = fmtKey(viewDate);
    if (lastCelebrated === key) return;
    lastCelebrated = key;
    showToast("🎉 Journée complétée — bravo, continue la série !");
  }
  let toastTimer;
  function showToast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Navigation & contrôles ----------
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

  // Sélecteur de palier
  const phaseSelect = el("phaseSelect");
  for (const p of PHASES) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = `${p.id}. ${p.emoji} ${p.name}`;
    phaseSelect.appendChild(opt);
  }
  phaseSelect.addEventListener("change", () => {
    store.phase = parseInt(phaseSelect.value, 10);
    saveStore(store);
    lastCelebrated = "";
    render();
  });

  // Sélecteur de catégorie pour les tâches perso
  const catSelect = el("customCat");
  for (const cat of CATS) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = `${cat.emoji} ${cat.name}`;
    catSelect.appendChild(opt);
  }
  el("customForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = el("customInput");
    const text = input.value.trim();
    if (!text) return;
    addCustom(catSelect.value, text);
    input.value = "";
    input.blur();
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
