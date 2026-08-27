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
| `CMD_F_DIR_OPN` | 0xC3 | Ouvrir dossier | *(non câblé par edlink — cf. ci‑dessous)* |
| `CMD_F_DIR_RD` | 0xC4 | Lire une entrée | *(non câblé par edlink — cf. ci‑dessous)* |

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

> ⚠️ **Reconstitué, non issu de l'`edlink` de référence.** Les commandes
> `CMD_F_DIR_*` sont *déclarées* dans `DeviceIO_V1.cs` mais **jamais appelées**
> (aucune carte n'expose de navigation SD via edlink). L'implémentation ci‑dessous
> reproduit la couche FS (`f_opendir` / `f_readdir`) du firmware MCU partagé des
> cartes « Pro ». **À valider sur matériel réel** (voir `EDLINK_TRACE` plus bas).

```text
TX  CMD_F_DIR_OPN                     trame 4 octets
TX  u16 len + chemin UTF-8            ("" ou "/" = racine, "/GAMES" = sous-dossier)
    → résultat : code FatFs lu via CMD_STATUS (comme CMD_F_DIR_MK)
                 0 = OK ; 4 (NO_FILE) / 5 (NO_PATH) → dossier absent (liste vide)

puis, en boucle jusqu'à name_len == 0 :
TX  CMD_F_DIR_RD                      trame 4 octets
RX  u8  status                        FRESULT (0 = OK, sinon erreur → abandon)
RX  u32 size                          taille du fichier (little-endian)
RX  u16 date                          date FAT (0 accepté ; ignorée par l'hôte)
RX  u16 time                          heure FAT (idem)
RX  u8  attrib                        attributs FatFs — AM_DIR=0x10 → dossier
RX  u8  name_len                      longueur du nom (0 = fin du dossier)
RX  u8  name[name_len]                nom (LFN, UTF-8/ASCII)
```

Pas de `count` en tête (`f_opendir` ne le connaît pas — d'où `CMD_F_DIR_SIZE`
séparé), pas de fermeture explicite (le `DIR` est réutilisé au prochain `OPN`).
Les entrées `.` / `..` sont filtrées côté hôte.

**Points à confirmer sur la vraie carte** (si `ls` échoue, la trace le montre) :
1. `CMD_F_DIR_RD` prend‑il un argument (p. ex. `u16` longueur max de nom) ? Ici : **aucun**.
2. `CMD_F_DIR_OPN` répond‑il par `CMD_STATUS` (hypothèse retenue) ou par un octet inline ?
3. Ordre / tailles exacts des champs FILINFO (`size`/`date`/`time`/`attrib`/`name`).

### Trace série (`EDLINK_TRACE`)

`EDLINK_TRACE=1` (variable d'environnement) journalise sur **stderr** chaque
octet émis/reçu par `edlink-core`. Pour capturer le vrai protocole d'une carte :

```bash
EDLINK_TRACE=1 edlink-cli --port /dev/cu.usbmodemXXXX ls sd:/GAMES
```

### Capture d'écran (menu)

1. `FifoWR("*v")` → la carte répond par l'adresse de dump `rx32()` ;
2. `MemRD(addr, 0x10000)` = VRAM, `MemRD(addr+0x10000, 1024)` = palette ;
3. conversion VRAM/palette → image 320×224 → PNG (port de `DEV_TED/MenuImage.cs`).

### Lancement d'un jeu

1. `ResetToMenu` : `HostReset(ON)`, attente 10 ms, `ConfigReset` (écriture de
   256 octets nuls à `0x01800000`), `HostReset(OFF)`, attente du statut `'r'`.
2. `AppInstall` : `FifoWR("*i")`, chemin (`u16` longueur + chaîne), acquittement.
3. `AppStart` : `FifoWR("*s")`.

Référence : `DEV_TED/MenuCmd.cs`, `DEV_TED/DeviceIO.cs`, `DeviceCmd.AppDeploy`.

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
> Conséquence côté outil : le visualiseur mémoire lit par **petits blocs**
> (1 Ko), **jamais automatiquement** (clic « Rafraîchir »), et n'expose pas de
> recherche linéaire ni de dump complet en un coup sur matériel. Les vues
> **VRAM / CRAM** n'existent que pour l'émulateur : la mémoire du VDC/VCE est
> interne à la console, elle n'est pas sur le bus FCI.

### Détection émulateur vs matériel

Les 20 premiers octets de la réponse `CMD_SYS_INF` sont un en-tête ASCII (chaîne
de build du firmware sur matériel). L'émulateur virtuel y place
`"TED-EMULATOR ..."` ; `Ted::is_emulator()` teste la présence de `"EMULATOR"`.
L'interface s'en sert pour débrider le visualiseur mémoire (lectures libres,
VRAM/CRAM) uniquement en émulation. `edlink-emulator --fake-hardware` force un
en-tête « matériel » pour tester le mode conservateur.

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
  reconstitué d'après la couche FS du firmware — cf. section dédiée ci‑dessus.
  À valider sur matériel réel.

## Tests

```bash
cargo test -p edlink-core
```

Les tests unitaires couvrent les conversions (dates/versions, endianness,
chemins `sd:`). La validation du flux série se fait via le binaire `edlink-cli`
(`devinf`, `probe`, …) lorsque le matériel est en état de répondre.
