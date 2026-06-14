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
  const DEFAULTS = { name: "Sidian", goal: 5000, daily: 8 };
  const PRIORITY = ["cursor", "tests", "produit", "marketing", "croissance", "strategie", "routine"];
  const dailyCount = () => (store.settings && store.settings.daily) || DEFAULTS.daily;

  const msByPhase = {};
  PHASES.forEach((p) => (msByPhase[p.id] = MILESTONES.filter((m) => m.phase === p.id)));

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
  if (!store.milestones) store.milestones = {};
  if (!store.batchDone) store.batchDone = {};
  if (!store.settings) store.settings = { ...DEFAULTS };

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

  // ---------- Génération d'une liste (répartie entre catégories) ----------
  // `n` est l'index de la liste : il n'avance que lorsque la liste est terminée,
  // donc la liste reste STABLE tant que tout n'est pas coché.
  function genKeys(phase, n) {
    const cats = [];
    for (const id of PRIORITY) {
      const cat = CATS.find((c) => c.id === id);
      const eligible = [];
      cat.tasks.forEach((task, i) => {
        if (task.p.includes(phase)) eligible.push(i);
      });
      if (!eligible.length) continue;
      const order = seededOrder(eligible.length, hashStr(cat.id + "@" + phase));
      const start = ((n % eligible.length) + eligible.length) % eligible.length;
      cats.push({ cat, eligible, order, start, taken: 0 });
    }
    const out = [];
    const limit = dailyCount();
    let progress = true;
    while (out.length < limit && progress) {
      progress = false;
      for (const c of cats) {
        if (out.length >= limit) break;
        if (c.taken >= c.eligible.length) continue;
        const idx = c.eligible[c.order[(c.start + c.taken) % c.eligible.length]];
        out.push(`${c.cat.id}#${idx}`);
        c.taken++;
        progress = true;
      }
    }
    return out;
  }

  function resolveTask(key) {
    const hash = key.indexOf("#");
    const cid = key.slice(0, hash);
    const idx = parseInt(key.slice(hash + 1), 10);
    const cat = CATS.find((c) => c.id === cid);
    return { cat, text: cat.tasks[idx].t };
  }

  // La liste courante est conservée tant qu'elle n'est pas entièrement cochée.
  // Elle ne change que dans 2 cas : (1) tout est coché → liste suivante,
  // (2) l'étape change (jalon coché) → liste adaptée à la nouvelle étape.
  function ensureBatch() {
    const phase = currentPhase();
    const b = store.batch;
    if (!b || b.phase !== phase || !Array.isArray(b.keys)) {
      const n = b && typeof b.n === "number" ? b.n : 0;
      store.batch = { phase, n, keys: genKeys(phase, n) };
      store.batchDone = {};
      saveStore();
    }
  }

  function advanceIfDone() {
    const keys = store.batch.keys || [];
    if (keys.length && keys.every((k) => store.batchDone[k])) {
      const phase = currentPhase();
      const n = store.batch.n + 1;
      store.batch = { phase, n, keys: genKeys(phase, n) };
      store.batchDone = {};
      saveStore();
      showToast("✅ Liste terminée — voici la suite !");
      return true;
    }
    return false;
  }

  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);
  const listEl = el("list");
  const setupEl = el("setup");

  function frenchDate(d) {
    const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- Bascule entre écrans (onboarding / avancement) et liste ----------
  function setupMode(on) {
    // Masquage infaillible : style inline (prioritaire sur le CSS) + attribut hidden.
    setupEl.hidden = !on;
    listEl.hidden = on;
    setupEl.style.display = on ? "flex" : "none";
    listEl.style.display = on ? "none" : "flex";
    el("dateLabel").style.visibility = on ? "hidden" : "";
    document.querySelectorAll(".daynav .nav").forEach((b) => {
      b.style.display = on ? "none" : "";
    });
  }

  function phaseFrom(ms) {
    for (let p = MIN_PHASE; p < MAX_PHASE; p++) {
      const list = msByPhase[p] || [];
      if (list.length && !list.every((m) => ms[m.id])) return p;
    }
    return MAX_PHASE;
  }

  function closeSetup() {
    store.setupDone = true;
    saveStore();
    setupEl.className = "setup";
    setupMode(false);
    render();
  }

  // ---------- Onboarding : parcours guidé multi-étapes ----------
  const WIZ_STEPS = 4;
  let wiz = { step: 0, checked: {}, settings: { ...DEFAULTS } };

  function startWizard() {
    wiz = { step: 0, checked: {}, settings: { ...store.settings } };
    setupMode(true);
    renderWizard();
  }

  function navButtons(opts) {
    const foot = document.createElement("div");
    foot.className = "wiz-foot";
    if (opts.back) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-ghost";
      b.textContent = "Retour";
      b.addEventListener("click", opts.back);
      foot.appendChild(b);
    }
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn-primary";
    next.textContent = opts.nextLabel || "Continuer";
    next.disabled = !!opts.nextDisabled;
    next.addEventListener("click", opts.next);
    foot.appendChild(next);
    return foot;
  }

  function renderWizard() {
    setupEl.className = "setup wizard";
    setupEl.innerHTML = "";

    const dots = document.createElement("div");
    dots.className = "wiz-dots";
    for (let i = 0; i < WIZ_STEPS; i++) {
      const d = document.createElement("span");
      d.className = "wiz-dot" + (i === wiz.step ? " on" : "") + (i < wiz.step ? " done" : "");
      dots.appendChild(d);
    }
    setupEl.appendChild(dots);

    const body = document.createElement("div");
    body.className = "wiz-body";
    setupEl.appendChild(body);

    if (wiz.step === 0) stepWelcome(body);
    else if (wiz.step === 1) stepInfo(body);
    else if (wiz.step === 2) stepJalons(body);
    else stepDone(body);
  }

  function stepWelcome(body) {
    el("title").textContent = "Bienvenue 👋";
    body.innerHTML =
      `<div class="wiz-hero">` +
      `<div class="wiz-hero-icon">✅</div>` +
      `<h2 class="wiz-h2">Construis Sidian, un jour à la fois</h2>` +
      `<p class="wiz-p">Chaque jour, une courte liste de tâches concrètes pour faire avancer ton SaaS — Cursor/dev, stratégie, marketing… adaptée à là où tu en es.</p>` +
      `<p class="wiz-p">En 30 secondes, dis-nous où tu en es.</p>` +
      `</div>`;
    setupEl.appendChild(
      navButtons({
        nextLabel: "Commencer",
        next: () => {
          wiz.step = 1;
          renderWizard();
        },
      })
    );
  }

  function field(labelText, type, key, placeholder) {
    const wrap = document.createElement("label");
    wrap.className = "wiz-field";
    const lab = document.createElement("span");
    lab.className = "wiz-label";
    lab.textContent = labelText;
    const input = document.createElement("input");
    input.type = type;
    if (type === "number") {
      input.inputMode = "numeric";
      input.min = "1";
    }
    input.placeholder = placeholder;
    input.value = wiz.settings[key] != null ? wiz.settings[key] : "";
    input.addEventListener("input", () => {
      wiz.settings[key] = type === "number" ? input.value.replace(/[^0-9]/g, "") : input.value;
    });
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }

  function stepInfo(body) {
    el("title").textContent = "Tes infos";
    const sub = document.createElement("p");
    sub.className = "wiz-p";
    sub.textContent = "Remplis ces quelques champs (tu pourras t'en servir comme repères).";
    body.appendChild(sub);

    const fields = document.createElement("div");
    fields.className = "wiz-fields";
    fields.appendChild(field("Nom de ton SaaS", "text", "name", "Sidian"));
    fields.appendChild(field("Objectif de revenu mensuel (€)", "number", "goal", "5000"));
    fields.appendChild(field("Combien de tâches par jour ?", "number", "daily", "8"));
    body.appendChild(fields);

    setupEl.appendChild(
      navButtons({
        back: () => {
          wiz.step = 0;
          renderWizard();
        },
        next: () => {
          // Nettoyage / valeurs par défaut.
          wiz.settings.name = (wiz.settings.name || "").trim() || DEFAULTS.name;
          wiz.settings.goal = Math.max(0, parseInt(wiz.settings.goal, 10) || DEFAULTS.goal);
          wiz.settings.daily = Math.min(15, Math.max(3, parseInt(wiz.settings.daily, 10) || DEFAULTS.daily));
          wiz.step = 2;
          renderWizard();
        },
      })
    );
  }

  function stepJalons(body) {
    el("title").textContent = "Qu'as-tu déjà fait ?";
    const sub = document.createElement("p");
    sub.className = "wiz-p";
    sub.textContent =
      "Coche tout ce qui est déjà fait. Le reste deviendra automatiquement tes prochaines tâches.";
    body.appendChild(sub);

    for (const ph of PHASES) {
      const group = document.createElement("div");
      group.className = "ms-group";
      const head = document.createElement("div");
      head.className = "ms-head";
      head.innerHTML =
        `<span class="ms-emoji">${ph.emoji}</span>` +
        `<span class="ms-name">Étape ${ph.id} — ${ph.name}</span>`;
      group.appendChild(head);

      for (const m of msByPhase[ph.id] || []) {
        const row = document.createElement("label");
        const checked = !!wiz.checked[m.id];
        row.className = "ms-row" + (checked ? " checked" : "");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = checked;
        box.addEventListener("change", () => {
          if (box.checked) wiz.checked[m.id] = true;
          else delete wiz.checked[m.id];
          row.classList.toggle("checked", box.checked);
        });
        const txt = document.createElement("span");
        txt.className = "ms-text";
        txt.textContent = m.t;
        row.appendChild(box);
        row.appendChild(txt);
        group.appendChild(row);
      }
      body.appendChild(group);
    }

    setupEl.appendChild(
      navButtons({
        back: () => {
          wiz.step = 1;
          renderWizard();
        },
        next: () => {
          wiz.step = 3;
          renderWizard();
        },
      })
    );
  }

  function stepDone(body) {
    el("title").textContent = "C'est parti 🚀";
    const ph = PHASES.find((p) => p.id === phaseFrom(wiz.checked));
    const goalTxt = wiz.settings.goal
      ? `Objectif : ${Number(wiz.settings.goal).toLocaleString("fr-FR")}€/mois. `
      : "";
    body.innerHTML =
      `<div class="wiz-hero">` +
      `<div class="wiz-hero-icon">${ph.emoji}</div>` +
      `<h2 class="wiz-h2">${wiz.settings.name} — étape ${ph.id} : ${ph.name}</h2>` +
      `<p class="wiz-p">${goalTxt}Chaque jour, ${wiz.settings.daily} tâches adaptées. La liste ne change que lorsque tu as tout coché. Mets à jour ce qui est fait via <b>📋 Mon avancement</b>.</p>` +
      `</div>`;
    setupEl.appendChild(
      navButtons({
        back: () => {
          wiz.step = 2;
          renderWizard();
        },
        nextLabel: "Voir mes tâches",
        next: () => {
          store.settings = { ...wiz.settings };
          store.milestones = { ...wiz.checked };
          store.batch = null; // forcer une nouvelle liste selon les réglages
          closeSetup();
        },
      })
    );
  }

  // ---------- Écran « Mon avancement » (⚙︎, modifiable à tout moment) ----------
  function showProgress() {
    setupMode(true);
    setupEl.className = "setup progress";
    setupEl.innerHTML = "";
    el("title").textContent = "Mon avancement";

    const intro = document.createElement("p");
    intro.className = "setup-intro";
    intro.textContent =
      "Coche un jalon dès qu'il est terminé. L'app ajuste automatiquement ton étape et tes tâches du jour.";
    setupEl.appendChild(intro);

    for (const ph of PHASES) {
      const group = document.createElement("div");
      group.className = "ms-group";
      const head = document.createElement("div");
      head.className = "ms-head";
      const ms = msByPhase[ph.id] || [];
      head.innerHTML =
        `<span class="ms-emoji">${ph.emoji}</span>` +
        `<span class="ms-name">Étape ${ph.id} — ${ph.name}</span>` +
        `<span class="ms-count">${ms.filter((m) => store.milestones[m.id]).length}/${ms.length}</span>`;
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
    cta.textContent = "Terminé";
    cta.addEventListener("click", closeSetup);
    setupEl.appendChild(cta);
  }


  // ---------- Rendu de la liste courante ----------
  function render() {
    ensureBatch();
    el("title").textContent = "Aujourd'hui";
    el("dateLabel").textContent = frenchDate(new Date());

    listEl.innerHTML = "";
    for (const key of store.batch.keys) {
      const { cat, text } = resolveTask(key);
      const checked = !!store.batchDone[key];

      const row = document.createElement("div");
      row.className = "item" + (checked ? " checked" : "");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      box.addEventListener("change", () => toggle(key, box.checked));

      const emoji = document.createElement("span");
      emoji.className = "item-emoji";
      emoji.textContent = cat.emoji;

      const txt = document.createElement("span");
      txt.className = "item-text";
      txt.textContent = text;

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
  }

  function toggle(key, checked) {
    if (checked) {
      store.batchDone[key] = true;
      playWin();
    } else {
      delete store.batchDone[key];
    }
    saveStore();
    advanceIfDone(); // si tout est coché → liste suivante
    render();
  }

  // Petit son de victoire (généré localement, aucun fichier, marche hors-ligne).
  let audioCtx;
  function playWin() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      [[784, 0], [1175, 0.08]].forEach(([f, t]) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(0.16, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(now + t);
        o.stop(now + t + 0.18);
      });
    } catch (e) {}
  }

  // ---------- Feedback ----------
  let toastTimer;
  function showToast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Actions ----------
  el("editStage").addEventListener("click", () => showProgress());

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
    startWizard();
  }
})();
