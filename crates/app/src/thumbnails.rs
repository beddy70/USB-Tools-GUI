//! Pochettes de jeu, en deux modes au choix (frontend, par utilisateur) :
//!
//! - **Réseau** : base communautaire [Libretro
//!   Thumbnails](https://github.com/libretro-thumbnails) (dépôts GitHub, un
//!   par système, mis à jour par la communauté RetroArch) ;
//! - **Local** ([`Source::Local`]) : un dossier `DB_Thumbnails` sur le
//!   disque de l'utilisateur, avec exactement la même arborescence que les
//!   dépôts ci-dessus (pratique pour cloner/copier une fois le dépôt en
//!   local et travailler hors ligne) : `DB_Thumbnails/<dépôt>/<dossier>/`.
//!
//! Dans les deux cas, l'arborescence attendue est celle des dépôts
//! libretro-thumbnails : un sous-dossier par système
//! (`NEC_-_PC_Engine_-_TurboGrafx_16` ou `NEC_-_PC_Engine_SuperGrafx`, selon
//! l'extension de la ROM), lui-même contenant des dossiers d'images PNG
//! nommées d'après le titre du jeu en convention *No-Intro* :
//!   `Named_Boxarts/<Titre> (Région).png`  — jaquette
//!   `Named_Snaps/<Titre> (Région).png`    — capture en jeu
//!   `Named_Titles/<Titre> (Région).png`   — écran-titre
//!   `Named_Logos/<Titre> (Région).png`    — logo (présent côté dépôt, non
//!                                            utilisé par cette application)
//!
//! Les noms de ROM sur une vraie carte SD suivent souvent une autre
//! convention (GoodTools/TOSEC : « Dragon's Curse (U).pce ») que No-Intro
//! (« Dragon's Curse (USA).png ») : deux niveaux de recherche, du plus fiable
//! au plus approximatif, communs aux deux modes :
//!
//! 1. [`name_variants`] essaie quelques substitutions usuelles des codes de
//!    région (résultat noté confiance 1.0 — c'est une transformation connue,
//!    pas une supposition) ;
//! 2. si aucune variante ne correspond, repli sur une **recherche au plus
//!    proche** dans l'index complet des titres disponibles (téléchargé une
//!    seule fois via l'API GitHub « git trees » en mode réseau, mis en cache
//!    indéfiniment ; simple listage du dossier en mode local) : le titre le
//!    plus proche par similarité de texte est retenu s'il dépasse
//!    [`FUZZY_THRESHOLD`], avec son score en pourcentage.
//!
//! Un jeu sans correspondance suffisamment proche reste simplement sans
//! image — l'utilisateur peut alors forcer manuellement un titre via le
//! mapping de noms (gear de la mosaïque, frontend).
//!
//! Mode réseau : requêtes via `reqwest` (rustls — pas d'OpenSSL, pour rester
//! cross-compilable vers Windows) ; tout résultat (trouvé ou non, variante ou
//! approché) est mis en cache sur disque (`app_cache_dir()/thumbnails/`) pour
//! ne plus jamais refaire cette requête ensuite. Mode local : lecture directe
//! du disque à chaque appel, pas de cache nécessaire (déjà local).

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
    /// Écran-titre — alterne avec `Snap` dans la fiche de détail (frontend).
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

