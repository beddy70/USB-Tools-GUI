//! Couche appareil Turbo EverDrive (port Rust de `DEV_TED/DeviceIO.cs`,
//! `DeviceCmd.cs`, `MenuCmd.cs` et de la base `DeviceIO_V1.cs`).
//!
//! Fournit les opérations haut niveau : infos appareil, copie de fichiers
//! (host <-> SD), lancement de jeu, reset, capture d'écran, lecture mémoire.

use crate::error::{EdError, Result};
use crate::link::Link;
use crate::protocol::*;
use std::path::Path;

/// Informations système lues via la commande `CMD_SYS_INF`.
#[derive(Debug, Clone)]
pub struct SysInfo {
    pub serial_g: u32,
    pub serial_l: u32,
    pub boot_ctr: u32,
    pub game_ctr: u32,
    pub asm_date: u16,
    pub asm_time: u16,
    pub sw_date: u16,
    pub sw_time: u16,
    pub sw_ver: u16,
    pub hw_ver: u16,
    pub boot_ver: u16,
    pub device_id: u8,
    pub flash_size: u32,
    /// En-tête ASCII (20 octets) en tête de la réponse `CMD_SYS_INF`. Sur
    /// matériel réel : chaîne de build du firmware. L'émulateur virtuel y place
    /// `"TED-EMULATOR ..."`, ce qui permet à l'hôte de savoir qu'il parle à
    /// l'émulateur (lectures mémoire libres) et non à une vraie carte (chaque
    /// `CMD_MEM_RD` vole des cycles au CPU PC-Engine).
    pub fw_header: String,
}

/// Tensions relevées via `CMD_GET_VDC`.
#[derive(Debug, Clone)]
pub struct Vdc {
    pub v50: u16,
    pub v25: u16,
    pub v12: u16,
    pub bat: u16,
}

/// Une entrée du système de fichiers de la carte SD (fichier ou dossier).
#[derive(Debug, Clone)]
pub struct SdEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u32,
}

/// Pilote de la Turbo EverDrive (Pro / Core).
pub struct Ted {
    link: Link,
    rst_state: u8,
}

impl Ted {
    /// Ouvre une connexion vers la carte. Vérifie que le protocol-id est bien
    /// celui d'une Turbo EverDrive.
    pub fn connect(target: Option<&str>) -> Result<Ted> {
        let mut link = Link::open(target)?;
        link.set_swap_endians(false);
        if link.protocol_id() != PROTOCOL_ID_TED {
            return Err(EdError::Unsupported(format!(
                "protocol-id {} is not a Turbo EverDrive",
                link.protocol_id()
            )));
        }
        Ok(Ted { link, rst_state: 0 })
    }

    pub fn device_name(&self) -> String {
        match self.link.device_id() {
            DEV_ID_TURBO_PRO => "Turbo EverDrive PRO".into(),
            DEV_ID_TURBO_CORE => "Turbo EverDrive CORE".into(),
            d => format!("Unknown Turbo EverDrive (0x{d:02X})"),
        }
    }

    pub fn device_id(&self) -> u8 {
        self.link.device_id()
    }

    /// `true` si l'hôte parle à l'émulateur virtuel (`crates/emulator`) et non à
    /// une vraie carte. Détecté via l'en-tête de `CMD_SYS_INF`. À utiliser pour
    /// autoriser les lectures mémoire massives (VRAM/CRAM, dump complet,
    /// recherche linéaire) : sur matériel réel elles gèlent le CPU PC-Engine.
    pub fn is_emulator(&mut self) -> Result<bool> {
        Ok(self.sys_info()?.fw_header.to_uppercase().contains("EMULATOR"))
    }

    pub fn protocol_id(&self) -> u8 {
        self.link.protocol_id()
    }

    pub fn port_name(&self) -> Result<String> {
        Ok(self.link.port_name()?)
    }

