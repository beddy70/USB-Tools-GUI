# Architecture

## Décisions de conception

- **Backend Rust + interface Tauri (WebView)** : un seul paquet natif, aucune
  dépendance à Mono/.NET. Le protocole est un **port** de la référence
  officielle `krikzz/edlink` (MIT) plutôt qu'une ré‑implémentation.
- **Crate core autonome (`edlink-core`)** : la logique de protocole ne dépend
  d'aucun framework GUI → testable et réutilisable (CLI + Tauri + futur).
- **Frontend statique** (HTML/CSS/JS, pas de bundler) : minimisation des
  dépendances de build ; `withGlobalTauri: true` expose l'API `window.__TAURI__`.

## Couches

```
┌─────────────────────────────────────────────┐
│ Frontend web (frontend/)                    │  index.html · styles.css · main.js
│   invite → invoke("cmd", args)              │  thème retrowave/néon
└───────────────┬─────────────────────────────┘
                │ IPC (invoke / events)
┌───────────────▼─────────────────────────────┐
│ Backend Tauri (src/lib.rs)                  │  commandes #[tauri::command]
│   État AppState { ted: Mutex<Option<Ted>> } │  glisser‑déposer → événement
└───────────────┬─────────────────────────────┘
┌───────────────▼─────────────────────────────┐
│ edlink-core                                 │
│   link.rs   → couche série (Link)           │  trames, endianness, discovery
│   ted.rs    → pilote TED (Ted)              │  devinf, cp, run, reset, screen, memrd
│   protocol.rs → codes de commandes          │
│   image.rs  → VRAM → PNG                    │
│   error.rs  → EdError                       │
└───────────────┬─────────────────────────────┘
                │ serialport
┌───────────────▼─────────────────────────────┐
│ Turbo EverDrive Pro / Core (USB CDC 921600) │
└─────────────────────────────────────────────┘
```

## Émulateur virtuel (`crates/emulator`)

Pour développer et tester l'interface **sans matériel**, le crate `emulator`
se substitue à la cartouche : placé **de l'autre côté du lien série**, il reçoit
les mêmes trames du protocole et y répond fidèlement.

- **Port série virtuel** : un pseudo‑terminal (`pty.rs`, via `nix`) expose un
  chemin `/dev/ttysXXX` que `serialport` peut ouvrir.
- **Carte SD virtuelle** (`sd.rs`) : un dossier local, dont les chemins
  périphériques (`/GAMES/jeu.pce`) sont résolus sans jamais sortir de la racine.
- **Répondeur protocole** (`device.rs`) : identité (STATUS2/STATUS), SYS_INF,
  GET_VDC, MEM_RD/WR, FIFO du menu (`*v` dump, `*i` install → RAM0, `*s` start),
  opérations fichiers (FOPN/FRD/FWR/FCLOSE/AVB/DIR_MK), reset (avec ou sans `'r'`).

