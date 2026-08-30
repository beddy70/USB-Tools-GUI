// Localisation de l'interface. Chargé AVANT main.js (voir index.html).
//
// Ajouter une langue : dupliquer un bloc ci-dessous sous une nouvelle clé
// (ex. "de"), l'ajouter à LANG_NAMES, traduire toutes les valeurs — aucun
// autre changement de code n'est nécessaire (index.html/main.js n'utilisent
// que des clés, jamais de texte en dur).
//
// - `data-i18n="clé"`        -> textContent
// - `data-i18n-html="clé"`   -> innerHTML (pour les blocs avec balises
//                               imbriquées, ex. <strong>/<span class="mono">)
// - `data-i18n-title="clé"`  -> attribut title
// - `data-i18n-placeholder="clé"` -> attribut placeholder
// - Dans le JS : `t("clé", { nom: valeur })` — remplace `{nom}` dans la
//   chaîne traduite.

const LANG_KEY = "edlink.lang";
const LANG_NAMES = { fr: "Français", en: "English" };

const I18N = {
fr: {
  "conn.connected": "Connecté",
  "conn.disconnected": "Déconnecté",

  "nav.connect": "Connexion",
  "nav.games": "GAMES",
  "nav.transfer": "Carte SD",
  "nav.play": "Jouer",
  "nav.memory": "Mémoire",
  "nav.sprites": "Sprites",
  "nav.appVersionTitle": "Version de l'application",

  "connect.title": "Connexion à la carte",
  "connect.portLabel": "Port série",
  "connect.connect": "Connecter",
  "connect.disconnect": "Déconnecter",
  "connect.manualLabel": "Port manuel (émulateur / PTY)",
  "connect.manualHint": "Pour l'émulateur virtuel (edlink-emulator), saisissez ici le chemin du port virtuel affiché au lancement. Vide = liste ci-dessus.",
  "connect.auto": "(auto)",
  "connect.noPort": "(aucun port)",
  "connect.scanning": "Scan automatique en cours… (veuillez patienter quelques secondes)",
  "connect.connectedLog": "Carte connectée",
  "connect.noAutoFound": "Astuce : aucune carte trouvée automatiquement. Pour l'émulateur virtuel, tapez le port affiché au lancement (ex: /dev/ttys001) dans « Port manuel », puis recliquez Connecter.",
  "connect.nameLine": "Nom: {name} · Port: {port}{emu}",
  "connect.emulatorSuffix": " · émulateur",
  "connect.realHardwareHint": "Matériel réel : la vue Mémoire est en mode conservateur (pas de lecture auto, clic « Rafraîchir »). VRAM/CRAM = instantané via le menu de la carte.",
  "connect.disconnectedLog": "Déconnecté",

  "games.title": "Jeux par catégorie",
  "games.rootLabel": "📁 {root}",
  "games.refreshTitle": "Actualiser",
  "games.changeFolder": "⚙ Changer le dossier de jeux",
  "games.changeFolderPrompt": "Dossier de base des jeux sur la carte SD (une sous-catégorie par sous-dossier) :",
  "games.listError": "Impossible de lister {path}. Vérifiez le dossier ou la connexion.",
  "games.noCategoriesError": "Aucune catégorie dans {path} — créez un sous-dossier par type de jeu (ex. Action, RPG, Plateforme…) et déposez vos ROM dedans.",
  "games.backToCategories": "← Catégories",
  "games.mosaicListError": "Impossible de lister {path}.",
  "games.oneGameAvailable": "{count} jeu disponible",
  "games.gamesAvailable": "{count} jeux disponibles",
  "games.noRomsError": "Aucune ROM connue (.pce/.sgx/.rom/.bin) dans {path}.",
  "games.mapButtonTitle": "Associer ce jeu à un titre de la base de pochettes",
  "games.mapPrompt": "Titre à chercher dans Libretro Thumbnails pour « {name} » (sans extension, tel qu'il apparaît dans la base — laisser vide pour retirer l'association) :",
  "games.approxBoxartTitle": "Pochette approchée ({pct}%) : {title}",
  "games.matchInfo": "⚠ Pochette approchée ({pct}%) : « {title} ».",
  "games.matchConfirmBtn": "✓ C'est le bon jeu",
  "games.matchConfirmTitle": "Mémoriser ce titre comme correspondance confirmée pour ce fichier",
  "games.matchConfirmedLog": "✔ « {name} » associé à « {title} » ({pct}%, mémorisé)",
  "games.matchConfirmFailedLog": "⚠ Association enregistrée pour « {name} », mais la relecture a échoué.",
  "games.titleScreenLabel": "Écran-titre",
  "games.inGameSnapLabel": "Capture en jeu",
  "games.sizeLabel": "Taille",
  "games.pathLabel": "Chemin",
  "games.play": "▶ Jouer",
  "games.download": "⬇ Télécharger",
  "games.closeTitle": "Fermer",

  "sd.explorerTitle": "Explorateur de carte SD",
  "sd.parentFolderTitle": "Dossier parent",
  "sd.refreshTitle": "Actualiser",
  "sd.gridViewTitle": "Vue en icônes",
  "sd.listViewTitle": "Vue en liste",
  "sd.import": "📂 Importer…",
  "sd.dropHint": "Glissez-déposez des fichiers ici pour les envoyer sur la carte,<br />ou cliquez sur « 📂 Importer… ».",
  "sd.transferring": "Transfert…",
  "sd.ctxPlay": "▶ Jouer",
  "sd.ctxRename": "✏️ Renommer…",
  "sd.ctxDownload": "⬇ Télécharger…",
  "sd.ctxDelete": "🗑 Effacer",
  "sd.loading": "Chargement de la carte…",
  "sd.listErr": "Impossible de lister la carte. Vérifiez la connexion.",
  "sd.emptyFolder": "Dossier vide — déposez des fichiers ici pour les envoyer.",
  "sd.itemCount": "{count} élément(s) · {path}",
  "sd.root": "racine",
  "sd.openFolder": "Ouvrir le dossier",
  "sd.download": "Télécharger (double-clic ou ⬇)",
  "sd.folder": "Dossier",
  "sd.file": "fichier",
  "sd.downloadBtn": "Télécharger",
  "sd.colName": "Nom",
  "sd.colType": "Type",
  "sd.colSize": "Taille",
  "sd.launching": "Lancement de {name}…",
  "sd.launched": "Jeu lancé ✔",
  "sd.deleteConfirm": "Effacer « {name} » de la carte SD ?\nCette action est irréversible.",
  "sd.deletedLog": "✔ {name} effacé",
  "sd.renamePrompt": "Nouveau nom :",
  "sd.renamedLog": "✔ Renommé en {name}",
  "sd.downloadedLog": "✔ Téléchargé : {path}",
  "sd.uploadingLog": "Téléversement de {name} → {dest}…",
  "sd.uploadedLog": "✔ {name} envoyé",
  "sd.uploadingMultiLog": "Envoi de {count} fichier(s) vers {dest}…",
  "sd.invalidAddress": "Adresse invalide",
  "sd.transferDownload": "Téléchargement",
  "sd.transferUpload": "Envoi",
  "sd.transferDone": "Terminé",
  "sd.transferFailed": "Échec",

  "play.title": "Lancer un jeu",
  "play.romLabel": "ROM (local ou sd:chemin)",
  "play.romPlaceholder": "Choisir via le bouton…",
  "play.pickAndRun": "▶ Choisir et lancer…",
  "play.resetConsole": "⟲ Reset console",
  "play.captureScreen": "📷 Capturer l'écran",
  "play.consoleReset": "Console réinitialisée",
  "play.launching": "Lancement de {name}…",
  "play.launched": "Jeu lancé ✔",
  "play.menuCaptureTitle": "Capture du menu",
  "play.imageSettings": "Réglages de l'image",
  "play.imageSettingsHint": "Rendu logiciel du plan de tuiles (BG1) à partir de la VRAM/CRAM déjà capturée : ces réglages ne relisent pas la carte. « 📷 Capturer l'écran » reprend un instantané.",
  "play.batWidth": "Taille BAT — largeur <em>(tuiles)</em>",
  "play.batHeight": "Taille BAT — hauteur <em>(tuiles)</em>",
  "play.resWidth": "Résolution — largeur <em>(px)</em>",
  "play.resHeight": "Résolution — hauteur <em>(px)</em>",
  "play.scrollX": "Défilement horizontal <em>(px)</em>",
  "play.scrollY": "Défilement vertical <em>(px)</em>",
  "play.saveScreen": "💾 Enregistrer le PNG…",
  "play.capturing": "Capture de l'écran…",
  "play.captured": "Capture effectuée",
  "play.pngSaved": "PNG enregistré : {path}",

  "mem.title": "Visualiseur mémoire (lecture seule)",
  "mem.subtabRam": "🗂 Mémoire (vue actuelle)",
  "mem.subtabVram": "🖥 VRAM (VDC)",
  "mem.subtabCram": "🎨 CRAM (VCE)",
  "mem.warningHtml": "⚠️ Matériel réel : la vue <strong>Mémoire</strong> parcourt le bus cartouche et <strong>gèle brièvement le CPU PC-Engine</strong> à chaque lecture — rien n'est lu automatiquement, utilisez « 🔄 Rafraîchir ». <strong>VRAM / CRAM</strong> : instantané via la commande <span class=\"mono\">*v</span> du menu OS — affichez le menu de la carte (impossible pendant un jeu).",
  "mem.goToLabel": "Aller à 0x",
  "mem.go": "Aller",
  "mem.bankLabel": "bank n°",
  "mem.searchPlaceholder": "Rechercher hex/ascii…",
  "mem.refreshTitle": "Relire les données de la vue courante depuis l'émulateur",
  "mem.refresh": "🔄 Rafraîchir",
  "mem.save": "💾 Sauver…",
  "mem.vectorsTitle": "Vecteurs d'interruption",
  "mem.vectorsChip": "PC-Engine",
  "mem.vectorsNoteHtml": "HuC6280 · banque 0 · à partir de <span class=\"mono\">$1FF6</span> · valeurs lues en RAM",
  "mem.offset": "Offset",
  "mem.ascii": "ASCII",
  "mem.ramLabel": "Mémoire (vue actuelle)",
  "mem.vramLabel": "VRAM (VDC)",
  "mem.cramLabel": "CRAM (VCE)",
  "mem.loadOnScroll": "Les données se chargent au fil du défilement",
  "mem.clickRefresh": "Cliquez <span class=\"mono\">🔄 Rafraîchir</span> pour charger la zone affichée (chaque lecture gèle brièvement la console)",
  "mem.hintRam": "RAM HuCard : <span class=\"mono\">$000000</span> → <span class=\"mono\">$7FFFFF</span> (8 Mo). {load} ; un repère <span class=\"mono\">bank</span> apparaît toutes les 8 Ko (0x2000 octets).",
  "mem.hintVram": "VRAM (VDC) : mémoire vidéo de 64 Ko, mots de 16 bits (32 768 mots). Instantané pris via la commande <span class=\"mono\">*v</span> du menu OS (comme la capture d'écran) — nécessite <b>le menu de la carte affiché</b>. « 🔄 Rafraîchir » reprend un instantané.",
  "mem.hintCram": "CRAM (VCE) : palette couleur, 32 palettes de 16 couleurs (512 mots de 16 bits). Les <b>Palette 0–15</b> servent aux tuiles, les <b>Palette sprite 0–15</b> aux sprites. Chaque mot code une couleur : <span class=\"mono\">bits 8-6 = G</span>, <span class=\"mono\">5-3 = R</span>, <span class=\"mono\">2-0 = B</span>. Instantané via <span class=\"mono\">*v</span> (menu de la carte affiché).",
  "mem.bankN": "bank {n}",
  "mem.paletteN": "Palette {n}",
  "mem.spriteN": "Sprite {n}",
  "mem.colorsHeader": "Couleurs",
  "mem.asciiHiLo": "ASCII (bas/haut)",
  "mem.vecIrq2Name": "IRQ2",
  "mem.vecIrq2Desc": "Interruption externe IRQ2 ou instruction BRK",
  "mem.vecIrq1Name": "IRQ1",
  "mem.vecIrq1Desc": "Interruption du VDC / balayage vertical",
  "mem.vecTimerName": "TIMER",
  "mem.vecTimerDesc": "Interruption du timer interne",
  "mem.vecNmiName": "NMI",
  "mem.vecNmiDesc": "Non-Maskable Interrupt / interruption non masquable",
  "mem.vecResetName": "RESET",
  "mem.vecResetDesc": "Vecteur de démarrage du système",
  "mem.invalidAddress": "Adresse invalide",
  "mem.emptySearch": "Recherche vide",
  "mem.searching": "Recherche de {label}{scope}…",
  "mem.searchScopeAll": "",
  "mem.searchScopeLoaded": " (zones déjà affichées)",
  "mem.patternFound": "Motif trouvé à {addr}{group}",
  "mem.patternNotFound": "Motif introuvable",
  "mem.patternNotFoundLoaded": "Motif introuvable dans les zones déjà chargées (faites défiler puis relancez)",
  "mem.capturingVramCram": "Capture VRAM/CRAM (menu de la carte)…",
  "mem.vramCramUnavailable": "VRAM/CRAM : lecture impossible. Affichez le menu de la carte (pas pendant un jeu).",
  "mem.vramCramCaptured": "VRAM/CRAM capturées ✔",
  "mem.reloading": "Relecture de {label}…",
  "mem.savedLog": "{label} enregistrée : {path} ({size} octets)",
  "mem.confirmFullDump": "Enregistrer {label} ({size}) demande de lire toute la zone sur la carte : la console va saccader pendant ~{secs} s et le jeu en cours peut planter. Continuer ?",
  "mem.readingLabel": "Lecture de {label} ({size})…",
  "mem.readInterrupted": "Lecture interrompue à {addr}",

  "sprites.title": "Planche de tuiles VRAM",
  "sprites.hintHtml": "Décodage de l'instantané VRAM (64 Ko) en grille de cellules 4 bpp. Les <strong>motifs de sprites</strong> (comme ceux de fond) sont stockés dans la VRAM : repérez-les visuellement, cliquez une cellule pour lire son adresse VRAM et son n° de pattern. Les 6 tailles de sprite du VDC sont proposées (16×16 à 32×64) : chaque taille regroupe 1 à 8 blocs de 16×16 contigus, colonne par colonne (celle du VDC : bloc <span class=\"mono\">$0000</span> = coin haut-gauche). Partage l'instantané <span class=\"mono\">*v</span> avec la capture d'écran — menu de la carte affiché.",
  "sprites.cellLabel": "Cellule",
  "sprites.cell8x8": "8×8 (fond)",
  "sprites.cell16x16": "16×16 (sprite)",
  "sprites.cell16x32": "16×32 (sprite)",
  "sprites.cell16x64": "16×64 (sprite)",
  "sprites.cell32x16": "32×16 (sprite)",
  "sprites.cell32x32": "32×32 (sprite)",
  "sprites.cell32x64": "32×64 (sprite)",
  "sprites.paletteLabel": "Palette",
  "sprites.columnsLabel": "Colonnes",
  "sprites.zoomLabel": "Zoom",
  "sprites.gridCheck": "Grille",
  "sprites.transparentCheck": "Index 0 transparent",
  "sprites.capture": "🔄 Capturer",
  "sprites.lockTitle": "N'afficher que la sélection (recadre la vue)",
  "sprites.lock": "🔒 Locker",
  "sprites.unlock": "🔓 Déverrouiller",
  "sprites.clearSelTitle": "Effacer la sélection (Échap)",
  "sprites.clearSel": "✕ Sélection",
  "sprites.save": "💾 PNG…",
  "sprites.hint2Html": "Cliquez une cellule, ou <strong>glissez</strong> pour sélectionner une plage — l'export PNG n'enregistre alors que la sélection. <strong>🔒 Locker</strong> recadre la vue sur la seule sélection (le reste de la VRAM n'est plus affiché — pratique pour « 🔄 Capturer » en boucle sur un même sprite, ex. une animation). <span class=\"mono\">Échap</span> ou « ✕ Sélection » efface tout (et déverrouille).",
  "sprites.noSelection": "Aucune cellule sélectionnée.",
  "sprites.paletteBg": "Fond {n}",
  "sprites.paletteSprite": "Sprite {n}",
  "sprites.lockedNote": "🔒 Vue verrouillée sur la sélection — le reste de la VRAM est masqué. ",
  "sprites.statusLine": "{cells} cellules {label} · {cols}×{rows} · VRAM 64 Ko",
  "sprites.cellInfo": "Cellule #{idx} · VRAM {word} (mot) / {byte} (octet)",
  "sprites.spriteInfo": "Sprite #{idx} · VRAM {word} (mot de base) · pattern SATB #{pattern}",
  "sprites.spriteInfoExtraBlocks": " (+{n} bloc(s) 16×16 contigus)",
  "sprites.selectionInfo": "Sélection {w}×{h} cellules ({n}) · {pxw}×{pxh} px",
  "sprites.selectionAddrRange": " · VRAM {from}–{to} (mots)",
  "sprites.selectionNonContiguous": " · adresses non contiguës sur {h} lignes",
  "sprites.capturingVram": "Capture VRAM (menu de la carte)…",
  "sprites.loadingStatus": "Chargement…",
  "sprites.vramUnavailable": "VRAM indisponible — affichez le menu de la carte (pas pendant un jeu).",
  "sprites.selectionSaved": "Sélection VRAM enregistrée : {path}",
  "sprites.sheetSaved": "Planche VRAM enregistrée : {path}",

  "modal.cancel": "Annuler",
  "modal.ok": "OK",

  "splitter.resizeTitle": "Redimensionner",
  "log.title": "Journal",
  "log.ready": "Prêt. Connectez la carte puis cliquez sur Connecter.",
  "log.appVersion": "Turbo Everdrive USB Tools GUI {label}",
  "log.appVersionTitle": "Application {label}",
},

en: {
  "conn.connected": "Connected",
  "conn.disconnected": "Disconnected",

  "nav.connect": "Connect",
  "nav.games": "GAMES",
  "nav.transfer": "SD Card",
  "nav.play": "Play",
  "nav.memory": "Memory",
  "nav.sprites": "Sprites",
  "nav.appVersionTitle": "Application version",

  "connect.title": "Connect to the cartridge",
  "connect.portLabel": "Serial port",
  "connect.connect": "Connect",
  "connect.disconnect": "Disconnect",
  "connect.manualLabel": "Manual port (emulator / PTY)",
  "connect.manualHint": "For the virtual emulator (edlink-emulator), enter the virtual port path shown at startup here. Empty = list above.",
  "connect.auto": "(auto)",
  "connect.noPort": "(no port)",
  "connect.scanning": "Auto-scanning… (please wait a few seconds)",
  "connect.connectedLog": "Cartridge connected",
  "connect.noAutoFound": "Tip: no cartridge found automatically. For the virtual emulator, type the port shown at startup (e.g. /dev/ttys001) in \"Manual port\", then click Connect again.",
  "connect.nameLine": "Name: {name} · Port: {port}{emu}",
  "connect.emulatorSuffix": " · emulator",
  "connect.realHardwareHint": "Real hardware: the Memory view is in conservative mode (no auto-read, click \"Refresh\"). VRAM/CRAM = snapshot via the cartridge menu.",
  "connect.disconnectedLog": "Disconnected",

  "games.title": "Games by category",
  "games.rootLabel": "📁 {root}",
  "games.refreshTitle": "Refresh",
  "games.changeFolder": "⚙ Change games folder",
  "games.changeFolderPrompt": "Base games folder on the SD card (one category per subfolder):",
  "games.listError": "Could not list {path}. Check the folder or the connection.",
  "games.noCategoriesError": "No categories in {path} — create one subfolder per game type (e.g. Action, RPG, Platformer…) and put your ROMs in there.",
  "games.backToCategories": "← Categories",
  "games.mosaicListError": "Could not list {path}.",
  "games.oneGameAvailable": "{count} game available",
  "games.gamesAvailable": "{count} games available",
  "games.noRomsError": "No known ROM (.pce/.sgx/.rom/.bin) in {path}.",
  "games.mapButtonTitle": "Manually match this game to a title in the boxart database",
  "games.mapPrompt": "Title to search for in Libretro Thumbnails for \"{name}\" (without extension, exactly as it appears in the database — leave empty to remove the mapping):",
  "games.approxBoxartTitle": "Approximate match ({pct}%): {title}",
  "games.matchInfo": "⚠ Approximate match ({pct}%): \"{title}\".",
  "games.matchConfirmBtn": "✓ That's the right game",
  "games.matchConfirmTitle": "Remember this title as a confirmed match for this file",
  "games.matchConfirmedLog": "✔ \"{name}\" matched to \"{title}\" ({pct}%, saved)",
  "games.matchConfirmFailedLog": "⚠ Mapping saved for \"{name}\", but re-checking it failed.",
  "games.titleScreenLabel": "Title screen",
  "games.inGameSnapLabel": "In-game snapshot",
  "games.sizeLabel": "Size",
  "games.pathLabel": "Path",
  "games.play": "▶ Play",
  "games.download": "⬇ Download",
  "games.closeTitle": "Close",

  "sd.explorerTitle": "SD card explorer",
  "sd.parentFolderTitle": "Parent folder",
  "sd.refreshTitle": "Refresh",
  "sd.gridViewTitle": "Icon view",
  "sd.listViewTitle": "List view",
  "sd.import": "📂 Import…",
  "sd.dropHint": "<strong>Drag and drop</strong> files here to send them to the cartridge,<br />or click \"📂 Import…\".",
  "sd.transferring": "Transferring…",
  "sd.ctxPlay": "▶ Play",
  "sd.ctxRename": "✏️ Rename…",
  "sd.ctxDownload": "⬇ Download…",
  "sd.ctxDelete": "🗑 Delete",
  "sd.loading": "Loading the cartridge…",
  "sd.listErr": "Could not list the cartridge. Check the connection.",
  "sd.emptyFolder": "Empty folder — drop files here to send them.",
  "sd.itemCount": "{count} item(s) · {path}",
  "sd.root": "root",
  "sd.openFolder": "Open folder",
  "sd.download": "Download (double-click or ⬇)",
  "sd.folder": "Folder",
  "sd.file": "file",
  "sd.downloadBtn": "Download",
  "sd.colName": "Name",
  "sd.colType": "Type",
  "sd.colSize": "Size",
  "sd.launching": "Launching {name}…",
  "sd.launched": "Game launched ✔",
  "sd.deleteConfirm": "Delete \"{name}\" from the SD card?\nThis action cannot be undone.",
  "sd.deletedLog": "✔ {name} deleted",
  "sd.renamePrompt": "New name:",
  "sd.renamedLog": "✔ Renamed to {name}",
  "sd.downloadedLog": "✔ Downloaded: {path}",
  "sd.uploadingLog": "Uploading {name} → {dest}…",
  "sd.uploadedLog": "✔ {name} sent",
  "sd.uploadingMultiLog": "Sending {count} file(s) to {dest}…",
  "sd.invalidAddress": "Invalid address",
  "sd.transferDownload": "Download",
  "sd.transferUpload": "Upload",
  "sd.transferDone": "Done",
  "sd.transferFailed": "Failed",

  "play.title": "Launch a game",
  "play.romLabel": "ROM (local path or sd:path)",
  "play.romPlaceholder": "Choose with the button…",
  "play.pickAndRun": "▶ Choose and launch…",
  "play.resetConsole": "⟲ Reset console",
  "play.captureScreen": "📷 Capture screen",
  "play.consoleReset": "Console reset",
  "play.launching": "Launching {name}…",
  "play.launched": "Game launched ✔",
  "play.menuCaptureTitle": "Menu capture",
  "play.imageSettings": "Image settings",
  "play.imageSettingsHint": "Software rendering of the tile plane (BG1) from the already-captured VRAM/CRAM: these settings do not re-read the cartridge. \"📷 Capture screen\" takes a fresh snapshot.",
  "play.batWidth": "BAT size — width <em>(tiles)</em>",
  "play.batHeight": "BAT size — height <em>(tiles)</em>",
  "play.resWidth": "Resolution — width <em>(px)</em>",
  "play.resHeight": "Resolution — height <em>(px)</em>",
  "play.scrollX": "Horizontal scroll <em>(px)</em>",
  "play.scrollY": "Vertical scroll <em>(px)</em>",
  "play.saveScreen": "💾 Save PNG…",
  "play.capturing": "Capturing screen…",
  "play.captured": "Capture done",
  "play.pngSaved": "PNG saved: {path}",

  "mem.title": "Memory viewer (read-only)",
  "mem.subtabRam": "🗂 Memory (current view)",
  "mem.subtabVram": "🖥 VRAM (VDC)",
  "mem.subtabCram": "🎨 CRAM (VCE)",
  "mem.warningHtml": "⚠️ Real hardware: the <strong>Memory</strong> view walks the cartridge bus and <strong>briefly freezes the PC-Engine CPU</strong> on every read — nothing is read automatically, use « 🔄 Refresh ». <strong>VRAM / CRAM</strong>: snapshot via the <span class=\"mono\">*v</span> menu OS command — display the cartridge menu first (not possible during a game).",
  "mem.goToLabel": "Go to 0x",
  "mem.go": "Go",
  "mem.bankLabel": "bank #",
  "mem.searchPlaceholder": "Search hex/ascii…",
  "mem.refreshTitle": "Re-read the current view's data from the emulator",
  "mem.refresh": "🔄 Refresh",
  "mem.save": "💾 Save…",
  "mem.vectorsTitle": "Interrupt vectors",
  "mem.vectorsChip": "PC-Engine",
  "mem.vectorsNoteHtml": "HuC6280 · bank 0 · from <span class=\"mono\">$1FF6</span> · values read from RAM",
  "mem.offset": "Offset",
  "mem.ascii": "ASCII",
  "mem.ramLabel": "Memory (current view)",
  "mem.vramLabel": "VRAM (VDC)",
  "mem.cramLabel": "CRAM (VCE)",
  "mem.loadOnScroll": "Data loads as you scroll",
  "mem.clickRefresh": "Click <span class=\"mono\">🔄 Refresh</span> to load the displayed area (each read briefly freezes the console)",
  "mem.hintRam": "HuCard RAM: <span class=\"mono\">$000000</span> → <span class=\"mono\">$7FFFFF</span> (8 MB). {load}; a <span class=\"mono\">bank</span> marker appears every 8 KB (0x2000 bytes).",
  "mem.hintVram": "VRAM (VDC): 64 KB video memory, 16-bit words (32,768 words). Snapshot taken via the <span class=\"mono\">*v</span> menu OS command (like the screen capture) — requires <b>the cartridge menu to be displayed</b>. \"🔄 Refresh\" takes a fresh snapshot.",
  "mem.hintCram": "CRAM (VCE): color palette, 32 palettes of 16 colors (512 16-bit words). <b>Palette 0–15</b> are used for tiles, <b>Sprite palette 0–15</b> for sprites. Each word encodes a color: <span class=\"mono\">bits 8-6 = G</span>, <span class=\"mono\">5-3 = R</span>, <span class=\"mono\">2-0 = B</span>. Snapshot via <span class=\"mono\">*v</span> (cartridge menu displayed).",
  "mem.bankN": "bank {n}",
  "mem.paletteN": "Palette {n}",
  "mem.spriteN": "Sprite {n}",
  "mem.colorsHeader": "Colors",
  "mem.asciiHiLo": "ASCII (lo/hi)",
  "mem.vecIrq2Name": "IRQ2",
  "mem.vecIrq2Desc": "IRQ2 external interrupt or BRK instruction",
  "mem.vecIrq1Name": "IRQ1",
  "mem.vecIrq1Desc": "VDC interrupt / vertical blank",
  "mem.vecTimerName": "TIMER",
  "mem.vecTimerDesc": "Internal timer interrupt",
  "mem.vecNmiName": "NMI",
  "mem.vecNmiDesc": "Non-Maskable Interrupt",
  "mem.vecResetName": "RESET",
  "mem.vecResetDesc": "System startup vector",
  "mem.invalidAddress": "Invalid address",
  "mem.emptySearch": "Empty search",
  "mem.searching": "Searching for {label}{scope}…",
  "mem.searchScopeAll": "",
  "mem.searchScopeLoaded": " (already displayed areas)",
  "mem.patternFound": "Pattern found at {addr}{group}",
  "mem.patternNotFound": "Pattern not found",
  "mem.patternNotFoundLoaded": "Pattern not found in already loaded areas (scroll around then retry)",
  "mem.capturingVramCram": "Capturing VRAM/CRAM (cartridge menu)…",
  "mem.vramCramUnavailable": "VRAM/CRAM: read failed. Display the cartridge menu (not during a game).",
  "mem.vramCramCaptured": "VRAM/CRAM captured ✔",
  "mem.reloading": "Reloading {label}…",
  "mem.savedLog": "{label} saved: {path} ({size} bytes)",
  "mem.confirmFullDump": "Saving {label} ({size}) requires reading the whole area from the cartridge: the console will stutter for ~{secs}s and the running game may crash. Continue?",
  "mem.readingLabel": "Reading {label} ({size})…",
  "mem.readInterrupted": "Read interrupted at {addr}",

  "sprites.title": "VRAM tile sheet",
  "sprites.hintHtml": "Decodes the VRAM snapshot (64 KB) as a grid of 4bpp cells. <strong>Sprite patterns</strong> (like background tiles) are stored in VRAM: spot them visually, click a cell to read its VRAM address and pattern number. All 6 VDC sprite sizes are available (16×16 to 32×64): each size groups 1 to 8 contiguous 16×16 blocks, column by column (VDC convention: block <span class=\"mono\">$0000</span> = top-left corner). Shares the <span class=\"mono\">*v</span> snapshot with the screen capture — cartridge menu displayed.",
  "sprites.cellLabel": "Cell",
  "sprites.cell8x8": "8×8 (background)",
  "sprites.cell16x16": "16×16 (sprite)",
  "sprites.cell16x32": "16×32 (sprite)",
  "sprites.cell16x64": "16×64 (sprite)",
  "sprites.cell32x16": "32×16 (sprite)",
  "sprites.cell32x32": "32×32 (sprite)",
  "sprites.cell32x64": "32×64 (sprite)",
  "sprites.paletteLabel": "Palette",
  "sprites.columnsLabel": "Columns",
  "sprites.zoomLabel": "Zoom",
  "sprites.gridCheck": "Grid",
  "sprites.transparentCheck": "Index 0 transparent",
  "sprites.capture": "🔄 Capture",
  "sprites.lockTitle": "Show only the selection (crops the view)",
  "sprites.lock": "🔒 Lock",
  "sprites.unlock": "🔓 Unlock",
  "sprites.clearSelTitle": "Clear the selection (Esc)",
  "sprites.clearSel": "✕ Selection",
  "sprites.save": "💾 PNG…",
  "sprites.hint2Html": "Click a cell, or <strong>drag</strong> to select a range — the PNG export then only saves the selection. <strong>🔒 Lock</strong> crops the view to just the selection (the rest of VRAM is no longer shown — handy for looping « 🔄 Capture » on the same sprite, e.g. an animation). <span class=\"mono\">Esc</span> or « ✕ Selection » clears everything (and unlocks).",
  "sprites.noSelection": "No cell selected.",
  "sprites.paletteBg": "Background {n}",
  "sprites.paletteSprite": "Sprite {n}",
  "sprites.lockedNote": "🔒 View locked on the selection — the rest of VRAM is hidden. ",
  "sprites.statusLine": "{cells} {label} cells · {cols}×{rows} · 64 KB VRAM",
  "sprites.cellInfo": "Cell #{idx} · VRAM {word} (word) / {byte} (byte)",
  "sprites.spriteInfo": "Sprite #{idx} · VRAM {word} (base word) · SATB pattern #{pattern}",
  "sprites.spriteInfoExtraBlocks": " (+{n} contiguous 16×16 block(s))",
  "sprites.selectionInfo": "{w}×{h} cell selection ({n}) · {pxw}×{pxh} px",
  "sprites.selectionAddrRange": " · VRAM {from}–{to} (words)",
  "sprites.selectionNonContiguous": " · non-contiguous addresses across {h} rows",
  "sprites.capturingVram": "Capturing VRAM (cartridge menu)…",
  "sprites.loadingStatus": "Loading…",
  "sprites.vramUnavailable": "VRAM unavailable — display the cartridge menu (not during a game).",
  "sprites.selectionSaved": "VRAM selection saved: {path}",
  "sprites.sheetSaved": "VRAM sheet saved: {path}",

  "modal.cancel": "Cancel",
  "modal.ok": "OK",

  "splitter.resizeTitle": "Resize",
  "log.title": "Log",
  "log.ready": "Ready. Connect the cartridge then click Connect.",
  "log.appVersion": "Turbo Everdrive USB Tools GUI {label}",
  "log.appVersionTitle": "Application {label}",
},
};

function getLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && I18N[saved]) return saved;
  } catch { /* stockage indisponible */ }
  return "fr";
}

function setLang(lang) {
  if (!I18N[lang]) return;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* tant pis */ }
  applyStaticTranslations();
  // Prévient le reste de l'app (main.js) qu'il faut re-générer les textes
  // dynamiques (journal, libellés calculés, etc.) dans la nouvelle langue.
  document.dispatchEvent(new CustomEvent("i18n:changed"));
}

let currentLang = getLang();

/** Traduit `key`, en remplaçant les `{nom}` par `vars.nom` s'il y en a. */
function t(key, vars) {
  const dict = I18N[currentLang] || I18N.fr;
  let str = dict[key] ?? I18N.fr[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      str = str.replaceAll(`{${k}}`, vars[k]);
    }
  }
  return str;
}

/** Applique les traductions à tous les éléments `data-i18n*` du document. */
function applyStaticTranslations() {
  currentLang = getLang();
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  const sel = document.getElementById("lang-select");
  if (sel) sel.value = currentLang;
}

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("lang-select");
  if (sel) {
    sel.innerHTML = "";
    for (const [code, name] of Object.entries(LANG_NAMES)) {
      const o = document.createElement("option");
      o.value = code; o.textContent = name;
      sel.appendChild(o);
    }
    sel.value = currentLang;
    sel.addEventListener("change", () => setLang(sel.value));
  }
  applyStaticTranslations();
});
