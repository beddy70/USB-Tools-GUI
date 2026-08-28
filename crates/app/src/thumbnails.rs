//! Pochettes de jeu via la base [Libretro Thumbnails](https://github.com/libretro-thumbnails)
//! (dépôts GitHub, un par système, mis à jour par la communauté RetroArch).
//!
//! Chaque dépôt contient trois dossiers d'images PNG nommées d'après le titre
//! du jeu en convention *No-Intro* :
//!   `Named_Boxarts/<Titre> (Région).png`  — jaquette
//!   `Named_Snaps/<Titre> (Région).png`    — capture en jeu
//!   `Named_Titles/<Titre> (Région).png`   — écran-titre
//!
//! Les noms de ROM sur une vraie carte SD suivent souvent une autre
//! convention (GoodTools/TOSEC : « Dragon's Curse (U).pce ») que No-Intro
//! (« Dragon's Curse (USA).png ») : [`name_variants`] tente quelques
//! substitutions usuelles des codes de région, sans garantie de résultat sur
//! tous les jeux — un jeu sans jaquette trouvée reste juste sans image.
//!
//! Une requête réseau (`reqwest`, rustls — pas d'OpenSSL, pour rester
//! cross-compilable vers Windows) par variante essayée, dans l'ordre, jusqu'à
//! la première réponse 200 ; le résultat (trouvé ou non) est mis en cache sur
//! disque (`app_cache_dir()/thumbnails/`) pour ne plus jamais refaire cette
//! requête ensuite.

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use std::path::{Path, PathBuf};

/// Caractères non réservés (RFC 3986) qu'on laisse lisibles dans l'URL —
/// le reste (espaces, apostrophes, virgules, parenthèses…) est encodé.
const ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

const REPO_TG16: &str = "NEC_-_PC_Engine_-_TurboGrafx_16";
const REPO_SGX: &str = "NEC_-_PC_Engine_SuperGrafx";

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Kind {
    Boxart,
    Snap,
    /// Écran-titre — pas encore câblé côté commandes Tauri, gardé pour
    /// compléter l'API si l'écran-titre s'avère utile plus tard.
    #[allow(dead_code)]
    Title,
}

impl Kind {
    fn folder(self) -> &'static str {
        match self {
            Kind::Boxart => "Named_Boxarts",
            Kind::Snap => "Named_Snaps",
            Kind::Title => "Named_Titles",
        }
    }
}

fn repo_for_ext(ext: &str) -> &'static str {
    if ext.eq_ignore_ascii_case("sgx") {
        REPO_SGX
    } else {
        REPO_TG16
    }
}

/// Sépare le nom de fichier en `(stem, extension_minuscule)`.
fn split_ext(file_name: &str) -> (&str, String) {
    match file_name.rsplit_once('.') {
        Some((stem, ext)) => (stem, ext.to_lowercase()),
        None => (file_name, String::new()),
    }
}

/// Caractères interdits dans un nom de playlist RetroArch → `_` (règle du
/// dépôt libretro-thumbnails).
fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if "&*/:`<>?\\|\"".contains(c) { '_' } else { c })
        .collect()
}

/// Variantes du titre à essayer, du plus proche du nom de fichier d'origine
/// au plus généraliste. Couvre les abréviations de région GoodTools/TOSEC les
/// plus courantes, en toute fin de nom.
fn name_variants(stem: &str) -> Vec<String> {
    let mut out = vec![stem.to_string()];
    const REGION_MAP: &[(&str, &str)] = &[
        (" (U)", " (USA)"),
        (" (J)", " (Japan)"),
        (" (E)", " (Europe)"),
        (" (UE)", " (USA, Europe)"),
        (" (JU)", " (Japan, USA)"),
        (" (JUE)", " (Japan, USA, Europe)"),
        (" (W)", " (World)"),
    ];
    for (from, to) in REGION_MAP {
        if let Some(base) = stem.strip_suffix(from) {
            out.push(format!("{base}{to}"));
        }
    }
    // Dernier essai : le titre nu, sans aucune parenthèse finale (perd
    // l'information de région, mais capte le cas où une seule version du jeu
    // est référencée côté Libretro).
    if let Some(idx) = stem.rfind(" (") {
        let bare = stem[..idx].trim();
        if !bare.is_empty() && !out.iter().any(|v| v == bare) {
            out.push(bare.to_string());
        }
    }
    out
}

