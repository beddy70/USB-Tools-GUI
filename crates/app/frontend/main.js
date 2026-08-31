// Frontend de l'outil Turbo EverDrive.
// Utilise l'API globale Tauri (withGlobalTauri) : window.__TAURI__

const { core, event } = window.__TAURI__;
const invoke = (cmd, args) => core.invoke(cmd, args);

// Change de langue en cours d'utilisation (voir i18n.js) : les textes
// statiques (data-i18n) se réappliquent seuls, mais les textes dynamiques
// (journal déjà écrit, libellés calculés, onglets déjà rendus) doivent être
// régénérés explicitement. Chaque module s'enregistre ici.
const langChangeHandlers = [];
function onLangChange(fn) { langChangeHandlers.push(fn); }
document.addEventListener("i18n:changed", () => langChangeHandlers.forEach((fn) => fn()));

const $ = (id) => document.getElementById(id);
const els = {
  connDot: $("conn-dot"), connLabel: $("conn-label"),
  portSelect: $("port-select"), portManual: $("port-manual"), infoCard: $("info-card"), infoText: $("info-text"),
  crumbs: $("crumbs"), explorer: $("explorer"), explorerEmpty: $("explorer-empty"),
  explorerStatus: $("explorer-status"),
  explorerUp: $("explorer-up"), explorerRefresh: $("explorer-refresh"), explorerImport: $("explorer-import"),
  sdCtxMenu: $("sd-ctxmenu"),
  modal: $("app-modal"), modalMsg: $("modal-msg"), modalInput: $("modal-input"),
  modalOk: $("modal-ok"), modalCancel: $("modal-cancel"),
  transferBar: $("transfer-bar"), transferLabel: $("transfer-label"),
  transferPct: $("transfer-pct"), transferFill: $("transfer-fill"),
  viewIcons: $("view-icons"), viewList: $("view-list"),
  gamesExplorer: $("games-explorer"),
  gameModal: $("game-modal"), gameModalClose: $("game-modal-close"),
  gameBoxart: $("game-boxart"), gameBoxartPh: $("game-boxart-ph"),
  gameTitle: $("game-title"), gameMeta: $("game-meta"), gameMatchInfo: $("game-match-info"),
  gameSnapWrap: $("game-snap-wrap"), gameSnap: $("game-snap"), gameSnapLabel: $("game-snap-label"),
  gamePlay: $("game-play"), gameDownload: $("game-download"), gameFav: $("game-fav"),
  romPath: $("rom-path"), screenCard: $("screen-card"), screenImg: $("screen-img"),
  batW: $("bat-w"), batH: $("bat-h"), resW: $("res-w"), resH: $("res-h"),
  scrollX: $("scroll-x"), scrollY: $("scroll-y"),
  batWVal: $("bat-w-val"), batHVal: $("bat-h-val"),
  resWVal: $("res-w-val"), resHVal: $("res-h-val"),
  scrollXVal: $("scroll-x-val"), scrollYVal: $("scroll-y-val"),
  log: $("log"),
};

// ------------------------------------------------------------- modale
// Remplace confirm()/prompt() natifs : pas fiables dans une WebView
// embarquée (Tauri/WebView2/WKWebView n'affichent pas toujours ces
// dialogues sans implémentation hôte dédiée — cause probable du menu
// contextuel « Renommer »/« Effacer » sans effet visible). Une seule
// instance à la fois ; `resolveModal` referme la précédente si besoin.
let resolveModal = null;
function closeModal(result) {
  els.modal.hidden = true;
  if (resolveModal) { const r = resolveModal; resolveModal = null; r(result); }
}
els.modal.addEventListener("click", (e) => { if (e.target === els.modal) closeModal(false); });
els.modalCancel.addEventListener("click", () => closeModal(false));
els.modalOk.addEventListener("click", () => {
  closeModal(els.modalInput.hidden ? true : els.modalInput.value);
});
els.modalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); els.modalOk.click(); }
  else if (e.key === "Escape") closeModal(false);
});

/** Remplace `confirm()`. Résout `true`/`false`. */
function askConfirm(message) {
  if (resolveModal) closeModal(false);
  els.modalMsg.textContent = message;
  els.modalInput.hidden = true;
  els.modal.hidden = false;
  els.modalOk.focus();
  return new Promise((resolve) => { resolveModal = resolve; });
}

/** Remplace `prompt()`. Résout la valeur saisie, ou `null` si annulé. */
function askPrompt(message, defaultValue = "") {
  if (resolveModal) closeModal(false);
  els.modalMsg.textContent = message;
  els.modalInput.hidden = false;
  els.modalInput.value = defaultValue;
  els.modal.hidden = false;
  els.modalInput.focus();
  els.modalInput.select();
  return new Promise((resolve) => {
    resolveModal = (v) => resolve(v === false ? null : v);
  });
}

// État de l'explorateur de carte SD.
let explorerPath = "";   // chemin SD courant ("" = racine)
let explorerBusy = false;
let explorerView = "grid"; // "grid" = icônes, "list" = liste
const EXPLORER_MTYPE = "text/x-ted-sd";
let lastScreenB64 = null;  // dernière capture (base64)
// Choix discrètes proposés par les curseurs de capture (index du curseur -> valeur).
const BAT_W_CHOICES = [32, 64, 128];   // largeur du BAT en tuiles
const BAT_H_CHOICES = [32, 64];        // hauteur du BAT en tuiles
const RES_W_CHOICES = [256, 320, 336, 352, 512]; // largeur d'affichage en px
const RES_H_CHOICES = [224, 240];      // hauteur d'affichage en px

// Fonction exposée par le visualiseur mémoire : vide le cache des banques et
// re-rend les données visibles, afin de relire l'état frais de l'émulateur.
// Renseignée par le module mémoire (hex-viewer). Appelée après un chargement
// de ROM, un reset ou une (re)connexion, et à l'ouverture de l'onglet Mémoire.
let invalidateMemCache = null;

// Renseignée par le visualiseur mémoire : (ré)applique la politique de lecture
// de la vue RAM selon la cible (émulateur = lectures libres ; matériel réel =
// mode conservateur). Appelée après chaque (dé)connexion.
let configureMemForDevice = null;

// Vrai uniquement quand l'hôte parle à l'émulateur virtuel. Sur matériel réel,
// chaque CMD_MEM_RD gèle le CPU PC-Engine le temps du transfert : le
// visualiseur mémoire se met alors en mode conservateur.
let isEmulator = false;

// ---------------------------------------------------------------- journal
function log(msg, cls = "") {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

async function safeInvoke(cmd, args, okMsg) {
  try {
    const res = await invoke(cmd, args);
    if (okMsg) log(okMsg, "ok");
    return res;
  } catch (e) {
    const msg = String(e);
    log(msg, "err");
    // Le backend referme la connexion et préfixe ainsi le message quand une
    // erreur d'E/S a rendu le port série inutilisable (vu sur matériel réel :
    // sinon chaque commande suivante répète la même erreur cryptique). On
    // repasse l'UI en « Déconnecté » plutôt que de laisser croire que la
    // carte répond encore.
    if (msg.includes("connexion perdue")) {
      setConnected(false);
      els.infoCard.hidden = true;
    }
    return null;
  }
}

function setConnected(connected) {
  els.connDot.classList.toggle("on", connected);
  els.connLabel.textContent = connected ? t("conn.connected") : t("conn.disconnected");
}
onLangChange(() => setConnected(els.connDot.classList.contains("on")));

// ---------------------------------------------------------------- onglets
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "games") renderGamesTab();
    if (btn.dataset.tab === "transfer") renderExplorer();
    // À l'ouverture de l'onglet Mémoire : sur l'émulateur, on relit les données
    // fraîches (le cache peut être périmé après un load/reset). Sur matériel
    // réel, on ne lit rien automatiquement — l'utilisateur clique « Rafraîchir »
    // (chaque lecture vole des cycles au CPU PC-Engine).
    if (btn.dataset.tab === "memory" && isEmulator && invalidateMemCache) invalidateMemCache();
    if (btn.dataset.tab === "sprites" && openSpritesTab) openSpritesTab();
  });
});

// Renseignée par le visualiseur de tuiles VRAM ; appelée à l'ouverture de l'onglet.
let openSpritesTab = null;

// ---------------------------------------------------------------- ports
async function refreshPorts() {
  const ports = await safeInvoke("list_ports");
  els.portSelect.innerHTML = "";
  if (ports && ports.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("connect.auto");
    els.portSelect.appendChild(opt);
    ports.forEach((p) => {
      const o = document.createElement("option");
      o.value = p; o.textContent = p;
      els.portSelect.appendChild(o);
    });
  } else {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = t("connect.noPort");
    els.portSelect.appendChild(opt);
  }
}

async function doConnect() {
  const manual = (els.portManual && els.portManual.value.trim()) || "";
  const port = manual || els.portSelect.value || null;
  if (!manual && !els.portSelect.value) {
    log(t("connect.scanning"), "info");
  }
  const info = await safeInvoke("connect", { port }, t("connect.connectedLog"));
  if (!info) {
    if (!manual) {
      log(t("connect.noAutoFound"), "err");
    }
    return;
  }
  setConnected(true);
  els.infoCard.hidden = false;
  els.infoText.textContent = info.info;
  isEmulator = !!info.is_emulator;
  log(t("connect.nameLine", { name: info.name, port: info.port, emu: isEmulator ? t("connect.emulatorSuffix") : "" }), "info");
  if (!isEmulator) {
    log(t("connect.realHardwareHint"), "info");
  }
  if (configureMemForDevice) configureMemForDevice(isEmulator);
  // Sur l'émulateur, la mémoire est observable sans coût : on relit tout de
  // suite. Sur matériel, on attend un clic explicite « Rafraîchir ».
  if (isEmulator && invalidateMemCache) invalidateMemCache();
}

async function doDisconnect() {
  await safeInvoke("disconnect", {}, t("connect.disconnectedLog"));
  setConnected(false);
  els.infoCard.hidden = true;
  isEmulator = false;
  if (configureMemForDevice) configureMemForDevice(false);
}

onLangChange(refreshPorts);
$("refresh-ports").addEventListener("click", refreshPorts);
$("connect-btn").addEventListener("click", doConnect);
$("disconnect-btn").addEventListener("click", doDisconnect);

// ------------------------------------------- explorateur de carte SD
function joinSdPath(dir, name) {
  return dir ? dir.replace(/\/+$/, "") + "/" + name : name;
}

function parentPath(dir) {
  const clean = (dir || "").replace(/\/+$/, "");
  if (!clean) return "";
  const idx = clean.lastIndexOf("/");
  return idx <= 0 ? "" : clean.slice(0, idx);
}

const ROM_EXTS = ["pce", "sgx", "rom", "bin"];
function isRomFile(entry) {
  if (entry.is_dir) return false;
  const ext = (entry.name.split(".").pop() || "").toLowerCase();
  return ROM_EXTS.includes(ext);
}

function iconFor(entry) {
  if (entry.is_dir) return "📁";
  const ext = (entry.name.split(".").pop() || "").toLowerCase();
  if (ROM_EXTS.includes(ext)) return "🎮";
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext)) return "🖼️";
  if (["txt", "md", "ini", "log", "cfg", "json"].includes(ext)) return "📄";
  if (["sav", "ram", "bram"].includes(ext)) return "💾";
  return "📦";
}

function fmtSize(b) {
  const unit = currentLang === "en" ? { mb: " MB", kb: " KB", b: " B" } : { mb: " Mo", kb: " Ko", b: " o" };
  if (b >= 1048576) return (b / 1048576).toFixed(1) + unit.mb;
  if (b >= 1024) return Math.round(b / 1024) + unit.kb;
  return b + unit.b;
}

function renderCrumbs() {
  const sep = () => {
    const s = document.createElement("span");
    s.className = "crumb sep"; s.textContent = "›"; return s;
  };
  els.crumbs.innerHTML = "";
  const rootBtn = document.createElement("button");
  rootBtn.className = "crumb root";
  rootBtn.textContent = "SD:/";
  rootBtn.addEventListener("click", () => { explorerPath = ""; renderExplorer(); });
  els.crumbs.appendChild(rootBtn);
  if (!explorerPath) return;
  const parts = explorerPath.replace(/\/+$/, "").split("/").filter(Boolean);
  let acc = "";
  parts.forEach((p, i) => {
    els.crumbs.appendChild(sep());
    acc = acc ? acc + "/" + p : p;
    const b = document.createElement("button");
    b.className = "crumb" + (i === parts.length - 1 ? " root" : "");
    b.textContent = p;
    b.addEventListener("click", () => { explorerPath = acc; renderExplorer(); });
    els.crumbs.appendChild(b);
  });
}

