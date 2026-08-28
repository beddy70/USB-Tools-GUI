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
    /// Dernier instantané VRAM + CRAM lu par `*v` (capture d'écran). Permet de
    /// re-rendre l'image avec d'autres réglages (BAT, résolution, défilement)
    /// sans réinterroger la carte.
    screen_snap: Mutex<Option<(Vec<u8>, Vec<u8>)>>,
}

/// Résumé retourné après connexion.
#[derive(Serialize)]
struct DeviceInfo {
    name: String,
    port: String,
    info: String,
    /// `true` si l'on parle à l'émulateur virtuel. Le frontend s'en sert pour
    /// débrider le visualiseur mémoire (VRAM/CRAM, dump complet, recherche
    /// linéaire) — interdits sur matériel réel car ils gèlent la console.
    is_emulator: bool,
}

/// Événement de progression d'un transfert, émis vers le frontend sous le nom
/// `transfer-progress`. Une session émet : une phase `start`, N phases
/// `progress` (throttlées), puis `done` ou `error`.
#[derive(Serialize, Clone)]
struct TransferProgress {
    phase: &'static str, // "start" | "progress" | "done" | "error"
    dir: &'static str,   // "upload" | "download"
    name: String,
    done: u64,
    total: u64,
    error: Option<String>,
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
        Some(t) => match f(t) {
            Ok(v) => Ok(v),
            Err(e) => {
                // Constaté sur matériel réel : une erreur d'E/S peut laisser le
                // port série dans un état irrécupérable — toute commande
                // suivante échoue alors à l'identique tant qu'on ne rouvre pas
                // la connexion. On la referme donc ici plutôt que de laisser
                // l'utilisateur cliquer en boucle sur la même erreur cryptique ;
                // le préfixe « connexion perdue » signale au frontend de
                // repasser l'UI en « Déconnecté ».
                let is_io = matches!(&e, EdError::Io(_));
                if is_io {
                    *guard = None;
                }
                let msg = e.to_string();
                Err(if is_io {
                    format!("connexion perdue ({msg}) — reconnectez-vous")
                } else {
                    msg
                })
            }
        },
        None => Err("Aucune carte connectée. Connectez-vous d'abord.".into()),
    }
}

/// Point d'entrée de l'app : configure l'état et les commandes Tauri.
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ted: Mutex::new(None),
            dropped: Mutex::new(Vec::new()),
            screen_snap: Mutex::new(None),
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
            delete_sd,
            rename_sd,
            run_rom,
            load_rom,
            reset_console,
            capture_screen,
            capture_vram,
            memrd,
            save_png,
            pick_file,
            pick_save,
            get_dropped,
            clear_dropped,
            get_build_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ------------------------------------------------------------ commandes

/// Métadonnées de build, injectées par `build.rs` (mises à jour à chaque
/// compilation : version du crate, hash git, date).
#[derive(Serialize)]
struct BuildInfo {
    version: String,
    git: String,
    date: String,
    label: String,
}