fn candidate_urls(rom_file_name: &str, kind: Kind) -> Vec<(String, String)> {
    let (stem, ext) = split_ext(rom_file_name);
    let repo = repo_for_ext(&ext);
    name_variants(stem)
        .into_iter()
        .map(|variant| {
            let clean = sanitize(&variant);
            let encoded = utf8_percent_encode(&clean, ENCODE_SET);
            let url = format!(
                "https://raw.githubusercontent.com/libretro-thumbnails/{repo}/master/{}/{encoded}.png",
                kind.folder()
            );
            (url, format!("{repo}/{}/{clean}.png", kind.folder()))
        })
        .collect()
}

/// Chemin de cache pour une clé de cache donnée (nom de dépôt/dossier/fichier,
/// tel que renvoyé en second élément de [`candidate_urls`]).
fn cache_path(cache_dir: &Path, cache_key: &str) -> PathBuf {
    cache_dir.join("thumbnails").join(cache_key)
}

/// Marqueur d'échec (aucune variante trouvée) : évite de re-taper le réseau à
/// chaque ouverture du dossier pour un jeu déjà su sans jaquette.
fn miss_marker(cache_dir: &Path, rom_file_name: &str, kind: Kind) -> PathBuf {
    let (stem, ext) = split_ext(rom_file_name);
    cache_dir
        .join("thumbnails")
        .join(".miss")
        .join(repo_for_ext(&ext))
        .join(kind.folder())
        .join(format!("{}.none", sanitize(stem)))
}

/// Cherche (cache disque puis réseau) l'image `kind` pour ce fichier ROM.
/// Renvoie les octets PNG si trouvés.
pub async fn fetch(cache_dir: &Path, rom_file_name: &str, kind: Kind) -> Option<Vec<u8>> {
    let miss = miss_marker(cache_dir, rom_file_name, kind);
    if miss.exists() {
        return None;
    }

    for (url, cache_key) in candidate_urls(rom_file_name, kind) {
        let path = cache_path(cache_dir, &cache_key);
        if let Ok(bytes) = std::fs::read(&path) {
            return Some(bytes);
        }
        let resp = match reqwest::get(&url).await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(bytes) = resp.bytes().await else { continue };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, &bytes);
        return Some(bytes.to_vec());
    }

    if let Some(parent) = miss.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&miss, b"");
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_map_goodtools_region_codes() {
        let v = name_variants("Dragon's Curse (U)");
        assert!(v.contains(&"Dragon's Curse (USA)".to_string()));
    }

    #[test]
    fn sanitize_replaces_forbidden_chars() {
        assert_eq!(sanitize("Time & Tide"), "Time _ Tide");
    }

    // Réseau réel — désactivé par défaut (`cargo test -- --ignored` pour l'exécuter).
    // `tauri::async_runtime::block_on` évite d'ajouter `tokio` en dépendance
    // directe rien que pour ce test (déjà tiré par `tauri`/`reqwest`).
    #[test]
    #[ignore]
    fn fetch_known_game_boxart() {
        let dir = std::env::temp_dir().join("edlink-thumb-test");
        let _ = std::fs::remove_dir_all(&dir);
        let bytes = tauri::async_runtime::block_on(fetch(&dir, "Dragon's Curse (U).pce", Kind::Boxart));
        assert!(bytes.is_some(), "attendu : jaquette trouvée via variante (USA)");
    }
}