async function renderExplorer() {
  if (explorerBusy) return;
  explorerBusy = true;

  renderCrumbs();
  els.explorer.innerHTML = "";
  els.explorerEmpty.hidden = true;
  els.explorerStatus.textContent = t("sd.loading");
  els.explorerStatus.className = "explorer-status";

  const entries = await safeInvoke("list_sd", { path: explorerPath });
  if (!entries) {
    els.explorerStatus.textContent = t("sd.listErr");
    els.explorerStatus.className = "explorer-status err";
    explorerBusy = false;
    return;
  }
  const sorted = [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  if (!sorted.length) {
    els.explorerEmpty.hidden = false;
    els.explorerStatus.textContent = t("sd.emptyFolder");
    explorerBusy = false;
    return;
  }

  const container = explorerView === "list" ? renderList(sorted) : renderGrid(sorted);
  els.explorer.appendChild(container);
  els.explorerStatus.textContent =
    t("sd.itemCount", { count: sorted.length, path: explorerPath ? explorerPath : t("sd.root") });
  explorerBusy = false;
}
onLangChange(() => { if ($("tab-transfer").classList.contains("active")) renderExplorer(); });

// ------------------------------------------------------------------ vue grille
function renderGrid(sorted) {
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const entry of sorted) {
    const card = document.createElement("div");
    card.className = "entry" + (entry.is_dir ? " is-dir" : " is-file");
    card.draggable = !entry.is_dir; // seuls les fichiers se téléchargent
    card.title = entry.is_dir ? t("sd.openFolder") : t("sd.download");

    const icon = document.createElement("div");
    icon.className = "eicon"; icon.textContent = iconFor(entry);
    const name = document.createElement("div");
    name.className = "ename"; name.textContent = entry.name;
    const size = document.createElement("div");
    size.className = "esize"; size.textContent = entry.is_dir ? t("sd.folder") : fmtSize(entry.size);
    const tag = document.createElement("div");
    tag.className = "etag";
    tag.textContent = entry.is_dir ? "DIR" : (entry.name.split(".").pop() || "FILE").toUpperCase();

    card.appendChild(icon); card.appendChild(name); card.appendChild(size);
    if (!entry.is_dir) card.appendChild(tag);

    const full = joinSdPath(explorerPath, entry.name);

    if (entry.is_dir) {
      card.addEventListener("click", () => { explorerPath = full; renderExplorer(); });
    } else {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(EXPLORER_MTYPE, full);
        e.dataTransfer.setData("text/plain", entry.name);
        e.dataTransfer.effectAllowed = "copy";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dblclick", () => playSd(entry, full));
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, entry, full);
      });
      const dl = document.createElement("button");
      dl.className = "dlbtn"; dl.textContent = "⬇"; dl.title = t("sd.downloadBtn");
      dl.addEventListener("click", (e) => { e.stopPropagation(); doDownloadSd(full); });
      card.appendChild(dl);
    }
    grid.appendChild(card);
  }
  return grid;
}

// ------------------------------------------------------------------ vue liste
function renderList(sorted) {
  const table = document.createElement("table");
  table.className = "explorer-list";
  const thead = document.createElement("thead");
  thead.innerHTML =
    `<tr><th></th><th>${t("sd.colName")}</th><th>${t("sd.colType")}</th><th>${t("sd.colSize")}</th><th></th></tr>`;
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const entry of sorted) {
    const full = joinSdPath(explorerPath, entry.name);
    const tr = document.createElement("tr");
    tr.className = entry.is_dir ? "is-dir" : "is-file";

    const tdIcon = document.createElement("td");
    tdIcon.className = "licon"; tdIcon.textContent = iconFor(entry);

    const tdName = document.createElement("td");
    tdName.className = "lname"; tdName.textContent = entry.name;

    const tdType = document.createElement("td");
    tdType.className = "ltype";
    tdType.textContent = entry.is_dir ? t("sd.folder")
      : (entry.name.split(".").pop() || t("sd.file")).toUpperCase();

    const tdSize = document.createElement("td");
    tdSize.className = "lsize";
    tdSize.textContent = entry.is_dir ? "—" : fmtSize(entry.size);

    const tdAct = document.createElement("td");
    tdAct.className = "lact";
    if (!entry.is_dir) {
      const dl = document.createElement("button");
      dl.className = "dlbtn"; dl.textContent = "⬇"; dl.title = t("sd.downloadBtn");
      dl.addEventListener("click", (e) => { e.stopPropagation(); doDownloadSd(full); });
      tdAct.appendChild(dl);
    }

    tr.appendChild(tdIcon); tr.appendChild(tdName); tr.appendChild(tdType);
    tr.appendChild(tdSize); tr.appendChild(tdAct);

    if (entry.is_dir) {
      tr.classList.add("dir-link");
      tr.addEventListener("click", () => { explorerPath = full; renderExplorer(); });
    } else {
      tr.addEventListener("dblclick", () => playSd(entry, full));
      tr.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, entry, full);
      });
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// ------------------------------------------------------------ vue « Jeux »
// Navigateur dédié en deux niveaux, ancré sur un dossier de base configurable
// (persisté), indépendant du dossier courant de l'explorateur générique :
//
//   <dossier de base>/<Catégorie>/<ROM>          (ex. sd:/GAMES/Action/Jeu.pce)
//
// Niveau 1 (catégories) : liste colorée, gros texte façon borne d'arcade.
// Niveau 2 (mosaïque) : grille de pochettes (Libretro Thumbnails) de la
// catégorie choisie, clic -> fiche détaillée (Jouer/Télécharger).
const boxartCache = new Map(); // nom de fichier -> data URI (ou null = introuvable)
const GAMES_ROOT_KEY = "edlink.gamesRoot";
const DEFAULT_GAMES_ROOT = "sd:/GAMES";

function normalizeGamesPath(p) {
  const t = (p || "").trim();
  if (!t) return DEFAULT_GAMES_ROOT;
  return /^sd:/i.test(t) ? t : "sd:/" + t.replace(/^\/+/, "");
}

function getGamesRoot() {
  try { return normalizeGamesPath(localStorage.getItem(GAMES_ROOT_KEY) || DEFAULT_GAMES_ROOT); }
  catch { return DEFAULT_GAMES_ROOT; }
}

function saveGamesRoot(path) {
  try { localStorage.setItem(GAMES_ROOT_KEY, path); } catch { /* stockage indisponible : tant pis, valeur en mémoire seulement */ }
}

// Correspondance manuelle nom de ROM -> titre à chercher dans Libretro
// Thumbnails, pour les jeux que la correspondance automatique (codes région
// GoodTools/TOSEC -> No-Intro) ne trouve pas. Persistée comme le dossier de
// jeux ; { "Jeu (U).pce": "Jeu Correct Title" } (titre SANS extension —
// l'extension d'origine est réutilisée pour garder le bon dépôt TG16/SGX).
const NAME_MAP_KEY = "edlink.thumbNameMap";

function getNameMap() {
  try { return JSON.parse(localStorage.getItem(NAME_MAP_KEY) || "{}"); }
  catch { return {}; }
}

function saveNameMapEntry(romName, mappedTitle) {
  const map = getNameMap();
  if (mappedTitle) map[romName] = mappedTitle; else delete map[romName];
  try { localStorage.setItem(NAME_MAP_KEY, JSON.stringify(map)); } catch { /* tant pis */ }
}

// Nom (avec extension) à envoyer à fetch_boxart/fetch_game_media : le titre
// mappé s'il existe, sinon le nom de fichier brut.
function getMappedGameName(romName) {
  const map = getNameMap();
  const mapped = map[romName];
  if (!mapped) return romName;
  const ext = romName.includes(".") ? romName.slice(romName.lastIndexOf(".")) : "";
  return mapped + ext;
}

// Source des pochettes : "network" (dépôts Libretro Thumbnails en ligne,
// comportement historique) ou "local" (dossier DB_Thumbnails de
// l'utilisateur, même arborescence — cf. thumbnails.rs côté Rust).
const THUMB_SOURCE_KEY = "edlink.thumbSource";
const THUMB_LOCAL_DIR_KEY = "edlink.thumbLocalDir";

function getThumbSource() {
  try { return localStorage.getItem(THUMB_SOURCE_KEY) === "local" ? "local" : "network"; }
  catch { return "network"; }
}
function saveThumbSource(v) {
  try { localStorage.setItem(THUMB_SOURCE_KEY, v); } catch { /* tant pis */ }
}
function getThumbLocalDir() {
  try { return localStorage.getItem(THUMB_LOCAL_DIR_KEY) || ""; }
  catch { return ""; }
}
function saveThumbLocalDir(v) {
  try { localStorage.setItem(THUMB_LOCAL_DIR_KEY, v); } catch { /* tant pis */ }
}

let thumbSource = getThumbSource();
let thumbLocalDir = getThumbLocalDir();

// Prêt à interroger : réseau toujours, local seulement une fois un dossier
// choisi (sinon on n'appelle pas fetch_boxart/fetch_game_media du tout — pas
// de repli silencieux sur le réseau qui trahirait le mode "local" choisi).
function thumbReady() {
  return thumbSource === "network" || !!thumbLocalDir;
}
function thumbArgs() {
  return { source: thumbSource, local_dir: thumbSource === "local" ? thumbLocalDir : null };
}

// Favoris : jeux marqués via le ♡/♥ de la fiche de détail, indépendamment de
// leur catégorie/dossier — accessibles depuis la catégorie virtuelle Favoris
// en tête de la liste (cf. buildCategoryList). Persistés par chemin complet
// (`full`) sur la carte SD ; taille mémorisée au moment de l'ajout (affichage
// seulement, peut devenir périmée si le fichier change ensuite).
const FAVORITES_KEY = "edlink.favorites";

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); }
  catch { return []; }
}
function saveFavorites(list) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(list)); } catch { /* tant pis */ }
}
function isFavorite(full) {
  return getFavorites().some((f) => f.full === full);
}
function addFavorite(entry, full) {
  const list = getFavorites();
  if (!list.some((f) => f.full === full)) {
    list.push({ full, name: entry.name, size: entry.size });
    saveFavorites(list);
  }
}
function removeFavorite(full) {
  saveFavorites(getFavorites().filter((f) => f.full !== full));
}
function renameFavorite(oldFull, newFull, newName) {
  const list = getFavorites();
  const idx = list.findIndex((f) => f.full === oldFull);
  if (idx !== -1) {
    list[idx] = { ...list[idx], full: newFull, name: newName };
    saveFavorites(list);
  }
}
function toggleFavorite(entry, full) {
  if (isFavorite(full)) removeFavorite(full); else addFavorite(entry, full);
}

// Catégories virtuelles de l'onglet GAMES (en plus des vrais sous-dossiers) :
// Favoris est toujours proposée ; GAMES n'apparaît que si le dossier de base
// ne contient aucun sous-dossier catégorie (accès direct aux ROM posées à la
// racine, plutôt qu'un message d'erreur bloquant).
const VIRTUAL_FAVORITES_CATEGORY = "\0favorites";
const VIRTUAL_ROOT_CATEGORY = "\0root";

let gamesRoot = getGamesRoot();
let gamesLevel = "categories"; // "categories" | "mosaic"
let gamesCategory = null;
let gamesCategoryColors = null; // [c1, c2] — même dégradé que la rangée cliquée

// Palette « très Recalbox » : chaque catégorie prend une couleur du cycle
// (dégradé), indépendamment de son contenu — juste pour que la liste soit
// vivante et que chaque rangée se reconnaisse au premier coup d'œil.
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

async function renderGamesBrowser() {
  const container = document.createElement("div");
  container.className = "games-browser";

  const bar = document.createElement("div");
  bar.className = "games-topbar";
  const rootLabel = document.createElement("span");
  rootLabel.className = "games-root-label";
  rootLabel.textContent = t("games.rootLabel", { root: gamesRoot });
  const actions = document.createElement("div");
  actions.className = "games-actions";
  const refresh = document.createElement("button");
  refresh.className = "btn ghost"; refresh.title = t("games.refreshTitle"); refresh.textContent = "⟳";
  refresh.addEventListener("click", () => renderGamesTab());
  const gear = document.createElement("button");
  gear.className = "btn ghost"; gear.textContent = t("games.changeFolder");
  gear.addEventListener("click", async () => {
    const v = await askPrompt(
      t("games.changeFolderPrompt"),
      gamesRoot);
    if (!v) return;
    gamesRoot = normalizeGamesPath(v);
    saveGamesRoot(gamesRoot);
    gamesLevel = "categories";
    renderGamesTab();
  });
  // Source des pochettes : réseau (Libretro Thumbnails) ou dossier local
  // DB_Thumbnails (même arborescence, cf. thumbnails.rs). Changer de source
  // invalide le cache mémoire (les résultats peuvent différer) et redessine.
  const sourceSelect = document.createElement("select");
  sourceSelect.className = "thumb-source-select";
  sourceSelect.title = t("games.thumbSourceTitle");
  const optNet = document.createElement("option");
  optNet.value = "network"; optNet.textContent = t("games.thumbSourceNetwork");
  const optLoc = document.createElement("option");
  optLoc.value = "local"; optLoc.textContent = t("games.thumbSourceLocal");
  sourceSelect.append(optNet, optLoc);
  sourceSelect.value = thumbSource;
  const pickDirBtn = document.createElement("button");
  pickDirBtn.className = "btn ghost";
  pickDirBtn.textContent = "📁";
  pickDirBtn.hidden = thumbSource !== "local";
  pickDirBtn.title = thumbLocalDir
    ? t("games.thumbLocalDirTitle", { dir: thumbLocalDir })
    : t("games.thumbLocalDirPick");
  pickDirBtn.addEventListener("click", async () => {
    const dir = await safeInvoke("pick_folder");
    if (!dir) return;
    thumbLocalDir = dir;
    saveThumbLocalDir(dir);
    boxartCache.clear();
    renderGamesTab();
  });
  sourceSelect.addEventListener("change", () => {
    thumbSource = sourceSelect.value;
    saveThumbSource(thumbSource);
    boxartCache.clear();
    renderGamesTab();
  });
  actions.appendChild(sourceSelect);
  actions.appendChild(pickDirBtn);
  actions.appendChild(refresh);
  actions.appendChild(gear);
  bar.appendChild(rootLabel);
  bar.appendChild(actions);
  container.appendChild(bar);

  if (thumbSource === "local") {
    const hint = document.createElement("div");
    // Avertissement tant qu'aucun dossier n'est choisi (rien n'est cherché) ;
    // simple rappel discret de la structure attendue une fois un dossier
    // choisi — la confusion initiale ("aucune pochette trouvée") venait de
    // ce que cette structure n'était expliquée que dans le guide utilisateur,
    // pas dans l'app elle-même.
    hint.className = "games-hint" + (thumbLocalDir ? " info" : "");
    hint.textContent = thumbLocalDir
      ? t("games.thumbLocalDirActiveInfo", { dir: thumbLocalDir })
      : t("games.thumbLocalDirHint");
    container.appendChild(hint);
  }

  container.appendChild(
    gamesLevel === "mosaic" ? await buildMosaic() : await buildCategoryList()
  );
  return container;
}

