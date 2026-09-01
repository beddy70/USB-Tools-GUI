// Page mobile du serveur GAMES intégré à Turbo Everdrive USB Tools GUI.
// Servie par le serveur HTTP local (crates/app/src/mobile_server.rs) — pas
// de Tauri ici, juste fetch() vers l'API JSON exposée par ce même serveur.
// Portée volontairement réduite par rapport à l'onglet GAMES du bureau :
// catégories (+ catégorie virtuelle "GAMES" si la racine n'a pas de
// sous-dossier) → mosaïque avec pochette → lancer. Pas de Favoris, pas de
// changement de dossier/source de pochette (ça reste géré depuis
// l'ordinateur ; le téléphone hérite juste des réglages courants).

const $ = (id) => document.getElementById(id);
const app = $("app");
const statusEl = $("status");

const CATEGORY_PALETTE = [
  ["#ff3d6a", "#ff8a3d"],
  ["#22e0ff", "#2d6bff"],
  ["#b14bff", "#ff2dd4"],
  ["#3dff9a", "#12c2c2"],
  ["#ffd23d", "#ff7a3d"],
  ["#ff2dd4", "#8a3dff"],
  ["#3dd6ff", "#3dff9a"],
];

function categoryIcon(name) {
  const n = name.toLowerCase();
  const rules = [
    [/action|combat|beat|fight/, "⚔️"],
    [/r\.?p\.?g|r[oô]le/, "🐉"],
    [/plate|platform/, "🍄"],
    [/sport/, "⚽"],
    [/course|racing|voiture|moto/, "🏎️"],
    [/puzzle|r[eé]flex/, "🧩"],
    [/shoot|shmup|tir/, "🔫"],
    [/arcade/, "🕹️"],
    [/aventure|adventure/, "🗺️"],
    [/strat/, "♟️"],
    [/simu/, "🛠️"],
  ];
  for (const [re, icon] of rules) if (re.test(n)) return icon;
  return "🎮";
}

function fmtSize(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " Mo";
  if (b >= 1024) return Math.round(b / 1024) + " Ko";
  return b + " o";
}

function toast(msg, cls) {
  const el = document.createElement("div");
  el.className = "toast" + (cls ? " " + cls : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || ("Erreur " + res.status));
  return data;
}

// ---- statut de connexion (bandeau du haut) ----
async function refreshStatus() {
  try {
    const s = await getJSON("/api/state");
    statusEl.textContent = s.connected ? "🟢 " + (s.device_name || "Connecté") : "🔴 Déconnecté";
    statusEl.className = "status " + (s.connected ? "on" : "off");
    return s.connected;
  } catch {
    statusEl.textContent = "🔴 Serveur injoignable";
    statusEl.className = "status off";
    return false;
  }
}

// ---- modale de confirmation (remplace confirm(), peu fiable sur mobile) ----
function askConfirm(message) {
  return new Promise((resolve) => {
    const modal = $("modal");
    $("modal-msg").textContent = message;
    modal.hidden = false;
    const done = (v) => { modal.hidden = true; ok.removeEventListener("click", onOk); cancel.removeEventListener("click", onCancel); resolve(v); };
    const ok = $("modal-ok"), cancel = $("modal-cancel");
    const onOk = () => done(true);
    const onCancel = () => done(false);
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
  });
}

// ---- vue catégories ----
async function renderCategories() {
  app.innerHTML = "";
  const connected = await refreshStatus();
  if (!connected) {
    app.innerHTML = '<p class="hint">La carte n\'est pas connectée depuis l\'ordinateur.<br>Branchez la cartouche et cliquez « Connecter » dans l\'application.</p>';
    return;
  }
  let cats;
  try {
    cats = await getJSON("/api/categories");
  } catch (e) {
    app.innerHTML = '<p class="games-error">' + e.message + "</p>";
    return;
  }
  const list = document.createElement("div");
  list.className = "cat-list";
  cats.forEach((c, i) => {
    const [c1, c2] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
    const row = document.createElement("div");
    row.className = "cat-row";
    row.style.background = `linear-gradient(120deg, ${c1}, ${c2})`;
    row.innerHTML = `<span class="cat-icon">${c.key ? categoryIcon(c.label) : "🎮"}</span>
      <span class="cat-title">${c.label}</span><span class="cat-chev">›</span>`;
    row.addEventListener("click", () => renderMosaic(c.key, c.label, [c1, c2]));
    list.appendChild(row);
  });
  app.appendChild(list);
}

// ---- vue mosaïque ----
async function renderMosaic(categoryKey, label, colors) {
  app.innerHTML = "";
  const [c1, c2] = colors || CATEGORY_PALETTE[0];
  const wrap = document.createElement("div");
  wrap.style.background = `linear-gradient(160deg, ${c1}, ${c2})`;
  wrap.style.borderRadius = "16px";
  wrap.style.padding = "16px";
  wrap.style.margin = "-14px -14px 0";

  const header = document.createElement("div");
  header.className = "mosaic-header";
  const back = document.createElement("button");
  back.className = "btn ghost";
  back.textContent = "← Catégories";
  back.addEventListener("click", renderCategories);
  const title = document.createElement("h2");
  title.className = "mosaic-title";
  title.textContent = label;
  header.append(back, title);
  wrap.appendChild(header);

  let games;
  try {
    games = await getJSON("/api/games?category=" + encodeURIComponent(categoryKey));
  } catch (e) {
    const err = document.createElement("p");
    err.className = "games-error";
    err.textContent = e.message;
    wrap.appendChild(err);
    app.appendChild(wrap);
    return;
  }

  if (!games.length) {
    const err = document.createElement("p");
    err.className = "games-error";
    err.textContent = "Aucun jeu dans cette catégorie.";
    wrap.appendChild(err);
    app.appendChild(wrap);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "mosaic-grid";
  for (const g of games) {
    const card = document.createElement("div");
    card.className = "mosaic-card";
    const frame = document.createElement("div");
    frame.className = "mosaic-frame";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = g.name;
    img.src = "/api/cover?kind=boxart&name=" + encodeURIComponent(g.name);
    img.addEventListener("error", () => {
      frame.innerHTML = '<span class="ph">🎮</span>';
    }, { once: true });
    frame.appendChild(img);
    const label = document.createElement("div");
    label.className = "mosaic-label";
    label.textContent = g.name;
    card.append(frame, label);
    card.addEventListener("click", () => launchGame(g));
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  app.appendChild(wrap);
}

async function launchGame(g) {
  const ok = await askConfirm(`Lancer « ${g.name} » (${fmtSize(g.size)}) sur la console ?`);
  if (!ok) return;
  try {
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: g.path }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || ("Erreur " + res.status));
    toast("✔ " + (data.message || "Jeu lancé"), "ok");
  } catch (e) {
    toast("⚠ " + e.message, "err");
  }
}

renderCategories();
// Revérifie la connexion périodiquement (l'utilisateur peut connecter/
// déconnecter la carte depuis l'ordinateur pendant que le téléphone est ouvert).
setInterval(refreshStatus, 5000);