    // ----------------------------------------------------------- infos
    /// Lit les informations système de la carte.
    pub fn sys_info(&mut self) -> Result<SysInfo> {
        self.link.tx_cmd(CMD_SYS_INF)?;
        let b = self.link.rx_data(64)?;
        let fw_header = String::from_utf8_lossy(&b[..20])
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        let mut p = 20usize;
        let serial_g = u32_le_at(&b, p);
        p += 4;
        let serial_l = u32_le_at(&b, p);
        p += 4;
        let boot_ctr = u32_le_at(&b, p);
        p += 4;
        let game_ctr = u32_le_at(&b, p);
        p += 4;
        let asm_date = u16_le_at(&b, p);
        p += 2;
        let asm_time = u16_le_at(&b, p);
        p += 2;
        let sw_date = u16_le_at(&b, p);
        p += 2;
        let sw_time = u16_le_at(&b, p);
        p += 2;
        let sw_ver = u16_le_at(&b, p);
        p += 2;
        let hw_ver = u16_le_at(&b, p);
        p += 2;
        let boot_ver = u16_le_at(&b, p);
        p += 2;
        let info = SysInfo {
            serial_g,
            serial_l,
            boot_ctr,
            game_ctr,
            asm_date,
            asm_time,
            sw_date,
            sw_time,
            sw_ver,
            hw_ver,
            boot_ver,
            device_id: b[p],
            flash_size: 1u32 << b[58],
            fw_header,
        };
        Ok(info)
    }

    /// Enregistre un "devinf" formaté (port de `DeviceCmd.DevInf`).
    pub fn devinf(&mut self) -> Result<String> {
        let inf = self.sys_info()?;
        let vdc = self.vdc()?;

        let mut msg = String::new();
        msg += &format!("device id : {:02X}\n", self.link.device_id());
        msg += &format!("name      : {}\n", self.device_name());
        msg += &format!("serial    : {:08X}.{:08X}\n", inf.serial_g, inf.serial_l);
        msg += &format!("build date: {}\n", ts_to_date(inf.asm_date));
        msg += &format!("bootloader: {:04X}\n", inf.boot_ver);
        msg += &format!("mcu core  : {}\n", ts_to_version(inf.sw_date));
        msg += &format!("game ctr  : {}\n", inf.game_ctr);
        msg += &format!("boot ctr  : {}\n", inf.boot_ctr);
        msg += &format!("vcc 5.0   : {}\n", vdc_to_str(vdc.v50));
        msg += &format!("vcc 2.5   : {}\n", vdc_to_str(vdc.v25));
        msg += &format!("vcc 1.2   : {}\n", vdc_to_str(vdc.v12));
        Ok(msg)
    }

    /// Lit les tensions d'alimentation.
    pub fn vdc(&mut self) -> Result<Vdc> {
        self.link.tx_cmd(CMD_GET_VDC)?;
        Ok(Vdc {
            v50: self.link.rx16()?,
            v25: self.link.rx16()?,
            v12: self.link.rx16()?,
            bat: self.link.rx16()?,
        })
    }

    // --------------------------------------------------------- memoire
    /// Lecture mémoire (lecture seule). `len` <= quelques Mo.
    pub fn mem_rd(&mut self, addr: u32, len: usize) -> Result<Vec<u8>> {
        if len == 0 {
            return Ok(Vec::new());
        }
        self.link.tx_cmd(CMD_MEM_RD)?;
        self.link.tx32(addr)?;
        self.link.tx32(len as u32)?;
        self.link.tx8(0)?; // exec
        self.link.rx_data(len)
    }