function gamesError(message) {
  const div = document.createElement("div");
  div.className = "games-error";
  div.textContent = message;
  return div;
}

async function buildCategoryList() {
  const entries = await safeInvoke("list_sd", { path: gamesRoot });
  if (!entries) {
    return gamesError(t("games.listError", { path: gamesRoot }));
  }
  const dirs = entries.filter((e) => e.is_dir)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Catégories virtuelles, en tête de liste : Favoris est toujours proposée
  // (jeux marqués ♥ dans leur fiche détail, quelle que soit leur catégorie
  // réelle) ; GAMES n'apparaît que si la racine ne contient aucun sous-dossier
  // catégorie — accès direct aux ROM posées à la racine plutôt qu'un message
  // d'erreur bloquant.
  const items = [
    { key: VIRTUAL_FAVORITES_CATEGORY, label: t("games.favoritesTitle"), icon: "❤️" },
  ];
  if (!dirs.length) {
    items.push({ key: VIRTUAL_ROOT_CATEGORY, label: "GAMES", icon: "🎮" });
  }
  for (const d of dirs) {
    items.push({ key: d.name, label: d.name.toUpperCase(), icon: categoryIcon(d.name) });
  }

  const list = document.createElement("div");
  list.className = "cat-list";
  items.forEach((item, i) => {
    const [c1, c2] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
    const row = document.createElement("div");
    row.className = "cat-row";
    row.style.background = `linear-gradient(120deg, ${c1}, ${c2})`;
    const icon = document.createElement("div");
    icon.className = "cat-icon";
    icon.textContent = item.icon;
    const title = document.createElement("div");
    title.className = "cat-title";
    title.textContent = item.label;
    const chev = document.createElement("div");
    chev.className = "cat-chev";
    chev.textContent = "›";
    row.appendChild(icon);
    row.appendChild(title);
    row.appendChild(chev);
    row.addEventListener("click", () => {
      gamesCategory = item.key;
      gamesCategoryColors = [c1, c2];
      gamesLevel = "mosaic";
      renderGamesTab();
    });
    list.appendChild(row);
  });
  return list;
}

async function buildMosaic() {
  const mySeq = ++gamesRenderSeq;
  const wrap = document.createElement("div");
  wrap.className = "mosaic-wrap";
  const [c1, c2] = gamesCategoryColors || CATEGORY_PALETTE[0];
  wrap.style.background = `linear-gradient(160deg, ${c1}, ${c2})`;

  const isFavorites = gamesCategory === VIRTUAL_FAVORITES_CATEGORY;
  const isVirtualRoot = gamesCategory === VIRTUAL_ROOT_CATEGORY;
  // Favoris : pas de dossier réel, `catPath` ne s'applique pas. GAMES virtuel :
  // liste directement la racine (les ROM y sont posées sans sous-dossier).
  const catPath = isFavorites ? null : (isVirtualRoot ? gamesRoot : joinSdPath(gamesRoot, gamesCategory));

  const header = document.createElement("div");
  header.className = "mosaic-header";
  const back = document.createElement("button");
  back.className = "btn ghost"; back.textContent = t("games.backToCategories");
  back.addEventListener("click", () => { gamesLevel = "categories"; renderGamesTab(); });
  const title = document.createElement("h3");
  title.className = "mosaic-title";
  title.textContent = isFavorites ? t("games.favoritesTitle") : (isVirtualRoot ? "GAMES" : gamesCategory);
  header.appendChild(back);
  header.appendChild(title);
  wrap.appendChild(header);

  const status = document.createElement("div");
  status.className = "mosaic-status";
  wrap.appendChild(status);

  let games;
  if (isFavorites) {
    // Chaque favori mémorise déjà son chemin complet (`full`) : pas de
    // list_sd, juste { name, size, is_dir: false, full } directement utilisable.
    games = getFavorites()
      .map((f) => ({ name: f.name, size: f.size, is_dir: false, full: f.full }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } else {
    const entries = await safeInvoke("list_sd", { path: catPath });
    if (!entries) {
      status.textContent = t("games.mosaicListError", { path: catPath });
      return wrap;
    }
    games = entries.filter(isRomFile)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  status.textContent = games.length <= 1
    ? t("games.oneGameAvailable", { count: games.length })
    : t("games.gamesAvailable", { count: games.length });

  if (!games.length) {
    wrap.appendChild(gamesError(isFavorites ? t("games.noFavoritesError") : t("games.noRomsError", { path: catPath })));
    return wrap;
  }

  const grid = document.createElement("div");
  grid.className = "mosaic-grid";
  for (const entry of games) {
    const full = isFavorites ? entry.full : joinSdPath(catPath, entry.name);
    const card = document.createElement("div");
    card.className = "mosaic-card";
    const frame = document.createElement("div");
    frame.className = "mosaic-frame";
    const ph = document.createElement("div");
    ph.className = "boxart-ph";
    ph.textContent = "🎮";
    frame.appendChild(ph);
    const label = document.createElement("div");
    label.className = "mosaic-label";
    label.textContent = entry.name;
    card.appendChild(frame);
    card.appendChild(label);

    // Roue crantée : associer manuellement ce fichier à un titre présent
    // dans Libretro Thumbnails, quand la correspondance automatique (codes
    // région GoodTools/TOSEC -> No-Intro) ne trouve rien.
    const mapBtn = document.createElement("button");
    mapBtn.className = "mosaic-mapbtn"; mapBtn.textContent = "⚙";
    mapBtn.title = t("games.mapButtonTitle");
    mapBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const current = getNameMap()[entry.name] || entry.name.replace(/\.[^.]+$/, "");
      const v = await askPrompt(
        t("games.mapPrompt", { name: entry.name }),
        current);
      if (v === null) return;
      saveNameMapEntry(entry.name, v.trim());
      boxartCache.delete(entry.name); // reforcer une nouvelle recherche
      frame.replaceChildren(Object.assign(document.createElement("div"), { className: "boxart-ph", textContent: "🎮" }));
      loadBoxartInto(entry.name, frame, mySeq);
    });
    card.appendChild(mapBtn);

    card.addEventListener("click", () => openGameModal(entry, full));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, entry, full);
    });
    loadBoxartInto(entry.name, frame, mySeq);
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  return wrap;
}

// Récupère la jaquette (cache mémoire -> commande Tauri, elle-même mise en
// cache disque côté Rust) et l'insère dans `frame` si trouvée ; sinon laisse
// le placeholder 🎮 en place.
// Jeton de rendu de la mosaïque courante : incrémenté à chaque (re)construction
// (buildMosaic) pour invalider les chargements en vol d'une mosaïque déjà
// remplacée. Remplace un test `frame.isConnected`, qui échouait à tort sur
// cache déjà chaud : le tableau de vignettes est construit puis rempli AVANT
// d'être attaché au document (fetch_boxart en cours), donc `isConnected`
// valait déjà `false` au moment du test — systématiquement en cas de cache
// (aucun `await` traversé, tout s'exécute avant l'attache au DOM), d'où les
// pochettes qui disparaissaient en revisitant une catégorie déjà vue.
let gamesRenderSeq = 0;

// boxartCache : nom de fichier -> { dataUri, matchedTitle, score } (score 1.0
// = variante de région connue, < 1.0 = correspondance approchée trouvée par
// similarité de texte dans l'index du dépôt — cf. thumbnails.rs) ; `null` =
// aucune pochette trouvée (mis en cache pour ne pas réessayer à chaque rendu).
async function loadBoxartInto(romName, frame, seq) {
  if (!thumbReady()) return; // mode local sans dossier choisi : pas d'appel, on garde le placeholder
  let cached = boxartCache.get(romName);
  if (cached === undefined) {
    const res = await safeInvoke("fetch_boxart", { name: getMappedGameName(romName), ...thumbArgs() });
    cached = res && res.png_base64
      ? { dataUri: "data:image/png;base64," + res.png_base64, matchedTitle: res.matched_title, score: res.score }
      : null;
    boxartCache.set(romName, cached);
  }
  if (!cached || seq !== gamesRenderSeq) return; // mosaïque remplacée entre-temps
  const img = document.createElement("img");
  img.src = cached.dataUri;
  img.alt = romName;
  frame.replaceChildren(img);
  if (cached.score < 1) {
    const pct = Math.round(cached.score * 100);
    img.title = t("games.approxBoxartTitle", { pct, title: cached.matchedTitle });
    const badge = document.createElement("div");
    badge.className = "mosaic-scorebadge" + (cached.score < 0.9 ? " low" : "");
    badge.textContent = pct + "%";
    badge.title = img.title;
    frame.appendChild(badge);
  }
}

let gameModalTarget = null; // { entry, full }

// Écran-titre / capture en jeu : alternent toutes les 2 secondes dans la fiche
// de détail quand les deux sont disponibles (sinon la seule trouvée reste
// affichée fixe).
let gameSnapTimer = null;
let gameSnapImages = []; // [{ uri, label }]
let gameSnapIndex = 0;

function showGameSnapFrame() {
  const frame = gameSnapImages[gameSnapIndex];
  if (!frame) return;
  els.gameSnap.src = frame.uri;
  els.gameSnap.alt = frame.label;
  els.gameSnap.classList.remove("fade");
  void els.gameSnap.offsetWidth; // relance l'animation même si la classe était déjà retirée
  els.gameSnap.classList.add("fade");
  els.gameSnapLabel.textContent = frame.label;
  els.gameSnapLabel.hidden = gameSnapImages.length < 2;
}

function stopSnapSlideshow() {
  if (gameSnapTimer) { clearInterval(gameSnapTimer); gameSnapTimer = null; }
  gameSnapImages = [];
  gameSnapIndex = 0;
  els.gameSnapWrap.hidden = true;
}

function startSnapSlideshow(images) {
  stopSnapSlideshow();
  gameSnapImages = images;
  if (!images.length) { els.gameSnapWrap.hidden = true; return; }
  els.gameSnapWrap.hidden = false;
  gameSnapIndex = 0;
  showGameSnapFrame();
  if (images.length > 1) {
    gameSnapTimer = setInterval(() => {
      gameSnapIndex = (gameSnapIndex + 1) % gameSnapImages.length;
      showGameSnapFrame();
    }, 2000);
  }
}

let gameMatchInfoTimer = null;
let currentMatchCached = null; // le dernier { dataUri, matchedTitle, score } affiché

function scheduleMatchInfoHide() {
  gameMatchInfoTimer = setTimeout(() => {
    els.gameMatchInfo.hidden = true;
    gameMatchInfoTimer = null;
  }, 3000);
}

function showMatchInfo(cached) {
  if (gameMatchInfoTimer) { clearTimeout(gameMatchInfoTimer); gameMatchInfoTimer = null; }
  currentMatchCached = cached;
  if (!cached || cached.score >= 1) {
    els.gameMatchInfo.hidden = true;
    return;
  }
  els.gameMatchInfo.hidden = false;
  els.gameMatchInfo.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = t("games.matchInfo", { pct: Math.round(cached.score * 100), title: cached.matchedTitle });
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "match-confirm-btn";
  confirmBtn.textContent = t("games.matchConfirmBtn");
  confirmBtn.title = t("games.matchConfirmTitle");
  confirmBtn.addEventListener("click", () => confirmMatch(cached));
  els.gameMatchInfo.appendChild(text);
  els.gameMatchInfo.appendChild(confirmBtn);
  // Correspondance non exacte : juste un avertissement, pas la peine qu'il
  // reste affiché en permanence — s'efface tout seul (sauf survol : le temps
  // de lire et, éventuellement, cliquer « C'est le bon jeu »).
  scheduleMatchInfoHide();
}

// Survoler le bandeau suspend l'auto-effacement, pour laisser le temps de
// cliquer « C'est le bon jeu » sans qu'il disparaisse sous la souris.
els.gameMatchInfo.addEventListener("mouseenter", () => {
  if (gameMatchInfoTimer) { clearTimeout(gameMatchInfoTimer); gameMatchInfoTimer = null; }
});
els.gameMatchInfo.addEventListener("mouseleave", () => {
  if (!els.gameMatchInfo.hidden && currentMatchCached && currentMatchCached.score < 1) {
    scheduleMatchInfoHide();
  }
});

// Valide la correspondance approchée trouvée : l'associe définitivement à ce
// fichier (comme le ferait la roue crantée ⚙, mais sans ressaisir le titre)
// — les prochaines recherches pour ce fichier retomberont directement dessus,
// en confiance 100% (le nom mappé correspond alors exactement à un fichier
// du dépôt, plus besoin de recherche approchée).
// Nom de fichier dont la pochette vient d'être confirmée manuellement dans
// la fiche actuellement ouverte : le fetch_game_media lancé à l'ouverture de
// la fiche est déjà en vol au moment du clic (appel réseau), et sa réponse —
// calculée AVANT la confirmation — arrive ensuite et écraserait sinon l'état
// tout juste confirmé avec l'ancien résultat approché (bandeau qui semblait
// « ne pas vouloir se refermer », alors que le mapping était bien enregistré).
let confirmedEntryName = null;

