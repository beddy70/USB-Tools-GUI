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
//! (« Dragon's Curse (USA).png ») : deux niveaux de recherche, du plus fiable
//! au plus approximatif :
//!
//! 1. [`name_variants`] essaie quelques substitutions usuelles des codes de
//!    région (résultat noté confiance 1.0 — c'est une transformation connue,
//!    pas une supposition) ;
//! 2. si aucune variante ne correspond, repli sur une **recherche au plus
//!    proche** dans l'index complet des titres du dépôt (téléchargé une seule
//!    fois via l'API GitHub « git trees », mis en cache indéfiniment) : le
//!    titre le plus proche par similarité de texte est retenu s'il dépasse
//!    [`FUZZY_THRESHOLD`], avec son score en pourcentage.
//!
//! Un jeu sans correspondance suffisamment proche reste simplement sans
//! image — l'utilisateur peut alors forcer manuellement un titre via le
//! mapping de noms (gear de la mosaïque, frontend).
//!
//! Requêtes réseau via `reqwest` (rustls — pas d'OpenSSL, pour rester
//! cross-compilable vers Windows) ; tout résultat (trouvé ou non, variante ou
//! approché) est mis en cache sur disque (`app_cache_dir()/thumbnails/`) pour
//! ne plus jamais refaire cette requête ensuite.

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Deserialize;
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

/// Score minimum (similarité de texte normalisée, 0.0–1.0) pour accepter une
/// correspondance approchée. Volontairement élevé : mieux vaut aucune
/// pochette qu'une pochette du mauvais jeu.
const FUZZY_THRESHOLD: f64 = 0.80;

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

/// Une pochette trouvée : ses octets PNG, le titre exact utilisé dans la
/// base, et un score de confiance (1.0 = variante de région connue, sinon
/// score de similarité de la recherche approchée).
pub struct ThumbMatch {
    pub bytes: Vec<u8>,
    pub matched_title: String,
    pub score: f64,
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

/// URL brute + clé de cache pour un titre déjà résolu (variante connue ou
/// résultat d'une recherche approchée).
fn url_and_cache_key(repo: &str, folder: &str, title: &str) -> (String, String) {
    let clean = sanitize(title);
    let encoded = utf8_percent_encode(&clean, ENCODE_SET);
    let url = format!(
        "https://raw.githubusercontent.com/libretro-thumbnails/{repo}/master/{folder}/{encoded}.png"
    );
    (url, format!("{repo}/{folder}/{clean}.png"))
}

fn cache_path(cache_dir: &Path, cache_key: &str) -> PathBuf {
    cache_dir.join("thumbnails").join(cache_key)
}

/// Marqueur d'échec (aucune variante ni correspondance approchée trouvée) :
/// évite de re-taper le réseau à chaque ouverture du dossier pour un jeu déjà
/// su sans jaquette.
fn miss_marker(cache_dir: &Path, rom_file_name: &str, kind: Kind) -> PathBuf {
    let (stem, ext) = split_ext(rom_file_name);
    cache_dir
        .join("thumbnails")
        .join(".miss")
        .join(repo_for_ext(&ext))
        .join(kind.folder())
        .join(format!("{}.none", sanitize(stem)))
}

/// Télécharge (ou lit du cache) l'image au titre exact donné. `Ok` interne
/// utilisé aussi bien pour les variantes connues que pour une correspondance
/// approchée — seul le titre change.
async fn fetch_exact(cache_dir: &Path, repo: &str, folder: &str, title: &str) -> Option<Vec<u8>> {
    let (url, cache_key) = url_and_cache_key(repo, folder, title);
    let path = cache_path(cache_dir, &cache_key);
    if let Ok(bytes) = std::fs::read(&path) {
        return Some(bytes);
    }
    let resp = reqwest::get(&url).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, &bytes);
    Some(bytes.to_vec())
}

#[derive(Deserialize)]
struct GhTreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct GhTreeResponse {
    tree: Vec<GhTreeEntry>,
}

/// Liste (mise en cache **indéfiniment** sur disque après le premier succès :
/// un seul appel réseau par dépôt/dossier, jamais réédité) des titres présents
/// dans `<repo>/<folder>` sur GitHub, via l'API « git trees » (une requête
/// pour tout le dépôt, plutôt qu'un appel par jeu). Renvoie une liste vide en
/// cas d'échec réseau — aucun cache n'est alors écrit, un futur appel
/// réessaiera.
async fn repo_index(cache_dir: &Path, repo: &str, folder: &str) -> Vec<String> {
    let index_path = cache_dir
        .join("thumbnails")
        .join(".index")
        .join(repo)
        .join(format!("{folder}.txt"));
    if let Ok(text) = std::fs::read_to_string(&index_path) {
        return text.lines().map(str::to_string).collect();
    }

    let url = format!(
        "https://api.github.com/repos/libretro-thumbnails/{repo}/git/trees/master?recursive=1"
    );
    let client = match reqwest::Client::builder()
        .user_agent("edlink-app-thumbnails (github.com/beddy70/USB-Tools-GUI)")
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let Ok(resp) = client.get(&url).send().await else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(parsed) = resp.json::<GhTreeResponse>().await else {
        return Vec::new();
    };

    let prefix = format!("{folder}/");
    let suffix = ".png";
    let names: Vec<String> = parsed
        .tree
        .into_iter()
        .filter(|e| e.kind == "blob" && e.path.starts_with(&prefix) && e.path.ends_with(suffix))
        .map(|e| e.path[prefix.len()..e.path.len() - suffix.len()].to_string())
        .collect();

    if !names.is_empty() {
        if let Some(parent) = index_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&index_path, names.join("\n"));
    }
    names
}

