//! Réponse au protocole EverDrive côté "périphérique".
//!
//! Reçoit les commandes de l'hôte (`edlink-core`) sur un PTY et répond comme le
//! ferait une vraie Turbo EverDrive Pro / Core : identité, informations système,
//! tensions, lecture/écriture mémoire, FIFO du menu OS (`*v`, `*i`, `*s`),
//! opérations fichiers sur la carte SD virtuelle, reset hôte.
//!
//! Les séquences reproduisent fidèlement ce que `edlink-core` envoie :
//! - initialisation : `STATUS2` puis `STATUS` (2+2 octets), puis `STATUS` seul
//!   (4 octets) pour les requêtes suivantes ;
//! - reset-to-menu (`HOST_RST ON` -> `MEM_WR ADDR_FCI_CFG` -> `HOST_RST OFF`) :
//!   le device annonce `'r'` au reset OFF ;
//! - reset simple (`HOST_RST ON` -> `HOST_RST OFF`, sans écriture config) :
//!   aucun octet renvoyé.

use crate::mcp::McpClient;
use crate::sd::VirtualSd;
use nix::pty::PtyMaster;
use std::io::{self, Read, Write};

pub const PROTOCOL_ID: u8 = 0x02;
pub const DEV_ID_TURBO_PRO: u8 = 0x20;
pub const DEV_ID_TURBO_CORE: u8 = 0x26;

const ADDR_FCI_RAM1: u32 = 0x0000_0000;
const ADDR_FCI_RAM2: u32 = 0x0080_0000;
const ADDR_FCI_CFG: u32 = 0x0180_0000;
const ADDR_FCI_FIFO: u32 = 0x0181_0000;
const SIZE_RAM0: usize = 0x0080_0000; // 8 Mo
const DUMP_ADDR: u32 = 0x0060_0000; // zone tampon du dump d'écran
// Fenêtres dédiées du visualiseur mémoire (adresses libres, hors RAM0/RAM1/CFG/FIFO).
// VRAM = mémoire vidéo du VDC (64 Ko), CRAM = palette du VCE (512 mots = 1024 octets).
const ADDR_VRAM: u32 = 0x0200_0000;
const ADDR_CRAM: u32 = 0x0201_0000;

// Commandes (cf. crates/edlink-core/src/protocol.rs)
const CMD_STATUS: u8 = 0x10;
const CMD_GET_VDC: u8 = 0x13;
const CMD_MEM_RD: u8 = 0x19;
const CMD_MEM_WR: u8 = 0x1A;
const CMD_SYS_INF: u8 = 0x26;
const CMD_HOST_RST: u8 = 0x29;
const CMD_STATUS2: u8 = 0x40;
const CMD_F_DIR_OPN: u8 = 0xC3;
const CMD_F_DIR_RD: u8 = 0xC4;
const CMD_F_FOPN: u8 = 0xC9;
const CMD_F_FRD: u8 = 0xCA;
const CMD_F_FWR: u8 = 0xCC;
const CMD_F_FCLOSE: u8 = 0xCE;
const CMD_F_DIR_MK: u8 = 0xD2;
const CMD_F_AVB: u8 = 0xD5;

const FA_WRITE: u8 = 0x02;
const FA_CREATE_ALWAYS: u8 = 0x08;
const HOST_RST_ON: u8 = 1;

// Attributs / codes FatFs (couche FS du firmware, cf. edlink-core::protocol).
const AM_DIR: u8 = 0x10;
const FR_OK: u8 = 0;
const FR_NO_PATH: u8 = 5;

