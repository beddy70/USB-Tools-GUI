//! # edlink-core
//!
//! Protocole de communication avec les cartouches **EverDrive** via port série
//! USB, porté en Rust depuis la référence officielle `krikzz/edlink` (MIT).
//!
//! Le crate se concentre sur la **Turbo EverDrive Pro / Core** (protocole V1,
//! génération Gen3). Il fournit les opérations suivantes :
//!
//! - connexion / détection de la carte (`Ted::connect`)
//! - infos appareil (`Ted::devinf`)
//! - copie de fichiers hôte <-> SD (`Ted::copy_file`)
//! - lancement d'un jeu (`Ted::run`)
//! - reset console (`Ted::reset`)
//! - capture d'écran du menu (`Ted::screen`, renvoie un PNG)
//! - lecture mémoire lecture seule (`Ted::mem_rd`)
//! - listing d'un dossier de la carte SD (`Ted::list_dir`)
//!
//! Le listing de dossier utilise la couche FS (`CMD_F_DIR_OPN` / `CMD_F_DIR_RD`)
//! du firmware MCU partagé des cartes « Pro » : elle n'est pas câblée par
//! l'`edlink` de référence mais fait partie du protocole du firmware. Voir
//! `Ted::list_dir` et `docs/PROTOCOL.md`.

pub mod error;
pub mod image;
pub mod link;
pub mod protocol;
pub mod ted;

pub use error::{EdError, Result};
pub use ted::{SdEntry, Ted};

/// Liste les ports série disponibles sur le système.
pub fn available_ports() -> Result<Vec<String>> {
    serialport::available_ports()
        .map(|ps| ps.into_iter().map(|p| p.port_name).collect())
        .map_err(|e| {
            EdError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })
}