/// Similarité normalisée [0.0, 1.0] entre deux titres, insensible à la casse
/// (distance de Levenshtein normalisée — `strsim`).
fn similarity(a: &str, b: &str) -> f64 {
    strsim::normalized_levenshtein(&a.to_lowercase(), &b.to_lowercase())
}

/// Le titre le plus proche de `stem` dans `candidates`, si son score dépasse
/// [`FUZZY_THRESHOLD`].
fn best_fuzzy_match(stem: &str, candidates: &[String]) -> Option<(String, f64)> {
    candidates
        .iter()
        .map(|c| (c.clone(), similarity(stem, c)))
        .filter(|(_, score)| *score >= FUZZY_THRESHOLD)
        .max_by(|a, b| a.1.total_cmp(&b.1))
}

/// Cherche (variantes connues, puis recherche au plus proche, cache disque à
/// chaque étape) l'image `kind` pour ce fichier ROM.
pub async fn fetch(cache_dir: &Path, rom_file_name: &str, kind: Kind) -> Option<ThumbMatch> {
    let miss = miss_marker(cache_dir, rom_file_name, kind);
    if miss.exists() {
        return None;
    }

    let (stem, ext) = split_ext(rom_file_name);
    let repo = repo_for_ext(&ext);
    let folder = kind.folder();

    // 1) variantes de région connues — confiance maximale, pas une supposition.
    for variant in name_variants(stem) {
        if let Some(bytes) = fetch_exact(cache_dir, repo, folder, &variant).await {
            return Some(ThumbMatch { bytes, matched_title: variant, score: 1.0 });
        }
    }

    // 2) repli : recherche au plus proche dans l'index complet du dépôt.
    let index = repo_index(cache_dir, repo, folder).await;
    if let Some((matched_title, score)) = best_fuzzy_match(stem, &index) {
        if let Some(bytes) = fetch_exact(cache_dir, repo, folder, &matched_title).await {
            return Some(ThumbMatch { bytes, matched_title, score });
        }
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

    #[test]
    fn fuzzy_match_picks_closest_above_threshold() {
        let candidates = vec![
            "Bomberman '93 (Japan)".to_string(),
            "Air Zonk (USA)".to_string(),
        ];
        let (title, score) = best_fuzzy_match("Bomberman 93 (Japan)", &candidates).unwrap();
        assert_eq!(title, "Bomberman '93 (Japan)");
        assert!(score >= FUZZY_THRESHOLD);
    }

    #[test]
    fn fuzzy_match_rejects_below_threshold() {
        let candidates = vec!["Completely Unrelated Title".to_string()];
        assert!(best_fuzzy_match("Dragon's Curse (USA)", &candidates).is_none());
    }

    // Réseau réel — désactivé par défaut (`cargo test -- --ignored` pour l'exécuter).
    // `tauri::async_runtime::block_on` évite d'ajouter `tokio` en dépendance
    // directe rien que pour ce test (déjà tiré par `tauri`/`reqwest`).
    #[test]
    #[ignore]
    fn fetch_known_game_boxart() {
        let dir = std::env::temp_dir().join("edlink-thumb-test");
        let _ = std::fs::remove_dir_all(&dir);
        let m = tauri::async_runtime::block_on(fetch(&dir, "Dragon's Curse (U).pce", Kind::Boxart));
        let m = m.expect("attendu : jaquette trouvée via variante (USA)");
        assert_eq!(m.score, 1.0);
    }

    // Réseau réel — un nom volontairement éloigné pour forcer le repli sur la
    // recherche approchée (pas de variante région connue ne peut matcher).
    #[test]
    #[ignore]
    fn fetch_fuzzy_fallback() {
        let dir = std::env::temp_dir().join("edlink-thumb-test-fuzzy");
        let _ = std::fs::remove_dir_all(&dir);
        let m = tauri::async_runtime::block_on(fetch(&dir, "Bomberman 93 (Japan).pce", Kind::Boxart));
        let m = m.expect("attendu : correspondance approchée trouvée");
        assert!(m.score < 1.0);
        assert!(m.score >= FUZZY_THRESHOLD);
        println!("matched: {} ({:.0}%)", m.matched_title, m.score * 100.0);
    }
}
