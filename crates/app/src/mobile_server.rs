//! Serveur web local minimal : donne accès, depuis un smartphone sur le même
//! réseau (Wi-Fi domestique), à une version simplifiée de l'onglet GAMES —
//! catégories, mosaïque avec pochettes, et lancement d'un jeu. La page mobile
//! elle-même (`crates/app/mobile/`) est un petit SPA statique embarqué au
//! build, qui ne parle qu'à ce serveur via `fetch()` (pas de Tauri côté
//! téléphone).
//!
//! ⚠️ Pas d'authentification : pensé pour un réseau local de confiance,
//! jamais pour être exposé sur Internet. Le serveur est éteint par défaut et
//! démarré explicitement par l'utilisateur (bouton dans l'onglet Connexion).
//!
//! Portée volontairement réduite par rapport à l'onglet GAMES du bureau :
//! pas de Favoris (liste stockée côté navigateur du bureau, pas partagée),
//! pas de changement de dossier de jeux ni de source de pochette depuis le
//! téléphone — ces réglages sont ceux configurés sur l'ordinateur, reflétés
//! ici via `sync_mobile_settings` (commande Tauri appelée par main.js à
//! chaque changement).
//!
//! Implémentation : `tiny_http` (serveur bloquant, pur Rust, sans piste TLS)
//! plutôt qu'un serveur async (axum/warp) — évite d'ajouter un runtime en
//! plus de celui de Tauri pour un besoin aussi simple, et reste cohérent avec
//! le reste du projet (dépendances minimales, cross-compilation Windows/Linux
//! sans complication). Une requête = un thread (`std::thread::spawn`), le
//! `Mutex<Option<Ted>>` partagé sérialise naturellement l'accès au port série
//! comme le fait déjà chaque commande Tauri via `with_ted`.

use crate::{base_name, thumb_source, with_ted, AppState};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const INDEX_HTML: &str = include_str!("../mobile/index.html");
const APP_JS: &str = include_str!("../mobile/app.js");
const APP_CSS: &str = include_str!("../mobile/style.css");

const ROM_EXTS: [&str; 4] = ["pce", "sgx", "rom", "bin"];
/// Clé de catégorie réservée pour les favoris (jamais un vrai nom de
/// sous-dossier SD, qui ne peut pas contenir de tels caractères en pratique).
const FAVORITES_KEY: &str = "__FAVORITES__";

/// Réglages du bureau reflétés ici pour que le téléphone voie la même chose
/// (dossier de jeux, source de pochette) — synchronisés depuis main.js.
#[derive(Clone)]
pub struct MobileSettings {
    pub games_root: String,
    pub thumb_source: String,
    pub thumb_local_dir: Option<String>,
}

impl Default for MobileSettings {
    fn default() -> Self {
        Self {
            games_root: "sd:/GAMES".into(),
            thumb_source: "network".into(),
            thumb_local_dir: None,
        }
    }
}

struct RunningServer {
    stop: Arc<AtomicBool>,
    join: JoinHandle<()>,
    info: ServerInfo,
}

/// État du serveur mobile, ajouté à `AppState`.
#[derive(Default)]
pub struct MobileState {
    pub settings: Mutex<MobileSettings>,
    running: Mutex<Option<RunningServer>>,
}

#[derive(Serialize, Clone)]
pub struct ServerInfo {
    pub url: String,
    pub port: u16,
}

/// Astuce classique et portable pour trouver l'IP locale utilisée pour
/// sortir sur le réseau : un « connect » UDP ne fait que consulter la table
/// de routage du système (aucun paquet n'est réellement envoyé), donnant
/// l'adresse de l'interface qui serait utilisée — exactement celle que le
/// téléphone doit viser sur le même réseau.
fn local_ip() -> Option<std::net::IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|a| a.ip())
}

pub fn status(app: &AppHandle) -> Option<ServerInfo> {
    let state = app.state::<AppState>();
    let guard = state.mobile.running.lock().unwrap();
    let info = guard.as_ref().map(|r| r.info.clone());
    info
}