// Enregistre l'association puis RELIT vraiment la base avec le nom désormais
// mappé (comme le fait la roue crantée ⚙ de la mosaïque), au lieu de
// supposer localement un score de 100% : la première variante essayée par
// le backend est maintenant le nom exact confirmé, donc cette nouvelle
// requête doit revenir en confiance 1.0 — c'est cette réponse réelle, pas
// une mutation locale, qui referme le bandeau.
async function confirmMatch(cached) {
  if (!gameModalTarget) return;
  const { entry } = gameModalTarget;
  confirmedEntryName = entry.name;
  saveNameMapEntry(entry.name, cached.matchedTitle);
  boxartCache.delete(entry.name);

  if (gameMatchInfoTimer) { clearTimeout(gameMatchInfoTimer); gameMatchInfoTimer = null; }
  els.gameMatchInfo.hidden = true;

  const res = await safeInvoke("fetch_boxart", { name: getMappedGameName(entry.name), ...thumbArgs() });
  if (res && res.png_base64) {
    const fresh = {
      dataUri: "data:image/png;base64," + res.png_base64,
      matchedTitle: res.matched_title,
      score: res.score,
    };
    boxartCache.set(entry.name, fresh);
    if (gameModalTarget && gameModalTarget.entry === entry) {
      els.gameBoxart.src = fresh.dataUri;
      els.gameBoxart.hidden = false;
      els.gameBoxartPh.hidden = true;
      showMatchInfo(fresh); // se cache tout seul si score >= 1
    }
    log(t("games.matchConfirmedLog", { name: entry.name, title: fresh.matchedTitle, pct: Math.round(fresh.score * 100) }), "ok");
  } else {
    log(t("games.matchConfirmFailedLog", { name: entry.name }), "err");
  }

  // Rafraîchit la mosaïque derrière la fiche (élément séparé, reste ouverte
  // par-dessus) pour que sa vignette reflète elle aussi la confirmation.
  if (gamesLevel === "mosaic") renderGamesTab();
}

function openGameModal(entry, full) {
  gameModalTarget = { entry, full };
  confirmedEntryName = null;
  els.gameTitle.textContent = entry.name;
  els.gameMeta.innerHTML =
    `<b>${t("games.sizeLabel")}</b> ${fmtSize(entry.size)}<br><b>${t("games.pathLabel")}</b> ${full}`;
  els.gameBoxart.hidden = true;
  els.gameBoxartPh.hidden = false;
  els.gameBoxartPh.textContent = "🎮";
  if (gameMatchInfoTimer) { clearTimeout(gameMatchInfoTimer); gameMatchInfoTimer = null; }
  els.gameMatchInfo.hidden = true;
  stopSnapSlideshow();
  updateFavBtn(full);
  els.gameModal.hidden = false;

  const cached = boxartCache.get(entry.name);
  if (cached) {
    els.gameBoxart.src = cached.dataUri;
    els.gameBoxart.hidden = false;
    els.gameBoxartPh.hidden = true;
    showMatchInfo(cached);
  }

  if (!thumbReady()) return; // mode local sans dossier choisi

  safeInvoke("fetch_game_media", { name: getMappedGameName(entry.name), ...thumbArgs() }).then((media) => {
    if (!media || gameModalTarget?.entry !== entry) return; // fermé/changé entre-temps
    if (media.boxart.png_base64 && confirmedEntryName !== entry.name) {
      const found = {
        dataUri: "data:image/png;base64," + media.boxart.png_base64,
        matchedTitle: media.boxart.matched_title,
        score: media.boxart.score,
      };
      boxartCache.set(entry.name, found);
      els.gameBoxart.src = found.dataUri;
      els.gameBoxart.hidden = false;
      els.gameBoxartPh.hidden = true;
      showMatchInfo(found);
    }
    const frames = [];
    if (media.title_base64) {
      frames.push({ uri: "data:image/png;base64," + media.title_base64, label: t("games.titleScreenLabel") });
    }
    if (media.snap_base64) {
      frames.push({ uri: "data:image/png;base64," + media.snap_base64, label: t("games.inGameSnapLabel") });
    }
    startSnapSlideshow(frames);
  });
}

function closeGameModal() {
  els.gameModal.hidden = true;
  gameModalTarget = null;
  stopSnapSlideshow();
  if (gameMatchInfoTimer) { clearTimeout(gameMatchInfoTimer); gameMatchInfoTimer = null; }
}
els.gameModal.addEventListener("click", (e) => { if (e.target === els.gameModal) closeGameModal(); });
els.gameModalClose.addEventListener("click", closeGameModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeGameModal(); });
els.gamePlay.addEventListener("click", () => {
  if (!gameModalTarget) return;
  const { entry, full } = gameModalTarget;
  closeGameModal();
  playSd(entry, full);
});
els.gameDownload.addEventListener("click", () => {
  if (!gameModalTarget) return;
  doDownloadSd(gameModalTarget.full);
});

// ♡/♥ de la fiche de détail : bascule ce jeu dans/hors des favoris (catégorie
// virtuelle "Favoris" de l'onglet GAMES, indépendante de son vrai dossier).
function updateFavBtn(full) {
  const fav = isFavorite(full);
  els.gameFav.textContent = fav ? "♥" : "♡";
  els.gameFav.classList.toggle("active", fav);
  els.gameFav.title = t(fav ? "games.favRemoveTitle" : "games.favAddTitle");
}
els.gameFav.addEventListener("click", () => {
  if (!gameModalTarget) return;
  const { entry, full } = gameModalTarget;
  toggleFavorite(entry, full);
  updateFavBtn(full);
  // Retirer un favori pendant qu'on est dans la vue Favoris doit le faire
  // disparaître de la mosaïque derrière la fiche (élément séparé, reste ouverte).
  if (gamesLevel === "mosaic" && gamesCategory === VIRTUAL_FAVORITES_CATEGORY) renderGamesTab();
});

function setView(v) {
  explorerView = v;
  els.viewIcons.classList.toggle("active", v === "grid");
  els.viewList.classList.toggle("active", v === "list");
  renderExplorer();
}

// Onglet GAMES : navigateur dédié (catégories -> mosaïque), à part de
// l'explorateur générique de l'onglet Carte SD (dossier/vue indépendants).
async function renderGamesTab() {
  els.gamesExplorer.innerHTML = "";
  els.gamesExplorer.appendChild(await renderGamesBrowser());
}
onLangChange(() => {
  if ($("tab-games").classList.contains("active")) renderGamesTab();
  if (gameModalTarget && !els.gameModal.hidden) openGameModal(gameModalTarget.entry, gameModalTarget.full);
});

// ---- dépôt de fichiers OS -> explorateur (upload) ----
["dragenter", "dragover"].forEach((evt) =>
  els.explorer.addEventListener(evt, (e) => {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    if (types.includes("Files")) {
      e.preventDefault();
      els.explorer.classList.add("drag");
    }
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.explorer.addEventListener(evt, (e) => { els.explorer.classList.remove("drag"); })
);

event.listen("files-dropped", (evt) => {
  const files = evt.payload || [];
  if (files.length) uploadAll(files);
});

// ---- barre de progression des transferts (événement backend) ----
let transferHideTimer = null;
event.listen("transfer-progress", (evt) => {
  const p = evt.payload || {};
  const bar = els.transferBar;
  if (transferHideTimer) { clearTimeout(transferHideTimer); transferHideTimer = null; }
  bar.hidden = false;
  bar.classList.remove("done", "err");
  const verb = p.dir === "download" ? t("sd.transferDownload") : t("sd.transferUpload");
  const fill = els.transferFill;

  if (p.phase === "start") {
    els.transferLabel.textContent = `${verb} · ${p.name}`;
    els.transferPct.textContent = "…";
    fill.classList.add("indeterminate");
    fill.style.width = "";
  } else if (p.phase === "progress") {
    els.transferLabel.textContent = `${verb} · ${p.name}`;
    if (p.total > 0) {
      fill.classList.remove("indeterminate");
      const pct = Math.min(100, Math.round((p.done / p.total) * 100));
      fill.style.width = pct + "%";
      els.transferPct.textContent = `${pct}% · ${fmtSize(p.done)} / ${fmtSize(p.total)}`;
    }
  } else if (p.phase === "done") {
    fill.classList.remove("indeterminate");
    fill.style.width = "100%";
    els.transferPct.textContent = t("sd.transferDone");
    bar.classList.add("done");
    transferHideTimer = setTimeout(() => { bar.hidden = true; }, 2500);
  } else if (p.phase === "error") {
    fill.classList.remove("indeterminate");
    els.transferPct.textContent = t("sd.transferFailed");
    bar.classList.add("err");
    // L'erreur détaillée est déjà journalisée par safeInvoke (retour de commande).
    transferHideTimer = setTimeout(() => { bar.hidden = true; }, 5000);
  }
});

async function doDownloadSd(full) {
  const local = await safeInvoke("pick_save", { default_name: full.split("/").pop() || "fichier.bin" });
  if (!local) return;
  const res = await safeInvoke("download", { src: full, local });
  if (res && !res.isErr) log(t("sd.downloadedLog", { path: full }), "ok");
}

// ---- menu contextuel de l'explorateur (clic droit sur un fichier) ----
let ctxEntry = null, ctxFull = null;

function openCtxMenu(x, y, entry, full) {
  ctxEntry = entry; ctxFull = full;
  const menu = els.sdCtxMenu;
  menu.hidden = false;
  // Positionné puis recalé pour rester dans la fenêtre (le menu n'a sa
  // taille réelle qu'une fois affiché, hidden retiré).
  const { innerWidth: vw, innerHeight: vh } = window;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.min(x, vw - w - 8) + "px";
  menu.style.top = Math.min(y, vh - h - 8) + "px";
}

function closeCtxMenu() {
  els.sdCtxMenu.hidden = true;
  ctxEntry = null; ctxFull = null;
}

// Ferme sur un clic ailleurs ou Échap. (Pas d'écouteur "contextmenu" sur
// document : l'ouverture elle-même est un événement "contextmenu" qui
// remonte jusqu'ici par bouillonnement — un tel écouteur refermait donc le
// menu à l'instant même où il venait de s'ouvrir.)
document.addEventListener("click", closeCtxMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCtxMenu(); });

async function playSd(entry, full) {
  log(t("sd.launching", { name: entry.name }));
  // `full` est déjà préfixé "sd:" quand cette fonction est appelée depuis
  // l'onglet GAMES (chemins construits à partir de gamesRoot, ex.
  // "sd:/GAMES/Action/Jeu.pce"), mais pas depuis le menu contextuel de
  // l'explorateur Carte SD (chemins relatifs à explorerPath, sans préfixe) —
  // ne préfixer que si besoin, sous peine d'un "sd:/sd:/..." invalide.
  const rom = /^sd:/i.test(full) ? full : "sd:/" + full;
  const res = await safeInvoke("run_rom", { rom });
  if (res && !res.isErr) log(t("sd.launched"), "ok");
}

els.sdCtxMenu.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || !ctxFull) return;
  const action = btn.dataset.action;
  const entry = ctxEntry, full = ctxFull;
  closeCtxMenu();

  if (action === "play") {
    playSd(entry, full);
  } else if (action === "download") {
    doDownloadSd(full);
  } else if (action === "delete") {
    const ok = await askConfirm(t("sd.deleteConfirm", { name: entry.name }));
    if (!ok) return;
    const res = await safeInvoke("delete_sd", { path: full });
    if (res !== null) {
      log(t("sd.deletedLog", { name: entry.name }), "ok");
      removeFavorite(full); // évite un favori fantôme sur un fichier effacé
      refreshAfterSdChange();
    }
  } else if (action === "rename") {
    const newName = await askPrompt(t("sd.renamePrompt"), entry.name);
    if (!newName || newName === entry.name) return;
    const res = await safeInvoke("rename_sd", { path: full, new_name: newName });
    if (res !== null) {
      log(t("sd.renamedLog", { name: newName }), "ok");
      const parent = full.includes("/") ? full.slice(0, full.lastIndexOf("/")) : "";
      renameFavorite(full, parent ? `${parent}/${newName}` : newName, newName);
      refreshAfterSdChange();
    }
  }
});

// Le menu contextuel est partagé entre l'explorateur Carte SD et l'onglet
// GAMES (mosaïque/favoris) : rafraîchit celui réellement affiché.
function refreshAfterSdChange() {
  if ($("tab-games").classList.contains("active")) renderGamesTab();
  else renderExplorer();
}

async function uploadOne(local) {
  const name = local.split(/[\\/]/).pop();
  const dest = joinSdPath(explorerPath, name);
  log(t("sd.uploadingLog", { name, dest: explorerPath || t("sd.root") }));
  const res = await safeInvoke("upload", { local, dest });
  if (res && !res.isErr) log(t("sd.uploadedLog", { name }), "ok");
}

// Rafraîchit le dossier courant une seule fois après le lot complet (plutôt
// qu'après chaque fichier) : évite de relister la carte N fois lors d'un
// dépôt multiple.
async function uploadAll(files) {
  if (!files.length) return;
  log(t("sd.uploadingMultiLog", { count: files.length, dest: explorerPath || t("sd.root") }), "info");
  for (const f of files) await uploadOne(f);
  await renderExplorer();
}