/// D'où lire les pochettes — choix fait côté frontend (paramètre utilisateur,
/// persisté en `localStorage`), transmis à chaque appel.
pub enum Source {
    /// Dépôts GitHub `libretro-thumbnails` (comportement historique).
    Network,
    /// Dossier local `DB_Thumbnails`, même arborescence que les dépôts
    /// ci-dessus (voir le commentaire de module).
    Local(PathBuf),
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

/// « Ratio partiel » façon fuzzywuzzy/RapidFuzz : aligne la chaîne la plus
/// courte sur la meilleure sous-fenêtre de la plus longue (quelques longueurs
/// de fenêtre proches de `short`, pour absorber une petite variation en plus
/// du décalage de position). Beaucoup de titres PC Engine japonais sont
/// référencés côté Libretro avec le titre original ajouté en préfixe (ex.
/// « Busou Keiji - Cyber Cross (Japan) » pour la ROM « Cyber Cross (J).pce ») :
/// une distance de Levenshtein sur la chaîne entière s'effondre à cause de la
/// longueur ajoutée, alors que le cœur du titre correspond exactement.
fn partial_ratio(a: &str, b: &str) -> f64 {
    let (short, long): (&str, &str) = if a.chars().count() <= b.chars().count() {
        (a, b)
    } else {
        (b, a)
    };
    let short_len = short.chars().count();
    let long_chars: Vec<char> = long.chars().collect();
    let long_len = long_chars.len();
    if short_len == 0 || long_len == 0 {
        return 0.0;
    }
    if short_len >= long_len {
        return strsim::normalized_levenshtein(short, long);
    }

    let mut best = 0.0f64;
    let max_extra = 4usize.min(long_len - short_len);
    for extra in 0..=max_extra {
        let win_len = short_len + extra;
        for start in 0..=(long_len - win_len) {
            let window: String = long_chars[start..start + win_len].iter().collect();
            let score = strsim::normalized_levenshtein(short, &window);
            if score > best {
                best = score;
            }
        }
    }
    best
}

/// Similarité [0.0, 1.0] entre deux titres, insensible à la casse : le
/// meilleur des deux entre la distance de Levenshtein sur la chaîne entière
/// (titres proches globalement) et le ratio partiel (titre entièrement
/// contenu dans l'autre, préfixe/suffixe différent).
fn similarity(a: &str, b: &str) -> f64 {
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    strsim::normalized_levenshtein(&a, &b).max(partial_ratio(&a, &b))
}

/// Éclate un titre « Principal - Sous-titre (Région) » en ses segments, le
/// titre entier étant toujours inclus en premier. Convention No-Intro très
/// courante côté PC Engine : beaucoup de jeux japonais sont référencés ainsi
/// (ex. « Narazumono Sentou Butai - Bloody Wolf (Japan) »), et le nom utilisé
/// par les dumps ROM correspond souvent à **un seul** des deux segments — pas
/// toujours le même côté (parfois le titre japonais d'origine, parfois le
/// titre/sous-titre anglais) — d'où la comparaison des deux indépendamment,
/// en plus de la chaîne entière.
fn title_segments(title: &str) -> Vec<&str> {
    let mut out = vec![title];
    if let Some(idx) = title.find(" - ") {
        let (a, b) = (title[..idx].trim(), title[idx + 3..].trim());
        if !a.is_empty() {
            out.push(a);
        }
        if !b.is_empty() {
            out.push(b);
        }
    }
    out
}

/// Score d'un candidat (titre complet, tel que dans le dépôt) face à une
/// variante du nom cherché :
/// - titre entier : [`similarity`] (Levenshtein + ratio partiel — un ajout de
///   préfixe/suffixe est attendu à ce niveau, ex. code de région) ;
/// - segments ([`title_segments`]) : Levenshtein strict *seul*, sans ratio
///   partiel. Un segment est déjà l'unité la plus fine (un titre autonome à
///   comparer dans son ensemble) — l'y appliquer quand même transformerait
///   un simple mot commun et court (« Bomberman », partagé par plusieurs
///   jeux distincts : « Bomberman '93 », « Bomberman - Users Battle »…) en
///   faux positif à 100%, puisqu'il serait trivialement trouvé comme
///   sous-chaîne de presque n'importe quelle variante commençant par ce mot.
fn candidate_score(variant: &str, full: &str) -> f64 {
    let mut best = similarity(variant, full);
    let variant_lc = variant.to_lowercase();
    for seg in title_segments(full).into_iter().skip(1) {
        let score = strsim::normalized_levenshtein(&variant_lc, &seg.to_lowercase());
        if score > best {
            best = score;
        }
    }
    best
}

/// Le titre le plus proche de `stem` dans `candidates`, si son score dépasse
/// [`FUZZY_THRESHOLD`]. Essaie aussi les variantes de région de `stem`
/// ([`name_variants`]) : un stem exprimé en code court (« (J) ») se compare
/// souvent mieux une fois étendu (« (Japan) »), la base Libretro utilisant
/// systématiquement la forme longue. L'URL/le cache utilisent toujours le
/// **titre complet**, seul vrai nom de fichier dans le dépôt.
fn best_fuzzy_match(stem: &str, candidates: &[String]) -> Option<(String, f64)> {
    name_variants(stem)
        .iter()
        .filter_map(|variant| {
            candidates
                .iter()
                .map(|full| (full.clone(), candidate_score(variant, full)))
                .filter(|(_, score)| *score >= FUZZY_THRESHOLD)
                .max_by(|a, b| a.1.total_cmp(&b.1))
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))
}

/// Cherche l'image `kind` pour ce fichier ROM, depuis la source demandée.
pub async fn fetch(
    cache_dir: &Path,
    source: &Source,
    rom_file_name: &str,
    kind: Kind,
) -> Option<ThumbMatch> {
    match source {
        Source::Network => fetch_network(cache_dir, rom_file_name, kind).await,
        Source::Local(root) => fetch_local(root, rom_file_name, kind),
    }
}

/// Mode réseau : variantes connues, puis recherche au plus proche, cache
/// disque à chaque étape (téléchargements + index + marqueurs d'échec).
async fn fetch_network(cache_dir: &Path, rom_file_name: &str, kind: Kind) -> Option<ThumbMatch> {
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

/// Chemin de l'image `<root>/<repo>/<folder>/<titre>.png` en mode local.
fn local_exact_path(root: &Path, repo: &str, folder: &str, title: &str) -> PathBuf {
    root.join(repo).join(folder).join(format!("{}.png", sanitize(title)))
}

/// Liste des titres présents dans `<root>/<repo>/<folder>` — simple lecture
/// de dossier (pas de mise en cache : c'est déjà local, donc rapide, et le
/// contenu peut changer d'une fois à l'autre si l'utilisateur met à jour son
/// dossier `DB_Thumbnails`).
fn local_index(root: &Path, repo: &str, folder: &str) -> Vec<String> {
    let dir = root.join(repo).join(folder);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("png")))
        .filter_map(|e| e.path().file_stem().and_then(|s| s.to_str()).map(str::to_string))
        .collect()
}

