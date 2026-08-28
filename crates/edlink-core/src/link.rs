//! Couche de transport série (port Rust de `edlink/Device/Link.cs`).
//!
//! Gère la découverte de la carte, l'ouverture du port (921600 bauds, CDC USB),
//! l'émission/réception des trames et les conversions d'endianness.

use crate::error::{EdError, Result};
use crate::protocol::{CMD_STATUS, CMD_STATUS2, STATUS_KEY};
use serialport::SerialPort;
use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;

const STATUS_KEY_OLD: u8 = 0xA5;
const PROTOCOL_ID_MEGA: u8 = 0x05;
const PROTOCOL_ID_N8: u8 = 0x06;

/// Trace série : si la variable d'environnement `EDLINK_TRACE` est définie (à
/// autre chose que "0"/"false"), chaque octet émis/reçu est journalisé sur
/// stderr. Indispensable pour valider un protocole sur matériel réel sans
/// analyseur logique (ex: reconstitution du listing de dossiers SD).
fn trace_enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| {
        std::env::var("EDLINK_TRACE")
            .map(|v| !v.is_empty() && v != "0" && v.to_lowercase() != "false")
            .unwrap_or(false)
    })
}

fn trace(dir: &str, buf: &[u8]) {
    if !trace_enabled() || buf.is_empty() {
        return;
    }
    let hex: String = buf
        .iter()
        .take(64)
        .map(|b| format!("{b:02X} "))
        .collect();
    let more = if buf.len() > 64 {
        format!("… (+{} o)", buf.len() - 64)
    } else {
        String::new()
    };
    eprintln!("[edlink-trace] {dir} {:>4} o : {hex}{more}", buf.len());
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Protocol {
    Gen1,
    Gen2,
    Gen3,
}

#[derive(Clone, Copy)]
struct Cfg {
    protocol: Protocol,
    protocol_id: u8,
    device_id: u8,
}

/// Connexion série à une carte EverDrive.
pub struct Link {
    port: Box<dyn SerialPort>,
    swap_endians: bool,
    cfg: Option<Cfg>,
}

impl Link {
    /// Timeout « port manuel » : couvre le cold-start du pseudo-terminal virtuel
    /// (1ère poignée de main jusqu'à ~3,7 s sur l'émulateur).
    const OPEN_TIMEOUT: Duration = Duration::from_millis(2000);
    /// Timeout par port pendant le scan automatique : court, car un port muet
    /// sans réponse coûte un timeout complet (sans cela, le scan d'une machine
    /// avec beaucoup de ports gèle l'app pendant ~90 s).
    const SCAN_TIMEOUT: Duration = Duration::from_millis(500);
    /// Budget total du scan automatique : on ne dépasse jamais ~4 s.
    const SCAN_DEADLINE: Duration = Duration::from_secs(4);

    /// Ouvre une connexion vers la carte. Si `target` est fourni, essaie
    /// uniquement ce port (timeout généreux) ; sinon scanne tous les ports
    /// série disponibles avec un budget borné et un timeout court par port.
    ///
    /// Reproduit le "cold start" de la référence : si la première passe échoue,
    /// on attend 100 ms puis on retente une fois (la carte a souvent besoin de
    /// se réinitialiser après le handshake initial).
    pub fn open(target: Option<&str>) -> Result<Link> {
        let explicit = target.is_some();
        let ports: Vec<String> = match target {
            Some(t) => vec![t.to_string()],
            None => serialport::available_ports()?
                .into_iter()
                .map(|p| p.port_name)
                .collect(),
        };

        // Le scan automatique ne doit jamais bloquer longtemps sur une machine
        // où aucun appareil ne répond (chaque port muet = un timeout). On ne
        // borne le temps que pour le scan ; le port manuel conserve son timeout
        // de 2 s pour absorber le "cold start" du PTY.
        let scan_deadline = std::time::Instant::now() + Self::SCAN_DEADLINE;

        let mut last_err = EdError::NotFound;
        for attempt in 0..2 {
            for p in &ports {
                if !explicit && std::time::Instant::now() >= scan_deadline {
                    return Err(last_err);
                }
                let timeout = if explicit { Self::OPEN_TIMEOUT } else { Self::SCAN_TIMEOUT };
                match Self::try_open_one(p, timeout) {
                    Ok(l) => return Ok(l),
                    Err(e) => last_err = e,
                }
            }
            if attempt == 0 {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        Err(last_err)
    }

    fn try_open_one(pname: &str, timeout: Duration) -> Result<Link> {
        // BAUDS : 921600 (matériel réel). En cas d'échec d'ouverture du port
        // (ex: pseudo-terminal macOS où l'ioctl IOSSIOSPEED renvoie ENOTTY),
        // on retente avec un baud à 0, ce qui évite cet ioctl. C'est ce qui
        // permet à l'émulateur virtuel (crates/emulator) d'être ouvert comme
        // un vrai port.
        let mut port = Self::open_port(pname, 921_600, timeout)
            .or_else(|_| Self::open_port(pname, 0, timeout))?;

        // Handshake : envoie 66 octets nuls puis purge le flux entrant.
        let zeros = vec![0u8; 64 + 2];
        Self::tx_data_impl(&mut *port, &zeros)?;
        let _ = Self::flush_port(&mut *port);

        let mut link = Link {
            port,
            swap_endians: true,
            cfg: None,
        };
        let _ = link.get_id()?;

        link.port.set_timeout(Self::OPEN_TIMEOUT)?;
        Ok(link)
    }

    /// Ouvre un port série avec un débit donné.
    fn open_port(pname: &str, baud: u32, timeout: Duration) -> Result<Box<dyn SerialPort>> {
        serialport::new(pname, baud)
            .timeout(timeout)
            .open()
            .map_err(|_| EdError::Other(format!("cannot open port {pname}")))
    }

    /// Définit l'endianness des entiers multi-octets (TED = little-endian).
    pub fn set_swap_endians(&mut self, swap: bool) {
        self.swap_endians = swap;
    }

    /// Timeout de lecture par défaut, rétabli après une opération longue.
    pub const OP_TIMEOUT: Duration = Duration::from_millis(2000);
    /// Timeout élargi pour les opérations « carte SD » (ouverture de dossier,
    /// premier bloc de lecture d'un gros fichier) : une vraie carte SD peut
    /// marquer une pause de plusieurs secondes (parcours de la FAT, latence
    /// interne). Le firmware n'émet alors rien tant qu'il n'a pas la donnée.
    pub const FS_TIMEOUT: Duration = Duration::from_millis(6000);

    /// Change le timeout de lecture du port (voir [`Self::FS_TIMEOUT`]).
    pub fn set_read_timeout(&mut self, d: Duration) -> Result<()> {
        self.port.set_timeout(d)?;
        Ok(())
    }

    pub fn port_name(&self) -> Result<String> {
        Ok(self.port.name().unwrap_or_default())
    }

    pub fn protocol_id(&self) -> u8 {
        self.cfg.map(|c| c.protocol_id).unwrap_or(0)
    }

    pub fn device_id(&self) -> u8 {
        self.cfg.map(|c| c.device_id).unwrap_or(0)
    }


    /// Émet une trame de commande (4 octets).
    pub fn tx_cmd(&mut self, code: u8) -> Result<()> {
        let cmd = [b'+', b'+' ^ 0xFF, code, code ^ 0xFF];
        self.tx_data(&cmd)
    }

    pub fn tx8(&mut self, v: u8) -> Result<()> {
        self.tx_data(&[v])
    }

    pub fn rx8(&mut self) -> Result<u8> {
        let b = self.rx_data(1)?;
        Ok(b[0])
    }

    pub fn tx16(&mut self, v: u16) -> Result<()> {
        let b = self.num16(v);
        self.tx_data(&b)
    }

    pub fn rx16(&mut self) -> Result<u16> {
        let b = self.rx_data(2)?;
        Ok(self.u16_of(&b))
    }

    pub fn tx32(&mut self, v: u32) -> Result<()> {
        let b = self.num32(v);
        self.tx_data(&b)
    }

    pub fn rx32(&mut self) -> Result<u32> {
        let b = self.rx_data(4)?;
        Ok(self.u32_of(&b))
    }

    /// Émet une chaîne UTF-8 précédée de sa longueur (u16).
    pub fn tx_string(&mut self, s: &str) -> Result<()> {
        let bytes = s.as_bytes();
        self.tx16(bytes.len() as u16)?;
        self.tx_data(bytes)
    }

    pub fn rx_string(&mut self) -> Result<String> {
        let len = self.rx16()? as usize;
        let b = self.rx_data(len)?;
        Ok(String::from_utf8_lossy(&b).into_owned())
    }

    /// Émet des données brutes, découpées en blocs (max 4096, 512 corrigé en 256).
    pub fn tx_data(&mut self, data: &[u8]) -> Result<()> {
        Self::tx_data_impl(&mut *self.port, data)
    }

    fn tx_data_impl(port: &mut dyn SerialPort, data: &[u8]) -> Result<()> {
        let mut offset = 0;
        let mut len = data.len();
        while len > 0 {
            let mut block = len.min(4096);
            if block == 512 {
                block = 256; // 512 ne fonctionne pas bien pour certaines opérations
            }
            port.write_all(&data[offset..offset + block])?;
            port.flush()?;
            trace("TX", &data[offset..offset + block]);
            len -= block;
            offset += block;
        }
        Ok(())
    }

    /// Réception de `len` octets exactement.
    pub fn rx_data(&mut self, len: usize) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; len];
        let mut filled = 0;
        while filled < len {
            let n = match self.port.read(&mut buf[filled..]) {
                Ok(n) => n,
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    trace("RX", &buf[..filled]);
                    return Err(EdError::Other(format!(
                        "timeout de lecture : la carte n'a renvoyé que {filled}/{len} octets \
                         (activez EDLINK_TRACE pour voir la trame reçue)"
                    )));
                }
                Err(e) => return Err(e.into()),
            };
            if n == 0 {
                return Err(EdError::Other("read timeout".into()));
            }
            filled += n;
        }
        trace("RX", &buf);
        Ok(buf)
    }

    /// Écrit des données avec accusé de réception par blocs (utilisé par
    /// l'écriture de fichiers / FIFO / flash).
    pub fn tx_data_ack(&mut self, data: &[u8]) -> Result<()> {
        self.tx_data_ack_progress(data, |_, _| {})
    }

    /// Comme [`Self::tx_data_ack`], en appelant `progress(octets_émis, total)`
    /// après chaque bloc acquitté (barre de progression d'un upload).
    pub fn tx_data_ack_progress<P: FnMut(u64, u64)>(
        &mut self,
        data: &[u8],
        mut progress: P,
    ) -> Result<()> {
        let ack_block_size = 1024;
        let total = data.len() as u64;
        let mut offset = 0;
        let mut len = data.len();
        progress(0, total);
        while len > 0 {
            let resp = self.rx8()?;
            if resp != 0 {
                return Err(EdError::DeviceError(resp));
            }
            let block = len.min(ack_block_size);
            self.tx_data(&data[offset..offset + block])?;
            len -= block;
            offset += block;
            progress(offset as u64, total);
        }
        Ok(())
    }

    /// Purge le flux entrant du port.
    fn flush_port(port: &mut dyn SerialPort) -> std::io::Result<()> {
        let mut buf = [0u8; 4096];
        loop {
            match port.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
        Ok(())
    }

    /// Renvoie l'identité (4 octets) de la carte et, au premier appel, détecte
    /// son protocole.
    pub fn get_id(&mut self) -> Result<[u8; 4]> {
        let cfg = match self.cfg {
            Some(c) => c,
            None => self.get_device_config()?,
        };

        self.tx_cmd(CMD_STATUS)?;

        let mut id = [0u8; 4];
        match cfg.protocol {
            Protocol::Gen3 => {
                let b = self.rx_data(4)?;
                id.copy_from_slice(&b);
            }
            _ => {
                // protocoles legacy (non utilisés par TED) : transformés en Gen3
                if cfg.protocol_id == PROTOCOL_ID_N8 {
                    id[3] = self.rx8()?;
                    id[0] = self.rx8()?;
                } else {
                    id[0] = self.rx8()?;
                    id[3] = self.rx8()?;
                }
                if id[0] != STATUS_KEY_OLD {
                    return Err(EdError::Other("invalid status key".into()));
                }
                id[1] = cfg.protocol_id;
                id[2] = cfg.device_id;
            }
        }

        // Validation
        let target_protocol = if self.protocol_id() == 0 {
            cfg.protocol_id
        } else {
            self.protocol_id()
        };
        let target_device = if self.device_id() == 0 {
            cfg.device_id
        } else {
            self.device_id()
        };

        if id[0] != STATUS_KEY {
            return Err(EdError::Other("invalid status key".into()));
        }
        if id[1] != target_protocol {
            return Err(EdError::Other(format!(
                "invalid protocol id ({} != {})",
                id[1], target_protocol
            )));
        }
        if id[2] != target_device {
            return Err(EdError::Other(format!(
                "invalid device id ({} != {})",
                id[2], target_device
            )));
        }

        if self.cfg.is_none() {
            self.cfg = Some(cfg);
        }

        Ok(id)
    }

    /// Lit le statut de la dernière opération (octet[3] de l'identité).
    pub fn status(&mut self) -> Result<u8> {
        let id = self.get_id()?;
        Ok(id[3])
    }

    /// S'assure que le statut est nul, sinon renvoie une erreur d'appareil.
    pub fn check_status(&mut self) -> Result<()> {
        let s = self.status()?;
        if s != 0 {
            return Err(EdError::DeviceError(s));
        }
        Ok(())
    }

    fn get_device_config(&mut self) -> Result<Cfg> {
        self.tx_cmd(CMD_STATUS2)?;
        self.tx_cmd(CMD_STATUS)?;

        let mut id = [0u8; 4];
        let b = self.rx_data(2)?;
        id[0] = b[0];
        id[1] = b[1];

        if id[0] == STATUS_KEY {
            // Nouveau protocole (Gen2/Gen3)
            let b2 = self.rx_data(2)?;
            id[2] = b2[0];
            id[3] = b2[1];

            let protocol = if id[1] == PROTOCOL_ID_MEGA || id[1] == PROTOCOL_ID_N8 {
                Protocol::Gen2
            } else {
                Protocol::Gen3
            };
            Ok(Cfg {
                protocol,
                protocol_id: id[1],
                device_id: id[2],
            })
        } else if id[0] == STATUS_KEY_OLD {
            // legacy MEGA
            Ok(Cfg {
                protocol: Protocol::Gen1,
                protocol_id: PROTOCOL_ID_MEGA,
                device_id: 0x18,
            })
        } else if id[1] == STATUS_KEY_OLD {
            // legacy N8
            Ok(Cfg {
                protocol: Protocol::Gen1,
                protocol_id: PROTOCOL_ID_N8,
                device_id: 0x17,
            })
        } else {
            Err(EdError::Other(format!("unexpected status key {}", id[0])))
        }
    }

    fn num16(&self, v: u16) -> [u8; 2] {
        let mut out = [0u8; 2];
        if self.swap_endians {
            out[0] = (v >> 8) as u8;
            out[1] = v as u8;
        } else {
            out[0] = v as u8;
            out[1] = (v >> 8) as u8;
        }
        out
    }

    fn num32(&self, v: u32) -> [u8; 4] {
        let mut out = [0u8; 4];
        if self.swap_endians {
            for i in 0..4 {
                out[3 - i] = (v >> (8 * i)) as u8;
            }
        } else {
            for i in 0..4 {
                out[i] = (v >> (8 * i)) as u8;
            }
        }
        out
    }

    fn u16_of(&self, b: &[u8]) -> u16 {
        if self.swap_endians {
            ((b[0] as u16) << 8) | (b[1] as u16)
        } else {
            (b[0] as u16) | ((b[1] as u16) << 8)
        }
    }

    fn u32_of(&self, b: &[u8]) -> u32 {
        let mut out = 0u32;
        if self.swap_endians {
            for i in 0..4 {
                out = (out << 8) | b[i] as u32;
            }
        } else {
            for i in 0..4 {
                out |= (b[i] as u32) << (8 * i);
            }
        }
        out
    }
}