/// Démarre le serveur (no-op si déjà démarré : renvoie ses infos actuelles).
pub fn start(app: AppHandle, port: u16) -> Result<ServerInfo, String> {
    {
        let state = app.state::<AppState>();
        let guard = state.mobile.running.lock().unwrap();
        if let Some(r) = guard.as_ref() {
            return Ok(r.info.clone());
        }
    }

    let server = Server::http(("0.0.0.0", port))
        .map_err(|e| format!("Impossible de démarrer le serveur sur le port {port} : {e}"))?;
    let ip = local_ip().ok_or_else(|| "Impossible de déterminer l'adresse IP locale (réseau non connecté ?)".to_string())?;
    let info = ServerInfo { url: format!("http://{ip}:{port}"), port };

    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let app2 = app.clone();
    let join = std::thread::spawn(move || {
        while !stop2.load(Ordering::Relaxed) {
            match server.recv_timeout(std::time::Duration::from_millis(300)) {
                Ok(Some(mut req)) => {
                    let app3 = app2.clone();
                    std::thread::spawn(move || {
                        let response = build_response(&app3, &mut req);
                        let _ = req.respond(response);
                    });
                }
                Ok(None) => continue, // timeout : juste l'occasion de relire `stop2`
                Err(_) => break,      // erreur d'E/S sur le socket : on arrête proprement
            }
        }
    });

    let state = app.state::<AppState>();
    *state.mobile.running.lock().unwrap() = Some(RunningServer { stop, join, info: info.clone() });
    Ok(info)
}

/// Arrête le serveur s'il tourne (no-op sinon).
pub fn stop(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let running = state.mobile.running.lock().unwrap().take();
    if let Some(r) = running {
        r.stop.store(true, Ordering::Relaxed);
        let _ = r.join.join(); // attend au plus ~300ms (prochain tour de la boucle recv_timeout)
    }
    Ok(())
}

// ------------------------------------------------------------ routage HTTP

fn build_response(app: &AppHandle, req: &mut tiny_http::Request) -> Response<Cursor<Vec<u8>>> {
    let raw_url = req.url().to_string();
    let (path, query) = raw_url.split_once('?').unwrap_or((raw_url.as_str(), ""));
    let qs = parse_query(query);

    match (req.method(), path) {
        (Method::Get, "/") => html_response(INDEX_HTML),
        (Method::Get, "/app.js") => js_response(APP_JS),
        (Method::Get, "/style.css") => css_response(APP_CSS),
        (Method::Get, "/api/state") => json_response(&api_state(app)),
        (Method::Get, "/api/categories") => match api_categories(app) {
            Ok(v) => json_response(&v),
            Err(e) => error_response(&e),
        },
        (Method::Get, "/api/games") => {
            match api_games(app, qs.get("category").map(String::as_str).unwrap_or("")) {
                Ok(v) => json_response(&v),
                Err(e) => error_response(&e),
            }
        }
        (Method::Get, "/api/cover") => match api_cover(app, &qs) {
            Ok(bytes) => png_response(bytes),
            Err(_) => not_found(),
        },
        (Method::Post, "/api/launch") => {
            let mut body = String::new();
            let _ = req.as_reader().read_to_string(&mut body);
            match api_launch(app, &body) {
                Ok(v) => json_response(&v),
                Err(e) => error_response(&e),
            }
        }
        (Method::Get, "/api/favorites") => json_response(&crate::favorites::list(app)),
        (Method::Post, "/api/favorites/toggle") => {
            let mut body = String::new();
            let _ = req.as_reader().read_to_string(&mut body);
            match api_favorites_toggle(app, &body) {
                Ok(v) => json_response(&v),
                Err(e) => error_response(&e),
            }
        }
        _ => not_found(),
    }
}