/// Mode local (dossier `DB_Thumbnails` de l'utilisateur) : même algorithme de
/// correspondance que le mode réseau (variantes connues puis recherche au
/// plus proche), mais lecture directe du disque — pas de requête HTTP, pas
/// de cache (déjà local).
fn fetch_local(root: &Path, rom_file_name: &str, kind: Kind) -> Option<ThumbMatch> {
    let (stem, ext) = split_ext(rom_file_name);
    let repo = repo_for_ext(&ext);
    let folder = kind.folder();

    for variant in name_variants(stem) {
        let path = local_exact_path(root, repo, folder, &variant);
        if let Ok(bytes) = std::fs::read(&path) {
            return Some(ThumbMatch { bytes, matched_title: variant, score: 1.0 });
        }
    }

    let index = local_index(root, repo, folder);
    if let Some((matched_title, score)) = best_fuzzy_match(stem, &index) {
        let path = local_exact_path(root, repo, folder, &matched_title);
        if let Ok(bytes) = std::fs::read(&path) {
            return Some(ThumbMatch { bytes, matched_title, score });
        }
    }

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

    // Mode local (dossier DB_Thumbnails) : pur système de fichiers, aucun
    // réseau — exécuté par défaut (pas de #[ignore]).
    #[test]
    fn fetch_local_exact_variant() {
        let dir = std::env::temp_dir().join("edlink-thumb-test-local-exact");
        let _ = std::fs::remove_dir_all(&dir);
        let folder = dir.join(REPO_TG16).join("Named_Boxarts");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("Dragon's Curse (USA).png"), b"fake-png-bytes").unwrap();

        let m = tauri::async_runtime::block_on(fetch(
            &std::env::temp_dir(), // cache_dir : inutilisé en mode local
            &Source::Local(dir),
            "Dragon's Curse (U).pce",
            Kind::Boxart,
        ));
        let m = m.expect("attendu : jaquette trouvée via variante (USA) en local");
        assert_eq!(m.score, 1.0);
        assert_eq!(m.matched_title, "Dragon's Curse (USA)");
        assert_eq!(m.bytes, b"fake-png-bytes");
    }

    #[test]
    fn fetch_local_fuzzy_fallback() {
        let dir = std::env::temp_dir().join("edlink-thumb-test-local-fuzzy");
        let _ = std::fs::remove_dir_all(&dir);
        let folder = dir.join(REPO_TG16).join("Named_Snaps");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("Bomberman '93 (Japan).png"), b"fake").unwrap();
        std::fs::write(folder.join("Air Zonk (USA).png"), b"fake").unwrap();

        let m = tauri::async_runtime::block_on(fetch(
            &std::env::temp_dir(),
            &Source::Local(dir),
            "Bomberman 93 (Japan).pce",
            Kind::Snap,
        ));
        let m = m.expect("attendu : correspondance approchée trouvée en local");
        assert_eq!(m.matched_title, "Bomberman '93 (Japan)");
        assert!(m.score < 1.0 && m.score >= FUZZY_THRESHOLD);
    }

    #[test]
    fn fetch_local_missing_returns_none() {
        let dir = std::env::temp_dir().join("edlink-thumb-test-local-missing");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(REPO_TG16).join("Named_Titles")).unwrap();
        let m = tauri::async_runtime::block_on(fetch(
            &std::env::temp_dir(),
            &Source::Local(dir),
            "Totally Unknown Game (U).pce",
            Kind::Title,
        ));
        assert!(m.is_none());
    }

    // Réseau réel — désactivé par défaut (`cargo test -- --ignored` pour l'exécuter).
    // `tauri::async_runtime::block_on` évite d'ajouter `tokio` en dépendance
    // directe rien que pour ce test (déjà tiré par `tauri`/`reqwest`).
    #[test]
    #[ignore]
    fn fetch_known_game_boxart() {
        let dir = std::env::temp_dir().join("edlink-thumb-test");
        let _ = std::fs::remove_dir_all(&dir);
        let m = tauri::async_runtime::block_on(fetch(&dir, &Source::Network, "Dragon's Curse (U).pce", Kind::Boxart));
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
        let m = tauri::async_runtime::block_on(fetch(&dir, &Source::Network, "Bomberman 93 (Japan).pce", Kind::Boxart));
        let m = m.expect("attendu : correspondance approchée trouvée");
        assert!(m.score < 1.0);
        assert!(m.score >= FUZZY_THRESHOLD);
        println!("matched: {} ({:.0}%)", m.matched_title, m.score * 100.0);
    }

    // Cas signalé : titre japonais original ajouté en préfixe côté Libretro
    // (« Busou Keiji - Cyber Cross (Japan) » pour « Cyber Cross (J).pce »),
    // que la seule distance de Levenshtein sur la chaîne entière ne trouvait
    // pas (score écrasé par la longueur du préfixe ajouté).
    #[test]
    #[ignore]
    fn fetch_fuzzy_fallback_prefixed_title() {
        let dir = std::env::temp_dir().join("edlink-thumb-test-fuzzy-prefixed");
        let _ = std::fs::remove_dir_all(&dir);
        let m = tauri::async_runtime::block_on(fetch(&dir, &Source::Network, "Cyber Cross (J).pce", Kind::Boxart));
        let m = m.expect("attendu : correspondance approchée trouvée malgré le préfixe");
        assert!(m.matched_title.contains("Cyber Cross"));
        println!("matched: {} ({:.0}%)", m.matched_title, m.score * 100.0);
    }

    // Autre cas de titre "Principal - Sous-titre" : ici le nom de ROM
    // correspond au PREMIER segment (le titre japonais), pas au second —
    // vérifie que title_segments() ne favorise pas arbitrairement un côté.
    #[test]
    #[ignore]
    fn fetch_fuzzy_fallback_matches_first_segment() {
        let dir = std::env::temp_dir().join("edlink-thumb-test-fuzzy-seg1");
        let _ = std::fs::remove_dir_all(&dir);
        let m = tauri::async_runtime::block_on(fetch(&dir, &Source::Network, "Bull Fight (J).pce", Kind::Boxart));
        let m = m.expect("attendu : correspondance approchée trouvée sur le premier segment");
        assert!(m.matched_title.contains("Bull Fight"));
        println!("matched: {} ({:.0}%)", m.matched_title, m.score * 100.0);
    }

    // Kind::Title (écran-titre) : même mécanique que Boxart/Snap, sur un
    // dossier différent (Named_Titles) du même dépôt.
    #[test]
    #[ignore]
    fn fetch_title_screen() {
        let dir = std::env::temp_dir().join("edlink-thumb-test-title");
        let _ = std::fs::remove_dir_all(&dir);
        let m = tauri::async_runtime::block_on(fetch(&dir, &Source::Network, "Dragon's Curse (U).pce", Kind::Title));
        let m = m.expect("attendu : écran-titre trouvé via variante (USA)");
        assert_eq!(m.score, 1.0);
    }
}