    /// Écriture mémoire (interne : FIFO, registre config, load HuCard).
    fn mem_wr(&mut self, addr: u32, data: &[u8]) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        self.link.tx_cmd(CMD_MEM_WR)?;
        self.link.tx32(addr)?;
        self.link.tx32(data.len() as u32)?;
        self.link.tx8(0)?; // exec
        self.link.tx_data(data)
    }

    /// Écrit dans la FIFO hôte (interface avec le menu OS de la carte).
    fn fifo_wr(&mut self, data: &[u8]) -> Result<()> {
        self.mem_wr(ADDR_FCI_FIFO, data)
    }

    /// Écrit une chaîne dans la FIFO (précédée de sa longueur u16 LE).
    fn fifo_tx_string(&mut self, s: &str) -> Result<()> {
        let len = s.len() as u16;
        self.fifo_wr(&[len as u8, (len >> 8) as u8])?;
        self.fifo_wr(s.as_bytes())
    }

    // --------------------------------------------------------- reset
    fn host_reset(&mut self, mode: u8) -> Result<()> {
        self.link.tx_cmd(CMD_HOST_RST)?;
        self.link.tx8(mode)?;
        if self.rst_state == HOST_RST_OFF && mode != HOST_RST_OFF {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        self.rst_state = mode;
        Ok(())
    }

    fn config_reset(&mut self) -> Result<()> {
        let zeros = vec![0u8; 256];
        self.mem_wr(ADDR_FCI_CFG, &zeros)
    }

    /// Réinitialise la console vers le menu de la carte (port de
    /// `MenuCmd.ResetToMenu`), en attendant le statut 'r'.
    pub fn reset_to_menu(&mut self) -> Result<()> {
        self.host_reset(HOST_RST_ON)?;
        std::thread::sleep(std::time::Duration::from_millis(10));
        self.config_reset()?;
        self.host_reset(HOST_RST_OFF)?;

        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(2000);
        loop {
            if self.link.bytes_to_read()? > 0 {
                let resp = self.link.rx8()?;
                if resp != b'r' {
                    return Err(EdError::Other(format!(
                        "unexpected usb status: 0x{resp:02X}"
                    )));
                }
                return Ok(());
            }
            if std::time::Instant::now() > deadline {
                return Err(EdError::Other("reset timeout".into()));
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    /// Reset console (bouton reset de l'outil).
    pub fn reset(&mut self) -> Result<()> {
        self.host_reset(HOST_RST_ON)?;
        std::thread::sleep(std::time::Duration::from_millis(50));
        self.host_reset(HOST_RST_OFF)?;
        Ok(())
    }

    // ------------------------------------------------------- demarrage
    /// Déploie et installe un jeu dans la mémoire (RAM) sans le lancer.
    pub fn load(&mut self, rom_path: &str) -> Result<String> {
        self.reset_to_menu()?;

        let app_dst = if is_dev_path(rom_path) {
            rom_path.to_string()
        } else {
            let name = file_name(rom_path);
            let dst = format!("sd:usb-games/{name}");
            self.copy_file(rom_path, &dst)?;
            dst
        };

        self.app_install(&get_dev_path(&app_dst))?;
        Ok(app_dst)
    }

    /// Déploie, installe puis lance un jeu depuis le menu de la carte.
    pub fn run(&mut self, rom_path: &str) -> Result<String> {
        let dst = self.load(rom_path)?;
        self.app_start()?;
        Ok(dst)
    }

    fn app_install(&mut self, path: &str) -> Result<()> {
        self.fifo_wr(b"*i")?;
        self.fifo_tx_string(path)?;
        let resp = self.link.rx8()?;
        if resp != 0 {
            return Err(EdError::Other(format!(
                "app installation error: 0x{resp:02X}"
            )));
        }
        Ok(())
    }

    fn app_start(&mut self) -> Result<()> {
        self.fifo_wr(b"*s")
    }

    // ------------------------------------------------------- fichiers
    /// Liste le contenu d'un dossier de la carte SD.
    ///
    /// `path` peut être un chemin "périphérique" (`sd:/GAMES`) ou nu (`GAMES`,
    /// `/GAMES`). Le dossier racine est `""` ou `/`. Renvoie les entrées
    /// (dossiers et fichiers) avec leur taille.
    ///
    /// Protocole (couche FS du firmware MCU partagé des cartes « Pro » —
    /// EverDrive-N8 Pro / Mega Pro / **Turbo Pro** — d'après `edFirmware`) :
    ///
    /// ```text
    /// TX  CMD_F_DIR_OPN + tx_string(path)      → statut FatFs lu via CMD_STATUS
    /// puis, en boucle jusqu'à name_len == 0 :
    /// TX  CMD_F_DIR_RD
    /// RX  u8  status      FRESULT (0 = OK, sinon erreur)
    ///     u32 size        taille du fichier (little-endian)
    ///     u16 date        date FAT (ignorée ici)
    ///     u16 time        heure FAT (ignorée ici)
    ///     u8  attrib      attributs FatFs (AM_DIR = dossier)
    ///     u8  name_len    longueur du nom (0 = fin du dossier)
    ///     u8  name[name_len]
    /// ```
    ///
    /// La colonne ASCII / le « count » en tête de l'ancienne implémentation
    /// n'existent pas côté firmware : `f_opendir` ne connaît pas le nombre
    /// d'entrées d'avance (d'où la commande séparée `CMD_F_DIR_SIZE`).
    pub fn list_dir(&mut self, path: &str) -> Result<Vec<SdEntry>> {
        let dev = get_dev_path(path);
        // Une vraie carte SD peut marquer une longue pause (parcours FAT,
        // latence interne) : on élargit le timeout le temps du listing, puis on
        // le rétablit — même en cas d'erreur.
        self.link.set_read_timeout(Link::FS_TIMEOUT)?;
        let r = self.list_dir_inner(&dev);
        let _ = self.link.set_read_timeout(Link::OP_TIMEOUT);
        r
    }

    fn list_dir_inner(&mut self, dev_path: &str) -> Result<Vec<SdEntry>> {
        self.link.tx_cmd(CMD_F_DIR_OPN)?;
        self.link.tx_string(dev_path)?;
        match self.link.status()? {
            FR_OK => {}
            // Dossier absent : liste vide plutôt qu'une erreur bloquante.
            FR_NO_FILE | FR_NO_PATH => return Ok(Vec::new()),
            code => return Err(EdError::DeviceError(code)),
        }

        let mut out = Vec::new();
        loop {
            self.link.tx_cmd(CMD_F_DIR_RD)?;
            let status = self.link.rx8()?;
            if status != FR_OK {
                return Err(EdError::DeviceError(status));
            }
            let size = self.link.rx32()?; // swap_endians = false → little-endian
            let _date = self.link.rx16()?;
            let _time = self.link.rx16()?;
            let attrib = self.link.rx8()?;
            let name_len = self.link.rx8()? as usize;
            if name_len == 0 {
                break; // fin du dossier
            }
            let name =
                String::from_utf8_lossy(&self.link.rx_data(name_len)?).into_owned();
            if name == "." || name == ".." {
                continue;
            }
            out.push(SdEntry {
                name,
                is_dir: (attrib & AM_DIR) != 0,
                size,
            });
        }
        Ok(out)
    }

    /// Copie un fichier : host -> SD ou SD -> host selon les préfixes
    /// (`sd:` = chemin sur la carte).
    pub fn copy_file(&mut self, src: &str, dst: &str) -> Result<()> {
        self.copy_file_with_progress(src, dst, |_, _| {})
    }

    /// Comme [`Self::copy_file`], en signalant la progression de la phase lente
    /// (échange avec la carte) : lecture SD pour un téléchargement, écriture SD
    /// pour un envoi. `progress` reçoit `(octets_traités, octets_total)` ; il
    /// est appelé une première fois à `(0, total)` puis après chaque bloc.
    pub fn copy_file_with_progress(
        &mut self,
        src: &str,
        dst: &str,
        mut progress: impl FnMut(u64, u64),
    ) -> Result<()> {
        let buff: Vec<u8>;
        if is_dev_path(src) {
            self.file_open(&get_dev_path(src), FA_READ)?;
            let avail = self.file_available()? as usize;
            buff = self.file_read(avail, &mut progress)?;
            self.file_close()?;
        } else {
            buff = std::fs::read(src)
                .map_err(|e| EdError::Other(format!("read {src}: {e}")))?;
        }

        if is_dev_path(dst) {
            self.file_open(
                &get_dev_path(dst),
                FA_WRITE | FA_CREATE_ALWAYS | FS_MAKEPATH,
            )?;
            self.file_write(&buff, &mut progress)?;
            self.file_close()?;
        } else {
            if let Some(parent) = Path::new(dst).parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = std::fs::create_dir_all(parent);
                }
            }
            std::fs::write(dst, &buff)
                .map_err(|e| EdError::Other(format!("write {dst}: {e}")))?;
        }
        Ok(())
    }

    fn file_open(&mut self, path: &str, mode: u8) -> Result<()> {
        self.make_path(path, mode)?;
        self.link.tx_cmd(CMD_F_FOPN)?;
        self.link.tx8(mode & !FS_MAKEPATH)?;
        self.link.tx_string(path)?;
        self.link.check_status()
    }

    fn file_close(&mut self) -> Result<()> {
        self.link.tx_cmd(CMD_F_FCLOSE)?;
        self.link.check_status()
    }

    fn file_available(&mut self) -> Result<u64> {
        self.link.tx_cmd(CMD_F_AVB)?;
        let hi = self.link.rx32()? as u64;
        let lo = self.link.rx32()? as u64;
        Ok(lo | (hi << 32))
    }

    fn file_read<P: FnMut(u64, u64)>(
        &mut self,
        total_len: usize,
        mut progress: P,
    ) -> Result<Vec<u8>> {
        self.link.tx_cmd(CMD_F_FRD)?;
        self.link.tx32(total_len as u32)?;
        let mut out = Vec::with_capacity(total_len);
        let mut remaining = total_len;
        progress(0, total_len as u64);
        while remaining > 0 {
            let block = remaining.min(4096);
            let ack = self.link.rx8()?;
            if ack != 0 {
                return Err(EdError::DeviceError(ack));
            }
            let data = self.link.rx_data(block)?;
            out.extend_from_slice(&data);
            remaining -= block;
            progress(out.len() as u64, total_len as u64);
        }
        Ok(out)
    }

    fn file_write<P: FnMut(u64, u64)>(
        &mut self,
        data: &[u8],
        progress: P,
    ) -> Result<()> {
        self.link.tx_cmd(CMD_F_FWR)?;
        self.link.tx32(data.len() as u32)?;
        self.link.tx_data_ack_progress(data, progress)?;
        self.link.check_status()
    }

    fn make_path(&mut self, path: &str, mode: u8) -> Result<()> {
        let target = FA_WRITE | FS_MAKEPATH;
        if mode & target != target {
            return Ok(());
        }
        for (i, ch) in path.bytes().enumerate() {
            if ch == b'/' && i > 0 {
                self.dir_make(&path[..i])?;
            }
        }
        Ok(())
    }

    fn dir_make(&mut self, path: &str) -> Result<()> {
        self.link.tx_cmd(CMD_F_DIR_MK)?;
        self.link.tx_string(path)?;
        let s = self.link.status()?;
        if s != 0 && s != 8 {
            // erreur 8 = dossier déjà existant : ignorée
            return Err(EdError::DeviceError(s));
        }
        Ok(())
    }

    // ------------------------------------------------------- screenshot
    /// Capture l'écran du menu de la carte et renvoie une image PNG.
    ///
    /// Nécessite que le menu (OS) de la cartouche soit affiché à l'écran.
    /// Capture l'écran du menu et renvoie un PNG (réglages par défaut).
    pub fn screen(&mut self) -> Result<Vec<u8>> {
        self.screen_opts(&crate::image::ScreenOpts::default())
    }

    /// Capture l'écran avec des réglages de visualisation (taille de BAT,
    /// résolution, défilement). Voir [`crate::image::ScreenOpts`].
    pub fn screen_opts(&mut self, opts: &crate::image::ScreenOpts) -> Result<Vec<u8>> {
        self.fifo_wr(b"*v")?;
        let dump_addr = self.link.rx32()?;
        let vram = self.mem_rd(dump_addr, 0x10000)?;
        let palette = self.mem_rd(dump_addr + 0x10000, 1024)?;
        crate::image::make_png(&vram, &palette, opts)
    }
}

// ------------------------------------------------------------ helpers
/// Lit un `u16` little-endian à un offset donné.
fn u16_le_at(b: &[u8], off: usize) -> u16 {
    let b0 = *b.get(off).unwrap_or(&0) as u16;
    let b1 = *b.get(off + 1).unwrap_or(&0) as u16;
    b0 | (b1 << 8)
}

/// Lit un `u32` little-endian à un offset donné.
fn u32_le_at(b: &[u8], off: usize) -> u32 {
    (u16_le_at(b, off) as u32) | ((u16_le_at(b, off + 2) as u32) << 16)
}

fn is_dev_path(p: &str) -> bool {
    p.to_lowercase().starts_with("sd:")
}

fn get_dev_path(p: &str) -> String {
    if is_dev_path(p) {
        p[3..].to_string()
    } else {
        p.to_string()
    }
}

fn file_name(p: &str) -> String {
    Path::new(p)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string())
}