pub struct Device {
    pub device_id: u8,
    sd: VirtualSd,
    /// Registre de statut renvoyé par `CMD_STATUS` (reflète la dernière
    /// opération fichier).
    status: u8,
    rst_state: u8,
    /// Vrai si un `MEM_WR ADDR_FCI_CFG` a eu lieu depuis le dernier reset ON :
    /// au reset OFF suivant, on annonce `'r'` (séquence "reset to menu").
    cfg_reset_done: bool,
    /// Vrai si un `CMD_STATUS2` vient d'être reçu (le `CMD_STATUS` suivant
    /// répond alors sur 2 octets, pas 4).
    pending_status2: bool,
    open_file: Option<std::fs::File>,
    open_len: u64,
    /// Itérateur du dossier ouvert par `CMD_F_DIR_OPN` ; consommé une entrée à
    /// la fois par `CMD_F_DIR_RD` (comme `f_readdir` côté firmware).
    dir_iter: Option<std::vec::IntoIter<crate::sd::SdEntryData>>,
    fifo_buf: Vec<u8>,
    ram0: Vec<u8>,
    vram: Vec<u8>,
    palette: Vec<u8>,
    dump_addr: u32,
    /// Client MCP vers l'émulateur PC-Engine hôte (GearGraFX) : quand il est
    /// présent, les lectures/écritures de la RAM0 (HuCard) sont servies depuis
    /// la zone ROM de l'hôte au lieu de la RAM virtuelle locale.
    mcp: Option<McpClient>,
    /// Test : si vrai, `CMD_SYS_INF` renvoie un en-tête « matériel » au lieu de
    /// `"TED-EMULATOR"`, pour que l'hôte croie parler à une vraie carte (mode
    /// conservateur du visualiseur mémoire). Activé par `--fake-hardware`.
    fake_hardware: bool,
}