// ---- barre d'outils ----
els.viewIcons.addEventListener("click", () => setView("grid"));
els.viewList.addEventListener("click", () => setView("list"));
els.explorerUp.addEventListener("click", () => {
  explorerPath = parentPath(explorerPath);
  renderExplorer();
});
els.explorerRefresh.addEventListener("click", renderExplorer);
els.explorerImport.addEventListener("click", async () => {
  const picked = await safeInvoke("pick_file");
  if (picked) {
    await uploadOne(picked);
    await renderExplorer();
  }
});

// ---------------------------------------------------------------- jouer
// « Choisir et lancer… » : sélectionne une ROM puis la déploie et la lance
// directement (les boutons « Charger » et « Lancer » séparés ont été supprimés).
$("pick-rom").addEventListener("click", async () => {
  const picked = await safeInvoke("pick_file");
  if (!picked) return;
  els.romPath.value = picked;
  log(t("play.launching", { name: picked.split(/[\\/]/).pop() }));
  const res = await safeInvoke("run_rom", { rom: picked });
  if (res && !res.isErr) {
    log(t("play.launched"), "ok");
    // La RAM contient désormais le jeu. Relecture auto seulement sur l'émulateur.
    if (isEmulator && invalidateMemCache) invalidateMemCache();
  }
});
$("reset-btn").addEventListener("click", async () => {
  await safeInvoke("reset_console", {}, t("play.consoleReset"));
  if (isEmulator && invalidateMemCache) invalidateMemCache(); // émulateur uniquement
});

// ---------------------------------------------------------------- écran
const screenChoiceVals = (el, choices) => choices[+el.value] ?? choices[0];
const screenParams = () => ({
  bat_w: screenChoiceVals(els.batW, BAT_W_CHOICES),
  bat_h: screenChoiceVals(els.batH, BAT_H_CHOICES),
  res_w: screenChoiceVals(els.resW, RES_W_CHOICES),
  res_h: screenChoiceVals(els.resH, RES_H_CHOICES),
  scroll_x: +els.scrollX.value,
  scroll_y: +els.scrollY.value,
});
const updateScreenLabels = (p) => {
  els.batWVal.textContent = p.bat_w;
  els.batHVal.textContent = p.bat_h;
  els.resWVal.textContent = p.res_w;
  els.resHVal.textContent = p.res_h;
  els.scrollXVal.textContent = p.scroll_x;
  els.scrollYVal.textContent = p.scroll_y;
};
// `refresh` : true = relire la VRAM/CRAM sur la carte (`*v`) ; false = juste
// re-rendre l'instantané déjà en mémoire avec les nouveaux réglages (aucun
// accès carte — c'est un rendu logiciel du plan de tuiles).
async function refreshScreen(refresh = false) {
  const params = screenParams();
  updateScreenLabels(params);
  const b64 = await safeInvoke("capture_screen", { params, refresh });
  if (!b64) return;
  lastScreenB64 = b64;
  els.screenImg.src = "data:image/png;base64," + b64;
  els.screenCard.hidden = false;
}
$("screen-btn").addEventListener("click", async () => {
  log(t("play.capturing"));
  await refreshScreen(true);
  if (lastScreenB64) log(t("play.captured"), "ok");
});
// Bouger un réglage re-rend l'image localement (sans relire la carte).
[els.batW, els.batH, els.resW, els.resH, els.scrollX, els.scrollY]
  .forEach((el) => el.addEventListener("input", () => refreshScreen(false)));
// Affiche les valeurs des curseurs dès le chargement (sans capture).
updateScreenLabels(screenParams());

$("save-screen").addEventListener("click", async () => {
  if (!lastScreenB64) return;
  const path = await safeInvoke("pick_save", { default_name: "ted-menu.png" });
  if (!path) return;
  const ok = await safeInvoke("save_png", { data_base64: lastScreenB64, path });
  if (ok === null) return;
  log(t("play.pngSaved", { path }), "ok");
});