L'émulateur est **persistant** : il ignore les déconnexions de l'hôte et relance
une session (état réinitialisé) à chaque reconnexion. L'hôte (`edlink-cli --port
/dev/ttysXXX` ou le champ « Port manuel » de la GUI) s'y connecte comme à une
vraie carte.

> Détail du transport : sur macOS, `serialport` règle le débit via l'ioctl
> `IOSSIOSPEED`, qui échoue (`ENOTTY`) sur un PTY. `edlink-core` retente donc
> l'ouverture avec un débit nul (baud 0) si la première passe échoue — ce qui
> ne change rien au débit réel d'un PTY (tampon mémoire), et préserve le
> comportement sur matériel réel (la première passe à 921600 réussit).

## Concurrence & état

L'app garde un `Option<Ted>` dans un `Mutex` géré par Tauri. La plupart des
commandes sont **synchrones** (exécutées sur le fil principal) : acceptable pour
les opérations courtes (infos, reset, listing, `memrd`).

Les transferts de fichiers (`upload` / `download`), eux, durent plusieurs
secondes. Ce sont des commandes **asynchrones** : le travail bloquant est confié
à un thread dédié via `tauri::async_runtime::spawn_blocking`, ce qui garde
l'interface réactive. La progression est publiée au fil du transfert par
l'événement **`transfer-progress`** (`{ phase, dir, name, done, total, error }` ;
`phase` ∈ `start` / `progress` / `done` / `error`), throttlé à ~40 ms côté
backend. Le `Mutex` `ted` reste tenu pendant toute la copie : les opérations
carte sont donc sérialisées (une seule à la fois), ce qui est le comportement
voulu pour un lien série unique.

Le rappel de progression traverse `edlink-core` :
`Ted::copy_file_with_progress` → `file_read` / `file_write` →
`Link::tx_data_ack_progress`, chacun appelant `progress(octets_faits, total)`
après chaque bloc. `Ted::copy_file` reste un raccourci sans rappel.

## Recevoir des fichiers (glisser‑déposer)

La sandbox de la WebView empêche de lire le chemin absolu d'un fichier déposé
depuis le JS. On gère donc le *drop* côté Rust : `on_window_event` intercepte
`WindowEvent::DragDrop`, stocke les chemins dans `AppState.dropped` et émet
l'événement `files-dropped` vers le frontend (qui les affiche puis appelle
`upload`).

## Visualiseur mémoire : émulateur vs matériel

`CMD_MEM_RD` lit le bus cartouche et **gèle le CPU PC-Engine** le temps du
transfert (cf. `docs/PROTOCOL.md`). Le visualiseur a été conçu pour l'émulateur,
où la mémoire est observée hors bus (gratuit). Sur matériel il passe en **mode
conservateur** :

| | émulateur | matériel réel |
|---|---|---|
| bloc de lecture | 8 Ko | 1 Ko |
| lecture au défilement | auto | manuelle (« Rafraîchir ») |
| relecture auto (connexion / load / reset) | oui | non |
| recherche | balayage complet | zones déjà chargées seulement |
| dump complet RAM | 1 lecture | blocs de 16 Ko + confirmation |

Les onglets **VRAM / CRAM** sont disponibles dans les deux cas : ils ne passent
pas par `CMD_MEM_RD` mais par un **instantané `*v`** (`Ted::vram_dump`, commande
`capture_vram`) — la même routine que la capture d'écran, où le menu OS recopie
VRAM+CRAM dans la RAM cartouche. Nécessite le menu de la carte affiché.

La bascule RAM vient de `DeviceInfo.is_emulator` (renvoyé par `connect`), déduit
de l'en-tête `CMD_SYS_INF` (`Ted::is_emulator`). Côté frontend, `connect` appelle
`configureMemForDevice(isEmulator)`. `memrd` et `capture_vram` sont des commandes
**async** (`spawn_blocking`) pour ne pas geler l'interface pendant le transfert.

## Ajouter une commande

1. Dans `edlink-core` (`ted.rs`), ajouter une méthode publique si nécessaire.
2. Dans `crates/app/src/lib.rs`, ajouter une `#[tauri::command]` qui appelle
   `with_ted(&state, |t| t.méthode(...))`.
3. L'enregistrer dans `tauri::generate_handler![…]`.
4. Appeler `invoke("nom_cmd", args)` depuis `frontend/main.js`.

## Flux lors d'un « Lancer un jeu »

```
reset_to_menu()          # retour au menu OS
  → HostReset(ON) · sleep 10ms · ConfigReset · HostReset(OFF) · attendre 'r'
app_dst = (rom locale ? copier vers sd:/usb-games/<nom> : rom sd:…)
app_install(app_dst)     # FifoWR "*i" + chemin + ack
app_start()              # FifoWR "*s"
```

## Vérifier / tester

```bash
cargo test -p edlink-core        # tests unitaires (conversions)
cargo build -p edlink-cli        # CLI de validation matérielle
cargo check -p edlink-app        # compilation du GUI
cd crates/app && cargo tauri dev # lancement du GUI
```
