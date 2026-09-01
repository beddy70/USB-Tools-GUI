# 🕹️ Turbo Everdrive USB Tools GUI

*[Version française](README.md)*

**Cross‑platform** graphical tool for the **Turbo EverDrive Pro / Core**
cartridge (PC‑Engine / TurboGrafx‑16), built with a **Rust** backend and a
**Tauri** (WebView) interface.

It lets you manage files on the SD card, launch ROMs, reset the console,
capture the menu screen and read the cartridge's status — all connected
through **USB serial** (CDC).

<p align="center">
  <img src="images/IMG_3311.png" width="266" alt="GAMES tab — category list (Recalbox-style)" />
  <img src="images/IMG_5546.png" width="266" alt="GAMES tab — boxart mosaic for a category" />
  <img src="images/IMG_9782.png" width="266" alt="Game detail sheet, with in-game snapshot" />
</p>

> ⚠️ **Version 0.1.1‑alpha — status: M2.** Protocol, GUI, SD listing,
> asynchronous transfers with progress bar, and the memory viewer are
> implemented. Validation on real hardware requires the cartridge's **OS
> menu** to be displayed and the console powered on (see [Hardware
> verification](#hardware-verification)).
>
> The version shown in the app (bottom of the sidebar) and by
> `edlink-emulator --version` includes the git hash and the date: it is
> regenerated on every build (`crates/*/build.rs`). A `+` after the hash
> flags a modified working tree. Single version number: `version` in
> [`Cargo.toml`](Cargo.toml) (`[workspace.package]`).

## Download

Ready-to-use builds (no GitHub release yet — archives are tracked directly
in the repository under [`downloads/`](downloads)):

| Platform | Archive | Contents |
|---|---|---|
| Windows x64 | [`edlink-app-win64.zip`](downloads/edlink-app-win64.zip) | GUI + CLI |
| macOS Intel | [`edlink-app-macos-intel.zip`](downloads/edlink-app-macos-intel.zip) | GUI + CLI + emulator |
| macOS Apple Silicon | [`edlink-app-macos-arm64.zip`](downloads/edlink-app-macos-arm64.zip) | GUI + CLI + emulator |
| Linux x64 | [`edlink-tools-linux-x64.tar.gz`](downloads/edlink-tools-linux-x64.tar.gz) | CLI + emulator only — the GUI needs `webkit2gtk`/GTK3, unavailable when cross-compiling from macOS (see the archive's `README.txt` to build it yourself on Linux) |

Each archive ships its own `README.txt` with installation instructions
(including, on macOS, how to lift the Gatekeeper block on an unsigned
binary) and [`GUIDE_UTILISATEUR.en.md`](docs/GUIDE_UTILISATEUR.en.md) (user
guide).

---

## Table of contents

- [Download](#download)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Build & run](#build--run)
- [Usage](#usage)
- [Full user guide](docs/GUIDE_UTILISATEUR.en.md)
- [Hardware verification](#hardware-verification)
- [QA test checklist](#qa-test-checklist)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Role of AI in this project](#role-of-ai-in-this-project)
- [Contributors](#contributors)
- [Repository](#repository)
- [References](#references)

---

## Features

| Feature | Description |
|---|---|
| **Connection** | Automatic detection of the cartridge's serial port (or manual choice) |
| **Cartridge info** (`devinf`) | Name, serial number, versions, counters, voltages |
| **SD Card** (tab) | Explorer; drag-and-drop upload and download of files via the cartridge's FatFs protocol, with a progress bar; right-click a file → context menu (Play, Rename, Download, Delete) |
| **GAMES** (🕹️ tab, below Connection) | Two-level browser anchored on a configurable base folder (default `sd:/GAMES`, persisted): a colorful list of subfolders (categories, e.g. Action/RPG/Platformer) in a Recalbox-like style, plus two virtual categories — **Favorites** (always present: games marked ♡/♥ in their detail sheet, regardless of their folder) and **GAMES** (shows up only when the base folder has no category subfolder, for direct access to ROMs placed at the root) — then a mosaic of the category's ROMs (background tinted with the category's color) with boxart from either **online** ([Libretro Thumbnails](https://github.com/libretro-thumbnails), exact match then fuzzy search with a score, ⚙ to fix manually, requires internet) or a **local** source (a user-chosen `DB_Thumbnails` folder — same matching algorithm, offline, `Named_Boxarts`/`Named_Snaps`/`Named_Titles` structure); clicking a game opens a detail sheet (size, title screen and in-game snapshot alternating every 2s, ♡/♥ favorite button) with "Play" and "Download" |
| **Launch a game** (`run`) | Deploys the ROM to the SD card (`sd:/usb-games/`) then launches it |
| **Reset** | Resets the console |
| **Screen capture** | Captures the cartridge's menu (VRAM + palette → PNG) |
| **Memory viewer** (read-only) | HuCard RAM via `memrd`; VRAM/CRAM via the menu's `*v` snapshot |
| **Sprites / VRAM tiles** | Sheet of 4bpp cells decoded from VRAM: 8×8 (background) or the VDC's 6 sprite sizes (16×16 to 32×64), palette choice, zoom, click (or drag for a range) → VRAM address + pattern number; "🔒 Lock" crops the view to just the selection; PNG export of the whole sheet or just the selection |
| **Mobile access** (Connection tab) | Small local web server (Start/Stop button) giving access, from a smartphone's browser on the same Wi-Fi network, to a simplified version of the GAMES tab: categories, boxart mosaic, launching a game. Address shown as text + a scannable QR code. No authentication — trusted local network only |

## Architecture

```
Turbo Everdrive USB Tools GUI/
├── Cargo.toml                 # Rust workspace (single version number)
├── crates/
│   ├── edlink-core/           # EverDrive protocol (library, no GUI)
│   │   └── src/
│   │       ├── link.rs        #   serial layer (discovery, frames, endianness)
│   │       ├── ted.rs         #   Turbo EverDrive driver (high-level operations)
│   │       ├── protocol.rs    #   command codes
│   │       ├── image.rs       #   VRAM → PNG
│   │       └── error.rs       #   errors
│   ├── cli/                   # validation CLI for real hardware
│   ├── emulator/               # virtual TED Pro emulator (hardware-less testing)
│   │   └── src/
│   │       ├── main.rs        #   CLI (--sd, --device pro|core)
│   │       ├── pty.rs         #   pseudo-terminal = virtual serial port
│   │       ├── sd.rs          #   virtual SD card (local folder)
│   │       └── device.rs      #   EverDrive protocol responder
│   └── app/                   # Tauri application (backend + web frontend)
│       ├── src/lib.rs         #   Tauri commands exposed to the frontend
│       ├── frontend/          #   web interface (HTML/CSS/JS, retrowave theme)
│       ├── tauri.conf.json
│       └── capabilities/
├── reference/edlink/          # official krikzz/edlink source (MIT), cloned
├── docs/                      # detailed documentation
│   └── qa-checklist.html      #   standalone QA test checklist (see below)
└── scripts/gen_icon.py        # icon generator
```

The protocol is a **Rust port** of the official
[krikzz/edlink](https://github.com/krikzz/edlink) reference (MIT), not a
"best guess" reimplementation: the correspondence with each C# file is
documented in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Requirements

- **Rust** (stable) + Cargo
- **Tauri CLI**: `cargo install tauri-cli`
- macOS: Xcode Command Line Tools; Linux: WebKitGTK dependencies; Windows: nothing extra

## Build & run

```bash
# 1. Build the protocol library
cargo build -p edlink-core

# 2. Run the GUI (dev mode)
cd crates/app
cargo tauri dev

# 3. (Optional) Produce an installable bundle
cd crates/app
cargo tauri build
```

### Validation CLI

The `edlink-cli` binary remains useful to test the protocol without a GUI:

```bash
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX devinf
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX ls "sd:/GAMES"
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX cp local.pce "sd:GAMES/local.pce"
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX run "sd:GAMES/local.pce"
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX mv "sd:GAMES/old.pce" "sd:GAMES/new.pce"
cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX rm "sd:GAMES/new.pce"

# Capture the raw serial frame (protocol validation on real hardware):
EDLINK_TRACE=1 cargo run -p edlink-cli -- --port /dev/cu.usbmodemXXXX ls "sd:/GAMES"
```

> On macOS, use the **`/dev/cu.*`** (call-up) port, not `/dev/tty.*`, which
> waits for a *carrier* signal the cartridge never sends.

## Virtual emulator (no hardware needed)

The `edlink-emulator` crate simulates a **Turbo EverDrive Pro / Core** on a
**virtual serial port (PTY)**: the application connects to it exactly as it
would to a real cartridge. The **SD card is a local folder**, and the
virtual device reproduces the protocol's commands, responses, states and
errors (identity, info, voltages, memory, the menu's `*v`/`*i`/`*s` FIFO,
FatFs file operations, reset).

```bash
# Launch the emulator (default SD card = ~/SD_PCE, PRO model)
cargo run -p edlink-emulator -- --device pro

# Different folder / model: --sd <folder> [--device pro|core]
cargo run -p edlink-emulator -- --sd /tmp/emu_sd --device pro
```

At startup, the virtual port's path is printed (e.g. `/dev/ttys001`).
Connect to that path:

```bash
# CLI
./target/debug/edlink-cli --port /dev/ttys001 devinf
./target/debug/edlink-cli --port /dev/ttys001 screen menu.png

# GUI: Connection tab → "Manual port (emulator / PTY)" field
#   enter /dev/ttys001 then click Connect
```

> ℹ️ On macOS, this port does **not** show up in the automatic dropdown list
> (`serialport`'s IOKit scan only enumerates USB devices): use the
> **manual port** field instead. On the `edlink-core` side, opening the port
> automatically retries at baud rate 0 when the baud setting fails on a PTY,
> so it works unambiguously.

The emulator stays active after each disconnection (like a plugged-in
cartridge) and resets its state per session. Useful commands:

| Command | Emulated behavior |
|---|---|
| `devinf` | Cartridge info (serial `TEDP…`, versions, voltages `05.00/02.50/01.20`) |
| `ls` | Lists a folder on the virtual SD card (`CMD_F_DIR_OPN`/`DIR_RD`) |
| `cp` | Reads/writes in the local folder (virtual SD card), handles subfolders |
| `run` | Copies the ROM to `sd:/usb-games/`, loads it into RAM0, "launches" it |
| `screen` | Returns a 320×224 PNG (color gradient = the virtual "menu") |
| `memrd` | Reads RAM0 (pattern or loaded ROM) and other zones |
| `reset` | Resets the console (menu state) |

## Usage

*Quick summary below — for a step-by-step guide aimed at the end user
(installation, each tab in detail, common troubleshooting), see
[`docs/GUIDE_UTILISATEUR.en.md`](docs/GUIDE_UTILISATEUR.en.md).*

1. Plug the cartridge in via USB and display the cartridge's **OS menu**.
2. Launch the app then click **Connect** (the port is auto-detected).
3. **GAMES** tab: base folder `sd:/GAMES` by default (⚙ to change it) —
   categories = its subfolders (plus virtual categories **GAMES**, if the
   root has no subfolder, and **Favorites**, always present); click a
   category → mosaic of ROMs with boxart; click a game → detail sheet
   (♡/♥ favorite, Play, Download).
   - **Configuring the boxart source** (dropdown at the top of the tab):
     - **🌐 Network (Libretro)** — the default, no setup needed (just an
       internet connection).
     - **💾 Local (DB_Thumbnails)** — click the **📁** button that appears
       next to the dropdown, then choose a folder that **directly**
       contains (no intermediate subfolder) images in the
       libretro-thumbnails format:
       ```
       DB_Thumbnails/
        ├─ Named_Boxarts/<Title> (Region).png
        ├─ Named_Snaps/<Title> (Region).png
        └─ Named_Titles/<Title> (Region).png
       ```
       Until a folder is chosen, a banner reminds you and no boxart is
       looked up.
4. **SD Card** tab: browse the card, drop files to upload them (progress
   bar), double-click to download, **right-click** a file for
   Play/Rename/Download/Delete.
5. **Play** tab: **Choose and launch…** deploys then launches the ROM.
6. **Capture screen** shows the cartridge's menu (PNG format).
7. **Memory** tab: HuCard RAM (via `memrd`), VRAM/CRAM (`*v` snapshot, menu
   displayed).
8. **Sprites** tab: sheet of tiles decoded from VRAM; choose the cell size
   (8×8 background, or 16×16 to 32×64 for the VDC's 6 sprite sizes), the
   palette and the zoom; click a cell for its VRAM address and pattern
   number, or **drag** to select a range — the PNG export then only saves
   the chosen area. "🔒 Lock" crops the view to just that selection (the
   rest of VRAM disappears): handy for watching the same sprite across
   repeated "🔄 Capture" clicks (e.g. an animation). The selection stays on
   the **same VRAM area** even when changing the cell size or the number of
   columns (recomputed in the new grid). "✕ Selection" or <kbd>Esc</kbd>
   clears everything and returns to the full sheet.

## Hardware verification

The cartridge's USB link is only active while the card's **(OS) menu** is
displayed on screen, with the console powered on. If no bytes are received
(`probe` test), check:

- that the console is on and the EverDrive menu is visible;
- that the right port is used (`/dev/cu.*` on macOS);
- that the USB cable is a **data** cable (not charge-only).

```bash
# Raw connectivity test: should print "total bytes received: N" (N>0)
./target/debug/edlink-cli --port /dev/cu.usbmodemXXXX probe
```

## QA test checklist

[`docs/qa-checklist.html`](docs/qa-checklist.html) is a **standalone**
validation form (local file, no dependencies, no network) to open in a
browser — handy to have someone test a build without Rust/Cargo installed
(e.g. a Windows tester who just gets the zip). Reuses the app's "retrowave"
palette.

- Test grid by section (Connection, SD Card, Play, Memory, Sprites,
  General): status ☐ / ✅ / ❌ / ➖ + comment per row, sticky progress bar.
- **📎 Screenshot per row** — resized (≤ 1400 px) and re-encoded as JPEG in
  the browser, preview by clicking the thumbnail; **💾 Download as .zip**
  bundles every attached screenshot into a single file (homemade ZIP
  writer, no dependency).
- **📝 Generate Markdown** produces a report ready to paste into an email
  (test info, summary, results table, notes, list of screenshots).
- Automatic save in the browser (`localStorage`); nothing is sent anywhere.

## Known limitations

- ⚠️ **Memory, Screen Capture and Sprites tabs: not yet stable on real
  hardware.** These three features read the console's bus/video memory
  while it's running (see above); on some cartridges or configurations,
  this can **crash the running game** on the console (return to the menu,
  or even a freeze requiring a reset). Use them carefully during an
  ongoing session, and expect to have to reset the console from time to
  time.
- **SD folder listing**: `CMD_F_DIR_OPN` / `CMD_F_DIR_RD` are wired by
  neither `edlink` nor `turbolink.exe` (no official tool exposes an `ls`).
  Protocol confirmed by IL disassembly of `turbolink.exe` (initial bug
  found and fixed: `CMD_F_DIR_RD` expects a `u16` argument that wasn't
  being sent) — see `docs/PROTOCOL.md`. Works on the emulator; to be
  reconfirmed on real hardware.
- **"Games" view**: assumes a `<base folder>/<Category>/<ROM>` tree (e.g.
  `sd:/GAMES/Action/Game.pce`). If the base folder has no category
  subfolder at all, a virtual **GAMES** category shows up automatically to
  give direct access to ROMs placed at the root; once at least one real
  subfolder exists, a file placed directly at the root without a category
  only shows up in the SD Card tab's List/Icon view. A virtual **Favorites**
  category (games marked ♡/♥ in their detail sheet) is always present at
  the top of the list, regardless of the base folder's contents. The base
  folder, favorites and boxart mappings are remembered in the embedded
  browser's local storage (persists across app launches, specific to the
  machine).
- **Boxart**: two sources to choose from (selector in the GAMES tab):
  - **Online** — name matching between the ROM file (often in GoodTools/
    TOSEC convention, e.g. "Game (U).pce") and the Libretro Thumbnails
    database (No-Intro convention, "Game (USA).png"), in two steps: first a
    few known region-code substitutions (100% confidence), then as a
    fallback a **closest match search** across the repository's full index
    (downloaded once via the GitHub API, cached indefinitely) — a match is
    accepted from 80% text similarity upward. Requires an internet
    connection (HTTPS requests to
    `raw.githubusercontent.com`/`api.github.com` from the Rust backend,
    never from the cartridge/serial port); results are cached locally (the
    app's cache folder) after the first attempt, including failures.
  - **Local** — same matching algorithm, but read directly from a
    user-chosen `DB_Thumbnails` folder on disk (📁 button), with the
    structure `DB_Thumbnails/Named_Boxarts|Named_Snaps|Named_Titles/<No-Intro title>.png`
    (no per-system subfolder: the app only handles PC-Engine/SuperGrafx).
    Works fully offline; handy for cloning a libretro-thumbnails repository
    once locally (keeping only these three folders, flattened, without the
    source repository's `NEC_-_PC_Engine_-_TurboGrafx_16`/
    `NEC_-_PC_Engine_SuperGrafx` level).
  - In both modes: below the threshold, or out of caution, the detail sheet
    shows the title found and its score when it isn't an exact variant. To
    fix a game that wasn't found or was matched wrong: the ⚙ button on its
    thumbnail (mosaic) lets you manually associate the exact title as it
    appears in the database — the mapping is remembered (local storage).
- **TED Pro is not RTC-compatible** via `edlink` (`RtcSet`/`RtcCal` raise
  `UnsupportedCmd`): the RTC isn't exposed.
- **Memory read (`memrd`) = cartridge bus**: on real hardware, every read
  from the *Memory* view briefly freezes the PC-Engine CPU (time
  proportional to size). It switches to a conservative mode outside the
  emulator (small blocks, no auto-read). The *VRAM / CRAM* views use the
  menu's `*v` snapshot (like the screen capture) and remain available
  everywhere the menu is displayed. See `docs/PROTOCOL.md`.
- **Serial port failure recoverable only by reconnecting**: an I/O error
  can leave the serial port unusable for the rest of the session (observed
  on real hardware). The app detects this case (a "connection lost"
  message) and automatically switches back to "Disconnected" rather than
  repeating the same error in a loop — just click **Connect** again.
- Not tested on hardware while the OS menu isn't reachable.

## Roadmap

- **M1 ✅** Foundations: workspace, protocol, CLI, Tauri app, retrowave
  frontend, connection, info, transfers, run, reset, capture, memrd.
- **M2 ✅** SD listing via `CMD_F_DIR_*`; asynchronous transfers (dedicated
  thread, responsive UI) + progress bar; memory viewer (RAM in conservative
  mode on hardware, VRAM/CRAM via `*v`); VRAM tile sheet (sprites);
  emulator/hardware detection; build version injected at compile time;
  standalone QA test checklist (`docs/qa-checklist.html`); full FR/EN/DE/ES
  localization of the GUI; choice of boxart source (online Libretro
  Thumbnails or a local `DB_Thumbnails` folder); virtual GAMES (root with no
  subfolder) and Favorites categories.
- **M3** Full HuCard save/load (via `memrd`/`memwr`), USB speed tests
  (`usbspd`), diagnostics (`diag`).
- **M4** Final packaging/icons, continuous integration, cross-platform
  validation.

## Role of AI in this project

This project grew out of a **specification** written and developed by Eddy in
collaboration with a **local AI** (DeepSeek V4 Flash). The first major hurdle
was understanding how to access the EverDrive's **SD card reader**: despite
extensive exchanges with **Claude** (Anthropic), neither of these two AIs
managed to read the SD card correctly.

It ultimately took **reverse engineering of the `turbolink.exe` executable**,
carried out with the help of **ChatGPT**, to unblock the problem: the
disassembly revealed the protocol's missing pieces (notably the `u16` argument
expected by `CMD_F_DIR_RD`, see `docs/PROTOCOL.md`), making proper **SD card
read/write** interrogation possible.

AI therefore played a decisive and complementary role: help with architecture
and development, protocol exploration and analysis of the proprietary binary —
each one bringing a different perspective on a problem none of them would have
solved on their own.

## Contributors

- **Eddy (beddy70)** — author: specification, development and reverse
  engineering.
- **Cline** — contributing AI assistant: code generation and refactoring,
  documentation and review.
- **DeepSeek V4 Flash** — local AI: specification drafting and initial
  development.

## Repository

- `git@github.com:beddy70/USB-Tools-GUI.git`

## References

- [krikzz/edlink](https://github.com/krikzz/edlink) — official reference (MIT)
- [Tauri](https://tauri.app) — application framework
- [serialport (Rust)](https://crates.io/crates/serialport) — serial port access

## License

MIT — this project is a port of the [`krikzz/edlink`](https://github.com/krikzz/edlink)
protocol (MIT). The *EverDrive*, *Turbo EverDrive* trademarks belong to
their respective owners.