// ---------------------------------------------------------------- mémoire (hex viewer)
// Visualiseur scrollable à trois vues : RAM HuCard (8 Mo, banques de 8 Ko),
// VRAM (VDC, 64 Ko) et CRAM (VCE, 512 mots) — ces deux dernières étant des
// mémoires 16 bits, affichées en mots. Chargement paresseux au défilement.
(() => {
  const LINE_H = 18;

  // Liste des vues de l'onglet Mémoire.
  //  - RAM : lue par blocs via CMD_MEM_RD (bus cartouche).
  //  - VRAM / CRAM : instantané via la commande FIFO `*v` du menu OS (même
  //    routine que la capture d'écran). `snap: true` → servi depuis le buffer
  //    en mémoire, offsets relatifs à 0.
  const VIEWS = {
    ram: {
      labelKey: "mem.ramLabel",
      start: 0x000000,
      size:  0x800000,          // 8 Mo (SIZE_RAM0)
      word16: false,
      unitsPerRow: 16,          // 16 octets par ligne
      groupBytes: 0x2000,       // banque de 8 Ko (en-tête "bank")
      showBanks: true,
      showVectors: true,
    },
    vram: {
      labelKey: "mem.vramLabel",
      start: 0,
      size:  0x10000,           // 64 Ko = 32 768 mots de 16 bits
      word16: true,
      unitsPerRow: 16,          // 16 mots par ligne (= 32 octets)
      noAscii: true,            // pas de colonne ASCII (inutile pour des mots vidéo)
      showVectors: false,
      snap: true,
    },
    cram: {
      labelKey: "mem.cramLabel",
      start: 0,
      size:  0x400,             // 512 mots de 16 bits = 1 024 octets
      word16: true,
      unitsPerRow: 8,           // 8 mots par ligne ; 1 palette = 2 lignes (16 mots)
      groupBytes: 0x20,         // 32 octets = une palette (16 mots) → en-tête "palette"
      swatches: true,           // colonne de droite = carrés de couleur (au lieu de l'ASCII)
      showVectors: false,
      snap: true,
    },
  };
  const curLabel = () => t(cur.labelKey);

  // Instantanés VRAM / CRAM (Uint8Array) obtenus par `*v`. null = pas encore lu.
  let vramSnap = null, cramSnap = null;
  const snapView = () => !!cur.snap;
  const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ----- éléments DOM -----
  const view     = $("hex-view");
  const spacer   = $("hex-spacer");
  const posEl    = $("mem-pos");
  const goInput  = $("mem-go");
  const vecPanel = $("vec-panel");
  const bankCtrl = $("mem-bank-ctrl");
  const hintEl   = $("mem-hint");
  const hOff = $("h-off"), hHex = $("h-hex"), hAsc = $("h-asc");
  if (!view) return;
  const hexWrap = view.closest(".hex-wrap");
  const hexHead = hHex ? hHex.parentElement : null;

  // ----- politique de lecture de la vue RAM selon la cible -----
  // "emu" : lectures libres (mémoire observée hors bus cartouche).
  // "hw"  : matériel réel — chaque CMD_MEM_RD gèle le CPU PC-Engine le temps du
  //         transfert. On lit par petits blocs et jamais automatiquement.
  // (VRAM/CRAM ne sont pas concernées : instantané `*v`, cf. plus bas.)
  let readMode = "hw";           // défaut prudent tant que rien n'est connecté
  let autoLoad = false;          // charger les chunks visibles au défilement ?
  const memWarnEl = $("mem-warning");

  // ----- géométrie courante (recalculée à chaque changement de vue) -----
  let cur = VIEWS.ram;
  let START, SIZE, WORD16, UNIT_BYTES, UNITS_PER_ROW, BYTES_PER_ROW;
  let GROUPED, GROUP_BYTES, ROWS_GROUP, PER_GROUP_LINES, GROUP_CNT, CHUNK, CHUNK_CNT, TOTAL_LINES, SWATCHES, NOASCII;

  const hexAddr = (n) => "$" + n.toString(16).toUpperCase().padStart(6, "0");
  const hexWord = (w) => w.toString(16).toUpperCase().padStart(4, "0");
  // Offset relatif à la fenêtre courante : 16 bits (4 chiffres hex) pour les
  // vues VRAM/CRAM, adresse absolue (6 chiffres) pour la RAM.
  const hexOffset = (n) => {
    const off = n - START;
    const w = (cur === VIEWS.vram || cur === VIEWS.cram) ? 4 : 6;
    return "$" + off.toString(16).toUpperCase().padStart(w, "0");
  };

  function makeHexHeader() {
    // 4 chiffres hex pour les vues 16 bits (VRAM/CRAM) : offsets 0000 0002 0004 …
    // 2 chiffres pour la RAM (octets) : offsets 00 01 02 …
    const w = WORD16 ? 4 : 2;
    const cols = [];
    for (let i = 0; i < UNITS_PER_ROW; i++) {
      cols.push((i * UNIT_BYTES).toString(16).toUpperCase().padStart(w, "0"));
    }
    return cols.join(" ");
  }

  function makeHint() {
    if (cur === VIEWS.ram) {
      const load = autoLoad ? t("mem.loadOnScroll") : t("mem.clickRefresh");
      return t("mem.hintRam", { load });
    }
    if (cur === VIEWS.vram) return t("mem.hintVram");
    if (cur === VIEWS.cram) return t("mem.hintCram");
  }

  // ----- géométrie -----
  function lineStartAddr(L) {
    if (GROUPED) {
      const g = Math.floor(L / PER_GROUP_LINES);
      const within = L % PER_GROUP_LINES;
      return START + g * GROUP_BYTES + (within === 0 ? 0 : (within - 1) * BYTES_PER_ROW);
    }
    return START + L * BYTES_PER_ROW;
  }
  const isGroupHeader = (L) => GROUPED && (L % PER_GROUP_LINES === 0);
  const groupIndexAt  = (L) => Math.floor(L / PER_GROUP_LINES);
  const chunkFor = (L) => Math.floor((lineStartAddr(L) - START) / CHUNK);
  const chunkAddr = (c) => START + c * CHUNK;

  // Libellé d'un en-tête de groupe : "bank N" pour la RAM, "Palette N" /
  // "Sprite N" pour la CRAM (16 palettes de tuiles puis 16 palettes sprites).
  function groupLabel(g) {
    if (cur === VIEWS.cram) {
      return g < 16 ? t("mem.paletteN", { n: g }) : t("mem.spriteN", { n: g - 16 });
    }
    return t("mem.bankN", { n: g });
  }

  function setupGeometry(viewId) {
    cur = VIEWS[viewId];
    START = cur.start; SIZE = cur.size;
    WORD16 = cur.word16;
    UNIT_BYTES = WORD16 ? 2 : 1;
    UNITS_PER_ROW = cur.unitsPerRow;
    BYTES_PER_ROW = UNITS_PER_ROW * UNIT_BYTES;
    GROUPED = (cur.groupBytes || 0) > 0;
    GROUP_BYTES = cur.groupBytes || 0;
    if (GROUPED) {
      ROWS_GROUP = GROUP_BYTES / BYTES_PER_ROW;
      PER_GROUP_LINES = ROWS_GROUP + 1;   // +1 ligne d'en-tête (bank / palette)
      GROUP_CNT = SIZE / GROUP_BYTES;
      TOTAL_LINES = GROUP_CNT * PER_GROUP_LINES;
    } else {
      TOTAL_LINES = SIZE / BYTES_PER_ROW;
    }
    // Bloc de lecture. VRAM/CRAM : servis depuis un instantané en mémoire, la
    // taille n'a pas d'incidence → 8 Ko. RAM (bus cartouche) : 8 Ko sur
    // l'émulateur, 1 Ko sur matériel réel (le gel du CPU PC-Engine est
    // ~proportionnel à la taille du transfert).
    CHUNK = Math.min(cur.snap || readMode === "emu" ? 0x2000 : 0x400, SIZE);
    CHUNK_CNT = Math.ceil(SIZE / CHUNK);
    SWATCHES = !!cur.swatches;
    NOASCII = !!cur.noAscii;
    spacer.style.height = TOTAL_LINES * LINE_H + "px";

    if (vecPanel) vecPanel.style.display = cur.showVectors ? "" : "none";
    if (bankCtrl) bankCtrl.style.display = cur.showBanks ? "" : "none";
    if (hexWrap) hexWrap.classList.toggle("noascii", NOASCII);
    if (hexHead) hexHead.scrollLeft = 0;
    if (hOff) hOff.textContent = t("mem.offset");
    if (hHex) hHex.textContent = makeHexHeader();
    if (hAsc) hAsc.textContent = SWATCHES ? t("mem.colorsHeader") : (WORD16 ? t("mem.asciiHiLo") : t("mem.ascii"));
    if (hintEl) hintEl.innerHTML = makeHint();
  }
  // ----- cache / chargement paresseux -----
  const cache   = new Map();   // chunkIndex -> Uint8Array(CHUNK)
  const loading = new Set();
  let highlight = null;        // { addr, bytes } : dernier motif trouvé

  function loadChunk(chunkIndex, addr) {
    if (cache.has(chunkIndex) || loading.has(chunkIndex)) return;

    // VRAM / CRAM : découpe l'instantané `*v` déjà en mémoire (pas d'accès carte).
    if (snapView()) {
      const snap = cur === VIEWS.vram ? vramSnap : cramSnap;
      if (snap) cache.set(chunkIndex, snap.subarray(addr, Math.min(addr + CHUNK, snap.length)));
      return;
    }

    loading.add(chunkIndex);
    safeInvoke("memrd", { addr, len: CHUNK })
      .then((dump) => {
        loading.delete(chunkIndex);
        if (dump) {
          const bin = atob(dump.data_base64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          cache.set(chunkIndex, arr);
        }
        renderVisible();
      })
      .catch(() => loading.delete(chunkIndex));
  }

  // `doFetch` : lit les chunks visibles manquants. Par défaut suit `autoLoad`
  // (vrai sur l'émulateur, faux sur matériel). Un appel explicite (Rafraîchir)
  // passe `true` pour charger la zone affichée à la demande.
  function renderVisible(doFetch = autoLoad) {
    const top = view.scrollTop;
    const vh  = view.clientHeight;
    const first = Math.max(0, Math.floor(top / LINE_H) - 2);
    const last  = Math.min(TOTAL_LINES - 1, Math.ceil((top + vh) / LINE_H) + 2);

    // VRAM/CRAM : découpe gratuite de l'instantané → toujours. RAM : selon doFetch.
    if (doFetch || snapView()) {
      const needed = new Set();
      for (let L = first; L <= last; L++) {
        if (!isGroupHeader(L)) needed.add(chunkFor(L));
      }
      for (const c of needed) loadChunk(c, chunkAddr(c));
    }

    const frag = document.createDocumentFragment();
    for (let L = first; L <= last; L++) {
      const div = document.createElement("div");
      div.className = "hex-line" + (isGroupHeader(L) ? " bank" : "") + ((L % 2 === 1) ? " alt" : "");
      div.style.top = (L * LINE_H) + "px";
      if (isGroupHeader(L)) {
        const s = lineStartAddr(L);
        const off = document.createElement("span"); off.className = "off";
        off.textContent = hexAddr(s);
        const bl = document.createElement("span"); bl.className = "bl";
        const gi = groupIndexAt(L);
        let label = groupLabel(gi);
        let extra = "";
        if (cur === VIEWS.cram) {
          // CRAM : libellé seul (sans plage d'adresses), + repère visuel dédié
          // aux palettes sprites (g >= 16) pour les distinguer des tuiles.
          if (gi >= 16) extra = " sprite";
        } else {
          label += " · " + hexAddr(s) + " – " + hexAddr(s + GROUP_BYTES - 1);
        }
        bl.textContent = label;
        div.className += extra; // " sprite" (rupture de palette sprite)
        div.append(off, bl);
      } else {
        const data = cache.get(chunkFor(L));
        const off = document.createElement("span"); off.className = "off";
        off.textContent = hexAddr(lineStartAddr(L));
        const hb = document.createElement("span"); hb.className = "hb";
        const ab = document.createElement("span"); ab.className = "ab";
        if (data) {
          const rowStart = lineStartAddr(L);
          const base = (rowStart - START) % CHUNK; // offset dans le chunk chargé
          const hlEnd = highlight ? highlight.addr + highlight.bytes.length : -1;
          for (let j = 0; j < UNITS_PER_ROW; j++) {
            const addr = rowStart + j * UNIT_BYTES;
            const inHl = highlight && addr >= highlight.addr && addr < hlEnd;
            if (!WORD16) {
              const u = document.createElement("span");
              if (inHl) u.className = "byte-hl";
              u.textContent = data[base + j].toString(16).toUpperCase().padStart(2, "0");
              hb.appendChild(u); hb.appendChild(document.createTextNode(" "));
              if (!NOASCII) {
                const b = data[base + j];
                const as = document.createElement("span");
                if (inHl) as.className = "byte-hl";
                as.textContent = (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".";
                ab.appendChild(as);
              }
            } else {
              const lo = data[base + j * 2], hi = data[base + j * 2 + 1] || 0;
              const w = (lo | (hi << 8)) & 0xFFFF;
              const u = document.createElement("span");
              if (inHl) u.className = "byte-hl";
              u.textContent = hexWord(w);
              hb.appendChild(u); hb.appendChild(document.createTextNode(" "));
              if (SWATCHES) {
                // CRAM : un carré de couleur par mot (CRAM 16 bits → RGB 3×3 bits).
                const B = (w >> 0) & 0x7, R = (w >> 3) & 0x7, G = (w >> 6) & 0x7;
                const s3 = (v) => Math.round((v * 255) / 7);
                const sw = document.createElement("span");
                sw.className = "cram-swatch";
                if (inHl) sw.classList.add("byte-hl");
                sw.style.background = "rgb(" + s3(R) + "," + s3(G) + "," + s3(B) + ")";
                sw.title = "RGB(" + R + "," + G + "," + B + ")  ·  $" + hexWord(w);
                ab.appendChild(sw);
              } else if (!NOASCII) {
                for (let k = 0; k < 2; k++) {
                  const b = data[base + j * 2 + k];
                  const as = document.createElement("span");
                  if (inHl) as.className = "byte-hl";
                  as.textContent = (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".";
                  ab.appendChild(as);
                }
              }
            }
          }
        } else {
          hb.textContent = (WORD16 ? "???? " : "?? ").repeat(UNITS_PER_ROW);
          if (!NOASCII) ab.textContent = SWATCHES ? "" : ".".repeat(UNITS_PER_ROW * UNIT_BYTES);
        }
        if (NOASCII) div.append(off, hb);
        else div.append(off, hb, ab);
      }
      frag.appendChild(div);
    }

    while (view.lastChild && view.lastChild !== spacer) view.removeChild(view.lastChild);
    view.appendChild(frag);

    posEl.textContent =
      (GROUPED ? groupLabel(groupIndexAt(first)) + " · " : "") + hexAddr(lineStartAddr(first));
  }
  // ---- Vecteurs d'interruption (panneau gauche, vue RAM) ----
  // Lecture des 5 vecteurs depuis la RAM chargée. VEC_BASE est l'offset dump de
  // IRQ2. Selon la taille de la HuCard : $1FF6 = 8 Ko, $2FF6 = 12 Ko, $3FF6 =
  // 16 Ko, … (les 10 derniers octets de la HuCard). Valeur petit-boutiste.
  const VEC_BASE = 0x1FF6;
  const VECTORS = [
    { off: 0, cpu: "$FFF6 – $FFF7", nameKey: "mem.vecIrq2Name",  descKey: "mem.vecIrq2Desc" },
    { off: 2, cpu: "$FFF8 – $FFF9", nameKey: "mem.vecIrq1Name",  descKey: "mem.vecIrq1Desc" },
    { off: 4, cpu: "$FFFA – $FFFB", nameKey: "mem.vecTimerName", descKey: "mem.vecTimerDesc" },
    { off: 6, cpu: "$FFFC – $FFFD", nameKey: "mem.vecNmiName",   descKey: "mem.vecNmiDesc" },
    { off: 8, cpu: "$FFFE – $FFFF", nameKey: "mem.vecResetName", descKey: "mem.vecResetDesc" },
  ];
  const vecListEl = $("vec-list");
  const vecValEls = [];

  function buildVecList() {
    if (!vecListEl) return;
    vecListEl.textContent = "";
    vecValEls.length = 0;
    for (const v of VECTORS) {
      const li = document.createElement("li");
      li.title = t(v.descKey);
      const a = document.createElement("span"); a.className = "vec-addr"; a.textContent = v.cpu;
      const n = document.createElement("b");   n.className = "vec-name"; n.textContent = t(v.nameKey);
      const val = document.createElement("span"); val.className = "vec-val empty"; val.textContent = "…";
      vecValEls.push(val);
      li.append(a, n, val);
      vecListEl.appendChild(li);
    }
  }

  // Lit les octets des vecteurs et affiche leur valeur (adresse pointée, petit-boutiste).
  function loadVectors() {
    if (!vecListEl || !vecValEls.length || !cur.showVectors) return;
    safeInvoke("memrd", { addr: VEC_BASE, len: 10 })
      .then((dump) => {
        if (!dump) return;
        const arr = Uint8Array.from(atob(dump.data_base64), (c) => c.charCodeAt(0));
        VECTORS.forEach((v, i) => {
          const lo = arr[v.off], hi = arr[v.off + 1];
          const el = vecValEls[i];
          el.className = "vec-val";
          el.textContent = "";
          const arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "→ ";
          const point = document.createElement("span");
          point.textContent = "$" + (lo | (hi << 8)).toString(16).toUpperCase().padStart(4, "0");
          el.append(arrow, point);
        });
      })
      .catch(() => {});
  }
  // ---- Navigation : adresse / bank / recherche hex·ascii ----
  const scrollToAddr = (addr) => {
    const a = Math.max(START, Math.min(addr, START + SIZE - 1));
    let L;
    if (GROUPED) {
      const g = Math.floor((a - START) / GROUP_BYTES);
      const within    = Math.floor(((a - START) % GROUP_BYTES) / BYTES_PER_ROW);
      L = g * PER_GROUP_LINES + 1 + within;
    } else {
      L = Math.floor((a - START) / BYTES_PER_ROW);
    }
    view.scrollTop = Math.max(0, L * LINE_H - view.clientHeight / 2);
    renderVisible();
  };

  $("mem-go-btn").addEventListener("click", () => {
    const raw = goInput.value.trim().replace(/^0x/i, "").replace(/^\$/, "");
    let addr = parseInt(raw, 16);
    if (isNaN(addr)) { log(t("mem.invalidAddress"), "err"); return; }
    scrollToAddr(addr);
  });
  goInput.addEventListener("keydown", (e) => { if (e.key === "Enter") $("mem-go-btn").click(); });

  const bankInput = $("mem-bank");
  const bankBtn   = $("mem-bank-btn");
  bankBtn.addEventListener("click", () => {
    let b = parseInt(bankInput.value, 10);
    if (isNaN(b)) return;
    b = Math.max(0, Math.min(b, GROUP_CNT - 1));
    bankInput.value = b;
    scrollToAddr(START + b * GROUP_BYTES);
  });
  bankInput.addEventListener("keydown", (e) => { if (e.key === "Enter") bankBtn.click(); });

  const searchInput = $("mem-search");
  const searchBtn   = $("mem-search-btn");
  const searchStop  = $("mem-search-stop");
  let searchAbort = false;

  function parseSearchPattern(raw) {
    const s = raw.trim();
    if (!s) return null;
    if (/^\s*(\$|0x)?[0-9A-Fa-f]{2}(\s*[0-9A-Fa-f]{2})*\s*$/.test(s)) {
      const clean = s.replace(/^0x/i, "").replace(/\$/g, "").replace(/\s+/g, "");
      const bytes = [];
      for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16));
      return bytes;
    }
    return Array.from(s, (c) => c.charCodeAt(0));
  }

  function findPattern(data, pat) {
    const lim = data.length - pat.length;
    outer: for (let i = 0; i <= lim; i++) {
      for (let j = 0; j < pat.length; j++) {
        if (data[i + j] !== pat[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  async function runSearch() {
    const pat = parseSearchPattern(searchInput.value);
    if (!pat || !pat.length) { log(t("mem.emptySearch"), "err"); return; }
    searchAbort = false;
    searchStop.hidden = false;
    if (highlight) { highlight = null; renderVisible(); }
    const label = pat.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const topL = Math.floor(view.scrollTop / LINE_H);
    const startChunk = Math.floor((lineStartAddr(topL) - START) / CHUNK);
    // Sur matériel réel : un balayage linéaire de toute la mémoire = des
    // milliers de CMD_MEM_RD d'affilée → console gelée > 1 min. On limite la
    // recherche aux blocs déjà chargés (zones consultées).
    const scanAll = readMode === "emu";
    log(t("mem.searching", { label, scope: scanAll ? t("mem.searchScopeAll") : t("mem.searchScopeLoaded") }), "info");
    try {
      for (let k = 0; k < CHUNK_CNT && !searchAbort; k++) {
        const c = (startChunk + k) % CHUNK_CNT;
        let data = cache.get(c);
        if (!data) {
          if (!scanAll) continue; // matériel : on ne lit rien de neuf
          let dump = null;
          try { dump = await safeInvoke("memrd", { addr: chunkAddr(c), len: CHUNK }); } catch {}
          if (!dump) continue;
          data = Uint8Array.from(atob(dump.data_base64), (ch) => ch.charCodeAt(0));
          cache.set(c, data);
        }
        const at = findPattern(data, pat);
        if (at >= 0) {
          const addr = chunkAddr(c) + at;
          highlight = { addr, bytes: pat };
          log(t("mem.patternFound", { addr: hexAddr(addr), group: GROUPED ? " (" + groupLabel(c) + ")" : "" }), "ok");
          scrollToAddr(addr);
          return;
        }
      }
      log(scanAll ? t("mem.patternNotFound") : t("mem.patternNotFoundLoaded"), "err");
    } finally {
      searchStop.hidden = true;
    }
  }
  searchBtn.addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
  searchStop.addEventListener("click", () => { searchAbort = true; });

  // Boutons de bascule entre les trois vues (RAM / VRAM / CRAM).
  const subtabBtns = document.querySelectorAll(".mem-subtab");
  const viewIdOf = (v) => Object.keys(VIEWS).find((k) => VIEWS[k] === v);

  // Prend un instantané VRAM + CRAM via `*v` (menu OS). Renvoie true si OK.
  // `refresh` false = réutilise l'instantané partagé s'il existe (capturé par
  // l'onglet Sprites ou la capture d'écran), sans relire la carte.
  let vramCapturing = false;
  async function captureVramCram(refresh = true) {
    if (vramCapturing) return false;
    vramCapturing = true;
    if (refresh) log(t("mem.capturingVramCram"));
    const res = await safeInvoke("capture_vram", { refresh });
    vramCapturing = false;
    if (!res) {
      log(t("mem.vramCramUnavailable"), "err");
      return false;
    }
    vramSnap = b64ToBytes(res.vram_b64);
    cramSnap = b64ToBytes(res.cram_b64);
    log(t("mem.vramCramCaptured"), "ok");
    return true;
  }

  // Vide le cache et recharge la vue courante : RAM → relit la zone visible ;
  // VRAM/CRAM → reprend un instantané `*v`. Sur matériel, appelé seulement sur
  // action explicite (« Rafraîchir », changement de vue).
  invalidateMemCache = () => {
    cache.clear();
    loading.clear();
    highlight = null;
    if (snapView()) {
      captureVramCram().then((ok) => { if (ok) { cache.clear(); renderVisible(true); } });
    } else {
      renderVisible(true);
      if (cur.showVectors) loadVectors();
    }
  };

  // (Ré)applique la politique de lecture après une (dé)connexion. Sur matériel
  // réel : RAM en mode conservateur ; VRAM/CRAM restent accessibles (via `*v`,
  // menu affiché). Sur l'émulateur : tout ouvert.
  configureMemForDevice = (isEmu) => {
    readMode = isEmu ? "emu" : "hw";
    autoLoad = isEmu;
    if (memWarnEl) memWarnEl.hidden = isEmu;

    cache.clear();
    loading.clear();
    highlight = null;
    vramSnap = cramSnap = null; // instantané périmé après un (dé)branchement

    setupGeometry(viewIdOf(cur)); // recalcule CHUNK selon le nouveau mode
    renderVisible(false);
    if (isEmu && cur.showVectors) loadVectors();
  };

  // Bascule entre les trois vues (RAM / VRAM / CRAM).
  subtabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.memview === viewIdOf(cur)) return;
      subtabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      cache.clear();
      loading.clear();
      highlight = null;
      view.scrollTop = 0;
      setupGeometry(btn.dataset.memview);
      const haveSnap = cur === VIEWS.vram ? vramSnap : (cur === VIEWS.cram ? cramSnap : true);
      if (snapView() && !haveSnap) {
        // Première ouverture de VRAM/CRAM : réutilise l'instantané partagé s'il
        // existe (capture d'écran / onglet Sprites), sinon lit `*v`.
        captureVramCram(false).then((ok) => { if (ok) { cache.clear(); renderVisible(true); } });
      } else {
        renderVisible(true); // RAM, ou instantané déjà en mémoire
      }
      if (cur.showVectors) loadVectors();
    });
  });

  let rafPending = false;
  view.addEventListener("scroll", () => {
    if (hexHead) hexHead.scrollLeft = view.scrollLeft;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderVisible(); });
  });

  if (window.ResizeObserver) {
    new ResizeObserver(() => renderVisible(false)).observe(view);
  } else {
    window.addEventListener("resize", () => renderVisible(false));
  }

  setupGeometry("ram");
  buildVecList();
  // État par défaut = conservateur (rien de connecté). `configureMemForDevice`
  // sera rappelé à la connexion avec la vraie nature de la cible.
  configureMemForDevice(false);
  // Pas de lecture au démarrage : rien n'est connecté. Les vecteurs sont lus à
  // la (re)connexion (émulateur) ou au clic « Rafraîchir » (matériel).

  // Rafraîchit la vue courante : vide le cache (et les relectures en cours),
  // relit les données fraîches de l'émulateur, et recharge les vecteurs si besoin.
  $("mem-refresh").addEventListener("click", () => {
    log(t("mem.reloading", { label: curLabel() }));
    invalidateMemCache();
  });

  // Encodage base64 d'un Uint8Array, par tranches (btoa plante sur un très gros
  // argument via String.fromCharCode).
  function bytesToB64(bytes) {
    let bin = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(bin);
  }

  $("mem-save").addEventListener("click", async () => {
    const defaultName = cur === VIEWS.ram ? "memdump.bin" : (cur === VIEWS.vram ? "vram.bin" : "cram.bin");

    // VRAM/CRAM : enregistre l'instantané `*v` (le capture si besoin), sans
    // toucher au bus cartouche.
    if (snapView()) {
      let snap = cur === VIEWS.vram ? vramSnap : cramSnap;
      if (!snap) {
        if (!(await captureVramCram())) return;
        snap = cur === VIEWS.vram ? vramSnap : cramSnap;
      }
      const p = await safeInvoke("pick_save", { default_name: defaultName });
      if (!p) return;
      const okv = await safeInvoke("save_png", { data_base64: bytesToB64(snap), path: p });
      if (okv === null) return;
      log(t("mem.savedLog", { label: curLabel(), path: p, size: snap.length }), "ok");
      return;
    }

    // Dump complet de la RAM = lecture de toute la fenêtre. Sur matériel réel,
    // ça vole beaucoup de cycles au CPU PC-Engine : on lit par blocs (la console
    // respire entre chaque) et on prévient l'utilisateur.
    if (readMode !== "emu") {
      const secs = Math.ceil(SIZE / 90000); // ~90 Ko/s utiles
      const ok = await askConfirm(
        t("mem.confirmFullDump", { label: curLabel(), size: fmtSize(SIZE), secs }));
      if (!ok) return;
    }

    const path = await safeInvoke("pick_save", { default_name: defaultName });
    if (!path) return;

    const BLOCK = readMode === "emu" ? 0x40000 : 0x4000;
    const out = new Uint8Array(SIZE);
    log(t("mem.readingLabel", { label: curLabel(), size: fmtSize(SIZE) }));
    let lastPct = -1;
    for (let off = 0; off < SIZE; off += BLOCK) {
      const len = Math.min(BLOCK, SIZE - off);
      const dump = await safeInvoke("memrd", { addr: START + off, len });
      if (!dump) { log(t("mem.readInterrupted", { addr: hexAddr(START + off) }), "err"); return; }
      out.set(Uint8Array.from(atob(dump.data_base64), (c) => c.charCodeAt(0)), off);
      const pct = Math.floor((off + len) * 100 / SIZE);
      if (SIZE > BLOCK && pct !== lastPct && pct % 10 === 0) { log(`  ${pct} %`, ""); lastPct = pct; }
    }
    const ok = await safeInvoke("save_png", { data_base64: bytesToB64(out), path });
    if (ok === null) return;
    log(t("mem.savedLog", { label: curLabel(), path, size: out.length }), "ok");
  });

  onLangChange(() => {
    setupGeometry(viewIdOf(cur));
    buildVecList();
    if (cur.showVectors && els.connDot.classList.contains("on")) loadVectors();
    renderVisible(false);
  });
})();

