use std::process::Command;

/// Injecte les métadonnées de build (`GIT_HASH`, `BUILD_DATE`) dans le binaire
/// via des variables d'environnement lues par `env!(...)`. Rafraîchies à chaque
/// commit / `git add` et à chaque modification de source ou du frontend.
fn emit_build_info() {
    let git = |args: &[&str]| -> Option<String> {
        let out = Command::new("git").args(args).output().ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    };

    let hash = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = match git(&["status", "--porcelain"]) {
        Some(s) if !s.is_empty() => "+",
        _ => "",
    };
    println!("cargo:rustc-env=GIT_HASH={hash}{dirty}");

    let date = Command::new("date")
        .arg("+%Y-%m-%d")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=BUILD_DATE={date}");

    // `.git/logs/HEAD` bouge à chaque commit / checkout / reset (le reflog) ;
    // `.git/HEAD` au changement de branche ; `.git/index` à `git add`.
    for p in [
        "../../.git/logs/HEAD",
        "../../.git/HEAD",
        "../../.git/index",
        "build.rs",
        "src",
        "frontend",
        "Cargo.toml",
    ] {
        println!("cargo:rerun-if-changed={p}");
    }
}

fn main() {
    emit_build_info();
    tauri_build::build()
}