impl Device {
    pub fn new(sd: VirtualSd, device_id: u8, mcp: Option<McpClient>) -> Self {
        // Remplit la RAM d'un motif reconnaissable (visible via mem_rd).
        let mut ram0 = vec![0u8; SIZE_RAM0];
        for (i, b) in ram0.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(31).wrapping_add((i >> 8) as u8);
        }
        let mut dev = Device {
            device_id,
            sd,
            status: 0,
            rst_state: 0,
            cfg_reset_done: false,
            pending_status2: false,
            open_file: None,
            open_len: 0,
            dir_iter: None,
            fifo_buf: Vec::new(),
            ram0,
            vram: vec![0u8; 0x10000],
            palette: vec![0u8; 1024],
            dump_addr: DUMP_ADDR,
            mcp,
            fake_hardware: false,
        };
        dev.gen_menu_image();
        dev
    }

    /// Test : fait passer l'émulateur pour une vraie carte (en-tête `SYS_INF`).
    pub fn set_fake_hardware(&mut self, on: bool) {
        self.fake_hardware = on;
    }

    /// Boucle principale : gère les connexions/déconnexions de l'hôte et
    /// relance une session après chaque déconnexion (l'émulateur est un
    /// "serveur" persistant, comme une vraie carte qui reste branchée).
    pub fn run(&mut self, master: &mut PtyMaster) -> io::Result<()> {
        loop {
            match self.run_once(master) {
                Ok(()) => eprintln!("[emulator] hôte déconnecté, en attente de reconnexion..."),
                Err(e) => eprintln!("[emulator] déconnexion ({e}), en attente de reconnexion..."),
            }
            self.reset_session();
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }

    /// Réinitialise l'état dépendant d'une connexion (un seul hôte à la fois).
    fn reset_session(&mut self) {
        self.status = 0;
        self.rst_state = 0;
        self.cfg_reset_done = false;
        self.pending_status2 = false;
        self.open_file = None;
        self.open_len = 0;
        self.dir_iter = None;
        self.fifo_buf.clear();
    }

    /// Lit et traite les commandes d'un hôte jusqu'à sa déconnexion (EOF).
    fn run_once(&mut self, master: &mut PtyMaster) -> io::Result<()> {
        loop {
            let Some(code) = scan_command(master)? else {
                return Ok(()); // hôte déconnecté (EOF)
            };
            match code {
                CMD_STATUS2 => {
                    println!("[cmd] STATUS2 (handshake)");
                    self.pending_status2 = true;
                    master.write_all(&[0x5A, PROTOCOL_ID])?;
                }
                CMD_STATUS => {
                    println!("[cmd] STATUS");
                    if self.pending_status2 {
                        self.pending_status2 = false;
                        master.write_all(&[self.device_id, self.status])?;
                    } else {
                        master.write_all(&[0x5A, PROTOCOL_ID, self.device_id, self.status])?;
                    }
                }
                CMD_SYS_INF => {
                    println!("[cmd] SYS_INF");
                    master.write_all(&self.sys_info())?
                }
                CMD_GET_VDC => {
                    println!("[cmd] GET_VDC");
                    master.write_all(&self.vdc_bytes())?
                }
                CMD_MEM_RD => {
                    let addr = read_u32(master)?;
                    let len = read_u32(master)? as usize;
                    let _exec = read_u8(master)?;
                    println!("[cmd] MEM_RD addr=0x{addr:08X} len={len}");
                    let data = self.mem_read(addr, len);
                    master.write_all(&data)?;
                }
                CMD_MEM_WR => {
                    let addr = read_u32(master)?;
                    let len = read_u32(master)? as usize;
                    let _exec = read_u8(master)?;
                    if addr == ADDR_FCI_FIFO {
                        println!("[cmd] MEM_WR FIFO len={len}");
                    } else if addr == ADDR_FCI_CFG {
                        println!("[cmd] MEM_WR CFG (reset config)");
                    } else {
                        println!("[cmd] MEM_WR addr=0x{addr:08X} len={len}");
                    }
                    let mut data = vec![0u8; len];
                    master.read_exact(&mut data)?;
                    self.mem_write(master, addr, &data)?;
                }
                CMD_HOST_RST => {
                    let mode = read_u8(master)?;
                    println!("[cmd] HOST_RST mode={mode}");
                    self.host_reset(master, mode)?;
                }
                CMD_F_FOPN => {
                    let mode = read_u8(master)?;
                    let path = read_string(master)?;
                    println!("[cmd] F_FOPN mode={mode:02X} path={path:?}");
                    self.file_open(mode, &path);
                }
                CMD_F_FCLOSE => {
                    println!("[cmd] F_FCLOSE");
                    self.file_close()
                }
                CMD_F_AVB => {
                    println!("[cmd] F_AVB");
                    let lo = (self.open_len as u32).to_le_bytes();
                    master.write_all(&0u32.to_le_bytes())?; // hi
                    master.write_all(&lo)?;
                }
                CMD_F_FRD => {
                    let total = read_u32(master)?;
                    println!("[cmd] F_FRD total={total}");
                    self.file_read(master, total)?;
                }
                CMD_F_FWR => {
                    let total = read_u32(master)?;
                    println!("[cmd] F_FWR total={total}");
                    self.file_write(master, total)?;
                }
                CMD_F_DIR_MK => {
                    let path = read_string(master)?;
                    println!("[cmd] F_DIR_MK path={path:?}");
                    self.dir_make(&path);
                }
                CMD_F_DIR_OPN => {
                    let path = read_string(master)?;
                    println!("[cmd] F_DIR_OPN path={path:?}");
                    self.dir_open(&path);
                }
                CMD_F_DIR_RD => {
                    println!("[cmd] F_DIR_RD");
                    self.dir_read(master)?;
                }
                other => {
                    eprintln!("[emulator] commande inconnue : 0x{other:02X}");
                }
            }
            master.flush()?;
        }
    }

    // ------------------------------------------------------------- mémoire
    fn mem_read(&mut self, addr: u32, len: usize) -> Vec<u8> {
        let mut out = vec![0u8; len];
        // Régions du dump d'écran du menu
        if addr == self.dump_addr && len == self.vram.len() {
            return self.vram.clone();
        }
        if addr == self.dump_addr.wrapping_add(0x10000) && len == self.palette.len() {
            return self.palette.clone();
        }
        // Fenêtres dédiées du visualiseur mémoire : VRAM (VDC) et CRAM (VCE).
        // Lectures partielles autorisées (le visualiseur lit par morceaux).
        if (addr as u64) >= ADDR_VRAM as u64
            && (addr as u64 + len as u64) <= ADDR_VRAM as u64 + 0x10000
        {
            // En mode MCP, on relit **systématiquement** l'état frais de la VRAM
            // auprès de l'hôte (GearGraFX) : le jeu tourne et modifie la VRAM en
            // continu. Sans ce rafraîchissement, un "Rafraîchir" du visualiseur
            // mémoire renverrait l'ancienne capture en cache. Hors MCP, on sert
            // la RAM virtuelle locale (inchangée entre deux captures).
            if self.mcp.is_some() {
                self.refresh_screen();
            }
            let base = (addr - ADDR_VRAM) as usize;
            out.copy_from_slice(&self.vram[base..base + len]);
            return out;
        }
        if (addr as u64) >= ADDR_CRAM as u64
            && (addr as u64 + len as u64) <= ADDR_CRAM as u64 + 1024
        {
            // Même logique que la VRAM : relecture fraîche de la palette (VCE)
            // auprès de l'hôte à chaque lecture de la fenêtre CRAM.
            if self.mcp.is_some() {
                self.refresh_screen();
            }
            let base = (addr - ADDR_CRAM) as usize;
            out.copy_from_slice(&self.palette[base..base + len]);
            return out;
        }
        let end = addr as u64 + len as u64;
        // RAM0 (HuCard chargée / jeu)
        if (addr as u64) >= ADDR_FCI_RAM1 as u64 && end <= ADDR_FCI_RAM1 as u64 + SIZE_RAM0 as u64 {
            if let Some(data) = self.mem_read_ram(addr - ADDR_FCI_RAM1, len) {
                return data;
            }
            let base = (addr - ADDR_FCI_RAM1) as usize;
            out.copy_from_slice(&self.ram0[base..base + len]);
            return out;
        }
        // RAM1 (miroir de RAM0 pour simplifier)
        if (addr as u64) >= ADDR_FCI_RAM2 as u64 && end <= ADDR_FCI_RAM2 as u64 + SIZE_RAM0 as u64 {
            if let Some(data) = self.mem_read_ram(addr - ADDR_FCI_RAM2, len) {
                return data;
            }
            let base = (addr - ADDR_FCI_RAM2) as usize;
            out.copy_from_slice(&self.ram0[base..base + len]);
            return out;
        }
        // Autre adresse : motif dépendant de l'adresse
        for i in 0..len {
            let v = addr as usize + i;
            out[i] = ((v ^ (v >> 8) ^ (v >> 16)) & 0xFF) as u8;
        }
        out
    }

    /// Tente une lecture via le client MCP pour un offset relatif à la banque
    /// RAM0. Retourne `None` si aucun client MCP ou en cas d'erreur (l'appelant
    /// retombe alors sur la RAM virtuelle locale).
    fn mem_read_ram(&mut self, offset: u32, len: usize) -> Option<Vec<u8>> {
        if let Some(mcp) = &mut self.mcp {
            match mcp.read_rom(offset as u64, len) {
                Ok(d) => return Some(d),
                Err(e) => eprintln!("[emulator] MCP read_rom(0x{offset:X}, {len}) : {e}"),
            }
        }
        None
    }

    fn mem_write(&mut self, master: &mut PtyMaster, addr: u32, data: &[u8]) -> io::Result<()> {
        if addr == ADDR_FCI_FIFO {
            self.fifo_buf.extend_from_slice(data);
            self.process_fifo(master)?;
        } else if addr == ADDR_FCI_CFG {
            // écriture du registre de config (config reset) : signale au menu
            // qu'une réinitialisation est en cours
            self.cfg_reset_done = true;
        } else if (addr as u64) >= ADDR_FCI_RAM1 as u64
            && (addr as u64 + data.len() as u64) <= ADDR_FCI_RAM1 as u64 + SIZE_RAM0 as u64
        {
            if let Some(mcp) = &mut self.mcp {
                if let Err(e) = mcp.write_rom((addr - ADDR_FCI_RAM1) as u64, data) {
                    eprintln!("[emulator] MCP write_rom(0x{addr:X}) : {e}");
                }
            }
            let base = (addr - ADDR_FCI_RAM1) as usize;
            self.ram0[base..base + data.len()].copy_from_slice(data);
        }
        Ok(())
    }

    // ----------------------------------------------------- FIFO du menu OS
    fn process_fifo(&mut self, master: &mut PtyMaster) -> io::Result<()> {
        loop {
            if self.fifo_buf.is_empty() {
                break;
            }
            if self.fifo_buf.starts_with(b"*v") {
                // dump d'écran : renvoie l'adresse tampon
                if self.fifo_buf.len() < 2 {
                    break;
                }
                println!("[cmd] FIFO *v (dump écran)");
                self.refresh_screen();
                master.write_all(&self.dump_addr.to_le_bytes())?;
                self.fifo_buf.drain(0..2);
            } else if self.fifo_buf.starts_with(b"*i") {
                // installation d'un jeu : "*i" + u16 len + chemin
                if self.fifo_buf.len() < 4 {
                    break;
                }
                let plen = u16::from_le_bytes([self.fifo_buf[2], self.fifo_buf[3]]) as usize;
                if self.fifo_buf.len() < 4 + plen {
                    break;
                }
                let path = String::from_utf8_lossy(&self.fifo_buf[4..4 + plen]).into_owned();
                println!("[cmd] FIFO *i (install game) path={path:?}");
                let code = self.install_game(&path);
                master.write_all(&[code])?;
                self.fifo_buf.drain(0..4 + plen);
            } else if self.fifo_buf.starts_with(b"*s") {
                // lancement du jeu
                if self.fifo_buf.len() < 2 {
                    break;
                }
                println!("[cmd] FIFO *s (start game)");
                // En mode MCP : l'hôte (GearGraFX) se met en pause après un
                // load_media/reset ; on reprend l'exécution pour lancer le jeu.
                if let Some(mcp) = &mut self.mcp {
                    match mcp.resume() {
                        Ok(_) => println!("[emulator] MCP debug_continue (reprise du jeu)"),
                        Err(e) => eprintln!("[emulator] MCP debug_continue : {e}"),
                    }
                }
                self.fifo_buf.drain(0..2);
            } else {
                break; // inconnu / partiel : attendre d'autres octets
            }
        }
        Ok(())
    }

    /// Charge le fichier SD dans la RAM0 (jeu/HuCard virtuelle).
    fn install_game(&mut self, path: &str) -> u8 {
        match self.sd.open_read(path) {
            Ok(mut f) => {
                let mut data = Vec::new();
                if f.read_to_end(&mut data).is_err() {
                    return 2;
                }
                let n = data.len().min(SIZE_RAM0);
                self.ram0[..n].copy_from_slice(&data[..n]);
                // En mode MCP : charge le même fichier dans l'émulateur hôte
                // (GearGraFX) pour que la zone mémoire "ROM" y soit exposée et
                // que les lectures/écritures de la RAM0 servent le vrai média.
                // En cas d'échec, on conserve le fallback RAM virtuelle locale.
                if let Some(mcp) = &mut self.mcp {
                    let abs = self.sd.resolve(path).to_string_lossy().into_owned();
                    if let Err(e) = mcp.load_media(&abs) {
                        eprintln!("[emulator] MCP load_media({abs:?}) : {e}");
                    }
                }
                // Nouveau média chargé : les fenêtres VRAM/CRAM seront relues
                // auprès de l'hôte à la prochaine lecture (nouvelle palette).
                0
            }
            Err(_) => 1, // fichier introuvable
        }
    }

    // ------------------------------------------------------------- fichiers
    fn file_open(&mut self, mode: u8, path: &str) {
        self.open_file = None;
        self.open_len = 0;
        self.status = 0;
        if mode & FA_WRITE != 0 {
            let create = mode & FA_CREATE_ALWAYS != 0;
            let r = if create {
                self.sd.open_create(path)
            } else {
                self.sd.open_append(path)
            };
            match r {
                Ok(f) => self.open_file = Some(f),
                Err(_) => self.status = 0x0D, // nom de fichier invalide
            }
        } else {
            match self.sd.open_read(path) {
                Ok(f) => {
                    self.open_len = f.metadata().map(|m| m.len()).unwrap_or(0);
                    self.open_file = Some(f);
                }
                Err(_) => self.status = 2, // FR_NO_FILE
            }
        }
    }

    fn file_close(&mut self) {
        self.open_file = None;
        self.status = 0;
    }

    fn file_read(&mut self, master: &mut PtyMaster, total: u32) -> io::Result<()> {
        let mut remaining = total as usize;
        while remaining > 0 {
            master.write_all(&[0u8])?; // ack
            let block = remaining.min(4096);
            let mut buf = vec![0u8; block];
            match &mut self.open_file {
                Some(f) => {
                    let n = f.read(&mut buf)?;
                    master.write_all(&buf[..n])?;
                }
                None => master.write_all(&buf)?,
            }
            remaining -= block;
        }
        Ok(())
    }

    fn file_write(&mut self, master: &mut PtyMaster, total: u32) -> io::Result<()> {
        let mut remaining = total as usize;
        while remaining > 0 {
            master.write_all(&[0u8])?; // ack avant chaque bloc
            let block = remaining.min(1024);
            let mut buf = vec![0u8; block];
            master.read_exact(&mut buf)?;
            if let Some(f) = &mut self.open_file {
                f.write_all(&buf)?;
            }
            remaining -= block;
        }
        if let Some(f) = &mut self.open_file {
            let _ = f.flush();
        }
        self.status = 0;
        Ok(())
    }

    fn dir_make(&mut self, path: &str) {
        self.status = match self.sd.make_dir(path) {
            Ok(true) => 0,
            Ok(false) => 8, // déjà existant (ignoré par le client)
            Err(_) => 3,    // FR_NO_PATH
        };
    }

    /// `CMD_F_DIR_OPN` : ouvre un dossier (équiv. `f_opendir`). Le résultat est
    /// un code FatFs lu ensuite par le client via `CMD_STATUS` (comme
    /// `CMD_F_DIR_MK`). Les entrées sont ensuite tirées une à une par
    /// `CMD_F_DIR_RD`.
    fn dir_open(&mut self, path: &str) {
        match self.sd.read_dir(path) {
            Ok(list) => {
                self.dir_iter = Some(list.into_iter());
                self.status = FR_OK;
            }
            Err(_) => {
                self.dir_iter = None;
                self.status = FR_NO_PATH;
            }
        }
    }

    /// `CMD_F_DIR_RD` : renvoie l'entrée suivante du dossier ouvert, au format
    /// FILINFO du firmware :
    ///   `u8 status`, `u32 size` (LE), `u16 date`, `u16 time`, `u8 attrib`,
    ///   `u8 name_len`, `name_len` octets de nom.
    /// Fin de dossier (ou aucun dossier ouvert) : `name_len == 0`.
    fn dir_read(&mut self, master: &mut PtyMaster) -> io::Result<()> {
        let next = self.dir_iter.as_mut().and_then(|it| it.next());
        match next {
            Some(e) => {
                let name = e.name.as_bytes();
                let name = &name[..name.len().min(255)];
                let attrib = if e.is_dir { AM_DIR } else { 0 };
                master.write_all(&[FR_OK])?;
                master.write_all(&(e.size.min(u32::MAX as u64) as u32).to_le_bytes())?;
                master.write_all(&0u16.to_le_bytes())?; // date FAT
                master.write_all(&0u16.to_le_bytes())?; // heure FAT
                master.write_all(&[attrib, name.len() as u8])?;
                master.write_all(name)?;
            }
            None => {
                // fin du dossier : statut OK, puis FILINFO nul (name_len = 0).
                // 11 octets : status + size(4) + date(2) + time(2) + attrib + name_len
                self.dir_iter = None;
                master.write_all(&[FR_OK, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])?;
            }
        }
        Ok(())
    }

    // -------------------------------------------------------------- reset
    fn host_reset(&mut self, master: &mut PtyMaster, mode: u8) -> io::Result<()> {
        if mode == HOST_RST_ON {
            self.rst_state = HOST_RST_ON;
            self.cfg_reset_done = false;
            // En mode MCP, le reset de la console PC-Engine se propage à
            // l'émulateur hôte (GearGraFX) : un reboot réel de la console.
            if let Some(mcp) = &mut self.mcp {
                match mcp.reset() {
                    Ok(_) => println!("[emulator] MCP debug_reset envoyé à l'hôte"),
                    Err(e) => eprintln!("[emulator] MCP reset : {e}"),
                }
            }
        } else {
            if self.cfg_reset_done {
                // séquence "reset to menu" : le menu annonce 'r'
                master.write_all(&[b'r'])?;
            }
            self.rst_state = 0;
            self.cfg_reset_done = false;
        }
        Ok(())
    }

    // ---------------------------------------------------------- infos carte
    fn sys_info(&self) -> [u8; 64] {
        let mut b = [0u8; 64];
        let mut hdr = [0u8; 20];
        let tag: &[u8] = if self.fake_hardware {
            b"TurboEverDrive Pro" // imite une vraie carte (test du mode conservateur)
        } else {
            b"TED-EMULATOR v1.0"
        };
        hdr[..tag.len()].copy_from_slice(tag);
        b[..20].copy_from_slice(&hdr);
        let mut p = 20usize;
        put_u32(&mut b, &mut p, 0x5445_4450); // serial_g "TEDP"
        put_u32(&mut b, &mut p, 1); // serial_l
        put_u32(&mut b, &mut p, 42); // boot_ctr
        put_u32(&mut b, &mut p, 7); // game_ctr
        put_u16(&mut b, &mut p, 0x5647); // asm_date 07.02.2023
        put_u16(&mut b, &mut p, 0x1234); // asm_time
        put_u16(&mut b, &mut p, 0x1207); // sw_date (version mcu)
        put_u16(&mut b, &mut p, 0x5678); // sw_time
        put_u16(&mut b, &mut p, 0x0101); // sw_ver
        put_u16(&mut b, &mut p, 0x0100); // hw_ver
        put_u16(&mut b, &mut p, 0x0001); // boot_ver
        b[p] = self.device_id;
        b[58] = 25; // flash_size = 1 << 25 = 32 Mo
        b
    }

    fn vdc_bytes(&self) -> [u8; 8] {
        let vals = [0x0500u16, 0x0250, 0x0120, 0x0000]; // v50, v25, v12, bat
        let mut out = [0u8; 8];
        for (i, v) in vals.iter().enumerate() {
            out[i * 2] = (v & 0xFF) as u8;
            out[i * 2 + 1] = (v >> 8) as u8;
        }
        out
    }

    /// Alimente les buffers de capture (`vram` VDC + `palette` VCE) avant un
    /// dump `*v`.
    ///
    /// En mode MCP, on lit la **VRAM** et la **palette/CRAM** réelles auprès de
    /// l'émulateur hôte (GearGraFX) via `read_memory`, ce qui correspond à ce
    /// que le code assembleur de la vraie TED Pro ferait sur une console
    /// physique. Sans hôte (ou en cas d'échec), on retombe sur l'écran de menu
    /// artificiel généré localement.
    fn refresh_screen(&mut self) {
        // Lire d'abord dans des buffers locaux pour libérer l'emprunt mut sur
        // `self.mcp` avant d'écrire dans `self.vram` / `self.palette`.
        let fetched: Option<(Vec<u8>, Vec<u8>)> = if let Some(mcp) = &mut self.mcp {
            match (mcp.read_vram(), mcp.read_palette()) {
                (Ok(v), Ok(p)) => Some((v, p)),
                _ => None,
            }
        } else {
            None
        };

        match fetched {
            Some((v, p)) if v.len() >= 0x10000 && p.len() >= 1024 => {
                self.vram[..0x10000].copy_from_slice(&v[..0x10000]);
                self.palette[..1024].copy_from_slice(&p[..1024]);
            }
            _ => {
                if self.mcp.is_some() {
                    eprintln!("[emulator] capture : lecture MCP VRAM/palette impossible, fallback menu");
                }
                self.gen_menu_image();
            }
        }
    }

    /// Génère un "écran de menu" reconnaissable (VRAM + palette) pour `capture_screen`.
    fn gen_menu_image(&mut self) {
        // Palette : cube de couleurs sur 256 entrées (16 palettes x 16 couleurs)
        let mut pal16 = [0u16; 256];
        for i in 0..256usize {
            let r = (i / 32) & 7;
            let g = (i / 4) & 7;
            let b = i & 7;
            pal16[i] = ((r as u16) << 3) | ((g as u16) << 6) | (b as u16);
        }
        for (i, p) in pal16.iter().enumerate() {
            self.palette[i * 2] = (p & 0xFF) as u8;
            self.palette[i * 2 + 1] = (p >> 8) as u8;
        }

        // Tilemap : dégradé de palettes sur les 40x28 tuiles visibles
        self.vram.fill(0);
        let plan_w = 64usize;
        for y in 0..28usize {
            for x in 0..40usize {
                let tile_pal = ((x + y) % 16) as u16;
                let entry = tile_pal << 12; // tuile 0, pixels 0
                let off = (x + y * plan_w) * 2;
                self.vram[off] = (entry & 0xFF) as u8;
                self.vram[off + 1] = (entry >> 8) as u8;
            }
        }
    }
}

