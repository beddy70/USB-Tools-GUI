//! Création d'un pseudo-terminal (PTY) servant de port série virtuel.
//!
//! Sur les systèmes Unix (macOS/Linux), un PTY fournit une paire de
//! terminaux : le côté **maître** est lu/écrit par l'émulateur (côté
//! "périphérique"), le côté **esclave** expose un chemin `/dev/ttysXXX` que
//! l'application hôte (`edlink-core`) ouvre exactement comme un vrai port
//! série USB.

use nix::fcntl::OFlag;
use nix::pty::{grantpt, posix_openpt, ptsname, unlockpt, PtyMaster};
use std::io;

/// Une paire maître/esclave de pseudo-terminal.
pub struct PtyPair {
    /// Côté maître : interface du "périphérique" (émulateur).
    pub master: PtyMaster,
    /// Chemin du côté esclave (ex: `/dev/ttys003`) : c'est ce chemin que
    /// l'application hôte doit ouvrir comme port série.
    pub slave_path: String,
}

/// Crée un PTY et renvoie le côté maître + le chemin du slave.
pub fn create_pty() -> io::Result<PtyPair> {
    let master = posix_openpt(OFlag::O_RDWR).map_err(|e| io::Error::other(e.to_string()))?;
    grantpt(&master).map_err(|e| io::Error::other(e.to_string()))?;
    unlockpt(&master).map_err(|e| io::Error::other(e.to_string()))?;
    let name = unsafe { ptsname(&master) }.map_err(|e| io::Error::other(e.to_string()))?;
    Ok(PtyPair { master, slave_path: name })
}
