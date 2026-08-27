# edlink-emulator — Émulateur virtuel Turbo EverDrive (Pro / Core)

Émulateur logiciel d'une **Turbo EverDrive Pro / Core** pour développer et tester
l'outil (`edlink-cli`, interface Tauri) **sans matériel**.

Il crée un **port série virtuel (PTY)** sur lequel `edlink-cli` (ou l'interface)
se connecte comme sur un vrai périphérique. La **carte SD** est représentée par un
**dossier local**, et la mémoire ROM peut être servie par un **émulateur PC‑Engine
hôte (GearGraFX)** via le protocole MCP.

---

## Sommaire

- [Construction](#construction)
- [Utilisation](#utilisation)
- [Se connecter avec `edlink-cli`](#se-connecter-avec-edlink-cli)
- [Carte SD virtuelle](#carte-sd-virtuelle)
- [Commandes protocole supportées](#commandes-protocole-supportées)
- [Mode MCP (GearGraFX)](#mode-mcp-geargrafx)
- [Tests](#tests)
- [Limites](#limites)

---

## Construction

```bash
cargo build -p edlink-emulator
```

Le binaire est produit dans `target/debug/edlink-emulator`.

---

## Utilisation

```text
edlink-emulator [--sd <dossier>] [--device pro|core]
               [--MCP_EMU <ip>] [--MCP_PORT <port>] [--MCP_TOKEN <jeton>]

Options :
  --sd <dossier>        Dossier local servant de carte SD virtuelle
                        (défaut : ~/SD_PCE)
  --device <type>       pro | core  (défaut : pro)
  --fake-hardware      Se fait passer pour une vraie carte (en-tête SYS_INF) :
                        teste le mode conservateur du visualiseur mémoire.
  --MCP_EMU <ip>        Adresse du serveur MCP de l'émulateur PC-Engine
                        (GearGraFX). Quand présent, la mémoire ROM est lue
                        depuis la zone ROM de l'hôte au lieu de la RAM
                        virtuelle locale.
  --MCP_PORT <port>     Port HTTP MCP de l'hôte (défaut : 7000)
  --MCP_TOKEN <jeton>   Token Bearer MCP (obligatoire si l'hôte écoute hors
                        loopback)
  -V, --version        Affiche la version (crate + hash git + date) et quitte
  -h, --help            Affiche l'aide
```

Exemple :

```bash
./target/debug/edlink-emulator --device pro
```

Au démarrage, l'émulateur affiche le chemin du port virtuel, par exemple :

```text
=== Turbo EverDrive PRO — émulateur virtuel v0.1.1-alpha (a1b2c3d, 2026-08-27) ===
Carte SD virtuelle : /Users/eddy/SD_PCE
Port série virtuel : /dev/ttys003

>> Connectez-vous à ce port depuis l'outil (champ port manuel)
>>   ou : edlink-cli --port /dev/ttys003 devinf
```

> **Note macOS** : ce port n'apparaît pas dans la liste déroulante auto (IOKit ne
> recense que les périphériques USB) ; une **saisie manuelle** est nécessaire.

---

## Se connecter avec `edlink-cli`

```bash
edlink-cli --port /dev/ttys003 devinf     # identité + infos carte
edlink-cli --port /dev/ttys003 cp toto.bin sd:usb-games/   # envoi d'un fichier
edlink-cli --port /dev/ttys003 run 'sd:usb-games/Jeu.pce'  # installer + lancer
edlink-cli --port /dev/ttys003 reset      # reset console
edlink-cli --port /dev/ttys003 memrd 0 16 # lecture mémoire
```

---

## Carte SD virtuelle

La carte SD est un **dossier local** (`--sd`, défaut `~/SD_PCE`). Les chemins
« périphériques » du protocole (ex : `/GAMES/jeu.pce`, `usb-games/jeu.pce`) sont
résolus **relativement à ce dossier racine**, sans jamais pouvoir s'en échapper
(les segments `..` sont ignorés). Les dossiers parents sont créés à la volée lors
des écritures.

Ainsi, un jeu envoyé vers `sd:usb-games/Jeu.pce` est physiquement écrit dans
`<racine>/usb-games/Jeu.pce`.

---

## Commandes protocole supportées

L'émulateur répond fidèlement à ce que `edlink-core` envoie :

| Domaine | Détails |
|---------|---------|
| Identité / statut | `STATUS2`, `STATUS`, `SYS_INF`, `GET_VDC` (id `PRO=0x20`, `CORE=0x26`) |
| Mémoire | `MEM_RD`, `MEM_WR` (RAM0/RAM1, registre CFG, FIFO du menu OS) |
| Fichiers SD | `F_OPN`, `F_RD`, `F_WR`, `F_CLOSE`, `F_AVB`, `F_DIR_OPN`, `F_DIR_MK` |
| Reset | `HOST_RST` (simple ou « reset to menu » avec annonce `'r'`) |
| FIFO menu OS | `*v` (instantané VRAM+CRAM — capture d'écran, vues VRAM/CRAM, planche de sprites), `*i` (installer un jeu), `*s` (lancer le jeu) |

---

## Mode MCP (GearGraFX)

Avec `--MCP_EMU`, l'émulateur se connecte au serveur **MCP** (Model Context
Protocol) de GearGraFX, l'émulateur PC‑Engine hôte. Le flux devient alors :

1. **Installer un jeu** (`*i`) → l'émulateur appelle l'outil MCP
   `load_media` avec le chemin absolu du fichier sur la carte SD virtuelle.
   GearGraFX charge la ROM/CD, ce qui fait **apparaître une zone mémoire « ROM »**.
2. **Lancer le jeu** (`*s`) → l'émulateur appelle `debug_continue` pour que le
   jeu **tourne réellement** (GearGraFX reste en pause après un `load_media`).
3. Les lectures ROM (`MEM_RD`) sont alors servies depuis la **zone ROM de
   GearGraFX** au lieu de la RAM virtuelle locale.

Chaque appel d'outil MCP est tracé sur **stdout** (`[MCP] tool: …`).

Si le chargement échoue (fichier introuvable, serveur indisponible), l'émulateur
reste sur le **fallback RAM virtuelle** : la lecture/écriture continue de
fonctionner localement.

```bash
# Démarrer GearGraFX (côté hôte) avec le serveur MCP HTTP :
./geargrafx --mcp-http --mcp-http-port 7000

# Puis l'émulateur TED branché dessus :
./target/debug/edlink-emulator --MCP_EMU 127.0.0.1 --MCP_PORT 7000
```

---

## Tests

```bash
cargo test -p edlink-emulator
```

Les tests couvrent notamment le client MCP (handshake, lecture ROM, reset,
`load_media` avec invalidation du cache, `debug_continue`), via un serveur
MCP factice (fake server).

---

## Limites

- Émulation **partielle** du protocole EverDrive : uniquement ce dont l'outil a
  besoin (identité, infos, mémoire, fichiers, reset, FIFO menu). Les fonctionnalités
  matérielles avancées (Mcu Mode, mise à jour FPGA, etc.) ne sont pas simulées.
- Le port PTY n'est pas recensé automatiquement sur macOS (saisie manuelle).
- En mode MCP, la carte SD virtuelle et le serveur GearGraFX doivent avoir accès
  au **même chemin absolu** pour que `load_media` retrouve le fichier envoyé.

---

_Licence MIT — projet « Turbo Everdrive USB Tools GUI »._
