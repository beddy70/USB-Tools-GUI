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
  viewIcons: $("view-icons"), viewList: $("view-list"),
  romPath: $("rom-path"), screenCard: $("screen-card"), screenImg: $("screen-img"),
  log: $("log"),
};

// État de l'explorateur de carte SD.
let explorerPath = "";   // chemin SD courant ("" = racine)
let explorerBusy = false;
let explorerView = "grid"; // "grid" = icônes, "list" = liste
const EXPLORER_MTYPE = "text/x-ted-sd";
let lastScreenB64 = null;  // dernière capture (base64)

// Fonction exposée par le visualiseur mémoire : vide le cache des banques et
// re-rend les données visibles, afin de relire l'état frais de l'émulateur.
// Renseignée par le module mémoire (hex-viewer). Appelée après un chargement
// de ROM, un reset ou une (re)connexion, et à l'ouverture de l'onglet Mémoire.
let invalidateMemCache = null;

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
    // À chaque ouverture de l'onglet Mémoire, on relit les données fraîches de
    // l'émulateur (le cache de banques peut être périmé après un load/reset).
    if (btn.dataset.tab === "memory" && invalidateMemCache) invalidateMemCache();
  });
});

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
  log(`Nom: ${info.name} · Port: ${info.port}`, "info");
  // La mémoire de l'émulateur est observable immédiatement : on ne garde pas
  // de banques en cache d'une session précédente.
  if (invalidateMemCache) invalidateMemCache();
}