// ---------------------------------------------------------------- planche de tuiles VRAM
// Décode l'instantané VRAM (`*v`) en grille de cellules 4 bpp pour repérer les
// motifs de sprites (stockés en VRAM comme les tuiles de fond). Tout le décodage
// se fait ici (canvas) : les réglages ne relisent jamais la carte.
(() => {
  const cv = $("spr-canvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const b64ToBytesLocal = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const elCell = $("spr-cell"), elPal = $("spr-pal"), elCols = $("spr-cols");
  const elZoom = $("spr-zoom"), elZoomVal = $("spr-zoom-val");
  const elGrid = $("spr-grid"), elTransp = $("spr-transp");
  const elInfo = $("spr-info"), elStatus = $("spr-status");

  let vram = null;         // Uint8Array(65536)
  let cram = null;         // Uint8Array(1024)
  let sheet = null;        // canvas natif (cols*cw × rows*ch)
  let geom = null;         // { spec, cw, ch, cols, rows, total, W, H, wordsPerCell }
  let selA = null, selB = null; // coins (cx,cy) de la sélection dans la grille courante
  // Plages d'octets VRAM (absolues, indépendantes de la grille) couvertes par
  // la sélection courante. Sert à la retrouver — même zone VRAM — après un
  // changement de taille de cellule / colonnes (`reprojectSelectionFromLock`)
  // ou un « 🔄 Capturer » : tant qu'on ne l'efface pas (« ✕ Sélection » /
  // Échap), la sélection reste posée sur la même zone.
  let lockedRanges = [];   // [[loByte, hiByte], …]
  let dragging = false;
  let locked = false;      // true : la vue (`paint`) est recadrée sur la seule
                            // sélection — plus rien d'autre de la VRAM affiché.
  let capturing = false;

  // Les 6 tailles de sprite du VDC (16×16 à 32×64), + la tuile de fond 8×8.
  // Une sprite CGX×CGY = cw×ch blocs de 16×16 contigus en VRAM, rangés
  // colonne par colonne, chaque colonne de haut en bas (convention VDC :
  // le bloc à l'adresse de base est le coin haut-gauche).
  const CELL_SIZES = {
    "8x8": { w: 8, h: 8, bg: true },
    "16x16": { w: 16, h: 16, cw: 1, ch: 1 },
    "16x32": { w: 16, h: 32, cw: 1, ch: 2 },
    "16x64": { w: 16, h: 64, cw: 1, ch: 4 },
    "32x16": { w: 32, h: 16, cw: 2, ch: 1 },
    "32x32": { w: 32, h: 32, cw: 2, ch: 2 },
    "32x64": { w: 32, h: 64, cw: 2, ch: 4 },
  };

  // Palettes : 16 « fond » puis 16 « sprite » (disposition CRAM du VCE).
  function buildPaletteOptions() {
    const prev = elPal.value;
    elPal.innerHTML = "";
    for (let p = 0; p < 32; p++) {
      const o = document.createElement("option");
      o.value = p;
      o.textContent = p < 16 ? t("sprites.paletteBg", { n: p }) : t("sprites.paletteSprite", { n: p - 16 });
      elPal.appendChild(o);
    }
    elPal.value = prev || "16"; // Sprite 0 par défaut
  }
  buildPaletteOptions();

  const word = (buf, w) => buf[2 * w] | (buf[2 * w + 1] << 8);

  // Couleur RVBA d'une entrée (palette 0-31, index 0-15). VCE = GRB 3-3-3.
  function palRGBA(pal, idx) {
    const w = word(cram, (pal * 16 + idx) & 0x1ff);
    const g = (w >> 6) & 7, r = (w >> 3) & 7, b = w & 7;
    const s = (v) => Math.round((v * 255) / 7);
    return [s(r), s(g), s(b)];
  }

  // Indice de couleur (0-15) d'un pixel d'une cellule.
  //  - 8×8  : format tuile de fond (plans aux octets 0,1,16,17 d'un bloc de 32).
  //  - 16×16: format motif de sprite (4 plans de 16 mots, bit 15 = pixel gauche).
  function pixel8(base, x, y) {
    const p = base + y * 2;
    const s = 7 - x;
    return ((vram[p] >> s) & 1)
      | (((vram[p + 1] >> s) & 1) << 1)
      | (((vram[p + 16] >> s) & 1) << 2)
      | (((vram[p + 17] >> s) & 1) << 3);
  }
  function pixel16(baseWord, x, y) {
    const s = 15 - x;
    return ((word(vram, baseWord + y) >> s) & 1)
      | (((word(vram, baseWord + 16 + y) >> s) & 1) << 1)
      | (((word(vram, baseWord + 32 + y) >> s) & 1) << 2)
      | (((word(vram, baseWord + 48 + y) >> s) & 1) << 3);
  }
  // Sprite composite (cw×ch blocs 16×16, cw/ch dans `spec`) : sous-bloc rangé
  // colonne par colonne, chaque colonne de haut en bas — cf. CELL_SIZES.
  function pixelSprite(spec, baseWord, x, y) {
    const subCol = (x / 16) | 0, subRow = (y / 16) | 0;
    const subIdx = subCol * spec.ch + subRow;
    return pixel16(baseWord + subIdx * 64, x % 16, y % 16);
  }

  function buildSheet() {
    if (!vram || !cram) { sheet = null; return; }
    const spec = CELL_SIZES[elCell.value] || CELL_SIZES["16x16"];
    const cols = Math.max(1, Math.min(64, +elCols.value || 16));
    const wordsPerCell = spec.bg ? 0 : spec.cw * spec.ch * 64;
    const bytesPerCell = spec.bg ? 32 : wordsPerCell * 2;
    const total = Math.floor(vram.length / bytesPerCell);
    const rows = Math.ceil(total / cols);
    const pal = +elPal.value;
    const transp = elTransp.checked;

    const cw = spec.w, ch = spec.h;
    const W = cols * cw, H = rows * ch;
    sheet = document.createElement("canvas");
    sheet.width = W; sheet.height = H;
    const sctx = sheet.getContext("2d");
    const img = sctx.createImageData(W, H);
    const d = img.data;

    const lut = [];
    for (let i = 0; i < 16; i++) lut.push(palRGBA(pal, i));

    // La planche décode toujours tout : c'est `paint()` qui recadre sur la
    // seule sélection en vue verrouillée (`locked`). `lockedRanges` ne sert
    // ici qu'à retrouver la même zone VRAM après un changement de grille
    // (cf. reprojectSelectionFromLock).
    for (let c = 0; c < total; c++) {
      const ox = (c % cols) * cw, oy = Math.floor(c / cols) * ch;
      const base = spec.bg ? c * 32 : c * wordsPerCell; // octets (fond) ou mots (sprite)
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const ci = spec.bg ? pixel8(base, x, y) : pixelSprite(spec, base, x, y);
          const o = ((oy + y) * W + (ox + x)) * 4;
          const [r, g, b] = lut[ci];
          d[o] = r; d[o + 1] = g; d[o + 2] = b;
          d[o + 3] = (transp && ci === 0) ? 0 : 255;
        }
      }
    }
    sctx.putImageData(img, 0, 0);
    geom = { spec, cw, ch, cols, rows, total, W, H, wordsPerCell, bytesPerCell };
  }

  function cellByteRange(c) {
    if (!geom) return [0, 0];
    const lo = c * geom.bytesPerCell;
    return [lo, lo + geom.bytesPerCell - 1];
  }

  // Recalcule `lockedRanges` (octets VRAM absolus) à partir de la sélection
  // courante (grille actuelle) — une plage contiguë par ligne sélectionnée
  // (les lignes ne sont pas forcément contiguës entre elles en VRAM).
  function syncLockFromSelection() {
    const r = selRect();
    if (!r || !geom) { lockedRanges = []; return; }
    lockedRanges = [];
    for (let cy = r.y0; cy <= r.y1; cy++) {
      const [lo] = cellByteRange(idxOf(r.x0, cy));
      const [, hi] = cellByteRange(idxOf(r.x1, cy));
      lockedRanges.push([lo, hi]);
    }
  }

  // Après un changement de grille (taille de cellule / colonnes), recalcule le
  // rectangle de sélection affiché (`selA`/`selB`) à partir des plages
  // verrouillées : englobe toutes les cellules de la nouvelle grille qui
  // recoupent une plage verrouillée.
  function reprojectSelectionFromLock() {
    if (!lockedRanges.length || !geom) { selA = null; selB = null; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let c = 0; c < geom.total; c++) {
      const [lo, hi] = cellByteRange(c);
      if (!lockedRanges.some(([rlo, rhi]) => lo <= rhi && hi >= rlo)) continue;
      const cx = c % geom.cols, cy = Math.floor(c / geom.cols);
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    }
    if (x1 < 0) { selA = null; selB = null; return; }
    selA = { cx: x0, cy: y0 };
    selB = { cx: x1, cy: y1 };
  }

  function paint() {
    if (!sheet || !geom) {
      cv.width = 10; cv.height = 10;
      ctx.clearRect(0, 0, 10, 10);
      return;
    }
    const z = +elZoom.value;
    elZoomVal.textContent = z + "×";
    const r = selRect();

    // Vue verrouillée : la planche disparaît, seule la sélection est recadrée
    // et affichée — plus rien d'autre de la VRAM n'est visible.
    if (locked && r) {
      const wCells = r.x1 - r.x0 + 1, hCells = r.y1 - r.y0 + 1;
      const sw = wCells * geom.cw, sh = hCells * geom.ch;
      // Redimensionner le canvas réinitialise tout son contexte (dont
      // imageSmoothingEnabled) : le repositionner après, pas avant.
      cv.width = sw * z; cv.height = sh * z;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(sheet, r.x0 * geom.cw, r.y0 * geom.ch, sw, sh, 0, 0, cv.width, cv.height);
      if (elGrid.checked && z >= 2) {
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1;
        const sx = geom.cw * z, sy = geom.ch * z;
        ctx.beginPath();
        for (let gx = 0; gx <= wCells; gx++) { ctx.moveTo(gx * sx + 0.5, 0); ctx.lineTo(gx * sx + 0.5, cv.height); }
        for (let gy = 0; gy <= hCells; gy++) { ctx.moveTo(0, gy * sy + 0.5); ctx.lineTo(cv.width, gy * sy + 0.5); }
        ctx.stroke();
      }
      return;
    }

    cv.width = geom.W * z;
    cv.height = geom.H * z;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(sheet, 0, 0, cv.width, cv.height);

    if (elGrid.checked && z >= 2) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      const sx = geom.cw * z, sy = geom.ch * z;
      ctx.beginPath();
      for (let gx = 0; gx <= geom.cols; gx++) { ctx.moveTo(gx * sx + 0.5, 0); ctx.lineTo(gx * sx + 0.5, cv.height); }
      for (let gy = 0; gy <= geom.rows; gy++) { ctx.moveTo(0, gy * sy + 0.5); ctx.lineTo(cv.width, gy * sy + 0.5); }
      ctx.stroke();
    }
    if (r) {
      const sx = geom.cw * z, sy = geom.ch * z;
      const rx = r.x0 * sx, ry = r.y0 * sy, rw = (r.x1 - r.x0 + 1) * sx, rh = (r.y1 - r.y0 + 1) * sy;
      // Contour de la sélection uniquement : le reste de la planche n'est pas
      // assombri (utilisez « 🔒 Locker » pour vraiment isoler la sélection).
      ctx.save();
      ctx.strokeStyle = "#22e0ff";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#22e0ff";
      ctx.shadowBlur = 6;
      ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
      ctx.restore();
    }
  }

  function refreshAll() { buildSheet(); paint(); updateStatus(); }

  function updateStatus() {
    if (!geom) { elStatus.textContent = ""; return; }
    const label = geom.spec.bg ? "8×8" : `${geom.spec.w}×${geom.spec.h}`;
    const lockNote = locked ? t("sprites.lockedNote") : "";
    elStatus.textContent =
      lockNote + t("sprites.statusLine", { cells: geom.total, label, cols: geom.cols, rows: geom.rows });
  }

  // Rectangle de sélection normalisé (coordonnées de cellule, incluses), ou
  // `null` si aucune sélection (export = planche entière).
  function selRect() {
    if (!selA || !selB) return null;
    return {
      x0: Math.min(selA.cx, selB.cx), x1: Math.max(selA.cx, selB.cx),
      y0: Math.min(selA.cy, selB.cy), y1: Math.max(selA.cy, selB.cy),
    };
  }

  // Cellule (cx, cy) sous le pointeur, bornée à la grille (permet de glisser
  // au-delà du canvas sans perdre la sélection en cours).
  function cellAt(clientX, clientY) {
    if (!geom) return null;
    const r = cv.getBoundingClientRect();
    const z = +elZoom.value;
    const px = (clientX - r.left) / z, py = (clientY - r.top) / z;
    const cx = Math.max(0, Math.min(geom.cols - 1, Math.floor(px / geom.cw)));
    const cy = Math.max(0, Math.min(geom.rows - 1, Math.floor(py / geom.ch)));
    return { cx, cy };
  }

  function clearSelection() {
    selA = null; selB = null;
    lockedRanges = [];
    locked = false;
    updateLockUI();
    updateSelInfo();
    updateStatus();
    paint();
  }

  function setLocked(v) {
    if (v && !selRect()) return; // rien à verrouiller
    locked = v;
    updateLockUI();
    updateStatus();
    paint();
  }

  function updateLockUI() {
    const btn = $("spr-lock");
    if (!btn) return;
    btn.disabled = !selRect();
    btn.textContent = locked ? t("sprites.unlock") : t("sprites.lock");
    btn.classList.toggle("active", locked);
  }

  function idxOf(cx, cy) { return cy * geom.cols + cx; }

  function updateSelInfo() {
    const r = selRect();
    if (!r || !geom) { elInfo.textContent = t("sprites.noSelection"); return; }
    const hex = (n) => "$" + n.toString(16).toUpperCase();
    const wCells = r.x1 - r.x0 + 1, hCells = r.y1 - r.y0 + 1;

    if (wCells === 1 && hCells === 1) {
      const idx = idxOf(r.x0, r.y0);
      if (geom.spec.bg) {
        const wordAddr = idx * 16, byteAddr = wordAddr * 2;
        elInfo.textContent = t("sprites.cellInfo", { idx, word: hex(wordAddr), byte: hex(byteAddr) });
      } else {
        const baseWord = idx * geom.wordsPerCell;
        const patternBase = baseWord / 64; // n° de pattern SATB (unité 16×16)
        const nBlocks = geom.spec.cw * geom.spec.ch;
        elInfo.textContent = t("sprites.spriteInfo", { idx, word: hex(baseWord), pattern: patternBase })
          + (nBlocks > 1 ? t("sprites.spriteInfoExtraBlocks", { n: nBlocks - 1 }) : "");
      }
      return;
    }

    const nCells = wCells * hCells;
    const pxW = wCells * geom.cw, pxH = hCells * geom.ch;
    let msg = t("sprites.selectionInfo", { w: wCells, h: hCells, n: nCells, pxw: pxW, pxh: pxH });
    if (hCells === 1) {
      const w0 = idxOf(r.x0, r.y0) * (geom.spec.bg ? 16 : geom.wordsPerCell);
      const w1 = (idxOf(r.x1, r.y0) + 1) * (geom.spec.bg ? 16 : geom.wordsPerCell) - 1;
      msg += t("sprites.selectionAddrRange", { from: hex(w0), to: hex(w1) });
    } else {
      msg += t("sprites.selectionNonContiguous", { h: hCells });
    }
    elInfo.textContent = msg;
  }

  async function sprCapture(refresh) {
    if (capturing) return;
    capturing = true;
    elStatus.textContent = refresh ? t("sprites.capturingVram") : t("sprites.loadingStatus");
    const res = await safeInvoke("capture_vram", { refresh });
    capturing = false;
    if (!res) {
      elStatus.textContent = t("sprites.vramUnavailable");
      return;
    }
    vram = b64ToBytesLocal(res.vram_b64);
    cram = b64ToBytesLocal(res.cram_b64);
    // La géométrie (taille de cellule, colonnes) ne change pas avec une simple
    // recapture : on garde la sélection pour pouvoir surveiller la même zone
    // VRAM d'un instantané à l'autre (ex. une animation).
    refreshAll();
  }

  // Ouverture de l'onglet : capture si rien en mémoire (réutilise l'instantané
  // partagé avec la capture d'écran quand il existe).
  openSpritesTab = () => { if (!vram) sprCapture(false); };

  // Changer la taille de cellule ou le nombre de colonnes redéfinit la grille
  // (coordonnées de cellule différentes). On ne perd pas la sélection pour
  // autant : `reprojectSelectionFromLock` la retrouve dans la nouvelle grille
  // à partir de la zone VRAM verrouillée (`lockedRanges`), qu'on soit en vue
  // verrouillée ou simple sélection — « tant qu'on ne l'efface pas, ça reste
  // sur la même zone ».
  [elCell, elCols].forEach((el) =>
    el.addEventListener("input", () => {
      buildSheet();
      reprojectSelectionFromLock();
      updateLockUI();
      updateSelInfo();
      updateStatus();
      paint();
    }));
  [elPal, elTransp].forEach((el) => el.addEventListener("input", refreshAll));
  [elZoom, elGrid].forEach((el) => el.addEventListener("input", paint));

  // Clic = cellule unique ; glisser = plage rectangulaire (limitera l'export PNG
  // et pourra être verrouillée). Désactivé en vue verrouillée (les coordonnées
  // du canvas ne correspondent plus à la grille entière) — déverrouillez
  // d'abord pour changer la sélection.
  cv.addEventListener("mousedown", (e) => {
    if (locked) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    dragging = true;
    selA = c; selB = c;
    syncLockFromSelection();
    updateSelInfo();
    updateLockUI();
    paint();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging || locked) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    selB = c;
    syncLockFromSelection();
    updateSelInfo();
    updateLockUI();
    paint();
  });
  window.addEventListener("mouseup", () => { dragging = false; });

  $("spr-lock").addEventListener("click", () => setLocked(!locked));
  $("spr-clear-sel").addEventListener("click", clearSelection);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("tab-sprites")?.classList.contains("active")) clearSelection();
  });

  $("spr-refresh").addEventListener("click", () => sprCapture(true));
  $("spr-save").addEventListener("click", async () => {
    if (!sheet || !geom) return;
    const r = selRect();
    let src = sheet, defaultName = "vram-tiles.png";
    if (r) {
      const w = (r.x1 - r.x0 + 1) * geom.cw, h = (r.y1 - r.y0 + 1) * geom.ch;
      const crop = document.createElement("canvas");
      crop.width = w; crop.height = h;
      crop.getContext("2d").drawImage(sheet, r.x0 * geom.cw, r.y0 * geom.ch, w, h, 0, 0, w, h);
      src = crop;
      defaultName = "vram-tiles-selection.png";
    }
    const path = await safeInvoke("pick_save", { default_name: defaultName });
    if (!path) return;
    const b64 = src.toDataURL("image/png").split(",")[1];
    const ok = await safeInvoke("save_png", { data_base64: b64, path });
    if (ok !== null) log(r ? t("sprites.selectionSaved", { path }) : t("sprites.sheetSaved", { path }), "ok");
  });

  onLangChange(() => {
    buildPaletteOptions();
    updateStatus();
    updateSelInfo();
    updateLockUI();
  });
})();

