# edlink-emulator — Virtual Turbo EverDrive Emulator (Pro / Core)

*[Version française](README.md)*

Software emulator of a **Turbo EverDrive Pro / Core** to develop and test the
tool (`edlink-cli`, Tauri interface) **without hardware**.

It creates a **virtual serial port (PTY)** that `edlink-cli` (or the GUI)
connects to just like a real device. The **SD card** is represented by a
**local folder**, and ROM memory can be served by a **host PC-Engine emulator
(GearGraFX)** via the MCP protocol.

---

## Contents

- [Building](#building)
- [Usage](#usage)
- [Connecting with `edlink-cli`](#connecting-with-edlink-cli)
- [Virtual SD card](#virtual-sd-card)
- [Supported protocol commands](#supported-protocol-commands)
- [MCP mode (GearGraFX)](#mcp-mode-geargrafx)
- [Tests](#tests)
- [Limits](#limits)

---

## Building

```bash
cargo build -p edlink-emulator
```

The binary is produced at `target/debug/edlink-emulator`.

---

## Usage

```text
edlink-emulator [--sd <folder>] [--device pro|core]
               [--MCP_EMU <ip>] [--MCP_PORT <port>] [--MCP_TOKEN <token>]

Options:
  --sd <folder>         Local folder acting as the virtual SD card
                        (default: ~/SD_PCE)
  --device <type>       pro | core  (default: pro)
  --fake-hardware      Pretend to be real hardware (SYS_INF header):
                        tests the memory viewer's conservative mode.
  --MCP_EMU <ip>        Address of the PC-Engine emulator's MCP server
                        (GearGraFX). When present, ROM memory is read
                        from the host's ROM area instead of the local
                        virtual RAM.
  --MCP_PORT <port>     Host's MCP HTTP port (default: 7000)
  --MCP_TOKEN <token>   MCP Bearer token (required if the host listens
                        outside loopback)
  -V, --version        Print the version (crate + git hash + date) and exit
  -h, --help            Print help
```

Example:

```bash
./target/debug/edlink-emulator --device pro
```

At startup, the emulator prints the virtual port's path, for example:

```text
=== Turbo EverDrive PRO — virtual emulator v0.1.1-alpha (a1b2c3d, 2026-08-27) ===
Virtual SD card: /Users/eddy/SD_PCE
Virtual serial port: /dev/ttys003

>> Connect the tool to this port (manual port field)
>>   or: edlink-cli --port /dev/ttys003 devinf
```

> **macOS note**: this port does not show up in the automatic dropdown list
> (IOKit only enumerates USB devices); **manual entry** is required.

---

## Connecting with `edlink-cli`

```bash
edlink-cli --port /dev/ttys003 devinf     # identity + cartridge info
edlink-cli --port /dev/ttys003 cp toto.bin sd:usb-games/   # send a file
edlink-cli --port /dev/ttys003 run 'sd:usb-games/Game.pce'  # install + launch
edlink-cli --port /dev/ttys003 reset      # reset the console
edlink-cli --port /dev/ttys003 memrd 0 16 # memory read
```

---

## Virtual SD card

The SD card is a **local folder** (`--sd`, default `~/SD_PCE`). The
protocol's "device" paths (e.g. `/GAMES/game.pce`, `usb-games/game.pce`) are
resolved **relative to this root folder**, and can never escape it (`..`
segments are ignored). Parent folders are created on the fly on writes.

So a game sent to `sd:usb-games/Game.pce` is physically written to
`<root>/usb-games/Game.pce`.

---

## Supported protocol commands

The emulator faithfully responds to what `edlink-core` sends:

| Domain | Details |
|---------|---------|
| Identity / status | `STATUS2`, `STATUS`, `SYS_INF`, `GET_VDC` (id `PRO=0x20`, `CORE=0x26`) |
| Memory | `MEM_RD`, `MEM_WR` (RAM0/RAM1, CFG register, OS menu FIFO) |
| SD files | `F_OPN`, `F_RD`, `F_WR`, `F_CLOSE`, `F_AVB`, `F_DIR_OPN`, `F_DIR_MK` |
| Reset | `HOST_RST` (simple or "reset to menu" with a `'r'` announcement) |
| OS menu FIFO | `*v` (VRAM+CRAM snapshot — screen capture, VRAM/CRAM views, sprite sheet), `*i` (install a game), `*s` (launch the game) |

---

## MCP mode (GearGraFX)

With `--MCP_EMU`, the emulator connects to the **MCP** (Model Context
Protocol) server of GearGraFX, the host PC-Engine emulator. The flow then
becomes:

1. **Install a game** (`*i`) → the emulator calls the MCP tool `load_media`
   with the absolute path of the file on the virtual SD card. GearGraFX
   loads the ROM/CD, which makes a **"ROM" memory area** appear.
2. **Launch the game** (`*s`) → the emulator calls `debug_continue` so the
   game **actually runs** (GearGraFX stays paused after a `load_media`).
3. ROM reads (`MEM_RD`) are then served from **GearGraFX's ROM area**
   instead of the local virtual RAM.

Every MCP tool call is traced on **stdout** (`[MCP] tool: …`).

If loading fails (file not found, server unavailable), the emulator stays
on the **virtual RAM fallback**: reading/writing keeps working locally.

```bash
# Start GearGraFX (host side) with the MCP HTTP server:
./geargrafx --mcp-http --mcp-http-port 7000

# Then the TED emulator plugged into it:
./target/debug/edlink-emulator --MCP_EMU 127.0.0.1 --MCP_PORT 7000
```

---

## Tests

```bash
cargo test -p edlink-emulator
```

Tests cover in particular the MCP client (handshake, ROM read, reset,
`load_media` with cache invalidation, `debug_continue`), via a fake MCP
server.

---

## Limits

- **Partial** emulation of the EverDrive protocol: only what the tool needs
  (identity, info, memory, files, reset, menu FIFO). Advanced hardware
  features (MCU Mode, FPGA update, etc.) are not simulated.
- The PTY port isn't auto-enumerated on macOS (manual entry).
- In MCP mode, the virtual SD card and the GearGraFX server must have access
  to the **same absolute path** for `load_media` to find the sent file.

---

_MIT license — "Turbo Everdrive USB Tools GUI" project._
