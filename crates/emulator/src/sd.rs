//! Carte SD virtuelle : un dossier local utilisé comme système de fichiers.
//!
//! Les chemins "périphériques" utilisés par le protocole (ex: `/GAMES/jeu.pce`)
//! sont résolus relativement au dossier racine, sans jamais pouvoir s'en
//! échapper (les segments `..` sont ignorés).

use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::PathBuf;

pub struct VirtualSd {
    root: PathBuf,
}

/// Une entrée de la carte SD virtuelle (fichier ou dossier).
pub struct SdEntryData {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

impl VirtualSd {
    pub fn new(root: impl Into<PathBuf>) -> io::Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        Ok(VirtualSd { root })
    }

    /// Résout un chemin "périphérique" (ex: `/GAMES/jeu.pce`) vers un chemin
    /// local dans le dossier racine. Le '/' de tête est ignoré.
    pub fn resolve(&self, dev_path: &str) -> PathBuf {
        let trimmed = dev_path.trim_start_matches('/');
        let mut p = self.root.clone();
        for seg in trimmed.split('/') {
            if !seg.is_empty() && seg != "." && seg != ".." {
                p.push(seg);
            }
        }
        p
    }

    pub fn open_read(&self, dev_path: &str) -> io::Result<File> {
        OpenOptions::new().read(true).open(self.resolve(dev_path))
    }

    /// Ouvre (ou crée/tronque) un fichier en écriture, en créant ses dossiers
    /// parents.
    pub fn open_create(&self, dev_path: &str) -> io::Result<File> {
        let p = self.resolve(dev_path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(p)
    }

    pub fn open_append(&self, dev_path: &str) -> io::Result<File> {
        OpenOptions::new().write(true).create(true).open(self.resolve(dev_path))
    }

    /// Crée un dossier et ses parents.
    /// Renvoie `Ok(false)` si le dossier existait déjà, `Ok(true)` s'il a été créé.
    pub fn make_dir(&self, dev_path: &str) -> io::Result<bool> {
        let p = self.resolve(dev_path);
        if p.is_dir() {
            return Ok(false);
        }
        fs::create_dir_all(&p)?;
        Ok(true)
    }

    /// Liste les entrées d'un dossier (nom, est-un-dossier, taille en octets).
    /// Ignore les entrées cachées (nom commençant par '.'). Si le dossier
    /// n'existe pas, renvoie une liste vide.
    pub fn read_dir(&self, dev_path: &str) -> io::Result<Vec<SdEntryData>> {
        let mut out = Vec::new();
        for e in fs::read_dir(self.resolve(dev_path))?.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let ft = e.file_type()?;
            let size = if ft.is_file() {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };
            out.push(SdEntryData {
                name,
                is_dir: ft.is_dir(),
                size,
            });
        }
        Ok(out)
    }
}
