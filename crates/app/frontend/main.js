// Frontend de l'outil Turbo EverDrive.
// Utilise l'API globale Tauri (withGlobalTauri) : window.__TAURI__

const { core, event } = window.__TAURI__;
const invoke = (cmd, args) => core.invoke(cmd, args);

const $ = (id) => document.getElementById(id);
const els = {
  connDot: $("conn-dot"), connLabel: $("conn-label"),
  portSelect: $("port-select"), portManual: $("port-manual"), infoCard: $("info-card"), infoText: $("info-text"),
  crumbs: $("crumbs"), explorer: $("explorer"), explorerEmpty: $("explorer-empty"),
  explorerStatus: $("explorer-status"),
  explorerUp: $("explorer-up"), explorerRefresh: $("explorer-refresh"), explorerImport: $("explorer-import"),
  transferBar: $("transfer-bar"), transferLabel: $("transfer-label"),
  transferPct: $("transfer-pct"), transferFill: $("transfer-fill"),
  viewIcons: $("view-icons"), viewList: $("view-list"),
  romPath: $("rom-path"), screenCard: $("screen-card"), screenImg: $("screen-img"),
  batW: $("bat-w"), batH: $("bat-h"), resW: $("res-w"), resH: $("res-h"),
  scrollX: $("scroll-x"), scrollY: $("scroll-y"),
  batWVal: $("bat-w-val"), batHVal: $("bat-h-val"),
  resWVal: $("res-w-val"), resHVal: $("res-h-val"),
  scrollXVal: $("scroll-x-val"), scrollYVal: $("scroll-y-val"),
  log: $("log"),
};

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
    log(String(e), "err");
    return null;
  }
}

function setConnected(connected) {
  els.connDot.classList.toggle("on", connected);
  els.connLabel.textContent = connected ? "Connecté" : "Déconnecté";
}

// ---------------------------------------------------------------- onglets
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
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
    opt.textContent = "(auto)";
    els.portSelect.appendChild(opt);
    ports.forEach((p) => {
      const o = document.createElement("option");
      o.value = p; o.textContent = p;
      els.portSelect.appendChild(o);
    });
  } else {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "(aucun port)";
    els.portSelect.appendChild(opt);
  }
}

async function doConnect() {
  const manual = (els.portManual && els.portManual.value.trim()) || "";
  const port = manual || els.portSelect.value || null;
  if (!manual && !els.portSelect.value) {
    log("Scan automatique en cours… (veuillez patienter quelques secondes)", "info");
  }
  const info = await safeInvoke("connect", { port }, "Carte connectée");
  if (!info) {
    if (!manual) {
      log("Astuce : aucune carte trouvée automatiquement. Pour l'émulateur virtuel, tapez le port affiché au lancement (ex: /dev/ttys001) dans « Port manuel », puis recliquez Connecter.", "err");
    }
    return;
  }
  setConnected(true);
  els.infoCard.hidden = false;
  els.infoText.textContent = info.info;
  isEmulator = !!info.is_emulator;
  log(`Nom: ${info.name} · Port: ${info.port}${isEmulator ? " · émulateur" : ""}`, "info");
  if (!isEmulator) {
    log("Matériel réel : la vue Mémoire est en mode conservateur (pas de lecture auto, clic « Rafraîchir »). VRAM/CRAM = instantané via le menu de la carte.", "info");
  }
  if (configureMemForDevice) configureMemForDevice(isEmulator);
  // Sur l'émulateur, la mémoire est observable sans coût : on relit tout de
  // suite. Sur matériel, on attend un clic explicite « Rafraîchir ».
  if (isEmulator && invalidateMemCache) invalidateMemCache();
}

async function doDisconnect() {
  await safeInvoke("disconnect", {}, "Déconnecté");
  setConnected(false);
  els.infoCard.hidden = true;
  isEmulator = false;
  if (configureMemForDevice) configureMemForDevice(false);
}

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