fn parse_query(q: &str) -> HashMap<String, String> {
    q.split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| {
            let mut it = pair.splitn(2, '=');
            let k = it.next()?;
            let v = it.next().unwrap_or("");
            Some((url_decode(k), url_decode(v)))
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    percent_decode_str(&s.replace('+', " ")).decode_utf8_lossy().into_owned()
}

fn ext_of(name: &str) -> Option<&str> {
    if !name.contains('.') {
        return None;
    }
    name.rsplit('.').next()
}

fn is_rom_name(name: &str) -> bool {
    ext_of(name).map(|e| ROM_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e))).unwrap_or(false)
}

fn join_sd(dir: &str, name: &str) -> String {
    format!("{}/{}", dir.trim_end_matches('/'), name)
}

// -------------------------------------------------------------- endpoints

#[derive(Serialize)]
struct StateResp {
    connected: bool,
    device_name: Option<String>,
}

fn api_state(app: &AppHandle) -> StateResp {
    let state = app.state::<AppState>();
    let device_name = {
        let mut guard = state.ted.lock().unwrap();
        guard.as_mut().map(|t| t.device_name())
    };
    StateResp { connected: device_name.is_some(), device_name }
}

#[derive(Serialize)]
struct CategoryResp {
    /// Chemin du sous-dossier catégorie, ou vide pour la catégorie virtuelle
    /// "GAMES" (racine sans sous-dossier — miroir de la logique desktop,
    /// voir buildCategoryList() dans main.js).
    key: String,
    label: String,
}

fn api_categories(app: &AppHandle) -> Result<Vec<CategoryResp>, String> {
    let state = app.state::<AppState>();
    let games_root = state.mobile.settings.lock().unwrap().games_root.clone();
    let entries = with_ted(&state, |t| t.list_dir(&games_root))?;
    let mut dirs: Vec<_> = entries.into_iter().filter(|e| e.is_dir).collect();
    dirs.sort_by(|a, b| a.name.cmp(&b.name));

    // Favoris toujours en tête (comme sur le bureau — voir VIRTUAL_FAVORITES_
    // CATEGORY dans main.js), GAMES virtuelle seulement si aucun vrai
    // sous-dossier catégorie n'existe.
    let mut out = vec![CategoryResp { key: FAVORITES_KEY.into(), label: "Favoris".into() }];
    if dirs.is_empty() {
        out.push(CategoryResp { key: String::new(), label: "GAMES".into() });
    }
    for d in dirs {
        out.push(CategoryResp { label: d.name.to_uppercase(), key: d.name });
    }
    Ok(out)
}

#[derive(Serialize)]
struct GameResp {
    name: String,
    size: u32,
    path: String,
}

fn api_games(app: &AppHandle, category: &str) -> Result<Vec<GameResp>, String> {
    if category == FAVORITES_KEY {
        let mut favs = crate::favorites::list(app);
        favs.sort_by(|a, b| a.name.cmp(&b.name));
        return Ok(favs.into_iter().map(|f| GameResp { name: f.name, size: f.size, path: f.full }).collect());
    }

    let state = app.state::<AppState>();
    let games_root = state.mobile.settings.lock().unwrap().games_root.clone();
    let cat_path = if category.is_empty() { games_root } else { join_sd(&games_root, category) };

    let entries = with_ted(&state, |t| t.list_dir(&cat_path))?;
    let mut games: Vec<_> = entries.into_iter().filter(|e| !e.is_dir && is_rom_name(&e.name)).collect();
    games.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(games
        .into_iter()
        .map(|e| GameResp { path: join_sd(&cat_path, &e.name), name: e.name, size: e.size })
        .collect())
}

#[derive(Deserialize)]
struct FavToggleReq {
    full: String,
    name: String,
    size: u32,
}

fn api_favorites_toggle(app: &AppHandle, body: &str) -> Result<Vec<crate::favorites::Favorite>, String> {
    let req: FavToggleReq = serde_json::from_str(body).map_err(|e| format!("Requête invalide : {e}"))?;
    Ok(crate::favorites::toggle(app, req.full, req.name, req.size))
}

