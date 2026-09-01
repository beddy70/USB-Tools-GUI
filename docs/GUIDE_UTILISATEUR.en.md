# User Guide — Turbo Everdrive USB Tools GUI

*[Version française](GUIDE_UTILISATEUR.md)*

This guide is aimed at the app's user, not the developer (for the technical
architecture, the protocol, or building it, see [`README.md`](../README.md)
/ [`README.en.md`](../README.en.md), [`docs/PROTOCOL.md`](PROTOCOL.md) and
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md)).

## Contents

1. [What you need](#what-you-need)
2. [Installation (Windows)](#installation-windows)
3. [First launch and connection](#first-launch-and-connection)
4. [GAMES tab](#games-tab)
5. [Mobile access](#mobile-access)
6. [SD Card tab](#sd-card-tab)
7. [Play tab](#play-tab)
8. [Memory tab](#memory-tab)
9. [Sprites tab](#sprites-tab)
10. [Troubleshooting](#troubleshooting)
11. [QA test checklist](#qa-test-checklist)
12. [Frequently asked questions](#frequently-asked-questions)

## What you need

- A **Turbo EverDrive Pro** or **Core** cartridge, plugged into the computer
  via USB (a **data** cable, not a charge-only one).
- A **PC-Engine / TurboGrafx-16** console powered on, with the cartridge
  plugged in and **the cartridge's menu displayed on screen**. This
  matters: the cartridge's USB link only responds while its menu is active
  — not while a game is running (see [Troubleshooting](#troubleshooting)).
- Windows 10/11 64-bit (the WebView2 Runtime is usually already installed;
  otherwise, Windows will offer to install it).

## Installation (Windows)

1. Unzip `edlink-app-win64.zip` into a folder of your choice.
2. Keep all the files together in that same folder (`edlink-app.exe` needs
   `WebView2Loader.dll` next to it).
3. Double-click `edlink-app.exe`.

The folder also contains:
- `edlink-cli.exe` — the command-line version (see `READ-ME.txt` for its
  commands), useful for advanced troubleshooting.
- `qa-checklist.html` — a test checklist to open in a browser, see
  [QA test checklist](#qa-test-checklist).

## First launch and connection

1. Open the application. The **🔌 Connection** tab is shown.
2. Choose the serial port from the dropdown list (EverDrive cartridges
   usually show up automatically), or leave it on automatic mode.
3. Click **Connect**.
4. Once connected, the banner in the top right turns green ("Connected")
   and an info card shows the cartridge's name, version, etc.

If nothing connects, see [Troubleshooting](#troubleshooting).

## GAMES tab

The **🕹️ GAMES** tab is the fastest way to find and launch a game: a list
of colorful arcade-cabinet-style categories, then a mosaic of boxart.

### Organizing your games

The tab expects this folder tree on the SD card:

```
sd:/GAMES
 ├─ Action
 │   ├─ Bloody Wolf (U).pce
 │   └─ ...
 ├─ RPG
 │   └─ ...
 └─ Platformer
     └─ ...
```

Each **top-level subfolder** of `sd:/GAMES` becomes a category; the ROM
files (`.pce`, `.sgx`, `.rom`, `.bin`) it contains show up in its mosaic.

If `sd:/GAMES` (or your base folder) **has no subfolder at all**, a virtual
**GAMES** category shows up automatically in the list to give direct access
to ROMs placed at the root — no need to create a subfolder for just one or
two games. Once at least one real category exists, a file left at the root
without a subfolder only shows up in the **SD Card** tab (List/Icon view).

A virtual **❤️ Favorites** category is always present at the top of the
list, regardless — see [below](#favorites).

The base folder doesn't have to be `sd:/GAMES`: click **⚙ Change games
folder** at the top of the tab to point to another path (e.g. `sd:/ROMS`).
This choice is remembered on this computer.

### Navigating

- Click a **category** → its mosaic of games is shown, with each game's
  boxart when found.
- **← Categories** at the top of the mosaic goes back to the list.
- Click a **game** → its detail sheet opens: file size, path on the card,
  title screen and in-game snapshot (when found — they alternate
  automatically every 2 seconds), a **♡/♥** (favorite) button, **▶ Play**
  and **⬇ Download** buttons.
- **Right-click** a mosaic thumbnail opens the same context menu as in the
  SD Card tab (Play, Rename, Download, Delete).

### Favorites

In a game's detail sheet, the **♡** button (top, next to the close cross)
adds it to favorites — it turns into **♥**. Click it again to remove it.

These games are then grouped under the virtual **❤️ Favorites** category, at
the top of the GAMES tab's category list — handy for finding your favorite
games without remembering which category they're filed under. The
favorites list is remembered on this computer (the embedded browser's local
storage); renaming or deleting a game from the context menu keeps this list
up to date automatically.

### Boxart

Two boxart sources are available, chosen from the dropdown at the top of
the tab:

- **🌐 Network (Libretro)** — the default. Boxart comes from the community
  [Libretro Thumbnails](https://github.com/libretro-thumbnails) database:
  this needs an internet connection (only to download images — never to
  talk to the cartridge), and results are cached on the computer so the
  network is never hit twice for a game already seen.
- **💾 Local (DB_Thumbnails)** — reads images directly from a folder of your
  choice, no internet needed. Click the **📁** button that appears next to
  the dropdown to choose that folder; until a folder is chosen, a warning
  message is shown and no boxart is looked up. The folder must directly
  contain (no intermediate subfolder) images in the Libretro Thumbnails
  repository format:
  ```
  DB_Thumbnails/
   ├─ Named_Boxarts/<Title> (Region).png   ← boxart
   ├─ Named_Snaps/<Title> (Region).png     ← in-game snapshot
   └─ Named_Titles/<Title> (Region).png    ← title screen
  ```
  (the `Named_Logos` folder seen in some repositories isn't used by the
  application). The simplest approach is to grab these three folders from a
  PC-Engine/SuperGrafx Libretro Thumbnails repository and flatten them into
  `DB_Thumbnails`, without keeping the source repository's subfolder.

In both modes, the match between the ROM file's name and the name used by
the database isn't always exact (different naming conventions): when it's
only an **approximate** match, a percentage badge appears on the thumbnail
and in the detail sheet. Below a certain similarity threshold, or if no
match is found, the thumbnail stays without boxart.

**To fix missing or wrong boxart**: hover the thumbnail in the mosaic,
click the small **⚙** button that appears, and enter the exact title as it
appears in the chosen database (without the extension). It's remembered
for next time.

## Mobile access

In the **🔌 Connection** tab, the **📱 Mobile access** card lets you reach a
simplified version of the GAMES tab (categories, boxart mosaic, launching a
game) from a smartphone's browser connected to the **same Wi-Fi network**
as the computer.

1. Click **▶ Start**. A QR code and an address (e.g.
   `http://192.168.1.23:4590`) appear.
2. On the phone, scan the QR code with the camera, or type the address into
   a browser.
3. The mobile page shows the same categories as the computer, including the
   virtual **GAMES** (root with no subfolder — see [GAMES tab](#games-tab))
   and **❤️ Favorites** categories, and the same boxart (network or local,
   depending on the source chosen on the computer). Tapping a game opens
   its detail sheet (boxart, title screen/in-game snapshot alternating, a
   ♡/♥ button) before launching it.
4. The **♡/♥** button on the detail sheet adds or removes that game from
   favorites — **shared live with the computer**: a game favorited from
   the phone shows up immediately in the desktop's Favorites category, and
   vice versa.
5. **⏹ Stop** closes the server — no one can access it anymore.

> ⚠️ **No authentication.** This server is meant for a trusted home Wi-Fi
> network: anyone on that network can access it while it's running, and it
> must **never** be exposed on the Internet (no port forwarding on your
> router). Turn it off when you're not using it.

**Limits of the mobile version** (intentionally simpler than the desktop):
no changing the games folder or boxart source from the phone — those
settings stay whatever is configured on the computer; no ⚙ button to
manually fix a boxart that wasn't found. Connecting to the cartridge (USB)
always happens from the computer, never from the phone.

## SD Card tab

The **📤 SD Card** tab is a classic file explorer.

- **⬆** goes up to the parent folder, **⟳** refreshes, **▦ / ☰** switch
  between icon view and list view.
- **📂 Import…** sends a file from your computer to the currently displayed
  folder.
- **Drag and drop** one or more files directly into the window to send
  them.
- **Double-click** a ROM file to launch it directly on the console;
  double-click a folder to open it.
- **Right-click** a file opens a menu:
  - **▶ Play** — deploys and launches the ROM;
  - **✏️ Rename…** — note: there is no native rename in the cartridge's
    protocol: this operation fully copies the file under the new name then
    deletes the original (a bit slower than a real rename on a large ROM);
  - **⬇ Download…** — saves the file to your computer;
  - **🗑 Delete** — removes the file from the card (asks for confirmation).

## Play tab

A simple shortcut: **Choose and launch…** opens a file picker on your
computer, sends the chosen ROM to the SD card then launches it — in a
single step, without needing it to already be on the card.

**🔄 Reset console** restarts the console (useful if a game crashes or to
get back to the cartridge's menu).

**Capture screen** shows an image of the cartridge's menu (not of a running
game — see [Troubleshooting](#troubleshooting)).

> ⚠️ **Screen capture, the Memory tab and the Sprites tab are not yet
> stable on real hardware**: these features read the console's bus or
> video memory while it's running, which can **crash the running game** on
> some cartridges (return to the menu, or even a freeze). Use them
> carefully during an ongoing game, and don't hesitate to reset the console
> if needed.

## Memory tab

Read-only viewer of the cartridge's memory.

- **RAM**: on real hardware, every read briefly interrupts the console (it
  shares the same bus) — so the tab switches to a cautious mode: small
  blocks, only on demand via **Refresh**, never continuous automatic
  reading.
- **VRAM / CRAM**: a snapshot taken via the cartridge's menu (like the
  screen capture) — so **the cartridge's menu must be displayed**, not a
  running game.

## Sprites tab

Sheet of tiles decoded from VRAM (requires, as above, that the cartridge's
menu be displayed).

- Choose the **cell size**: 8×8 (background only) or one of the VDC's 6
  real sprite sizes (16×16 to 32×64), the **palette** and the **zoom**.
- Click a cell to see its VRAM address and pattern number.
- **Drag** to select a rectangle of cells; the PNG export then only saves
  that selection.
- **🔒 Lock** crops the display to just the selection (the rest of VRAM
  disappears) — handy for tracking the same sprite across several captures
  (e.g. an animation): the selection stays on the same area even if you
  change the cell size or the number of columns.
- **✕ Selection** (or the <kbd>Esc</kbd> key) clears the selection and
  returns to the full sheet.

## Troubleshooting

**Nothing connects / the port doesn't show up**
- Check that the console is on and that **the cartridge's menu is properly
  displayed on screen**.
- Check that the USB cable carries data (not a "charge-only" cable).
- Retry **Connect** — simply unplugging and replugging the cable is
  sometimes enough to make the port reappear.

**"Connection lost" message during use**
- A communication error made the port unusable for the rest of the session
  (rare, observed on some Windows configurations). The app detects it and
  automatically switches back to "Disconnected" rather than repeating the
  same error in a loop: just click **Connect** again.

**"Capture screen" or the Memory tab (VRAM/CRAM) fail**
- These features read video memory **via the cartridge's menu**: they only
  work while that menu is displayed on screen, never while a game is
  running. Go back to the cartridge's menu (the **Reset console** button if
  needed) then try again.

**The SD Card tab's listing fails (timeout)**
- Protocol still being validated on some cartridges — see
  [`docs/PROTOCOL.md`](PROTOCOL.md) for the exact status and how to send us
  a diagnostic trace if the problem persists for you.

**No boxart shows up in the GAMES tab**
- Check the computer's internet connection (needed only to download
  images, not to talk to the cartridge).
- The game may simply not have a reliable enough match in the database —
  associate it manually via the **⚙** button on its thumbnail (see [GAMES
  tab](#games-tab)).

## QA test checklist

`qa-checklist.html` (shipped next to the application) is a standalone
validation form to open in a browser: no installation, no data sent
anywhere. It lists the points to check after an update (connection,
transfers, memory reading…), with a status and a screenshot per row, and
generates a Markdown report ready to share.

## Frequently asked questions

**Do I need to keep the console powered on the whole time?**
Yes, as long as you're using the application — the cartridge's USB link
depends on the console being powered.

**Can I use the application without an internet connection?**
Yes, including the GAMES tab's boxart by choosing the **💾 Local
(DB_Thumbnails)** source (see above): connecting to the cartridge,
transferring files, screen capture, memory, sprites and favorites all work
entirely offline. Only the **🌐 Network** boxart source needs internet.

**Where are the games folder and boxart mappings stored?**
In the local storage of the browser embedded in the application, specific
to this computer — it doesn't travel with the SD card or with an export.
