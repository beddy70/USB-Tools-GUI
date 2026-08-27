//! Émulateur virtuel Turbo EverDrive (Pro / Core).
//!
//! Crée un port série virtuel (PTY) sur lequel l'application (`edlink-cli` ou
//! l'interface Tauri) se connecte comme sur un vrai périphérique. La carte SD
//! est représentée par un dossier local.
//!
//! Usage :
//!   edlink-emulator [--sd <dossier>] [--device pro|core]
//!
//! Au démarrage, le chemin du port virtuel (ex: `/dev/ttys003`) est affiché :
//! c'est lui qu'il faut fournir à l'utilisateur dans le champ "Port manuel"
//! de l'interface, ou via `edlink-cli --port <chemin>`.
//!
//! Note : sur macOS, ce port n'apparaît pas dans la liste déroulante auto
//! (IOKit ne recense que les périphériques USB) ; une saisie manuelle est
//! nécessaire.

mod device;
mod mcp;
mod pty;
mod sd;

use device::{Device, DEV_ID_TURBO_CORE, DEV_ID_TURBO_PRO};
use std::io::Write;
use std::path::PathBuf;

const USAGE: &str = "\
edlink-emulator - émulateur virtuel Turbo EverDrive (tests sans matériel)

Usage:
  edlink-emulator [--sd <dossier>] [--device pro|core]
                 [--MCP_EMU <ip>] [--MCP_PORT <port>] [--MCP_TOKEN <jeton>]

