# Protocole EverDrive — port Rust

Ce document décrit le protocole série implémenté dans `edlink-core` et sa
correspondance avec la référence officielle [`krikzz/edlink`](https://github.com/krikzz/edlink)
(MIT). Le port vise la **Turbo EverDrive Pro / Core** (protocole V1, génération
**Gen3**).

## Transport série

- Débit : **921 600 bauds**, 8N1, via CDC USB.
- Sur macOS, ouvrir le port **`/dev/cu.*`** (call‑up) et non `/dev/tty.*`.
- Le handshake initial envoie **66 octets nuls** puis purge le flux entrant.
- La référence effectue un **cold start** : si le premier essai échoue, on
  attend 100 ms et on retente une fois (`Link.cs → Open()`).

Référence : `reference/edlink/edlink/Device/Link.cs`.

## Format des trames de commande

Chaque commande est une trame de 4 octets :

```
['+' (0x2B), '+'^0xFF (0xD4), CODE, CODE^0xFF]
```

`TxCMD(code)` envoie ces 4 octets. Les entiers sont transmis en **little‑endian**
pour la TED (la référence force `SwapEndians = false` dans le constructeur du
pilote TED — `DEV_TED/DeviceIO.cs`).

## Identification de l'appareil

1. `TxCMD(CMD_STATUS2 = 0x40)` puis `TxCMD(CMD_STATUS = 0x10)` ;
2. lecture de 2 octets : si `id[0] == 0x5A` (STATUS_KEY) → protocole **Gen3**
   (cas TED), on lit 2 octets supplémentaires d'identité ;
3. `protocol_id` et `device_id` sont lus. Pour la TED : `protocol_id = 0x02`,
   `device_id = 0x20` (Pro) ou `0x26` (Core).

Référence : `Link.cs → GetDeviceConfig()` / `GetID()`.

## Commandes implémentées

| Constante | Code | Opération | Référence C# |
|---|---|---|---|
| `CMD_SYS_INF` | 0x26 | Infos système (64 octets) | `DeviceIO_V1.GetSysInf` |
| `CMD_GET_VDC` | 0x13 | Tensions | `DeviceIO_V1.GetVdc` |
| `CMD_MEM_RD` | 0x19 | Lecture mémoire | `DeviceIO_V1.MemRD` |
| `CMD_MEM_WR` | 0x1A | Écriture mémoire (interne) | `DeviceIO_V1.MemWR` |
| `CMD_HOST_RST` | 0x29 | Reset hôte | `DEV_TED/DeviceIO.HostReset` |
| `CMD_F_FOPN` | 0xC9 | Ouverture fichier | `DeviceIO_V1.FileOpen` |
| `CMD_F_FRD` | 0xCA | Lecture fichier | `DeviceIO_V1.FileRead` |
| `CMD_F_FWR` | 0xCC | Écriture fichier | `DeviceIO_V1.FileWrite` |
| `CMD_F_FCLOSE` | 0xCE | Fermeture fichier | `DeviceIO_V1.FileClose` |
| `CMD_F_AVB` | 0xD5 | Taille fichier | `DeviceIO_V1.FileAvailable` |
| `CMD_F_DIR_MK` | 0xD2 | Créer dossier | `DeviceIO_V1.DirMake` |
| `CMD_F_DIR_OPN` | 0xC3 | Ouvrir dossier | `turbolink.exe DeviceIO.dirOpen` (cf. ci‑dessous) |
| `CMD_F_DIR_RD` | 0xC4 | Lire une entrée | `turbolink.exe DeviceIO.dirRead` (cf. ci‑dessous) |

### Système de fichiers SD (FatFs-like)

- Ouverture : `FOPN`, drapeau `mode`, puis chaîne de chemin (`u16` longueur +
  UTF‑8). Flags : `FA_READ=0x01`, `FA_WRITE=0x02`, `FA_CREATE_ALWAYS=0x08`,
  `FS_MAKEPATH=0x80` (crée les dossiers parents).
- Lecture : `FRD` + taille totale ; données reçues par blocs de 4096 octets,
  chaque bloc précédé d'un octet d'acquittement (0 = OK).
- Écriture : `FWR` + taille ; données envoyées par blocs de 1024 avec
  acquittement (`TxDataACK`), puis statut final.
- `MakePath` crée les sous‑dossiers parents (`DIR_MK`), en ignorant l'erreur 8
  (« dossier déjà existant »).

Référence : `DeviceIO_V1.cs` (FileOpen/Read/Write/…).

### Listing de dossiers SD (`CMD_F_DIR_OPN` / `CMD_F_DIR_RD`)

> ✅ **Confirmé le 28/08/2026 par désassemblage IL de `turbolink.exe` v1.0.0.3**
> (l'outil CLI propre à la Turbo EverDrive, distinct du `edlink` générique de
> `reference/edlink`). Ni l'un ni l'autre outil n'expose de commande `ls` côté
> CLI, mais `turbolink.exe` contient malgré tout les méthodes complètes
> `DeviceIO.dirOpen`/`dirRead`/`rxFileInfo`, écrites avec les mêmes primitives
> (`txCMD`/`rx8`/`rx16`/`rx32`/`rxString`) que le reste du pilote de fichiers —
> lui bien vérifié fonctionnel (upload de ROM, etc.). Désassemblage fait avec
> `dnfile`/`dncil` (Python, sans dépendance à `dotnet`/ILSpy) sur le binaire
> fourni par l'utilisateur.

```csharp
// DeviceIO.dirOpen(string path)  — RVA 0x38fc
txCMD(0xC3);              // CMD_F_DIR_OPN
txString(path);
checkStatus();             // lit CMD_STATUS séparé, comme CMD_F_DIR_MK

// DeviceIO.dirRead(int max_name_len = 0xFFFF)  — RVA 0x3918
// (l'argument vaut 0xFFFF si l'appelant passe 0 — seule valeur jamais
// exercée dans ce binaire, aucun appelant ne le fait varier)
txCMD(0xC4);               // CMD_F_DIR_RD
tx16(max_name_len);        // ARGUMENT REQUIS — silence total sans lui
byte status = rx8();
if (status != 0) throw;
return rxFileInfo();

// DeviceIO.rxFileInfo()  — RVA 0x3718
size   = rx32();           // u32 LE
date   = rx16();           // u16 FAT (ignorée)
time   = rx16();           // u16 FAT (ignorée)
attrib = rx8();            // u8 — AM_DIR = 0x10 → dossier
name   = rxString();       // u16 longueur + octets UTF-8 (PAS un u8 !)
```

Trame complète, en boucle jusqu'à `name == ""` :

```text
TX  CMD_F_DIR_RD                      trame 4 octets
TX  u16 max_name_len                  0xFFFF (aucun appelant connu n'utilise autre chose)
RX  u8  status                        FRESULT (0 = OK, sinon erreur → abandon)
RX  u32 size                          taille du fichier (little-endian)
RX  u16 date                          date FAT (ignorée par l'hôte)
RX  u16 time                          heure FAT (ignorée par l'hôte)
RX  u8  attrib                        attributs FatFs — AM_DIR=0x10 → dossier
RX  u16 name_len + name (UTF-8)       rxString — longueur nulle = fin du dossier
```

Pas de `count` en tête (`f_opendir` ne le connaît pas — d'où `CMD_F_DIR_SIZE`
séparé, lui aussi jamais exercé), pas de fermeture explicite (le `DIR` est
réutilisé au prochain `OPN`). Les entrées `.` / `..` sont filtrées côté hôte.

**Historique du diagnostic** (pour mémoire) : une première implémentation
reconstituait ce protocole sans aucune source (`CMD_F_DIR_OPN`/`RD` sont
déclarées dans `reference/edlink` mais jamais appelées, par aucun outil, sur
aucune des 5 familles de cartes) — elle omettait l'argument `u16` de
`CMD_F_DIR_RD` et lisait le nom via un `u8 name_len`. Sur une vraie Turbo
EverDrive Pro (28/08/2026), `CMD_F_DIR_OPN` répondait correctement mais
`CMD_F_DIR_RD` restait totalement muet : le firmware attendait les 2 octets
de `max_name_len` qui n'arrivaient jamais. Résolu par désassemblage direct de
`turbolink.exe` plutôt que par une nouvelle supposition.

### Trace série (`EDLINK_TRACE`)

`EDLINK_TRACE=1` (variable d'environnement) journalise sur **stderr** chaque
octet émis/reçu par `edlink-core`. Pour capturer le vrai protocole d'une carte :

```bash
EDLINK_TRACE=1 edlink-cli --port /dev/cu.usbmodemXXXX ls sd:/GAMES
```

Sous Windows (`edlink-cli.exe`, port `COMx`), avec le résultat redirigé vers un
fichier pour le partager facilement :

```bat
:: Invite de commandes (cmd.exe)
set EDLINK_TRACE=1
edlink-cli.exe --port COM3 ls sd:/ > trace.txt 2>&1
```

```powershell
# PowerShell
$env:EDLINK_TRACE = 1
.\edlink-cli.exe --port COM3 ls sd:/ 2>&1 | Tee-Object trace.txt
```

### Instantané VRAM / CRAM (`*v`) — capture d'écran & visualiseur mémoire

1. `FifoWR("*v")` → le **menu OS** (code assembleur de la carte) recopie
   VRAM + CRAM dans un tampon de la RAM cartouche et répond par son adresse
   (`rx32()`) ;
2. `MemRD(addr, 0x10000)` = **VRAM** (VDC), `MemRD(addr+0x10000, 1024)` =
   **CRAM** (VCE, 512 mots de 16 bits) ;
3. la capture d'écran passe VRAM/CRAM à `make_png` — un **rendu logiciel** du
   plan de tuiles BG (port étendu de `DEV_TED/MenuImage.cs`) : lecture du BAT,
   des motifs de tuiles (4 bpp planaire) et de la palette (GRB 3-3-3). Pas de
   sprites, pas de fenêtre, pas d'effets par ligne. Les réglages BAT /
   résolution / défilement n'agissent que sur ce rendu — l'app garde le dernier
   instantané en cache (`AppState.screen_snap`) et ne relit `*v` que sur le
   bouton « Capturer l'écran » (`capture_screen(refresh = true)`). Le
   visualiseur mémoire, lui, affiche les octets bruts.

`Ted::vram_dump()` renvoie `(vram, cram)` ; `Ted::screen_opts()` l'utilise.
**Ne fonctionne que si le menu de la carte est affiché** : le VDC/VCE sont
internes à la console (hors bus cartouche), seul du code PCE peut les lire —
donc pas d'accès pendant un jeu. Contrairement à la RAM (`CMD_MEM_RD`), ce
n'est pas un souci de gel : au menu, la console est au repos.

La commande `capture_vram(refresh)` renvoie l'instantané en base64 (partagé avec
la capture d'écran via `AppState.screen_snap`). Consommateurs :
- **onglet Mémoire** (vues VRAM/CRAM) : octets bruts ;
- **onglet Sprites** (`frontend/main.js`) : décode la VRAM en **planche de
  cellules 4 bpp** — 8×8 (format tuile de fond : plans aux octets 0/1/16/17 d'un
  bloc de 32) ou une des **6 tailles de sprite du VDC** : 16×16, 16×32, 16×64,
  32×16, 32×32, 32×64. Le motif d'un bloc 16×16 = 4 plans de 16 mots, bit 15 =
  pixel gauche, base = n° de pattern × 64 mots — **format confirmé visuellement**
  contre GearGraFX (vrais sprites d'un jeu, taille 16×16). Une sprite plus
  grande = cw×ch blocs 16×16 **contigus**, rangés colonne par colonne (chaque
  colonne de haut en bas) : sous-bloc `(cx, cy)` à `base + (cx·ch + cy)·64` mots
  — convention VDC usuelle, **non encore vérifiée** pour les tailles composites
  (16×32 à 32×64). Les motifs de sprites vivent dans la VRAM (la SATB ne fait
  que les référencer) : on les repère à l'œil, on clique (ou on glisse pour une
  plage rectangulaire) pour lire l'adresse VRAM / le n° de pattern, et on
  exporte en PNG soit la planche entière soit la sélection courante. Décodage
  100 % côté client (canvas) — les réglages ne relisent jamais la carte.

### Lancement d'un jeu

1. `ResetToMenu` : `HostReset(ON)`, attente 10 ms, `ConfigReset` (écriture de
   256 octets nuls à `0x01800000`), `HostReset(OFF)`, attente du statut `'r'`.
2. `AppInstall` : `FifoWR("*i")`, chemin (`u16` longueur + chaîne), acquittement.
3. `AppStart` : `FifoWR("*s")`.

Référence : `DEV_TED/MenuCmd.cs`, `DEV_TED/DeviceIO.cs`, `DeviceCmd.AppDeploy`.

> ⚠️ **Attendre le statut `'r'` : lecture bloquante, pas `bytes_to_read()`.**
> La référence C# sonde `Link.BytesToRead` en boucle avant de lire. Sur
> matériel réel (Windows), l'appel équivalent côté `serialport`
> (`bytes_to_read()` → IOCTL `ClearCommError`) a été observé en échec avec
> `os error 22` (« The device does not recognize the command »), et **ce
> premier échec rend le port série inutilisable pour toute la suite de la
> session** (chaque commande suivante échoue à l'identique, y compris des
> commandes sans rapport, jusqu'à déconnexion/reconnexion). `Ted::reset_to_menu`
> attend désormais le statut avec une lecture bloquante classique
> (`set_read_timeout(2000ms)` + `rx8()`), le seul type d'appel exercé partout
> ailleurs dans le pilote et qui fonctionne de façon fiable. `Link::bytes_to_read`
> a été retiré (plus aucun appelant).

### Lecture mémoire (`CMD_MEM_RD`)

```text
TX  CMD_MEM_RD                        trame 4 octets
TX  u32 addr                          adresse sur le bus FCI (little-endian)
TX  u32 len                           nombre d'octets
TX  u8  0                             "exec"
RX  len octets                        (aucun acquittement, flux direct)
```

Port de `DeviceIO_V1.MemRD`. `addr` adresse le **bus cartouche (FCI)** :
`0x000000`–`0x7FFFFF` = RAM0 (HuCard chargée), `0x800000`+ = RAM1 (Pro),
`0x1800000` = config, `0x1810000` = FIFO.

> ⚠️ **Sur matériel réel, `CMD_MEM_RD` gèle le CPU PC-Engine** pendant toute la
> durée du transfert (le MCU prend le bus cartouche). Le temps de gel est
> proportionnel à `len` (~90 Ko/s utiles → 8 Ko ≈ 90 ms, 8 Mo ≈ 90 s). La
> référence n'utilise `memrd` que comme **diagnostic**, sur de petites plages,
> et jamais en attendant qu'un jeu continue de tourner normalement. Il n'existe
> pas de « pause/peek/resume » : `CMD_HOST_RST` ne fait que OFF/ON (reset franc).
>
> Conséquence côté outil : la vue **Mémoire** (RAM, bus FCI) lit par **petits
> blocs** (1 Ko), **jamais automatiquement** (clic « Rafraîchir »), et n'expose
> ni recherche linéaire ni dump complet en un coup sur matériel. Les vues
> **VRAM / CRAM** utilisent l'instantané `*v` (menu affiché) — pas le bus FCI.

### Détection émulateur vs matériel

Les 20 premiers octets de la réponse `CMD_SYS_INF` sont un en-tête ASCII (chaîne
de build du firmware sur matériel). L'émulateur virtuel y place
`"TED-EMULATOR ..."` ; `Ted::is_emulator()` teste la présence de `"EMULATOR"`.
L'interface s'en sert pour mettre la vue **Mémoire** en mode conservateur sur
matériel (lectures libres en émulation). VRAM/CRAM restent disponibles partout
via `*v`. `edlink-emulator --fake-hardware` force un en-tête « matériel » pour
tester le mode conservateur.

## Adresses mémoire clés (Turbo EverDrive Pro)

| Adresse | Rôle |
|---|---|
| `0x00000000` | RAM0 (8 Mo) — HuCard chargée |
| `0x00800000` | RAM1 (8 Mo, Pro uniquement) |
| `0x01800000` | Registre config |
| `0x01810000` | FIFO hôte |

## Ce qui est volontairement exclu (v1)

- **`flard` / `flawr`** (flash système) et **`memwr`** (écriture HuCard) : hors
  périmètre v1 (sécurité).
- **RTC sur TED Pro** : la référence lève `UnsupportedCmd`
  (`DEV_TED/DeviceIO.cs → RtcSet/RtcCal`) → non exposé.
- ~~**Listing de dossiers SD**~~ : implémenté (`CMD_F_DIR_OPN` / `CMD_F_DIR_RD`),
  protocole confirmé par désassemblage de `turbolink.exe` — cf. section dédiée
  ci‑dessus. À reconfirmer sur matériel réel (corrigé le 28/08/2026, pas encore
  retesté sur une vraie carte).

## Tests

```bash
cargo test -p edlink-core
```

Les tests unitaires couvrent les conversions (dates/versions, endianness,
chemins `sd:`). La validation du flux série se fait via le binaire `edlink-cli`
(`devinf`, `probe`, …) lorsque le matériel est en état de répondre.