fn api_cover(app: &AppHandle, qs: &HashMap<String, String>) -> Result<Vec<u8>, ()> {
    let name = qs.get("name").ok_or(())?;
    let kind = match qs.get("kind").map(String::as_str) {
        Some("snap") => crate::thumbnails::Kind::Snap,
        Some("title") => crate::thumbnails::Kind::Title,
        _ => crate::thumbnails::Kind::Boxart,
    };
    let state = app.state::<AppState>();
    let settings = state.mobile.settings.lock().unwrap().clone();
    let src = thumb_source(&settings.thumb_source, settings.thumb_local_dir);
    let cache_dir = app.path().app_cache_dir().map_err(|_| ())?;
    let base = base_name(name);
    let m = tauri::async_runtime::block_on(crate::thumbnails::fetch(&cache_dir, &src, &base, kind));
    m.map(|t| t.bytes).ok_or(())
}

#[derive(Deserialize)]
struct LaunchReq {
    path: String,
}

#[derive(Serialize)]
struct LaunchResp {
    ok: bool,
    message: String,
}

fn api_launch(app: &AppHandle, body: &str) -> Result<LaunchResp, String> {
    let req: LaunchReq = serde_json::from_str(body).map_err(|e| format!("Requête invalide : {e}"))?;
    let state = app.state::<AppState>();
    let dst = with_ted(&state, |t| t.run(&req.path))?;
    Ok(LaunchResp { ok: true, message: format!("Jeu lancé : {dst}") })
}

// --------------------------------------------------------- réponses HTTP

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("en-tête HTTP valide")
}

fn html_response(body: &str) -> Response<Cursor<Vec<u8>>> {
    Response::from_string(body).with_header(header("Content-Type", "text/html; charset=utf-8"))
}

fn js_response(body: &str) -> Response<Cursor<Vec<u8>>> {
    Response::from_string(body).with_header(header("Content-Type", "application/javascript; charset=utf-8"))
}

fn css_response(body: &str) -> Response<Cursor<Vec<u8>>> {
    Response::from_string(body).with_header(header("Content-Type", "text/css; charset=utf-8"))
}

fn json_response<T: Serialize>(v: &T) -> Response<Cursor<Vec<u8>>> {
    let body = serde_json::to_string(v).unwrap_or_else(|_| "null".into());
    Response::from_string(body).with_header(header("Content-Type", "application/json; charset=utf-8"))
}

fn error_response(msg: &str) -> Response<Cursor<Vec<u8>>> {
    let body = serde_json::json!({ "error": msg }).to_string();
    Response::from_string(body)
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
        .with_status_code(StatusCode(500))
}

fn png_response(bytes: Vec<u8>) -> Response<Cursor<Vec<u8>>> {
    Response::from_data(bytes).with_header(header("Content-Type", "image/png"))
}

fn not_found() -> Response<Cursor<Vec<u8>>> {
    Response::from_string("Not Found").with_status_code(StatusCode(404))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_rom_name_accepts_known_extensions() {
        assert!(is_rom_name("Dragon's Curse (U).pce"));
        assert!(is_rom_name("game.SGX")); // insensible à la casse
        assert!(is_rom_name("game.rom"));
        assert!(is_rom_name("game.bin"));
        assert!(!is_rom_name("readme.txt"));
        assert!(!is_rom_name("no_extension"));
    }

    #[test]
    fn join_sd_normalizes_trailing_slash() {
        assert_eq!(join_sd("sd:/GAMES", "Action"), "sd:/GAMES/Action");
        assert_eq!(join_sd("sd:/GAMES/", "Action"), "sd:/GAMES/Action");
    }

    #[test]
    fn parse_query_decodes_percent_and_plus() {
        let qs = parse_query("name=Bonk%27s%20Adventure+%28U%29.pce&kind=snap");
        assert_eq!(qs.get("name").unwrap(), "Bonk's Adventure (U).pce");
        assert_eq!(qs.get("kind").unwrap(), "snap");
    }

    #[test]
    fn parse_query_handles_empty_string() {
        assert!(parse_query("").is_empty());
    }
}
