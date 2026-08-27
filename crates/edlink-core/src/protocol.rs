//! Codes de commandes du protocole EverDrive (port Rust de `DeviceIO_V1.cs`).
//!
//! Chaque commande est émise via [`crate::link::Link::tx_cmd`] qui enveloppe le
//! code dans une trame de 4 octets : `['+', '+'^0xFF, code, code^0xFF]`.

pub const STATUS_KEY: u8 = 0x5A;

// ---- Commandes de la couche "V1" (Turbo EverDrive) ----
pub const CMD_STATUS: u8 = 0x10;
pub const CMD_GET_MODE: u8 = 0x11;
pub const CMD_RST_MCU: u8 = 0x12;
pub const CMD_GET_VDC: u8 = 0x13;
pub const CMD_RTC_GET: u8 = 0x14;
pub const CMD_RTC_SET: u8 = 0x15;
pub const CMD_FLA_RD: u8 = 0x16;
pub const CMD_FLA_WR: u8 = 0x17;
pub const CMD_MEM_RD: u8 = 0x19;
pub const CMD_MEM_WR: u8 = 0x1A;
pub const CMD_SYS_INF: u8 = 0x26;
pub const CMD_HOST_RST: u8 = 0x29;
pub const CMD_STATUS2: u8 = 0x40;

// ---- Commandes système de fichiers (carte SD) ----
pub const CMD_F_DIR_OPN: u8 = 0xC3; // ouvre un dossier et renvoie son contenu
pub const CMD_F_FOPN: u8 = 0xC9;
pub const CMD_F_FRD: u8 = 0xCA;
pub const CMD_F_FWR: u8 = 0xCC;
pub const CMD_F_FCLOSE: u8 = 0xCE;
pub const CMD_F_AVB: u8 = 0xD5;
pub const CMD_F_DIR_MK: u8 = 0xD2;

// ---- Flags d'accès fichiers (FatFs-like) ----
pub const FA_READ: u8 = 0x01;
pub const FA_WRITE: u8 = 0x02;
pub const FA_CREATE_ALWAYS: u8 = 0x08;
pub const FS_MAKEPATH: u8 = 0x80;

// ---- Modes reset hôte (Turbo EverDrive) ----
pub const HOST_RST_OFF: u8 = 0;
pub const HOST_RST_ON: u8 = 1;

// ---- Identifiants Turbo EverDrive ----
pub const PROTOCOL_ID_TED: u8 = 0x02;
pub const DEV_ID_TURBO_PRO: u8 = 0x20;
pub const DEV_ID_TURBO_CORE: u8 = 0x26;

// ---- Adresses mémoire de la Turbo EverDrive Pro ----
pub const ADDR_FCI_RAM1: u32 = 0x0000_0000; // banque RAM0 (jeu / HuCard virtuelle)
pub const ADDR_FCI_RAM2: u32 = 0x0080_0000; // banque RAM1 (Pro uniquement)
pub const SIZE_RAM0: u32 = 0x0080_0000; // 8 Mo
pub const SIZE_RAM1_PRO: u32 = 0x0080_0000; // 8 Mo
pub const ADDR_FCI_CFG: u32 = 0x0180_0000; // registre config
pub const ADDR_FCI_FIFO: u32 = 0x0181_0000; // FIFO hôte
