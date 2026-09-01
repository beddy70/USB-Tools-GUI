//! Jeux marqués favoris (♡/♥), partagés entre le bureau et le serveur
//! mobile — voir `mobile_server.rs`.
//!
//! Contrairement au dossier de jeux / à la source de pochette (réglages
//! bureau simplement *reflétés* côté Rust pour que le téléphone les
//! connaisse), les favoris peuvent être ajoutés ou retirés **depuis les deux
//! côtés** : le bureau comme le téléphone doivent voir le même résultat
//! immédiatement. On en fait donc l'état Rust *autoritaire* (fini le
//! `localStorage` du navigateur du bureau, propre à cette seule fenêtre) et
//! on le persiste dans un fichier JSON (`app_data_dir()/favorites.json`)
//! pour qu'il survive à un redémarrage de l'application — le processus Rust
//! ne vit que le temps où le bureau tourne de toute façon (le serveur
//! mobile s'arrête avec lui), donc pas de scénario où le téléphone
//! modifierait la liste bureau fermé.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::AppState;

#[derive(Clone, Serialize, Deserialize)]
pub struct Favorite {
    /// Chemin complet sur la carte SD (ex. `sd:/GAMES/Action/Jeu.pce`) — clé
    /// d'identité d'un favori.
    pub full: String,
    pub name: String,
    pub size: u32,
}

/// `None` tant que le fichier n'a pas encore été lu (chargement paresseux :
/// au premier accès, bureau ou téléphone, peu importe lequel dégaine en
/// premier).
#[derive(Default)]
pub struct FavoritesState(pub Mutex<Option<Vec<Favorite>>>);

fn favorites_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("favorites.json"))
}

fn load_from_disk(app: &AppHandle) -> Vec<Favorite> {
    let Ok(path) = favorites_path(app) else { return Vec::new() };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_to_disk(app: &AppHandle, list: &[Favorite]) {
    let Ok(path) = favorites_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(list) {
        let _ = std::fs::write(&path, json);
    }
}

/// Liste actuelle (charge depuis le disque au premier appel).
pub fn list(app: &AppHandle) -> Vec<Favorite> {
    let state = app.state::<AppState>();
    let mut guard = state.favorites.0.lock().unwrap();
    if guard.is_none() {
        *guard = Some(load_from_disk(app));
    }
    guard.clone().unwrap()
}

/// Applique `f` à la liste en mémoire, sauvegarde sur disque, renvoie la
/// liste résultante (pratique pour renvoyer directement la nouvelle liste
/// au frontend qui vient de faire la modification, sans second aller-retour).
fn mutate(app: &AppHandle, f: impl FnOnce(&mut Vec<Favorite>)) -> Vec<Favorite> {
    let state = app.state::<AppState>();
    let mut guard = state.favorites.0.lock().unwrap();
    if guard.is_none() {
        *guard = Some(load_from_disk(app));
    }
    let list = guard.as_mut().unwrap();
    f(list);
    let out = list.clone();
    save_to_disk(app, &out);
    out
}

/// Ajoute `full` s'il n'y est pas déjà, le retire sinon (bascule ♡ ↔ ♥).
pub fn toggle(app: &AppHandle, full: String, name: String, size: u32) -> Vec<Favorite> {
    mutate(app, |list| {
        if let Some(idx) = list.iter().position(|f| f.full == full) {
            list.remove(idx);
        } else {
            list.push(Favorite { full, name, size });
        }
    })
}

/// Retire `full` s'il est présent (no-op sinon) — utilisé quand un fichier
/// est effacé de la carte, pour ne pas laisser un favori fantôme.
pub fn forget(app: &AppHandle, full: &str) -> Vec<Favorite> {
    mutate(app, |list| list.retain(|f| f.full != full))
}

/// Met à jour le chemin/nom d'un favori après un renommage sur la carte.
pub fn rename(app: &AppHandle, old_full: &str, new_full: String, new_name: String) -> Vec<Favorite> {
    mutate(app, |list| {
        if let Some(f) = list.iter_mut().find(|f| f.full == old_full) {
            f.full = new_full;
            f.name = new_name;
        }
    })
}
