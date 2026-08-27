//! Backend Tauri de l'outil Turbo EverDrive.
//!
//! Expose au frontend web des commandes de connexion et d'opérations sur la
//! carte (infos, transfert fichiers, lancement, reset, capture, memrd).

use edlink_core::{EdError, Ted};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

/// État partagé de l'application.
struct AppState {
    ted: Mutex<Option<Ted>>,
    dropped: Mutex<Vec<String>>,
}

/// Résumé retourné après connexion.
#[derive(Serialize)]
struct DeviceInfo {
    name: String,
    port: String,
    info: String,
}

#[derive(Serialize)]
struct MemDump {
    addr: u32,
    len: usize,
    data_base64: String,
}

/// Une entrée du système de fichiers SD renvoyée au frontend.
#[derive(Serialize)]
struct SdEntry {
    name: String,
    is_dir: bool,
    size: u32,
}

fn with_ted<R>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut Ted) -> Result<R, EdError>,
) -> Result<R, String> {
    let mut guard = state.ted.lock().unwrap();
    match guard.as_mut() {
        Some(t) => f(t).map_err(|e| e.to_string()),
        None => Err("Aucune carte connectée. Connectez-vous d'abord.".into()),
    }
}

/// Point d'entrée de l'app : configure l'état et les commandes Tauri.
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ted: Mutex::new(None),
            dropped: Mutex::new(Vec::new()),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event
            {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let mut dropped = state.dropped.lock().unwrap();
                dropped.clear();
                let files: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                dropped.extend(files.clone());
                drop(dropped);
                let _ = app.emit("files-dropped", files);
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_ports,
            connect,
            disconnect,
            get_info,
            upload,
            download,
            list_sd,
            run_rom,
            load_rom,
            reset_console,
            capture_screen,
            memrd,
            save_png,
            pick_file,
            pick_save,
            get_dropped,
            clear_dropped,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ------------------------------------------------------------ commandes
/// Liste les ports série disponibles.
#[tauri::command]
fn list_ports() -> Result<Vec<String>, String> {
    edlink_core::available_ports().map_err(|e| e.to_string())
}

/// Se connecte à la carte (port optionnel ; sinon scan automatique).
///
/// Une erreur d'E/S transitoire (ex: 1ère poignée de main lente sur un port
/// virtuel PTY) est automatiquement retentée jusqu'à 3 fois, afin d'éviter les
/// échecs « Operation timed out » passagers.
#[tauri::command]
fn connect(state: State<'_, AppState>, port: Option<String>) -> Result<DeviceInfo, String> {
    let mut last_err = "connexion impossible".to_string();
    for attempt in 0..3 {
        match try_connect(port.as_deref()) {
            Ok((ted, info)) => {
                let port_name = ted.port_name().unwrap_or_default();
                let name = ted.device_name();
                let mut guard = state.ted.lock().unwrap();
                *guard = Some(ted);
                return Ok(DeviceInfo {
                    name,
                    port: port_name,
                    info,
                });
            }
            Err(e) => {
                let is_io = matches!(&e, EdError::Io(_));
                last_err = e.to_string();
                // Ne re-tente que sur erreur d'E/S (timeout, port occupé...), pas
                // sur une erreur métier (port introuvable, mauvais device).
                if attempt < 2 && is_io {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    continue;
                }
                break;
            }
        }
    }
    Err(last_err)
}

/// Ouvre la carte (poignée de main) et lit les infos, sans stocker l'état.
fn try_connect(port: Option<&str>) -> Result<(Ted, String), EdError> {
    let mut ted = Ted::connect(port)?;
    let info = ted.devinf()?;
    Ok((ted, info))
}

/// Déconnecte (libère la carte).
#[tauri::command]
fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.ted.lock().unwrap();
    *guard = None;
    Ok(())
}

/// Renvoie les infos appareil formatées.
#[tauri::command]
fn get_info(state: State<'_, AppState>) -> Result<String, String> {
    with_ted(&state, |t| t.devinf())
}

/// Téléverse un fichier local vers la carte SD.
#[tauri::command]
fn upload(
    state: State<'_, AppState>,
    local: String,
    dest: String,
) -> Result<String, String> {
    let dest = normalize_sd_path(&dest);
    with_ted(&state, |t| t.copy_file(&local, &dest))
        .map(|_| format!("Uploadé vers {dest}"))
}

/// Télécharge un fichier de la carte SD vers le local.
#[tauri::command]
fn download(
    state: State<'_, AppState>,
    src: String,
    local: String,
) -> Result<String, String> {
    let src = normalize_sd_path(&src);
    with_ted(&state, |t| t.copy_file(&src, &local))
        .map(|_| format!("Téléchargé de {src} vers {local}"))
}