fn byte_to_bcd(val: u32) -> u8 {
    let mut v = val & 0xFF;
    if v > 99 {
        v = 99;
    }
    (((v / 10) << 4) | (v % 10)) as u8
}

/// Convertit un timestamp (u16 FAT-like) en date `JJ.MM.AAAA`.
fn ts_to_date(ts: u16) -> String {
    let date = ts as u32;
    let d = byte_to_bcd(date & 31);
    let mo = byte_to_bcd((date >> 5) & 15);
    let yr = (date >> 9) + 1980;
    format!("{:02X}.{:02X}.{}", d, mo, yr)
}

/// Convertit un timestamp (u16 FAT-like) en version `XX.YYYY`.
fn ts_to_version(ts: u16) -> String {
    let date = ts as u32;
    let mut ver: u32 = 0;
    let base = (date >> 9).wrapping_sub(20);
    ver |= (byte_to_bcd(base) as u32) << 8;
    ver <<= 8;
    ver |= (byte_to_bcd((date >> 5) & 15) as u32) << 8;
    ver |= byte_to_bcd(date & 31) as u32;
    format!("{:02X}.{:04X}", (ver >> 16) & 0xFF, ver & 0xFFFF)
}

fn vdc_to_str(v: u16) -> String {
    format!("{:02X}.{:02X}", v >> 8, v & 0xFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ts_to_date() {
        // 0x5647 => jour 07, mois 02, année 2023
        assert_eq!(ts_to_date(0x5647), "07.02.2023");
    }

    #[test]
    fn test_ts_to_version() {
        // sanity: ne panique pas et renvoie au format XX.YYYY
        assert!(ts_to_version(0x1207).len() >= 7);
    }

    #[test]
    fn test_dev_path_helpers() {
        assert!(is_dev_path("sd:/GAMES/game.pce"));
        assert!(!is_dev_path("/GAMES/game.pce"));
        assert_eq!(get_dev_path("sd:/GAMES/game.pce"), "/GAMES/game.pce");
    }

    #[test]
    fn test_u16_le() {
        assert_eq!(u16_le_at(&[0x34, 0x12], 0), 0x1234);
    }
}