// ---------------------------------------------------------------- séparateur
// Sépare la partie haute de l'interface du journal : le glisser redimensionne
// la hauteur du journal (donc celle de la partie haute). Valeur mémorisée.
(() => {
  const splitter = $("splitter");
  if (!splitter) return;
  const MIN_LOG = 60;
  const saved = localStorage.getItem("ed-tools-log-h");
  if (saved) document.documentElement.style.setProperty("--log-h", saved + "px");

  let dragging = false;
  const clamp = (h) =>
    Math.max(MIN_LOG, Math.min(h, window.innerHeight - 180));

  splitter.addEventListener("pointerdown", (e) => {
    dragging = true;
    splitter.classList.add("dragging");
    e.preventDefault();
    try { splitter.setPointerCapture(e.pointerId); } catch (_) {}
  });
  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    document.documentElement.style.setProperty("--log-h", clamp(window.innerHeight - e.clientY) + "px");
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--log-h")) || 150;
    localStorage.setItem("ed-tools-log-h", String(Math.round(h)));
  };
  splitter.addEventListener("pointerup", end);
  splitter.addEventListener("pointercancel", end);
})();

// ---------------------------------------------------------------- init
(async () => {
  const b = await safeInvoke("get_build_info");
  if (b) {
    const el = $("app-version");
    if (el) { el.textContent = b.label; el.title = t("log.appVersionTitle", { label: b.label }); }
    log(t("log.appVersion", { label: b.label }), "info");
  }
})();
refreshPorts();
setInterval(refreshPorts, 4000); // rafraîchit la liste des ports
log(t("log.ready"), "info");
