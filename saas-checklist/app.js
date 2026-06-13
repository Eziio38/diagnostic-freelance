/* SaaS Daily — génération déterministe de la check-list du jour + persistance locale. */

(() => {
  "use strict";

  const STORE_KEY = "saasDaily:v1";
  const CATS = window.CATEGORIES;

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
  // Permutation stable d'un tableau d'indices (Fisher–Yates seedé).
  function seededOrder(n, seed) {
    const idx = Array.from({ length: n }, (_, i) => i);
    const rnd = mulberry32(seed);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }

  // Sélection des tâches générées pour un jour donné.
  // Chaque catégorie a un ordre stable propre ; la fenêtre avance chaque jour
  // pour parcourir tout le réservoir avant de boucler.
  function generateForDate(d) {
    const dn = dayNumber(d);
    const out = [];
    for (const cat of CATS) {
      const pool = cat.tasks;
      const order = seededOrder(pool.length, hashStr(cat.id));
      const count = Math.min(cat.perDay, pool.length);
      const start = ((dn * count) % pool.length + pool.length) % pool.length;
      const picks = [];
      for (let k = 0; k < count; k++) {
        const taskIndex = order[(start + k) % pool.length];
        picks.push({
          key: `${cat.id}#${taskIndex}`,
          catId: cat.id,
          text: pool[taskIndex],
        });
      }
      out.push({ cat, picks });
    }
    return out;
  }

  // ---------- Persistance ----------
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || { days: {} };
    } catch {
      return { days: {} };
    }
  }
  function saveStore(s) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
  let store = loadStore();

  function dayState(key) {
    if (!store.days[key]) store.days[key] = { done: {}, custom: [] };
    if (!store.days[key].done) store.days[key].done = {};
    if (!store.days[key].custom) store.days[key].custom = [];
    return store.days[key];
  }

  // Une journée est "active" si au moins une tâche y a été cochée.
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
    // Si rien fait aujourd'hui, on regarde à partir d'hier (la série n'est pas rompue).
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
    let s = d.toLocaleDateString("fr-FR", opts);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function render() {
    const key = fmtKey(viewDate);
    const ds = dayState(key);
    const groups = generateForDate(viewDate);

    el("dateLabel").textContent =
      key === todayKey() ? frenchDate(viewDate) + " · aujourd'hui" : frenchDate(viewDate);
    el("nextDay").disabled = key >= todayKey();

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
        const checked = item.custom
          ? !!ds.custom.find((c) => c.id === item.key)?.done
          : !!ds.done[item.key];
        if (checked) done++;

        const row = document.createElement("label");
        row.className = "item" + (checked ? " checked" : "");
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
        items.appendChild(row);
      }

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

  // ---------- Petit feedback ----------
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