function iconFor(entry) {
  if (entry.is_dir) return "📁";
  const ext = (entry.name.split(".").pop() || "").toLowerCase();
  if (["pce", "sgx", "rom", "bin"].includes(ext)) return "🎮";
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext)) return "🖼️";
  if (["txt", "md", "ini", "log", "cfg", "json"].includes(ext)) return "📄";
  if (["sav", "ram", "bram"].includes(ext)) return "💾";
  return "📦";
}

function fmtSize(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " Mo";
  if (b >= 1024) return Math.round(b / 1024) + " Ko";
  return b + " o";
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
  els.explorerStatus.textContent = "Chargement de la carte…";
  els.explorerStatus.className = "explorer-status";

  const entries = await safeInvoke("list_sd", { path: explorerPath });
  if (!entries) {
    els.explorerStatus.textContent = "Impossible de lister la carte. Vérifiez la connexion.";
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
    els.explorerStatus.textContent = "Dossier vide — déposez des fichiers ici pour les envoyer.";
    explorerBusy = false;
    return;
  }

  const container = explorerView === "list" ? renderList(sorted) : renderGrid(sorted);
  els.explorer.appendChild(container);
  els.explorerStatus.textContent =
    `${sorted.length} élément(s) · ${explorerPath ? explorerPath : "racine"}`;
  explorerBusy = false;
}

// ------------------------------------------------------------------ vue grille
function renderGrid(sorted) {
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const entry of sorted) {
    const card = document.createElement("div");
    card.className = "entry" + (entry.is_dir ? " is-dir" : " is-file");
    card.draggable = !entry.is_dir; // seuls les fichiers se téléchargent
    card.title = entry.is_dir ? "Ouvrir le dossier" : "Télécharger (double-clic ou ⬇)";

    const icon = document.createElement("div");
    icon.className = "eicon"; icon.textContent = iconFor(entry);
    const name = document.createElement("div");
    name.className = "ename"; name.textContent = entry.name;
    const size = document.createElement("div");
    size.className = "esize"; size.textContent = entry.is_dir ? "Dossier" : fmtSize(entry.size);
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
      card.addEventListener("dblclick", () => doDownloadSd(full));
      const dl = document.createElement("button");
      dl.className = "dlbtn"; dl.textContent = "⬇"; dl.title = "Télécharger";
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
    '<tr><th></th><th>Nom</th><th>Type</th><th>Taille</th><th></th></tr>';
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
    tdType.textContent = entry.is_dir ? "Dossier"
      : (entry.name.split(".").pop() || "fichier").toUpperCase();

    const tdSize = document.createElement("td");
    tdSize.className = "lsize";
    tdSize.textContent = entry.is_dir ? "—" : fmtSize(entry.size);

    const tdAct = document.createElement("td");
    tdAct.className = "lact";
    if (!entry.is_dir) {
      const dl = document.createElement("button");
      dl.className = "dlbtn"; dl.textContent = "⬇"; dl.title = "Télécharger";
      dl.addEventListener("click", (e) => { e.stopPropagation(); doDownloadSd(full); });
      tdAct.appendChild(dl);
    }

    tr.appendChild(tdIcon); tr.appendChild(tdName); tr.appendChild(tdType);
    tr.appendChild(tdSize); tr.appendChild(tdAct);

    if (entry.is_dir) {
      tr.classList.add("dir-link");
      tr.addEventListener("click", () => { explorerPath = full; renderExplorer(); });
    } else {
      tr.addEventListener("dblclick", () => doDownloadSd(full));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function setView(v) {
  explorerView = v;
  els.viewIcons.classList.toggle("active", v === "grid");
  els.viewList.classList.toggle("active", v === "list");
  renderExplorer();
}

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
  const verb = p.dir === "download" ? "Téléchargement" : "Envoi";
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
    els.transferPct.textContent = "Terminé";
    bar.classList.add("done");
    transferHideTimer = setTimeout(() => { bar.hidden = true; }, 2500);
  } else if (p.phase === "error") {
    fill.classList.remove("indeterminate");
    els.transferPct.textContent = "Échec";
    bar.classList.add("err");
    // L'erreur détaillée est déjà journalisée par safeInvoke (retour de commande).
    transferHideTimer = setTimeout(() => { bar.hidden = true; }, 5000);
  }
});

