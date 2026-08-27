// Reproduction : charger une ROM dans la mémoire de l'émulateur puis relire.
// Usage : memload_check <port> <rom>
use std::io::Write;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::args().nth(1).ok_or("usage: memload_check <port> <rom>")?;
    let rom = std::env::args().nth(2).ok_or("usage: memload_check <port> <rom>")?;

    let mut ted = edlink_core::Ted::connect(Some(&port))?;
    println!("connecté : {}", ted.device_name());

    println!("load('{rom}')…");
    let dst = ted.load(&rom)?;
    println!("load ok -> {dst}");

    for base in [0u32, 0x2000u32, 0x4000u32] {
        let data = ted.mem_rd(base, 32)?;
        let hex: Vec<String> = data.iter().map(|b| format!("{b:02X}")).collect();
        println!("mem @ 0x{base:06X}: {}", hex.join(" "));
    }
    let _ = std::io::stdout().flush();
    Ok(())
}