async function doDisconnect() {
  await safeInvoke("disconnect", {}, "Déconnecté");
  setConnected(false);
  els.infoCard.hidden = true;
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
$("pick-rom").addEventListener("click", async () => {
  const picked = await safeInvoke("pick_file");
  if (!picked) return;
  els.romPath.value = picked;
  // « Parcourir… » charge aussi la ROM en mémoire (le bouton « Charger » a été supprimé).
  const res = await safeInvoke("load_rom", { rom: picked });
  if (res && !res.isErr) {
    log("Jeu chargé en mémoire ✔", "ok");
    if (invalidateMemCache) invalidateMemCache(); // afficher la ROM dans l'onglet Mémoire
  }
});
$("run-btn").addEventListener("click", async () => {
  const rom = els.romPath.value.trim();
  if (!rom) { log("Choisissez une ROM", "err"); return; }
  const res = await safeInvoke("run_rom", { rom });
  if (res && !res.isErr) {
    log("Jeu lancé ✔", "ok");
    if (invalidateMemCache) invalidateMemCache(); // la RAM contient désormais le jeu
  }
});
$("reset-btn").addEventListener("click", async () => {
  await safeInvoke("reset_console", {}, "Console réinitialisée");
  if (invalidateMemCache) invalidateMemCache(); // état mémoire potentiellement modifié
});

// ---------------------------------------------------------------- écran
$("screen-btn").addEventListener("click", async () => {
  log("Capture de l'écran…");
  const b64 = await safeInvoke("capture_screen");
  if (!b64) return;
  lastScreenB64 = b64;
  els.screenImg.src = "data:image/png;base64," + b64;
  els.screenCard.hidden = false;
  log("Capture effectuée", "ok");
});

$("save-screen").addEventListener("click", async () => {
  if (!lastScreenB64) return;
  const path = await safeInvoke("pick_save", { default_name: "ted-menu.png" });
  if (!path) return;
  const ok = await safeInvoke("save_png", { data_base64: lastScreenB64, path });
  if (ok === null) return;
  log(`PNG enregistré : ${path}`, "ok");
});

// ---------------------------------------------------------------- mémoire (hex viewer)
// Visualiseur scrollable de la RAM (8 Mo), avec colonne ASCII, repères de banque
// toutes les 8 Ko (0x2000) et chargement paresseux des banques au défilement.
(() => {
  const MEM_START = 0x000000;
  const MEM_END   = 0x800000;             // 8 Mo (SIZE_RAM0)
  const BANK      = 0x2000;               // 8 Ko par banque
  const BPR       = 16;                   // octets par ligne
  const ROWS_BANK = BANK / BPR;           // 512 lignes de données par banque
  const PER_BANK_LINES = ROWS_BANK + 1;   // + 1 ligne d'en-tête "bank"
  const BANK_CNT  = (MEM_END - MEM_START) / BANK; // 1024 banques
  const TOTAL_LINES = BANK_CNT * PER_BANK_LINES;
  const LINE_H = 18;

  const view   = $("hex-view");
  const spacer = $("hex-spacer");
  const posEl  = $("mem-pos");
  const goInput = $("mem-go");
  if (!view) return;

  spacer.style.height = (TOTAL_LINES * LINE_H) + "px";

  const cache   = new Map();   // bankIndex -> Uint8Array(8192)
  const loading = new Set();   // bankIndex en cours de chargement
  let highlight = null;        // { addr, bytes } : dernier motif trouvé (surbrillance)

  const lineInfo = (L) => {
    const bankIndex = Math.floor(L / PER_BANK_LINES);
    return { bankIndex, within: L % PER_BANK_LINES };
  };
  const bankStart = (b) => MEM_START + b * BANK;
  const addressAt = (L) => {
    const { bankIndex, within } = lineInfo(L);
    return bankStart(bankIndex) + (within === 0 ? 0 : (within - 1) * BPR);
  };
  const hex6 = (n) => "$" + n.toString(16).toUpperCase().padStart(6, "0");

  function loadBank(bankIndex) {
    if (cache.has(bankIndex) || loading.has(bankIndex)) return;
    loading.add(bankIndex);
    safeInvoke("memrd", { addr: bankStart(bankIndex), len: BANK })
      .then((dump) => {
        loading.delete(bankIndex);
        if (dump) {
          // Le back-end renvoie `MemDump { addr, len, data_base64 }` (snake_case).
          const bin = atob(dump.data_base64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          cache.set(bankIndex, arr);
        }
        renderVisible();
      })
      .catch(() => loading.delete(bankIndex));
  }

  function renderVisible() {
    const top = view.scrollTop;
    const vh  = view.clientHeight;
    const first = Math.max(0, Math.floor(top / LINE_H) - 2);
    const last  = Math.min(TOTAL_LINES - 1, Math.ceil((top + vh) / LINE_H) + 2);

    const needed = new Set();
    for (let L = first; L <= last; L++) {
      const { within, bankIndex } = lineInfo(L);
      if (within !== 0) needed.add(bankIndex);
    }
    for (const b of needed) loadBank(b);

    const frag = document.createDocumentFragment();
    for (let L = first; L <= last; L++) {
      const { bankIndex, within } = lineInfo(L);
      const div = document.createElement("div");
      div.className = "hex-line" + (within === 0 ? " bank" : "") + ((L % 2 === 1) ? " alt" : "");
      div.style.top = (L * LINE_H) + "px";
      if (within === 0) {
        const s = bankStart(bankIndex);
        const off = document.createElement("span"); off.className = "off";
        const bl  = document.createElement("span"); bl.className = "bl";
        bl.textContent = `bank ${bankIndex} · ${hex6(s)} – ${hex6(s + BANK - 1)}`;
        div.append(off, bl);
      } else {
        const base = (within - 1) * BPR;
        const data = cache.get(bankIndex);
        const off = document.createElement("span"); off.className = "off";
        off.textContent = hex6(addressAt(L));
        const hb = document.createElement("span"); hb.className = "hb";
        const ab = document.createElement("span"); ab.className = "ab";
        if (data) {
          const lineStart = addressAt(L);
          const hlEnd = highlight ? highlight.addr + highlight.bytes.length : -1;
          for (let j = 0; j < BPR; j++) {
            const b = data[base + j];
            const addr = lineStart + j;
            const inHl = highlight && addr >= highlight.addr && addr < hlEnd;
            const bs = document.createElement("span");
            if (inHl) bs.className = "byte-hl";
            bs.textContent = b.toString(16).toUpperCase().padStart(2, "0");
            hb.appendChild(bs);
            hb.appendChild(document.createTextNode(" "));
            const as = document.createElement("span");
            if (inHl) as.className = "byte-hl";
            as.textContent = (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".";
            ab.appendChild(as);
          }
        } else {
          hb.textContent = "?? ".repeat(BPR);
          ab.textContent = ".".repeat(BPR);
        }
        div.append(off, hb, ab);
      }
      frag.appendChild(div);
    }

    while (view.lastChild && view.lastChild !== spacer) view.removeChild(view.lastChild);
    view.appendChild(frag);

    posEl.textContent =
      "bank " + Math.floor(addressAt(first) / BANK) + " · " + hex6(addressAt(first));
  }

  // ---- Vecteurs d'interruption (panneau gauche) ----
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
      li.title = v.desc; // description conservée en info-bulle
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
    if (!vecListEl || !vecValEls.length) return;
    safeInvoke("memrd", { addr: MEM_START + VEC_BASE, len: 10 })
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

  // ---- Navigation simplifiée : bank / adresse / recherche hex·ascii ----
  const scrollToAddr = (addr) => {
    const a = Math.max(MEM_START, Math.min(addr, MEM_END - 1));
    const bankIndex = Math.floor((a - MEM_START) / BANK);
    const within    = Math.floor(((a - MEM_START) % BANK) / BPR);
    const L = bankIndex * PER_BANK_LINES + 1 + within;
    view.scrollTop = Math.max(0, L * LINE_H - view.clientHeight / 2);
    renderVisible();
  };

  const bankInput = $("mem-bank");
  const bankBtn   = $("mem-bank-btn");
  const searchInput = $("mem-search");
  const searchBtn   = $("mem-search-btn");
  const searchStop  = $("mem-search-stop");
  let searchAbort = false;

  bankBtn.addEventListener("click", () => {
    let b = parseInt(bankInput.value, 10);
    if (isNaN(b)) return;
    b = Math.max(0, Math.min(b, BANK_CNT - 1));
    bankInput.value = b;
    scrollToAddr(MEM_START + b * BANK);
  });
  bankInput.addEventListener("keydown", (e) => { if (e.key === "Enter") bankBtn.click(); });

  // "DE AD BE" / "DEADBEEF" / "$DEAD" / "0xDEAD" → motif hex ; sinon ASCII.
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
    log("Recherche de " + label + "…", "info");
    const startBank = Math.floor((view.scrollTop / LINE_H) / PER_BANK_LINES);
    try {
      for (let k = 0; k < BANK_CNT && !searchAbort; k++) {
        const b = (startBank + k) % BANK_CNT;
        let data = cache.get(b);
        if (!data) {
          let dump = null;
          try { dump = await safeInvoke("memrd", { addr: bankStart(b), len: BANK }); } catch {}
          if (!dump) continue;
          data = Uint8Array.from(atob(dump.data_base64), (c) => c.charCodeAt(0));
          cache.set(b, data);
        }
        const at = findPattern(data, pat);
        if (at >= 0) {
          const addr = bankStart(b) + at;
          highlight = { addr, bytes: pat };
          log("Motif trouvé à " + hex6(addr) + " (bank " + b + ")", "ok");
          scrollToAddr(addr);
          return;
        }
      }
      log("Motif introuvable", "err");
    } finally {
      searchStop.hidden = true;
    }
  }
  searchBtn.addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
  searchStop.addEventListener("click", () => { searchAbort = true; });

  // Vide le cache des banques chargées et relit les données fraîches de la
  // RAM (nécessaire après un chargement de ROM, un reset ou une reconnexion).
  invalidateMemCache = () => {
    cache.clear();
    loading.clear();
    highlight = null;
    renderVisible();
    loadVectors();
  };

  let rafPending = false;
  view.addEventListener("scroll", () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderVisible(); });
  });

  $("mem-go-btn").addEventListener("click", () => {
    const raw = goInput.value.trim().replace(/^0x/i, "").replace(/^\$/, "");
    let addr = parseInt(raw, 16);
    if (isNaN(addr)) { log("Adresse invalide", "err"); return; }
    addr = Math.max(MEM_START, Math.min(addr, MEM_END - 1));
    const bankIndex = Math.floor((addr - MEM_START) / BANK);
    const within    = Math.floor(((addr - MEM_START) % BANK) / BPR);
    const L = bankIndex * PER_BANK_LINES + 1 + within;
    view.scrollTop = Math.max(0, L * LINE_H - view.clientHeight / 2);
    renderVisible();
  });
  goInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("mem-go-btn").click();
  });

  // Suit le redimensionnement (séparateur, fenêtre, activation d'onglet)
  if (window.ResizeObserver) {
    new ResizeObserver(renderVisible).observe(view);
  } else {
    window.addEventListener("resize", renderVisible);
  }

  renderVisible();
  buildVecList();
  loadVectors();

  $("mem-save").addEventListener("click", async () => {
    const path = await safeInvoke("pick_save", { default_name: "memdump.bin" });
    if (!path) return;
    log("Lecture de toute la mémoire (8 Mo)…");
    const dump = await safeInvoke("memrd", { addr: MEM_START, len: MEM_END - MEM_START });
    if (!dump) return;
    const bytes = Uint8Array.from(atob(dump.data_base64), (c) => c.charCodeAt(0));
    const ok = await safeInvoke("save_png", { data_base64: dump.data_base64, path });
    if (ok === null) return;
    log(`Mémoire enregistrée : ${path} (${bytes.length} octets)`, "ok");
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
refreshPorts();
setInterval(refreshPorts, 4000); // rafraîchit la liste des ports
log("Prêt. Connectez la carte puis cliquez sur Connecter.", "info");
