// Page mobile du serveur GAMES intégré à Turbo Everdrive USB Tools GUI.
// Servie par le serveur HTTP local (crates/app/src/mobile_server.rs) — pas
// de Tauri ici, juste fetch() vers l'API JSON exposée par ce même serveur.
// Portée volontairement réduite par rapport à l'onglet GAMES du bureau :
// catégories (+ virtuelles GAMES et Favoris) → mosaïque avec pochette →
// fiche détail (écran-titre/capture alternés, favoris) → lancer. Pas de
// changement de dossier de jeux ni de source de pochette depuis le
// téléphone (ça reste géré depuis l'ordinateur ; le téléphone hérite juste
// des réglages courants). Les favoris, eux, sont un état partagé avec le
// bureau (voir favorites.rs) : ajouter/retirer ici se voit immédiatement
// dans l'app desktop et vice-versa.

const $ = (id) => document.getElementById(id);
const app = $("app");
const statusEl = $("status");
const FAVORITES_KEY = "__FAVORITES__";

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
    const icon = c.key === FAVORITES_KEY ? "❤️" : (c.key ? categoryIcon(c.label) : "🎮");
    row.innerHTML = `<span class="cat-icon">${icon}</span>
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
    err.textContent = categoryKey === FAVORITES_KEY
      ? "Aucun favori pour l'instant. Ouvrez la fiche d'un jeu et touchez ♡ pour l'ajouter."
      : "Aucun jeu dans cette catégorie.";
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
    card.addEventListener("click", () => openDetail(g));
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  app.appendChild(wrap);
}

// ---- fiche de détail (tap sur une vignette) ----
// Vérifie qu'une image se charge réellement (le serveur renvoie 404 en PNG
// absent — <img src> seul ne dit pas si ça a marché tant qu'on n'écoute pas
// load/error).
function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

let detailTarget = null; // { name, size, path }
let detailSnapTimer = null;

function stopDetailSnapSlideshow() {
  if (detailSnapTimer) { clearInterval(detailSnapTimer); detailSnapTimer = null; }
  $("detail-snap-wrap").hidden = true;
}

// Alterne écran-titre / capture en jeu toutes les 2s quand les deux sont
// disponibles (même logique que la fiche de détail du bureau) ; si un seul
// des deux existe, il reste affiché fixe, sans bascule.
async function startDetailSnapSlideshow(name) {
  stopDetailSnapSlideshow();
  const titleUrl = "/api/cover?kind=title&name=" + encodeURIComponent(name);
  const snapUrl = "/api/cover?kind=snap&name=" + encodeURIComponent(name);
  const [hasTitle, hasSnap] = await Promise.all([probeImage(titleUrl), probeImage(snapUrl)]);
  if (detailTarget?.name !== name) return; // fiche fermée/changée entre-temps

  const frames = [];
  if (hasTitle) frames.push({ uri: titleUrl, label: "Écran-titre" });
  if (hasSnap) frames.push({ uri: snapUrl, label: "Capture en jeu" });
  if (!frames.length) return;

  const wrap = $("detail-snap-wrap"), img = $("detail-snap"), label = $("detail-snap-label");
  wrap.hidden = false;
  let idx = 0;
  const show = () => {
    img.src = frames[idx].uri;
    label.textContent = frames[idx].label;
    label.hidden = frames.length < 2;
  };
  show();
  if (frames.length > 1) {
    detailSnapTimer = setInterval(() => { idx = (idx + 1) % frames.length; show(); }, 2000);
  }
}

async function updateDetailFavBtn(full) {
  const favs = await getJSON("/api/favorites").catch(() => []);
  const fav = favs.some((f) => f.full === full);
  const btn = $("detail-fav");
  btn.textContent = fav ? "♥" : "♡";
  btn.classList.toggle("active", fav);
  btn.title = fav ? "Retirer des favoris" : "Ajouter aux favoris";
}

async function openDetail(g) {
  detailTarget = g;
  $("detail-title").textContent = g.name;
  $("detail-meta").textContent = fmtSize(g.size);

  const img = $("detail-boxart"), ph = $("detail-boxart-ph");
  img.hidden = true; ph.hidden = false;
  stopDetailSnapSlideshow();
  $("detail-modal").hidden = false;
  updateDetailFavBtn(g.path);

  const boxartUrl = "/api/cover?kind=boxart&name=" + encodeURIComponent(g.name);
  probeImage(boxartUrl).then((has) => {
    if (detailTarget !== g) return; // fermé/changé entre-temps
    if (has) { img.src = boxartUrl; img.hidden = false; ph.hidden = true; }
  });
  startDetailSnapSlideshow(g.name);
}

function closeDetail() {
  $("detail-modal").hidden = true;
  stopDetailSnapSlideshow();
  detailTarget = null;
}
$("detail-close").addEventListener("click", closeDetail);
$("detail-fav").addEventListener("click", async () => {
  if (!detailTarget) return;
  await fetch("/api/favorites/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full: detailTarget.path, name: detailTarget.name, size: detailTarget.size }),
  });
  await updateDetailFavBtn(detailTarget.path);
});
$("detail-launch").addEventListener("click", () => {
  if (detailTarget) { closeDetail(); launchGame(detailTarget); }
});

// La fiche de détail sert déjà d'écran de confirmation (comme sur le
// bureau) : pas de second "êtes-vous sûr ?" ici, on lance directement.
async function launchGame(g) {
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