/// Liste le contenu d'un dossier de la carte SD.
#[tauri::command]
fn list_sd(state: State<'_, AppState>, path: String) -> Result<Vec<SdEntry>, String> {
    let dev = normalize_sd_path(&path);
    with_ted(&state, |t| t.list_dir(&dev)).map(|entries| {
        entries
            .into_iter()
            .map(|e| SdEntry {
                name: e.name,
                is_dir: e.is_dir,
                size: e.size,
            })
            .collect()
    })
}

/// Déploie et lance un jeu (chemin local ou `sd:...`).
#[tauri::command]
fn run_rom(state: State<'_, AppState>, rom: String) -> Result<String, String> {
    with_ted(&state, |t| t.run(&rom))
        .map(|dst| format!("Jeu lancé : {dst}"))
}

/// Déploie et charge un jeu dans la mémoire (RAM) sans le lancer.
#[tauri::command]
fn load_rom(state: State<'_, AppState>, rom: String) -> Result<String, String> {
    with_ted(&state, |t| t.load(&rom))
        .map(|dst| format!("Jeu chargé en mémoire : {dst}"))
}

/// Reset de la console.
#[tauri::command]
fn reset_console(state: State<'_, AppState>) -> Result<(), String> {
    with_ted(&state, |t| t.reset())
}

/// Paramètres d'affichage de la capture d'écran, envoyés par le frontend.
#[derive(serde::Deserialize, Default)]
#[serde(default)]
pub struct ScreenParams {
    bat_w: Option<usize>,
    bat_h: Option<usize>,
    res_w: Option<usize>,
    res_h: Option<usize>,
    scroll_x: Option<usize>,
    scroll_y: Option<usize>,
}

/// Capture l'écran du menu et renvoie l'image PNG encodée en base64.
/// `params` contient les réglages de visualisation (BAT, résolution, défilement).
#[tauri::command]
fn capture_screen(state: State<'_, AppState>, params: Option<ScreenParams>) -> Result<String, String> {
    let p = params.unwrap_or_default();
    let opts = edlink_core::image::ScreenOpts {
        bat_w: p.bat_w.unwrap_or(64),
        bat_h: p.bat_h.unwrap_or(32),
        res_w: p.res_w.unwrap_or(320),
        res_h: p.res_h.unwrap_or(224),
        scroll_x: p.scroll_x.unwrap_or(0),
        scroll_y: p.scroll_y.unwrap_or(0),
    };
    let png = with_ted(&state, |t| t.screen_opts(&opts))?;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, png))
}

/// Lecture mémoire (lecture seule) : renvoie les octets en base64.
#[tauri::command]
fn memrd(
    state: State<'_, AppState>,
    addr: u32,
    len: usize,
) -> Result<MemDump, String> {
    let data = with_ted(&state, |t| t.mem_rd(addr, len))?;
    Ok(MemDump {
        addr,
        len: data.len(),
        data_base64: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            data,
        ),
    })
}

/// Enregistre un PNG (base64) vers un chemin local.
#[tauri::command]
fn save_png(state: State<'_, AppState>, data_base64: String, path: String) -> Result<(), String> {
    let _ = state; // inutilisé
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data_base64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())
}

/// Ouvre un sélecteur de fichier et renvoie le chemin choisi.
#[tauri::command]
fn pick_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .add_filter("ROM EverDrive", &["pce", "sgx", "bin", "rom", "fpg"])
        .add_filter("Tous fichiers", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned()))
}

/// Ouvre un sélecteur de destination de fichier.
#[tauri::command]
fn pick_save(default_name: String) -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_file_name(&default_name)
        .save_file()
        .map(|p| p.to_string_lossy().into_owned()))
}

/// Renvoie la liste des fichiers déposés par glisser-déposer (puis la vide).
#[tauri::command]
fn get_dropped(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut guard = state.dropped.lock().unwrap();
    Ok(std::mem::take(&mut *guard))
}

#[tauri::command]
fn clear_dropped(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.dropped.lock().unwrap();
    guard.clear();
    Ok(())
}

/// Ajoute le préfixe `sd:/` si le chemin n'en a pas déjà un.
fn normalize_sd_path(p: &str) -> String {
    let t = p.trim();
    if t.to_lowercase().starts_with("sd:") {
        t.to_string()
    } else {
        format!("sd:/{}", t.trim_start_matches('/'))
    }
}