async function doDownloadSd(full) {
  const local = await safeInvoke("pick_save", { default_name: full.split("/").pop() || "fichier.bin" });
  if (!local) return;
  const res = await safeInvoke("download", { src: full, local });
  if (res && !res.isErr) log(`✔ Téléchargé : ${full}`, "ok");
}

async function uploadOne(local) {
  const name = local.split(/[\\/]/).pop();
  const dest = joinSdPath(explorerPath, name);
  log(`Téléversement de ${name} → ${explorerPath || "racine"}…`);
  const res = await safeInvoke("upload", { local, dest });
  if (res && !res.isErr) log(`✔ ${name} envoyé`, "ok");
  renderExplorer();
}

async function uploadAll(files) {
  if (!files.length) return;
  log(`Envoi de ${files.length} fichier(s) vers ${explorerPath || "racine"}…`, "info");
  for (const f of files) await uploadOne(f);
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
  if (picked) await uploadOne(picked);
});

// ---------------------------------------------------------------- jouer
// « Choisir et lancer… » : sélectionne une ROM puis la déploie et la lance
// directement (les boutons « Charger » et « Lancer » séparés ont été supprimés).
$("pick-rom").addEventListener("click", async () => {
  const picked = await safeInvoke("pick_file");
  if (!picked) return;
  els.romPath.value = picked;
  log(`Lancement de ${picked.split(/[\\/]/).pop()}…`);
  const res = await safeInvoke("run_rom", { rom: picked });
  if (res && !res.isErr) {
    log("Jeu lancé ✔", "ok");
    // La RAM contient désormais le jeu. Relecture auto seulement sur l'émulateur.
    if (isEmulator && invalidateMemCache) invalidateMemCache();
  }
});
$("reset-btn").addEventListener("click", async () => {
  await safeInvoke("reset_console", {}, "Console réinitialisée");
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
  log("Capture de l'écran…");
  await refreshScreen(true);
  if (lastScreenB64) log("Capture effectuée", "ok");
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
  log(`PNG enregistré : ${path}`, "ok");
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
      label: "Mémoire (vue actuelle)",
      start: 0x000000,
      size:  0x800000,          // 8 Mo (SIZE_RAM0)
      word16: false,
      unitsPerRow: 16,          // 16 octets par ligne
      groupBytes: 0x2000,       // banque de 8 Ko (en-tête "bank")
      showBanks: true,
      showVectors: true,
    },
    vram: {
      label: "VRAM (VDC)",
      start: 0,
      size:  0x10000,           // 64 Ko = 32 768 mots de 16 bits
      word16: true,
      unitsPerRow: 16,          // 16 mots par ligne (= 32 octets)
      noAscii: true,            // pas de colonne ASCII (inutile pour des mots vidéo)
      showVectors: false,
      snap: true,
    },
    cram: {
      label: "CRAM (VCE)",
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
      const load = autoLoad
        ? 'Les données se chargent au fil du défilement'
        : 'Cliquez <span class="mono">🔄 Rafraîchir</span> pour charger la zone affichée (chaque lecture gèle brièvement la console)';
      return 'RAM HuCard : <span class="mono">$000000</span> → <span class="mono">$7FFFFF</span> (8 Mo). ' +
        load + ' ; un repère <span class="mono">bank</span> apparaît toutes les 8 Ko (0x2000 octets).';
    }
    if (cur === VIEWS.vram) {
      return 'VRAM (VDC) : mémoire vidéo de 64 Ko, mots de 16 bits (32 768 mots). ' +
        'Instantané pris via la commande <span class="mono">*v</span> du menu OS ' +
        '(comme la capture d\'écran) — nécessite <b>le menu de la carte affiché</b>. ' +
        '« 🔄 Rafraîchir » reprend un instantané.';
    }
    if (cur === VIEWS.cram) {
      return 'CRAM (VCE) : palette couleur, 32 palettes de 16 couleurs (512 mots de 16 bits). ' +
        'Les <b>Palette 0–15</b> servent aux tuiles, les <b>Palette sprite 0–15</b> aux sprites. ' +
        'Chaque mot code une couleur : <span class="mono">bits 8-6 = G</span>, ' +
        '<span class="mono">5-3 = R</span>, <span class="mono">2-0 = B</span>. ' +
        'Instantané via <span class="mono">*v</span> (menu de la carte affiché).';
    }
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
      return g < 16 ? "Palette " + g : "Sprite " + (g - 16);
    }
    return "bank " + g;
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
    if (hOff) hOff.textContent = "Offset";
    if (hHex) hHex.textContent = makeHexHeader();
    if (hAsc) hAsc.textContent = SWATCHES ? "Couleurs" : (WORD16 ? "ASCII (bas/haut)" : "ASCII");
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
    { off: 0, cpu: "$FFF6 – $FFF7", name: "IRQ2",  desc: "Interruption externe IRQ2 ou instruction BRK" },
    { off: 2, cpu: "$FFF8 – $FFF9", name: "IRQ1",  desc: "Interruption du VDC / balayage vertical" },
    { off: 4, cpu: "$FFFA – $FFFB", name: "TIMER", desc: "Interruption du timer interne" },
    { off: 6, cpu: "$FFFC – $FFFD", name: "NMI",   desc: "Non-Maskable Interrupt / interruption non masquable" },
    { off: 8, cpu: "$FFFE – $FFFF", name: "RESET", desc: "Vecteur de démarrage du système" },
  ];
  const vecListEl = $("vec-list");
  const vecValEls = [];

  function buildVecList() {
    if (!vecListEl) return;
    vecListEl.textContent = "";
    vecValEls.length = 0;
    for (const v of VECTORS) {
      const li = document.createElement("li");
      li.title = v.desc;
      const a = document.createElement("span"); a.className = "vec-addr"; a.textContent = v.cpu;
      const n = document.createElement("b");   n.className = "vec-name"; n.textContent = v.name;
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
    if (isNaN(addr)) { log("Adresse invalide", "err"); return; }
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
    if (!pat || !pat.length) { log("Recherche vide", "err"); return; }
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
    log("Recherche de " + label + (scanAll ? "…" : " (zones déjà affichées)…"), "info");
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
          log("Motif trouvé à " + hexAddr(addr) + (GROUPED ? " (" + groupLabel(c) + ")" : ""), "ok");
          scrollToAddr(addr);
          return;
        }
      }
      log(scanAll ? "Motif introuvable" : "Motif introuvable dans les zones déjà chargées (faites défiler puis relancez)", "err");
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
    if (refresh) log("Capture VRAM/CRAM (menu de la carte)…");
    const res = await safeInvoke("capture_vram", { refresh });
    vramCapturing = false;
    if (!res) {
      log("VRAM/CRAM : lecture impossible. Affichez le menu de la carte (pas pendant un jeu).", "err");
      return false;
    }
    vramSnap = b64ToBytes(res.vram_b64);
    cramSnap = b64ToBytes(res.cram_b64);
    log("VRAM/CRAM capturées ✔", "ok");
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
    log("Relecture de " + cur.label + "…");
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
      log(cur.label + " enregistrée : " + p + " (" + snap.length + " octets)", "ok");
      return;
    }

    // Dump complet de la RAM = lecture de toute la fenêtre. Sur matériel réel,
    // ça vole beaucoup de cycles au CPU PC-Engine : on lit par blocs (la console
    // respire entre chaque) et on prévient l'utilisateur.
    if (readMode !== "emu") {
      const secs = Math.ceil(SIZE / 90000); // ~90 Ko/s utiles
      if (!confirm(
        `Enregistrer ${cur.label} (${fmtSize(SIZE)}) demande de lire toute la zone ` +
        `sur la carte : la console va saccader pendant ~${secs} s et le jeu en ` +
        `cours peut planter. Continuer ?`)) return;
    }

    const path = await safeInvoke("pick_save", { default_name: defaultName });
    if (!path) return;

    const BLOCK = readMode === "emu" ? 0x40000 : 0x4000;
    const out = new Uint8Array(SIZE);
    log("Lecture de " + cur.label + " (" + fmtSize(SIZE) + ")…");
    let lastPct = -1;
    for (let off = 0; off < SIZE; off += BLOCK) {
      const len = Math.min(BLOCK, SIZE - off);
      const dump = await safeInvoke("memrd", { addr: START + off, len });
      if (!dump) { log("Lecture interrompue à " + hexAddr(START + off), "err"); return; }
      out.set(Uint8Array.from(atob(dump.data_base64), (c) => c.charCodeAt(0)), off);
      const pct = Math.floor((off + len) * 100 / SIZE);
      if (SIZE > BLOCK && pct !== lastPct && pct % 10 === 0) { log(`  ${pct} %`, ""); lastPct = pct; }
    }
    const ok = await safeInvoke("save_png", { data_base64: bytesToB64(out), path });
    if (ok === null) return;
    log(cur.label + " enregistrée : " + path + " (" + out.length + " octets)", "ok");
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
  let sheet = null;        // OffscreenCanvas-like : canvas natif (cols*cell × rows*cell)
  let geom = null;         // { cell, cols, rows, total, cellW }
  let sel = -1;            // index de cellule sélectionnée
  let capturing = false;

  // Palettes : 16 « fond » puis 16 « sprite » (disposition CRAM du VCE).
  for (let p = 0; p < 32; p++) {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = p < 16 ? `Fond ${p}` : `Sprite ${p - 16}`;
    elPal.appendChild(o);
  }
  elPal.value = "16"; // Sprite 0 par défaut

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

  function buildSheet() {
    if (!vram || !cram) { sheet = null; return; }
    const cell = +elCell.value;
    const cols = Math.max(1, Math.min(64, +elCols.value || 16));
    const bytesPerCell = cell === 8 ? 32 : 128;
    const total = Math.floor(vram.length / bytesPerCell);
    const rows = Math.ceil(total / cols);
    const pal = +elPal.value;
    const transp = elTransp.checked;

    const W = cols * cell, H = rows * cell;
    sheet = document.createElement("canvas");
    sheet.width = W; sheet.height = H;
    const sctx = sheet.getContext("2d");
    const img = sctx.createImageData(W, H);
    const d = img.data;

    const lut = [];
    for (let i = 0; i < 16; i++) lut.push(palRGBA(pal, i));

    for (let c = 0; c < total; c++) {
      const cx = (c % cols) * cell, cy = Math.floor(c / cols) * cell;
      const base = cell === 8 ? c * 32 : c * 64; // octets (8×8) ou mots (16×16)
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const ci = cell === 8 ? pixel8(base, x, y) : pixel16(base, x, y);
          const o = ((cy + y) * W + (cx + x)) * 4;
          const [r, g, b] = lut[ci];
          d[o] = r; d[o + 1] = g; d[o + 2] = b;
          d[o + 3] = (transp && ci === 0) ? 0 : 255;
        }
      }
    }
    sctx.putImageData(img, 0, 0);
    geom = { cell, cols, rows, total, W, H };
  }

  function paint() {
    if (!sheet || !geom) {
      cv.width = 10; cv.height = 10;
      ctx.clearRect(0, 0, 10, 10);
      return;
    }
    const z = +elZoom.value;
    elZoomVal.textContent = z + "×";
    cv.width = geom.W * z;
    cv.height = geom.H * z;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(sheet, 0, 0, cv.width, cv.height);

    if (elGrid.checked && z >= 2) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      const step = geom.cell * z;
      ctx.beginPath();
      for (let gx = 0; gx <= geom.cols; gx++) { ctx.moveTo(gx * step + 0.5, 0); ctx.lineTo(gx * step + 0.5, cv.height); }
      for (let gy = 0; gy <= geom.rows; gy++) { ctx.moveTo(0, gy * step + 0.5); ctx.lineTo(cv.width, gy * step + 0.5); }
      ctx.stroke();
    }
    if (sel >= 0 && sel < geom.total) {
      const step = geom.cell * z;
      const sx = (sel % geom.cols) * step, sy = Math.floor(sel / geom.cols) * step;
      ctx.strokeStyle = "#22e0ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, step - 2, step - 2);
    }
  }

  function refreshAll() { buildSheet(); paint(); updateStatus(); }

  function updateStatus() {
    if (!geom) { elStatus.textContent = ""; return; }
    elStatus.textContent =
      `${geom.total} cellules ${geom.cell}×${geom.cell} · ${geom.cols}×${geom.rows} · VRAM 64 Ko`;
  }

  function selectAt(clientX, clientY) {
    if (!geom) return;
    const r = cv.getBoundingClientRect();
    const z = +elZoom.value;
    const px = (clientX - r.left) / z, py = (clientY - r.top) / z;
    const cx = Math.floor(px / geom.cell), cy = Math.floor(py / geom.cell);
    if (cx < 0 || cx >= geom.cols || cy < 0) return;
    const idx = cy * geom.cols + cx;
    if (idx < 0 || idx >= geom.total) return;
    sel = idx;
    const wordAddr = geom.cell === 8 ? idx * 16 : idx * 64;
    const byteAddr = wordAddr * 2;
    const hex = (n) => "$" + n.toString(16).toUpperCase();
    let msg = `Cellule #${idx} · VRAM ${hex(wordAddr)} (mot) / ${hex(byteAddr)} (octet)`;
    if (geom.cell === 16) msg += ` · pattern sprite #${idx}  (SATB : addr ÷ 64)`;
    elInfo.textContent = msg;
    paint();
  }

  async function sprCapture(refresh) {
    if (capturing) return;
    capturing = true;
    elStatus.textContent = refresh ? "Capture VRAM (menu de la carte)…" : "Chargement…";
    const res = await safeInvoke("capture_vram", { refresh });
    capturing = false;
    if (!res) {
      elStatus.textContent = "VRAM indisponible — affichez le menu de la carte (pas pendant un jeu).";
      return;
    }
    vram = b64ToBytesLocal(res.vram_b64);
    cram = b64ToBytesLocal(res.cram_b64);
    sel = -1;
    elInfo.textContent = "Aucune cellule sélectionnée.";
    refreshAll();
  }

  // Ouverture de l'onglet : capture si rien en mémoire (réutilise l'instantané
  // partagé avec la capture d'écran quand il existe).
  openSpritesTab = () => { if (!vram) sprCapture(false); };

  [elCell, elPal, elCols, elTransp].forEach((el) =>
    el.addEventListener("input", () => { sel = -1; refreshAll(); }));
  [elZoom, elGrid].forEach((el) => el.addEventListener("input", paint));
  cv.addEventListener("click", (e) => selectAt(e.clientX, e.clientY));
  $("spr-refresh").addEventListener("click", () => sprCapture(true));
  $("spr-save").addEventListener("click", async () => {
    if (!sheet) return;
    const path = await safeInvoke("pick_save", { default_name: "vram-tiles.png" });
    if (!path) return;
    const b64 = sheet.toDataURL("image/png").split(",")[1];
    const ok = await safeInvoke("save_png", { data_base64: b64, path });
    if (ok !== null) log("Planche VRAM enregistrée : " + path, "ok");
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
    if (el) { el.textContent = b.label; el.title = `Application ${b.label}`; }
    log(`Turbo Everdrive USB Tools GUI ${b.label}`, "info");
  }
})();
refreshPorts();
setInterval(refreshPorts, 4000); // rafraîchit la liste des ports
log("Prêt. Connectez la carte puis cliquez sur Connecter.", "info");