/// Renvoie la version de l'application et les infos de build.
#[tauri::command]
fn get_build_info() -> BuildInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let git = env!("GIT_HASH").to_string();
    let date = env!("BUILD_DATE").to_string();
    let label = format!("v{version} · {git} · {date}");
    BuildInfo { version, git, date, label }
}

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
            Ok((mut ted, info)) => {
                let port_name = ted.port_name().unwrap_or_default();
                let name = ted.device_name();
                let is_emulator = ted.is_emulator().unwrap_or(false);
                let mut guard = state.ted.lock().unwrap();
                *guard = Some(ted);
                return Ok(DeviceInfo {
                    name,
                    port: port_name,
                    info,
                    is_emulator,
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
    *state.ted.lock().unwrap() = None;
    *state.screen_snap.lock().unwrap() = None;
    Ok(())
}

/// Renvoie les infos appareil formatées.
#[tauri::command]
fn get_info(state: State<'_, AppState>) -> Result<String, String> {
    with_ted(&state, |t| t.devinf())
}

/// Téléverse un fichier local vers la carte SD.
///
/// Commande **asynchrone** : le transfert (bloquant, plusieurs secondes) tourne
/// sur un thread dédié via `spawn_blocking`, ce qui laisse l'interface réactive.
/// La progression est publiée via l'événement `transfer-progress`.
#[tauri::command]
async fn upload(
    app: tauri::AppHandle,
    local: String,
    dest: String,
) -> Result<String, String> {
    let dest = normalize_sd_path(&dest);
    let name = base_name(&dest);
    let (src, dst) = (local, dest.clone());
    tauri::async_runtime::spawn_blocking(move || {
        run_transfer(&app, "upload", name, &src, &dst)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(format!("Uploadé vers {dest}"))
}

/// Télécharge un fichier de la carte SD vers le local. Voir [`upload`] pour le
/// modèle d'exécution (thread dédié + événements `transfer-progress`).
#[tauri::command]
async fn download(
    app: tauri::AppHandle,
    src: String,
    local: String,
) -> Result<String, String> {
    let src = normalize_sd_path(&src);
    let name = base_name(&src);
    let (dev, dst) = (src.clone(), local.clone());
    tauri::async_runtime::spawn_blocking(move || {
        run_transfer(&app, "download", name, &dev, &dst)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(format!("Téléchargé de {src} vers {local}"))
}

/// Exécute une copie `src` -> `dst` (sur un thread bloquant) en émettant les
/// événements `transfer-progress` : une phase `start`, N phases `progress`
/// (throttlées à ~40 ms), puis `done` ou `error`.
///
/// Le verrou `ted` est tenu pendant tout le transfert, ce qui sérialise
/// naturellement les opérations carte (une seule à la fois).
fn run_transfer(
    app: &tauri::AppHandle,
    dir: &'static str,
    name: String,
    src: &str,
    dst: &str,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let emit = |phase: &'static str, done: u64, total: u64, error: Option<String>| {
        let _ = app.emit(
            "transfer-progress",
            TransferProgress { phase, dir, name: name.clone(), done, total, error },
        );
    };

    emit("start", 0, 0, None);
    let mut last = std::time::Instant::now();
    let res = with_ted(&state, |t| {
        t.copy_file_with_progress(src, dst, |done, total| {
            if done >= total || last.elapsed().as_millis() >= 40 {
                last = std::time::Instant::now();
                emit("progress", done, total, None);
            }
        })
    });

    match res {
        Ok(()) => {
            emit("done", 0, 0, None);
            Ok(())
        }
        Err(e) => {
            emit("error", 0, 0, Some(e.clone()));
            Err(e)
        }
    }
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

/// Supprime un fichier (ou dossier vide) de la carte SD.
#[tauri::command]
fn delete_sd(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let dev = normalize_sd_path(&path);
    with_ted(&state, |t| t.delete_file(&dev)).map(|_| format!("{dev} effacé"))
}

/// Renomme un fichier de la carte SD (reste dans le même dossier).
#[tauri::command]
fn rename_sd(state: State<'_, AppState>, path: String, new_name: String) -> Result<String, String> {
    let old = normalize_sd_path(&path);
    let parent = old.rsplit_once('/').map(|(p, _)| p).unwrap_or("sd:");
    let new_path = format!("{parent}/{new_name}");
    with_ted(&state, |t| t.rename_file(&old, &new_path)).map(|_| new_path)
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

/// Rend l'écran du menu en PNG (base64).
///
/// La conversion VRAM/CRAM → image est un **rendu logiciel** (plan de tuiles du
/// VDC) : les réglages `params` (BAT, résolution, défilement) n'agissent que
/// dessus, pas sur la carte. On ne relit la VRAM/CRAM (`*v`) que si
/// `refresh == true` (bouton « Capturer l'écran ») ou si aucun instantané n'est
/// en cache. Bouger un curseur passe `refresh == false` → re-rendu local, aucun
/// accès carte.
#[tauri::command]
async fn capture_screen(
    app: tauri::AppHandle,
    params: Option<ScreenParams>,
    refresh: Option<bool>,
) -> Result<String, String> {
    let p = params.unwrap_or_default();
    let opts = edlink_core::image::ScreenOpts {
        bat_w: p.bat_w.unwrap_or(64),
        bat_h: p.bat_h.unwrap_or(32),
        res_w: p.res_w.unwrap_or(320),
        res_h: p.res_h.unwrap_or(224),
        scroll_x: p.scroll_x.unwrap_or(0),
        scroll_y: p.scroll_y.unwrap_or(0),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let want_fetch =
            refresh != Some(false) || state.screen_snap.lock().unwrap().is_none();
        if want_fetch {
            let fresh = with_ted(&state, |t| t.vram_dump())?;
            *state.screen_snap.lock().unwrap() = Some(fresh);
        }
        let snap = state.screen_snap.lock().unwrap();
        let (vram, cram) = snap
            .as_ref()
            .ok_or("aucune capture disponible — cliquez « Capturer l'écran »")?;
        let png = edlink_core::image::make_png(vram, cram, &opts).map_err(|e| e.to_string())?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, png))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct VramSnapshot {
    vram_b64: String,
    cram_b64: String,
}

/// Instantané VRAM (VDC) + CRAM (VCE) via la commande FIFO `*v` du menu OS.
///
/// Fonctionne sur l'émulateur **et sur matériel réel** — mais uniquement quand
/// le menu de la carte est affiché (le VDC/VCE sont internes à la console). Sur
/// un jeu en cours, `*v` reste sans réponse → erreur de timeout.
///
/// `refresh` : `true` (défaut) relit `*v` ; `false` renvoie le dernier
/// instantané mis en cache (partagé avec la capture d'écran et la vue Sprites),
/// et ne lit la carte que si le cache est vide. Commande async (~66 Ko lus).
#[tauri::command]
async fn capture_vram(
    app: tauri::AppHandle,
    refresh: Option<bool>,
) -> Result<VramSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let want_fetch =
            refresh != Some(false) || state.screen_snap.lock().unwrap().is_none();
        if want_fetch {
            let fresh = with_ted(&state, |t| t.vram_dump())?;
            *state.screen_snap.lock().unwrap() = Some(fresh);
        }
        let snap = state.screen_snap.lock().unwrap();
        let (vram, cram) = snap
            .as_ref()
            .ok_or("aucun instantané VRAM — affichez le menu de la carte")?;
        let b64 = |v: &[u8]| {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, v)
        };
        Ok(VramSnapshot { vram_b64: b64(vram), cram_b64: b64(cram) })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lecture mémoire (lecture seule) : renvoie les octets en base64.
///
/// Commande **asynchrone** : `CMD_MEM_RD` lit le bus FCI et gèle le CPU
/// PC-Engine le temps du transfert. On l'exécute sur un thread dédié pour ne
/// pas bloquer l'interface ; le frontend limite la taille et la fréquence des
/// lectures sur matériel réel.
#[tauri::command]
async fn memrd(app: tauri::AppHandle, addr: u32, len: usize) -> Result<MemDump, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let data = with_ted(&state, |t| t.mem_rd(addr, len))?;
        Ok(MemDump {
            addr,
            len: data.len(),
            data_base64: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                data,
            ),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Enregistre un PNG (base64) vers un chemin local.
///
/// `rename_all = "snake_case"` : par défaut, Tauri attend des clés d'argument
/// en camelCase côté JS (ex. `dataBase64`) — tout le reste du frontend envoie
/// du snake_case (assorti aux noms de champs Rust), d'où cette annotation
/// plutôt que de réécrire les appels JS.
#[tauri::command(rename_all = "snake_case")]
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
#[tauri::command(rename_all = "snake_case")]
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

/// Dernier segment d'un chemin (SD ou local), pour l'affichage.
fn base_name(p: &str) -> String {
    p.trim_end_matches('/')
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(p)
        .to_string()
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
