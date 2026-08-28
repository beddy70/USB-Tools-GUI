use edlink_core::{EdError, Result, Ted};
use std::time::Instant;

const USAGE: &str = concat!("\
edlink-cli v", env!("CARGO_PKG_VERSION"), " - outil Turbo EverDrive (validation du protocole)

Usage:
  edlink-cli [--port <PORT>] devinf
  edlink-cli [--port <PORT>] cp <src> <dst>          (dst = sd:chemin ou chemin local)
  edlink-cli [--port <PORT>] ls [sd:chemin]          (liste un dossier de la carte SD)
  edlink-cli [--port <PORT>] rm <sd:chemin>          (efface un fichier de la carte SD)
  edlink-cli [--port <PORT>] mv <sd:src> <sd:dst>    (renomme/déplace sur la carte SD)
  edlink-cli [--port <PORT>] run <rom>               (rom = chemin local ou sd:chemin)
  edlink-cli [--port <PORT>] reset
  edlink-cli [--port <PORT>] screen <out.png>
  edlink-cli [--port <PORT>] memrd <addr-hex> <len> [out.bin]

Astuce : EDLINK_TRACE=1 journalise sur stderr chaque octet émis/reçu
(utile pour valider un protocole sur matériel réel, ex: `ls`).
");

struct Opts {
    port: Option<String>,
    cmd: String,
    args: Vec<String>,
}

fn parse_args() -> Result<Opts> {
    let mut it = std::env::args().skip(1);
    let mut port = None;
    let mut cmd = None;
    let mut args = Vec::new();
    while let Some(a) = it.next() {
        if a == "--port" {
            port = Some(it.next().ok_or(EdError::Other("--port requires a value".into()))?);
        } else if cmd.is_none() {
            cmd = Some(a);
        } else {
            args.push(a);
        }
    }
    let cmd = cmd.ok_or(EdError::Other("missing command".into()))?;
    Ok(Opts { port, cmd, args })
}

fn main() {
    if let Err(e) = run() {
        eprintln!("ERROR: {e}");
        eprintln!("{USAGE}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let opts = parse_args()?;
    match opts.cmd.as_str() {
        "help" | "--help" | "-h" => {
            println!("{USAGE}");
            Ok(())
        }
        "version" | "--version" | "-V" => {
            println!("edlink-cli v{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "devinf" => {
            let mut ted = Ted::connect(opts.port.as_deref())?;
            print!("{}", ted.devinf()?);
            if ted.is_emulator().unwrap_or(false) {
                println!("target    : émulateur virtuel");
            }
            Ok(())
        }
        "probe" => {
            probe(opts.port.as_deref())?;
            Ok(())
        }
        "cp" => {
            if opts.args.len() != 2 {
                return Err(EdError::Other("cp requires <src> <dst>".into()));
            }
            let mut ted = Ted::connect(opts.port.as_deref())?;
            let t = Instant::now();
            let mut last = Instant::now();
            ted.copy_file_with_progress(&opts.args[0], &opts.args[1], |done, total| {
                if total > 0 && (done >= total || last.elapsed().as_millis() >= 100) {
                    last = Instant::now();
                    let pct = done * 100 / total;
                    eprint!("\r  {pct:3}%  ({done}/{total} o)   ");
                }
            })?;
            let dt = t.elapsed();
            eprintln!();
            println!("copy done in {dt:?}");
            Ok(())
        }
        "ls" => {
            let path = opts.args.first().map(String::as_str).unwrap_or("sd:/");
            let mut ted = Ted::connect(opts.port.as_deref())?;
            let t = Instant::now();
            let mut entries = ted.list_dir(path)?;
            entries.sort_by(|a, b| {
                b.is_dir.cmp(&a.is_dir).then_with(|| {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                })
            });
            for e in &entries {
                if e.is_dir {
                    println!("  <DIR>  {}/", e.name);
                } else {
                    println!("{:>9}  {}", e.size, e.name);
                }
            }
            println!("({} entrée(s), {:?})", entries.len(), t.elapsed());
            Ok(())
        }
        "rm" => {
            if opts.args.len() != 1 {
                return Err(EdError::Other("rm requires <sd:chemin>".into()));
            }
            let mut ted = Ted::connect(opts.port.as_deref())?;
            ted.delete_file(&opts.args[0])?;
            println!("deleted: {}", opts.args[0]);
            Ok(())
        }
        "mv" => {
            if opts.args.len() != 2 {
                return Err(EdError::Other("mv requires <sd:src> <sd:dst>".into()));
            }
            let mut ted = Ted::connect(opts.port.as_deref())?;
            ted.rename_file(&opts.args[0], &opts.args[1])?;
            println!("renamed: {} -> {}", opts.args[0], opts.args[1]);
            Ok(())
        }
        "run" => {
            if opts.args.len() != 1 {
                return Err(EdError::Other("run requires <rom>".into()));
            }
            let mut ted = Ted::connect(opts.port.as_deref())?;
            let dst = ted.run(&opts.args[0])?;
            println!("launching: {dst}");
            Ok(())
        }
        "reset" => {
            let mut ted = Ted::connect(opts.port.as_deref())?;
            ted.reset()?;
            println!("console reset");
            Ok(())
        }
        "screen" => {
            if opts.args.len() != 1 {
                return Err(EdError::Other("screen requires <out.png>".into()));
            }
            let mut ted = Ted::connect(opts.port.as_deref())?;
            let png = ted.screen()?;
            std::fs::write(&opts.args[0], &png)
                .map_err(|e| EdError::Other(format!("write {}: {e}", opts.args[0])))?;
            println!("screenshot saved: {} ({} bytes)", opts.args[0], png.len());
            Ok(())
        }
        "memrd" => {
            if opts.args.len() < 2 {
                return Err(EdError::Other("memrd requires <addr-hex> <len>".into()));
            }
            let addr = u32::from_str_radix(opts.args[0].trim_start_matches("0x"), 16)
                .map_err(|_| EdError::Other("invalid address".into()))?;
            let len = opts.args[1]
                .parse::<usize>()
                .map_err(|_| EdError::Other("invalid length".into()))?;
            let mut ted = Ted::connect(opts.port.as_deref())?;
            let data = ted.mem_rd(addr, len)?;
            if let Some(path) = opts.args.get(2) {
                std::fs::write(path, &data)
                    .map_err(|e| EdError::Other(format!("write {path}: {e}")))?;
                println!("wrote {} bytes to {path}", data.len());
            } else {
                println!("{} bytes @ 0x{addr:X}", data.len());
            }
            Ok(())
        }
        other => Err(EdError::Other(format!("unknown command: {other}"))),
    }
}

/// Diagnostic brut : envoie le handshake puis interroge le status, affiche
/// tous les octets reçus. Sert à valider la connectivité de la carte.
fn probe(port_name: Option<&str>) -> Result<()> {
    use serialport::SerialPort;
    use std::io::{Read, Write};
    use std::time::Duration;

    let pname = port_name.ok_or(EdError::Other("probe requires --port".into()))?;
    // Débit bridé à 0 en secours pour les pseudo-terminaux (émulateur virtuel)
    let mut port = serialport::new(pname, 921_600)
        .timeout(Duration::from_millis(100))
        .open()
        .or_else(|_| serialport::new(pname, 0).timeout(Duration::from_millis(100)).open())
        .map_err(|e| EdError::Other(format!("open {pname}: {e}")))?;

    println!("port open: {pname}");

    // handshake 66 octets nuls
    let zeros = vec![0u8; 66];
    port.write_all(&zeros).map_err(|e| EdError::Other(e.to_string()))?;
    port.flush().map_err(|e| EdError::Other(e.to_string()))?;
    std::thread::sleep(Duration::from_millis(300));

    fn drain(port: &mut dyn SerialPort) {
        let mut b = [0u8; 2048];
        loop {
            match port.read(&mut b) {
                Ok(n) => println!("RX(handshake): {:02X?}", &b[..n]),
                Err(_) => break,
            }
        }
    }
    drain(&mut *port);

    let tx_cmd = |code: u8| [b'+', b'+' ^ 0xFF, code, code ^ 0xFF];
    port.write_all(&tx_cmd(0x40)).map_err(|e| EdError::Other(e.to_string()))?;
    port.write_all(&tx_cmd(0x10)).map_err(|e| EdError::Other(e.to_string()))?;
    port.flush().map_err(|e| EdError::Other(e.to_string()))?;

    let start = Instant::now();
    let mut buf = [0u8; 2048];
    let mut total = 0usize;
    while start.elapsed() < Duration::from_secs(2) {
        match port.read(&mut buf) {
            Ok(n) => {
                println!("RX[{}]: {:02X?}", n, &buf[..n]);
                total += n;
            }
            Err(_) => {}
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    println!("probe finished, total bytes received: {total}");
    Ok(())
}