// ------------------------------------------------------------ primitives
fn scan_command(master: &mut PtyMaster) -> io::Result<Option<u8>> {
    let mut b = [0u8; 1];
    loop {
        if master.read_exact(&mut b).is_err() {
            return Ok(None); // EOF : hôte déconnecté
        }
        if b[0] == 0x2B {
            let mut b2 = [0u8; 1];
            if master.read_exact(&mut b2).is_err() {
                return Ok(None);
            }
            if b2[0] != 0xD4 {
                continue; // le 0x2B faisait partie d'un préambule (handshake)
            }
            let mut c = [0u8; 1];
            if master.read_exact(&mut c).is_err() {
                return Ok(None);
            }
            let mut ck = [0u8; 1];
            if master.read_exact(&mut ck).is_err() {
                return Ok(None);
            }
            if ck[0] == c[0] ^ 0xFF {
                return Ok(Some(c[0]));
            }
            // checksum invalide : on resynchronise
        }
    }
}

fn read_u8(master: &mut PtyMaster) -> io::Result<u8> {
    let mut b = [0u8; 1];
    master.read_exact(&mut b)?;
    Ok(b[0])
}

fn read_u32(master: &mut PtyMaster) -> io::Result<u32> {
    let mut b = [0u8; 4];
    master.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_string(master: &mut PtyMaster) -> io::Result<String> {
    let mut lb = [0u8; 2];
    master.read_exact(&mut lb)?;
    let len = u16::from_le_bytes(lb) as usize;
    let mut b = vec![0u8; len];
    master.read_exact(&mut b)?;
    Ok(String::from_utf8_lossy(&b).into_owned())
}

fn put_u32(buf: &mut [u8], p: &mut usize, v: u32) {
    buf[*p..*p + 4].copy_from_slice(&v.to_le_bytes());
    *p += 4;
}

fn put_u16(buf: &mut [u8], p: &mut usize, v: u16) {
    buf[*p..*p + 2].copy_from_slice(&v.to_le_bytes());
    *p += 2;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_sd() -> VirtualSd {
        let dir = std::env::temp_dir().join(format!("edlink_sd_vram_test_{}", std::process::id()));
        VirtualSd::new(&dir).unwrap()
    }

    #[test]
    fn mem_read_vram_cram_windows() {
        let mut dev = Device::new(temp_sd(), DEV_ID_TURBO_PRO, None);
        // Motifs reconnaissables pour vérifier que les octets servis viennent
        // bien des buffers VRAM / palette.
        for i in 0..dev.vram.len() {
            dev.vram[i] = (i as u8).wrapping_mul(7);
        }
        for i in 0..dev.palette.len() {
            dev.palette[i] = (i as u8).wrapping_mul(13);
        }

        // Lecture partielle en début de VRAM
        let part = dev.mem_read(ADDR_VRAM, 16);
        assert_eq!(part.len(), 16);
        for i in 0..16 {
            assert_eq!(part[i], dev.vram[i], "VRAM début, octet {i}");
        }

        // Lecture partielle en fin de VRAM (chevauchant la fin de la fenêtre)
        let off = 0x10000 - 8;
        let tail = dev.mem_read(ADDR_VRAM + off, 8);
        assert_eq!(tail.len(), 8);
        for i in 0..8 {
            assert_eq!(tail[i], dev.vram[off as usize + i], "VRAM fin, octet {i}");
        }

        // Lecture complète VRAM
        let full = dev.mem_read(ADDR_VRAM, 0x10000);
        assert_eq!(full, dev.vram);

        // CRAM : lecture partielle décalée
        let cram = dev.mem_read(ADDR_CRAM + 4, 12);
        assert_eq!(cram.len(), 12);
        for i in 0..12 {
            assert_eq!(cram[i], dev.palette[4 + i], "CRAM, octet {i}");
        }

        // Lecture complète CRAM
        let full_cram = dev.mem_read(ADDR_CRAM, 1024);
        assert_eq!(full_cram, dev.palette);

        // Hors fenêtre : ne doit PAS venir de la VRAM/CRAM (retombe sur le motif adresse).
        let oob = dev.mem_read(ADDR_CRAM + 0x400, 4);
        for i in 0..4 {
            let v = (ADDR_CRAM + 0x400) as usize + i;
            let expected = ((v ^ (v >> 8) ^ (v >> 16)) & 0xFF) as u8;
            assert_eq!(oob[i], expected, "hors fenêtre, octet {i}");
        }
    }
}

