# 🕹️ Turbo Everdrive USB Tools

Outil graphique **cross‑platform** pour la carte **Turbo EverDrive Pro / Core**
(PC‑Engine / TurboGrafx‑16), construit avec un backend **Rust** et une interface
**Tauri** (WebView).

Il permet de gérer les fichiers sur la carte SD, de lancer des ROMs, de
réinitialiser la console, de capturer l'écran du menu et de lire l'état de la
carte — le tout relié à la cartouche par **USB série** (CDC).

> ⚠️ **État : M2.** Protocole, interface graphique, listing SD et transferts
> asynchrones avec barre de progression sont implémentés. La validation sur
> matériel requiert que le **menu OS** de la cartouche soit affiché et la
> console alimentée (voir [Vérification matérielle](#vérification-matérielle)).

---

## Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Build & lancement](#build--lancement)
- [Utilisation](#utilisation)
- [Vérification matérielle](#vérification-matérielle)
- [Limitations connues](#limitations-connues)
- [Feuille de route](#feuille-de-route)
- [Références](#références)

---

## Fonctionnalités

| Fonction | Description |
|---|---|
| **Connexion** | Détection automatique du port série de la carte (ou choix manuel) |
| **Infos carte** (`devinf`) | Nom, n° de série, versions, compteurs, tensions |
| **Transfert hôte ↔ SD** | Envoi (glisser‑déposer) et téléchargement de fichiers via le protocole FatFs de la carte |
| **Lancer un jeu** (`run`) | Déploie la ROM sur la SD (`sd:/usb-games/`) puis la lance |
| **Reset** | Réinitialise la console |
| **Capture d'écran** | Capture le menu de la carte (VRAM + palette → PNG) |
| **Lecture mémoire** (`memrd`, lecture seule) | Dump de la HuCard chargée dans la RAM |

## Architecture

```
Turbo Everdrive USB Tools/
├── Cargo.toml                 # workspace Rust
├── crates/
│   ├── edlink-core/           # protocole EverDrive (bibliothèque, sans GUI)
│   │   └── src/
│   │       ├── link.rs        #   couche série (découverte, trames, endian)
│   │       ├── ted.rs         #   pilote Turbo EverDrive (opérations haut niveau)
│   │       ├── protocol.rs    #   codes de commandes
│   │       ├── image.rs       #   VRAM → PNG
│   │       └── error.rs       #   erreurs
│   ├── cli/                   # CLI de validation sur matériel
│   ├── emulator/              # émulateur virtuel TED Pro (tests sans matériel)
│   │   └── src/
│   │       ├── main.rs        #   CLI (--sd, --device pro|core)
│   │       ├── pty.rs         #   pseudo-terminal = port série virtuel
│   │       ├── sd.rs          #   carte SD virtuelle (dossier local)
│   │       └── device.rs      #   répondeur du protocole EverDrive
│   └── app/                   # application Tauri (backend + frontend web)
│       ├── src/lib.rs         #   commandes Tauri exposées au frontend
│       ├── frontend/          #   interface web (HTML/CSS/JS, thème retrowave)
│       ├── tauri.conf.json
│       └── capabilities/
├── reference/edlink/          # source officielle krikzz/edlink (MIT) clonée
├── docs/                      # documentation détaillée
└── scripts/gen_icon.py        # générateur d'icône
```

Le protocole est un **port Rust** de la référence officielle
[krikzz/edlink](https://github.com/krikzz/edlink) (MIT), et non une
ré‑implémentation « au doigt mouillé » : la correspondance avec chaque fichier
C# est documentée dans [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Prérequis

- **Rust** (stable) + Cargo
- **Tauri CLI** : `cargo install tauri-cli`
- macOS : Xcode Command Line Tools ; Linux : dépendances WebKitGTK ; Windows : aucune en plus

## Build & lancement

```bash
# 1. Compiler la bibliothèque de protocole
cargo build -p edlink-core

# 2. Lancer l'interface graphique (mode dev)
cd crates/app
cargo tauri dev

# 3. (Option) Produire un bundle installable
cd crates/app
cargo tauri build
```

### CLI de validation

Le binaire `edlink-cli` reste utile pour tester le protocole sans interface :

```bash
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX devinf
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX ls "sd:/GAMES"
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX cp local.pce "sd:GAMES/local.pce"
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX run "sd:GAMES/local.pce"

# Capturer la trame série brute (validation protocole sur vraie carte) :
EDLINK_TRACE=1 cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX ls "sd:/GAMES"
```

> Sur macOS, utilisez le port **`/dev/cu.*`** (call‑up) et non `/dev/tty.*`,
> qui attend le signal *carrier* non émis par la cartouche.

## Émulateur virtuel (sans matériel)

Le crate `edlink-emulator` simule une **Turbo EverDrive Pro / Core** sur un
**port série virtuel (PTY)** : l'application se connecte dessus exactement
comme sur une vraie cartouche. La **carte SD est un dossier local**, et le
périphérique virtuel reproduit les commandes, réponses, états et erreurs du
protocole (identité, infos, tensions, mémoire, FIFO du menu `*v`/`*i`/`*s`,
opérations fichiers FatFs, reset).

```bash
# Lance l'émulateur (carte SD par défaut = ~/SD_PCE, modèle PRO)
cargo run -p edlink-emulator -- --device pro

# Autre dossier / modèle : --sd <dossier> [--device pro|core]
cargo run -p edlink-emulator -- --sd /tmp/emu_sd --device pro
```

Au démarrage, le chemin du port virtuel est affiché (ex: `/dev/ttys001`).
Connectez‑vous à ce chemin :

```bash
# CLI
./target/debug/edlink-cli --port /dev/ttys001 devinf
./target/debug/edlink-cli --port /dev/ttys001 screen menu.png

# Interface graphique : onglet Connexion → champ "Port manuel (émulateur / PTY)"
#   saisir /dev/ttys001 puis Connecter
```

> ℹ️ Sur macOS, ce port n'apparaît **pas** dans la liste déroulante automatique
> (le scan IOKit de `serialport` ne recense que les périphériques USB) : utilisez
> donc le **port manuel**. Côté `edlink-core`, l'ouverture retente automatiquement
> avec un débit nul quand le réglage du baud échoue sur un PTY, afin de
> fonctionner sans ambiguïté.

L'émulateur reste actif après chaque déconnexion (comme une carte branchée) et
réinitialise son état par session. Commandes utiles :

| Commande | Comportement émulé |
|---|---|
| `devinf` | Infos carte (série `TEDP…`, versions, tensions `05.00/02.50/01.20`) |
| `ls` | Liste un dossier de la carte SD virtuelle (`CMD_F_DIR_OPN`/`DIR_RD`) |
| `cp` | Lit/écrit dans le dossier local (carte SD virtuelle), gère les sous‑dossiers |
| `run` | Copie la ROM vers `sd:/usb-games/`, la charge en RAM0, la « lance » |
| `screen` | Renvoie un PNG 320×224 (dégradé de couleurs = le « menu » virtuel) |
| `memrd` | Lit la RAM0 (motif ou ROM chargée) et autres zones |
| `reset` | Réinitialise la console (état du menu) |

## Utilisation

1. Branchez la cartouche en USB et affichez le **menu OS** de la carte.
2. Lancez l'app puis **Connecter** (le port se détecte automatiquement).
3. Onglet **Transférer** : déposez/choisissez un fichier, indiquez le dossier de
   destination sur la SD (ex. `GAMES/`), puis **Téléverser**.
4. Onglet **Jouer** : choisissez une ROM et **Lancer**.
5. **Capturer l'écran** affiche le menu de la carte (format PNG).

## Vérification matérielle

Le lien USB de la cartouche n'est actif que lorsque le **menu (OS)** de la
carte est affiché à l'écran, la console étant alimentée. Si aucun octet n'est
reçu (test `probe`), vérifiez :

- que la console est allumée et que le menu EverDrive est visible ;
- que le bon port est utilisé (`/dev/cu.*` sur macOS) ;
- que le câble USB est bien un câble **données** (pas charge seule).

```bash
# Test brut de connectivité : doit afficher "total bytes received: N" (N>0)
./target/debug/edlink-cli --port /dev/cu.usbmodemXXXX probe
```

## Limitations connues

- **Listing de dossiers SD reconstitué** : `CMD_F_DIR_OPN` / `CMD_F_DIR_RD` ne
  sont pas câblés par la référence `edlink` ; l'implémentation reproduit la
  couche FS du firmware MCU des cartes « Pro » et **reste à valider sur matériel
  réel** (`EDLINK_TRACE=1 edlink-cli --port … ls sd:/GAMES` pour capturer la
  trame réelle et ajuster — cf. `docs/PROTOCOL.md`).
- **TED Pro non compatible RTC** via `edlink` (`RtcSet`/`RtcCal` lèvent
  `UnsupportedCmd`) : le RTC n'est pas exposé.
- **Lecture mémoire (`memrd`) = bus cartouche** : sur matériel réel, chaque
  lecture gèle brièvement le CPU PC-Engine (temps ∝ taille). Le visualiseur
  mémoire passe en mode conservateur hors émulateur (petits blocs, pas de
  lecture auto, VRAM/CRAM masquées). Cf. `docs/PROTOCOL.md`.
- Non testé sur matériel tant que le menu OS n'est pas accessible.

## Feuille de route

- **M1 ✅** Fondations : workspace, protocole, CLI, app Tauri, frontend
  retrowave, connexion, infos, transferts, run, reset, capture, memrd.
- **M2 ✅** Listing SD via `CMD_F_DIR_*` ; transferts asynchrones (thread dédié,
  interface réactive) + barre de progression (événement `transfer-progress`).
- **M3** Sauvegarde/chargement de HuCard complète (via `memrd`/`memwr`), tests
  de vitesse USB (`usbspd`), diagnostics (`diag`).
- **M4** Packager/icônes finales, intégration continue, validations multiplateforme.

## Références

- [krikzz/edlink](https://github.com/krikzz/edlink) — référence officielle (MIT)
- [Tauri](https://tauri.app) — framework applicatif
- [serialport (Rust)](https://crates.io/crates/serialport) — accès ports série

## Licence

MIT — ce projet est un port du protocole de [`krikzz/edlink`](https://github.com/krikzz/edlink)
(MIT). Les marques *EverDrive*, *Turbo EverDrive* appartiennent à leurs
propriétaires respectifs.