Options:
  --sd <dossier>          Dossier local utilisé comme carte SD virtuelle (défaut: ~/SD_PCE)
  --device <type>         pro | core  (défaut: pro)
  --fake-hardware         L'émulateur se fait passer pour une vraie carte
                          (en-tête SYS_INF) : sert à tester le mode conservateur
                          du visualiseur mémoire de l'interface.
  --MCP_EMU <ip>          Adresse du serveur MCP de l'émulateur PC-Engine (GearGraFX).
                          Quand ce flag est présent, la mémoire ROM servie par la carte
                          est lue/écrite depuis la zone ROM de l'émulateur hôte au lieu
                          de la RAM virtuelle locale (le reset de la console est aussi
                          propagé à l'hôte).
  --MCP_PORT <port>       Port HTTP MCP de l'hôte (défaut: 7000).
  --MCP_TOKEN <jeton>     Token Bearer MCP (obligatoire si l'hôte écoute hors loopback).
  -V, --version           Affiche la version et quitte
  -h, --help              Affiche cette aide
";

/// Version complète : `v<crate> (<git>, <date>)`. `GIT_HASH` / `BUILD_DATE`
/// sont injectés par `build.rs` à chaque compilation.
const VERSION: &str = concat!(
    "v",
    env!("CARGO_PKG_VERSION"),
    " (",
    env!("GIT_HASH"),
    ", ",
    env!("BUILD_DATE"),
    ")"
);

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Dossier SD par défaut : ~/SD_PCE (résout ici vers /Users/eddy/SD_PCE)
    let mut sd_dir = std::env::var("HOME")
        .map(|h| format!("{h}/SD_PCE"))
        .unwrap_or_else(|_| "sd_root".to_string());
    let mut device = "pro".to_string();
    let mut mcp_emu: Option<String> = None;
    let mut mcp_port: u16 = 7000;
    let mut mcp_token: Option<String> = None;
    let mut fake_hardware = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--sd" => {
                i += 1;
                if let Some(d) = args.get(i) {
                    sd_dir = d.clone();
                } else {
                    eprintln!("--sd nécessite une valeur");
                    std::process::exit(2);
                }
            }
            "--device" => {
                i += 1;
                if let Some(d) = args.get(i) {
                    device = d.clone();
                } else {
                    eprintln!("--device nécessite une valeur");
                    std::process::exit(2);
                }
            }
            "--MCP_EMU" => {
                i += 1;
                if let Some(d) = args.get(i) {
                    if d.to_lowercase() == "geargrafx" || d.to_lowercase() == "gear" {
                        // tolérance : --MCP_EMU Geargrafx sans IP est ignoré
                        eprintln!("--MCP_EMU attend une adresse IP, valeur ignorée : {d}");
                    } else {
                        mcp_emu = Some(d.clone());
                    }
                } else {
                    eprintln!("--MCP_EMU nécessite une valeur");
                    std::process::exit(2);
                }
            }
            "--MCP_PORT" => {
                i += 1;
                if let Some(d) = args.get(i) {
                    mcp_port = d.parse().unwrap_or_else(|_| {
                        eprintln!("--MCP_PORT invalide : {d}");
                        std::process::exit(2);
                    });
                } else {
                    eprintln!("--MCP_PORT nécessite une valeur");
                    std::process::exit(2);
                }
            }
            "--MCP_TOKEN" => {
                i += 1;
                if let Some(d) = args.get(i) {
                    mcp_token = Some(d.clone());
                } else {
                    eprintln!("--MCP_TOKEN nécessite une valeur");
                    std::process::exit(2);
                }
            }
            "--fake-hardware" => {
                fake_hardware = true;
            }
            "-V" | "--version" => {
                println!("edlink-emulator {VERSION}");
                return;
            }
            "-h" | "--help" => {
                print!("{USAGE}");
                return;
            }
            other => {
                eprintln!("argument inconnu : {other}");
                eprint!("{USAGE}");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    let device_id = match device.as_str() {
        "pro" => DEV_ID_TURBO_PRO,
        "core" => DEV_ID_TURBO_CORE,
        other => {
            eprintln!("device inconnu : {other} (attendu pro|core)");
            std::process::exit(2);
        }
    };
    let device_name = if device_id == DEV_ID_TURBO_PRO {
        "PRO"
    } else {
        "CORE"
    };

    let mut pair = match pty::create_pty() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("impossible de créer le port virtuel (PTY) : {e}");
            std::process::exit(1);
        }
    };
    let sd = match sd::VirtualSd::new(&sd_dir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("impossible d'ouvrir le dossier SD '{}' : {e}", sd_dir);
            std::process::exit(1);
        }
    };

    println!("=== Turbo EverDrive {device_name} — émulateur virtuel {VERSION} ===");
    println!("Carte SD virtuelle : {}", absolutize(&sd_dir));
    println!("Port série virtuel : {}", pair.slave_path);
    println!();
    println!(">> Connectez-vous à ce port depuis l'outil (champ port manuel)");
    println!(">>   ou : edlink-cli --port {} devinf", pair.slave_path);
    println!("(Ctrl-C pour arrêter)");
    let _ = std::io::stdout().flush();

    let mcp = if let Some(host) = mcp_emu {
        match mcp::McpClient::connect(&host, mcp_port, mcp_token.as_deref()) {
            Ok(c) => {
                println!("Connecté au serveur MCP GearGraFX : http://{host}:{mcp_port}/mcp");
                println!(">> La mémoire ROM servie par la carte sera lue depuis l'émulateur hôte");
                Some(c)
            }
            Err(e) => {
                eprintln!("Échec de connexion au serveur MCP GearGraFX ({host}:{mcp_port}) : {e}");
                eprintln!("Vérifiez que GearGraFX écoute bien (--mcp-http --mcp-http-port {mcp_port}) et le token (--MCP_TOKEN).");
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    let mut dev = Device::new(sd, device_id, mcp);
    dev.set_fake_hardware(fake_hardware);
    if fake_hardware {
        println!(">> --fake-hardware : l'émulateur se fait passer pour une vraie carte");
    }
    match dev.run(&mut pair.master) {
        Ok(()) => println!("\nhôte déconnecté, arrêt de l'émulateur."),
        Err(e) => eprintln!("\nerreur de l'émulateur : {e}"),
    }
}

fn absolutize(p: &str) -> String {
    std::fs::canonicalize(p)
        .unwrap_or_else(|_| PathBuf::from(p))
        .display()
        .to_string()
}
