//! Client MCP (Model Context Protocol) léger pour piloter l'émulateur
//! GearGraFX (PC Engine) et servir sa mémoire ROM à la place de la RAM
//! virtuelle de l'émulateur Turbo EverDrive.
//!
//! GearGraFX expose un serveur MCP en HTTP (transport "Streamable HTTP"
//! compatible) sur l'URL `http://<host>:<port>/mcp`. Le protocole est du
//! JSON-RPC 2.0 : on fait un `initialize`, puis des `tools/call` pour invoquer
//! les outils de debug (`list_memory_areas`, `read_memory`, `write_memory`,
//! `debug_reset`, `get_screenshot`...).
//!
//! Contraintes vérifiées sur le code source de GearGraFX (`mcp_transport.h`) :
//! - chaque requête POST doit porter l'en-tête `MCP-Protocol-Version`
//!   (`2025-11-25`) ;
//! - le header `Host` doit correspondre à l'adresse de bind du serveur
//!   (`<ip>` ou `<ip>:<port>`) ;
//! - aucun `Origin` n'est requis (son absence est acceptée) ;
//! - sur une adresse non-loopback, un bearer token est obligatoire et doit
//!   être envoyé en `Authorization: Bearer <token>`.
//!
//! Le résultat d'un `tools/call` respecte le format MCP standard :
//! `result.content[0].text` est une chaîne JSON contenant le résultat réel de
//! l'outil.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// Chemin de l'endpoint MCP HTTP de GearGraFX.
const MCP_PATH: &str = "/mcp";
/// Version du protocole MCP utilisée par GearGraFX 1.7.19.
const MCP_PROTOCOL_VERSION: &str = "2025-11-25";

/// Erreur côté client MCP.
#[derive(Debug)]
pub struct McpError(pub String);

impl std::fmt::Display for McpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for McpError {}

type Result<T> = std::result::Result<T, McpError>;

/// Client MCP minimal vers le serveur GearGraFX.
pub struct McpClient {
    /// Adresse `host:port` du serveur MCP.
    addr: String,
    /// Token bearer optionnel (obligatoire sur adresse non-loopback).
    token: Option<String>,
    /// Compteur d'identifiants de requêtes JSON-RPC.
    next_id: i64,
    /// Version de protocole négociée (renvoyée par le serveur à `initialize`).
    server_version: String,
    /// Identifiant de la zone mémoire "ROM" (résolu paresseusement).
    rom_area: Option<i64>,
    /// Taille en octets de la zone ROM (0 si inconnue).
    rom_size: u64,
}

impl McpClient {
    /// Ouvre la connexion, exécute le handshake `initialize` + `initialized`
    /// et renvoie un client prêt à appeler des outils.
    pub fn connect(host: &str, port: u16, token: Option<&str>) -> Result<McpClient> {
        let mut c = McpClient {
            addr: format!("{host}:{port}"),
            token: token.map(|s| s.to_string()),
            next_id: 0,
            server_version: MCP_PROTOCOL_VERSION.to_string(),
            rom_area: None,
            rom_size: 0,
        };
        c.initialize()?;
        Ok(c)
    }

    /// Pointe l'adresse du serveur (utile pour l'affichage / les logs).
    #[allow(dead_code)]
    pub fn addr(&self) -> &str {
        &self.addr
    }

    /// Handshake MCP : `initialize` puis notification `notifications/initialized`.
    fn initialize(&mut self) -> Result<()> {
        let result = self.call(
            "initialize",
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "edlink-emulator", "version": env!("CARGO_PKG_VERSION")}
            }),
        )?;
        if let Some(v) = result.get("protocolVersion").and_then(|v| v.as_str()) {
            self.server_version = v.to_string();
        }
        self.notify("notifications/initialized", json!({}))
    }

    // ------------------------------------------------------------ couche HTTP

    /// Envoie une requête `POST /mcp` et renvoie le corps de la réponse HTTP
    /// (JSON pour une requête, vide pour une notification).
    fn http_post(&self, body: &str) -> Result<String> {
        let mut stream =
            TcpStream::connect(&self.addr).map_err(|e| McpError(format!("connexion {} : {e}", self.addr)))?;
        stream.set_read_timeout(Some(Duration::from_secs(15))).ok();
        stream.set_write_timeout(Some(Duration::from_secs(15))).ok();

        let mut req = format!("POST {MCP_PATH} HTTP/1.1\r\nHost: {}\r\n", self.host_only());
        req.push_str("Content-Type: application/json\r\n");
        req.push_str("Accept: application/json, text/event-stream\r\n");
        req.push_str(&format!("MCP-Protocol-Version: {}\r\n", self.server_version));
        req.push_str("Connection: close\r\n");
        if let Some(t) = &self.token {
            req.push_str(&format!("Authorization: Bearer {t}\r\n"));
        }
        let body_bytes = body.as_bytes();
        req.push_str(&format!("Content-Length: {}\r\n\r\n", body_bytes.len()));
        req.push_str(body);

        stream.write_all(req.as_bytes()).map_err(|e| McpError(format!("envoi : {e}")))?;

        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).map_err(|e| McpError(format!("lecture : {e}")))?;
        let raw = String::from_utf8_lossy(&buf).into_owned();

        // Sépare en-têtes / corps (Connection: close => tout est reçu).
        let header_end = raw
            .find("\r\n\r\n")
            .map(|p| p + 4)
            .ok_or_else(|| McpError("réponse HTTP invalide (pas de fin d'en-têtes)".to_string()))?;
        let headers = &raw[..header_end - 4];
        let rb = &raw[header_end..];

        let status = headers.lines().next().unwrap_or("");
        if !(status.contains("200") || status.contains("202")) {
            return Err(McpError(format!("réponse HTTP {status}")));
        }
        Ok(rb.to_string())
    }

    /// Extrait le nom d'hôte (sans le numéro de port) pour le header `Host`.
    fn host_only(&self) -> String {
        self.addr
            .rsplit_once(':')
            .map(|(h, _)| h.to_string())
            .unwrap_or_else(|| self.addr.clone())
    }

    // ---------------------------------------------------------- couche JSON-RPC

    /// Appelle une méthode JSON-RPC avec id et attend un `result`.
    fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        let req = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let body = serde_json::to_string(&req).map_err(|e| McpError(format!("sérialisation : {e}")))?;
        let resp_body = self.http_post(&body)?;
        let v: Value = serde_json::from_str(&resp_body)
            .map_err(|e| McpError(format!("réponse non JSON : {e}")))?;
        if let Some(err) = v.get("error") {
            return Err(McpError(format!("erreur JSON-RPC {method}: {err}")));
        }
        v.get("result").cloned().ok_or_else(|| McpError(format!("réponse {method} sans result")))
    }

    /// Envoie une notification JSON-RPC (pas d'id, pas de réponse attendue).
    fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        let req = json!({"jsonrpc": "2.0", "method": method, "params": params});
        let body = serde_json::to_string(&req).map_err(|e| McpError(format!("sérialisation : {e}")))?;
        self.http_post(&body)?;
        Ok(())
    }

    // ---------------------------------------------------------------- outils MCP

    /// Invoque un outil et renvoie son résultat réel (contenu de
    /// `result.content[0].text`, re-parsé en JSON).
    ///
    /// Chaque appel d'outil est tracé sur stdout (`[MCP] tool: …`) pour
    /// visualiser ce que l'émulateur demande à GearGraFX quand le mode MCP est
    /// actif.
    pub fn call_tool(&mut self, name: &str, args: Value) -> Result<Value> {
        println!("[MCP] tool: {name} args: {args}");
        let result = match self.call("tools/call", json!({"name": name, "arguments": args})) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[MCP] tool: {name} -> ERREUR (transport) : {e}");
                return Err(e);
            }
        };
        if result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false) {
            let txt = result["content"][0]["text"].as_str().unwrap_or("");
            eprintln!("[MCP] tool: {name} -> ERREUR : {txt}");
            return Err(McpError(format!("outil {name} en erreur : {txt}")));
        }
        let text = result["content"][0]["text"].as_str().ok_or_else(|| {
            McpError(format!("réponse tools/call ({name}) sans content[0].text"))
        })?;
        let parsed: Value = serde_json::from_str(text)
            .map_err(|e| McpError(format!("résultat outil {name} non JSON : {e}")))?;
        // Résumé compact de la réponse (tronqué) pour éviter un stdout saturé.
        // Troncature par caractères (pas par octets) pour ne pas casser l'UTF-8.
        let summary = serde_json::to_string(&parsed).unwrap_or_default();
        let summary: String = summary.chars().take(200).collect();
        println!("[MCP] tool: {name} -> OK : {summary}");
        Ok(parsed)
    }

    /// Résout l'identifiant et la taille (en octets) de la zone mémoire "ROM".
    /// La résolution est mise en cache pour la session courante.
    pub fn rom_area(&mut self) -> Result<(i64, u64)> {
        if let Some(id) = self.rom_area {
            return Ok((id, self.rom_size));
        }
        let r = self.call_tool("list_memory_areas", json!({}))?;
        for area in r["areas"].as_array().cloned().unwrap_or_default() {
            if area["name"].as_str() == Some("ROM") {
                let id = area["id"].as_i64().ok_or_else(|| McpError("zone ROM sans id".to_string()))?;
                let unit = area["unit_size"].as_u64().unwrap_or(1);
                let size = area["size"].as_u64().unwrap_or(0) * unit;
                self.rom_area = Some(id);
                self.rom_size = size;
                return Ok((id, size));
            }
        }
        Err(McpError("zone mémoire ROM introuvable (aucun jeu chargé dans GearGraFX ?)".to_string()))
    }

    /// Lit `size` octets de la ROM de GearGraFX à partir de l'offset `offset`.
    /// Les octets au-delà de la taille de la ROM sont remplis de `0xFF`
    /// (valeur par défaut d'une HuCard pour une zone non mappée).
    pub fn read_rom(&mut self, offset: u64, size: usize) -> Result<Vec<u8>> {
        let mut out = vec![0xFFu8; size];
        let (area, rom_size) = self.rom_area()?;
        if offset >= rom_size {
            return Ok(out);
        }
        let readable = ((rom_size - offset) as usize).min(size);
        let r = self.call_tool(
            "read_memory",
            json!({"area": area, "offset": format!("{:X}", offset), "size": readable}),
        )?;
        let data = r["data"].as_str().ok_or_else(|| McpError("read_memory sans data".to_string()))?;
        let bytes = hex_bytes(data)?;
        out[..bytes.len()].copy_from_slice(&bytes);
        Ok(out)
    }

    /// Écrit des octets dans la ROM de GearGraFX à partir de l'offset `offset`.
    pub fn write_rom(&mut self, offset: u64, data: &[u8]) -> Result<()> {
        let (area, rom_size) = self.rom_area()?;
        if offset >= rom_size {
            return Ok(());
        }
        let writable = data.len().min((rom_size - offset) as usize);
        let hex = to_hex(&data[..writable]);
        self.call_tool(
            "write_memory",
            json!({"area": area, "offset": format!("{:X}", offset), "bytes": hex}),
        )?;
        Ok(())
    }

    /// Réinitialise (reboot) l'émulateur PC-Engine hôte.
    pub fn reset(&mut self) -> Result<Value> {
        self.call_tool("debug_reset", json!({}))
    }

    /// Charge une ROM/CD dans l'émulateur hôte (GearGraFX) depuis un chemin
    /// absolu. Rend la zone mémoire "ROM" disponible côté serveur. Invalide le
    /// cache de la zone ROM (id + taille) car elle apparaît/change après
    /// chargement.
    pub fn load_media(&mut self, file_path: &str) -> Result<Value> {
        let r = self.call_tool("load_media", json!({"file_path": file_path}))?;
        self.rom_area = None;
        self.rom_size = 0;
        Ok(r)
    }

    /// Reprend l'exécution du jeu sur l'émulateur hôte (GearGraFX).
    ///
    /// Après un `load_media` (ou un reset propagé), l'hôte se met en pause dans
    /// son mode debugger : il faut lui envoyer `debug_continue` pour que le jeu
    /// tourne réellement. Corrèle avec le `FIFO *s` (start game) du menu OS.
    pub fn resume(&mut self) -> Result<Value> {
        self.call_tool("debug_continue", json!({}))
    }

    /// Capture une capture d'écran PNG de l'émulateur hôte (optionnel).
    #[allow(dead_code)]
    pub fn screenshot(&mut self) -> Result<Vec<u8>> {
        let r = self.call_tool("get_screenshot", json!({}))?;
        let b64 = r["data"].as_str().ok_or_else(|| McpError("get_screenshot sans data".to_string()))?;
        base64_decode(b64).ok_or_else(|| McpError("get_screenshot : base64 invalide".to_string()))
    }

    // ------------------------------------------------- zones mémoire génériques

    /// Résout une zone mémoire par fragment de nom (insensible à la casse,
    /// correspondance "contient"). Renvoie `(id, size, unit_size)`.
    ///
    /// Les identifiants (`id`) et l'échelle (`unit_size`) des zones de
    /// GearGraFX peuvent varier selon la configuration : on les interroge donc
    /// toujours via `list_memory_areas` plutôt que de les supposer fixes.
    pub fn area_id(&mut self, needle: &str) -> Result<(i64, u64, u64)> {
        let needle = needle.to_lowercase();
        let r = self.call_tool("list_memory_areas", json!({}))?;
        for area in r["areas"].as_array().cloned().unwrap_or_default() {
            let name = area["name"].as_str().unwrap_or("").to_lowercase();
            if name.contains(&needle) {
                let id = area["id"]
                    .as_i64()
                    .ok_or_else(|| McpError(format!("zone {needle} sans id")))?;
                let unit = area["unit_size"].as_u64().unwrap_or(1).max(1);
                let size = area["size"].as_u64().unwrap_or(0);
                return Ok((id, size, unit));
            }
        }
        Err(McpError(format!("zone mémoire {needle} introuvable (list_memory_areas)")))
    }

    /// Lit `size_units` unités adressables d'une zone (offset en unités),
    /// en décodant la réponse hexadécimale en octets bruts.
    fn read_zone_bytes(&mut self, area: i64, offset_units: u64, size_units: usize) -> Result<Vec<u8>> {
        let r = self.call_tool(
            "read_memory",
            json!({
                "area": area,
                "offset": format!("{:X}", offset_units),
                "size": size_units,
            }),
        )?;
        let data = r["data"].as_str().ok_or_else(|| McpError("read_memory sans data".to_string()))?;
        hex_bytes(data)
    }

    /// Lit la **VRAM** complète du VDC (64 Ko) auprès de l'émulateur hôte.
    /// Renvoyée en octets bruts. La zone VRAM (unit_size = 2) a une taille de
    /// `size` unités adressables ; `read_memory` compte en **octets**, on lit
    /// donc `size * unit_size` octets (32768 unités × 2 = 65536 octets).
    pub fn read_vram(&mut self) -> Result<Vec<u8>> {
        let (id, size, unit) = self.area_id("VRAM")?;
        self.read_zone_bytes(id, 0, (size * unit) as usize)
    }

    /// Lit la **palette / color table RAM** du HuC6260 (VCE) auprès de
    /// l'émulateur hôte. La zone palette (unit_size = 2) fait 512 unités
    /// adressables = 1024 octets ; `read_memory` compte en **octets**, on lit
    /// donc `size * unit_size` octets (512 × 2 = 1024) pour obtenir la totalité
    /// des 512 couleurs (BBB RRR GGG sur 9 bits par mot 16 bits).
    pub fn read_palette(&mut self) -> Result<Vec<u8>> {
        for needle in ["Palette", "Color RAM", "CRAM", "VCE", "pal"] {
            if let Ok((id, size, unit)) = self.area_id(needle) {
                return self.read_zone_bytes(id, 0, (size * unit) as usize);
            }
        }
        Err(McpError("zone palette introuvable (list_memory_areas)".to_string()))
    }
}


// ---------------------------------------------------------------- helpers

/// Décode une chaîne hexadécimale (espaces optionnels) en octets.
fn hex_bytes(s: &str) -> Result<Vec<u8>> {
    let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.len() % 2 != 0 {
        return Err(McpError("data hex de longueur impaire".to_string()));
    }
    let b = compact.as_bytes();
    let mut out = Vec::with_capacity(compact.len() / 2);
    for i in (0..compact.len()).step_by(2) {
        let (hi, lo) = (hexval(b[i]), hexval(b[i + 1]));
        match (hi, lo) {
            (Some(h), Some(l)) => out.push((h << 4) | l),
            _ => return Err(McpError("data hex invalide".to_string())),
        }
    }
    Ok(out)
}

/// Encode des octets en hexadécimal séparé par des espaces.
fn to_hex(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut s = String::with_capacity(data.len() * 3);
    for (i, b) in data.iter().enumerate() {
        if i > 0 {
            s.push(' ');
        }
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xF) as usize] as char);
    }
    s
}

fn hexval(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Décodeur base64 minimal (suffisant pour décoder un PNG).
#[allow(dead_code)]
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    let mut out = Vec::with_capacity(compact.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits = 0u32;
    for c in compact.chars() {
        let v: u32 = match c {
            'A'..='Z' => (c as u32) - 'A' as u32,
            'a'..='z' => (c as u32) - 'a' as u32 + 26,
            '0'..='9' => (c as u32) - '0' as u32 + 52,
            '+' => 62,
            '/' => 63,
            '=' => break,
            _ => return None,
        };
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn test_hex_bytes() {
        assert_eq!(hex_bytes("DE AD BE").unwrap(), vec![0xDE, 0xAD, 0xBE]);
        assert_eq!(hex_bytes("deadbeef").unwrap(), vec![0xDE, 0xAD, 0xBE, 0xEF]);
        assert_eq!(hex_bytes("A9 00 85").unwrap(), vec![0xA9, 0x00, 0x85]);
        assert!(hex_bytes("AB C").is_err());
        assert!(hex_bytes("GG").is_err());
    }

    #[test]
    fn test_to_hex() {
        assert_eq!(to_hex(&[0xA9, 0x00, 0x85]), "A9 00 85");
        assert_eq!(to_hex(&[]), "");
    }

    #[test]
    fn test_base64_decode() {
        assert_eq!(base64_decode("AQID").unwrap(), vec![1, 2, 3]);
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
        assert!(base64_decode("!!").is_none());
    }

    fn find_header_end(buf: &[u8]) -> Option<usize> {
        buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
    }

    fn content_length(headers: &str) -> Option<usize> {
        for line in headers.lines() {
            if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                return v.trim().parse().ok();
            }
        }
        None
    }

    /// Serveur MCP HTTP factice reproduisant le comportement de GearGraFX
    /// (une connexion par requête, réponse JSON ou 202 pour les notifications).
    fn spawn_fake_gear_server() -> std::net::SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = match stream {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let mut buf = Vec::new();
                let mut tmp = [0u8; 2048];
                loop {
                    match stream.read(&mut tmp) {
                        Ok(0) => break,
                        Ok(n) => {
                            buf.extend_from_slice(&tmp[..n]);
                            if let Some(h) = find_header_end(&buf) {
                                let headers = String::from_utf8_lossy(&buf[..h]);
                                if let Some(len) = content_length(&headers) {
                                    if buf.len() >= h + len {
                                        break;
                                    }
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                let raw = String::from_utf8_lossy(&buf);
                let body = raw
                    .find("\r\n\r\n")
                    .map(|p| &raw[p + 4..])
                    .unwrap_or("");
                let req: Value = serde_json::from_str(body).unwrap_or(Value::Null);
                let method = req["method"].as_str().unwrap_or("");

                let (status, resp_body): (&str, String) = match method {
                    "initialize" => {
                        let j = json!({
                            "jsonrpc": "2.0", "id": req["id"],
                            "result": {
                                "protocolVersion": "2025-11-25",
                                "capabilities": {},
                                "serverInfo": {"name": "fake-geargrafx", "version": "1.7.19"}
                            }
                        });
                        ("200 OK", serde_json::to_string(&j).unwrap())
                    }
                    "notifications/initialized" => ("202 Accepted", String::new()),
                    "tools/call" => {
                        let tool = req["params"]["name"].as_str().unwrap_or("");
                        let inner = match tool {
                            "list_memory_areas" => {
                                json!({"areas": [
                                    {"id": 1, "name": "VRAM", "size": 0x10000, "unit_size": 1},
                                    {"id": 2, "name": "Palette", "size": 512, "unit_size": 2},
                                    {"id": 3, "name": "ROM", "size": 0x10000, "unit_size": 1}
                                ]})
                            }
                            "read_memory" => {
                                let off_str = req["params"]["arguments"]["offset"].as_str().unwrap_or("0");
                                let off = u32::from_str_radix(off_str, 16).unwrap_or(0);
                                let size = req["params"]["arguments"]["size"].as_i64().unwrap_or(0) as usize;
                                let data: Vec<u8> = (0..size).map(|i| ((off + i as u32) & 0xFF) as u8).collect();
                                json!({"area": 3, "offset": off.to_string(), "data": to_hex(&data)})
                            }
                            "load_media" => json!({"success": true, "file_path": req["params"]["arguments"]["file_path"]}),
                            "debug_reset" => json!({"success": true}),
                            "debug_continue" => json!({"success": true, "paused": false}),
                            _ => json!({"error": "unknown tool"}),
                        };
                        let text = serde_json::to_string(&inner).unwrap();
                        let j = json!({
                            "jsonrpc": "2.0", "id": req["id"],
                            "result": {"content": [{"type": "text", "text": text}], "isError": false}
                        });
                        ("200 OK", serde_json::to_string(&j).unwrap())
                    }
                    _ => ("400 Bad Request", String::new()),
                };

                let resp = if resp_body.is_empty() {
                    format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                } else {
                    let len = resp_body.len();
                    format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{resp_body}")
                };
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        addr
    }

    #[test]
    fn test_mcp_client_roundtrip() {
        let addr = spawn_fake_gear_server();
        let mut c = McpClient::connect("127.0.0.1", addr.port(), None).unwrap();

        // Lecture dans la zone ROM : le client doit envoyer l'offset hexadécimal
        // et décoder les octets renvoyés par l'hôte.
        let data = c.read_rom(0xA0, 8).unwrap();
        let expected: Vec<u8> = (0xA0..0xA8).map(|i| (i & 0xFF) as u8).collect();
        assert_eq!(data, expected);

        // Lecture au-delà de la taille de la ROM (0x10000) : 0xFF.
        let beyond = c.read_rom(0x10000, 4).unwrap();
        assert_eq!(beyond, vec![0xFF; 4]);
    }

    #[test]
    fn test_mcp_read_vram_palette() {
        let addr = spawn_fake_gear_server();
        let mut c = McpClient::connect("127.0.0.1", addr.port(), None).unwrap();

        // VRAM : 32768 unités (unit_size 2) -> 65536 octets.
        let vram = c.read_vram().unwrap();
        assert_eq!(vram.len(), 0x10000);

        // Palette : 512 unités (unit_size 2) -> 1024 octets bruts.
        let pal = c.read_palette().unwrap();
        assert_eq!(pal.len(), 1024);

        // Resolution par nom : doit trouver la zone VRAM (insensible casse).
        let (id, size, unit) = c.area_id("vram").unwrap();
        assert_eq!(id, 1);
        assert_eq!(size, 0x10000);
        assert_eq!(unit, 1);
    }

    #[test]
    fn test_mcp_reset() {
        let addr = spawn_fake_gear_server();
        let mut c = McpClient::connect("127.0.0.1", addr.port(), None).unwrap();
        let r = c.reset().unwrap();
        assert_eq!(r["success"], true);
    }

    #[test]
    fn test_mcp_load_media_invalidates_rom_cache() {
        let addr = spawn_fake_gear_server();
        let mut c = McpClient::connect("127.0.0.1", addr.port(), None).unwrap();

        // Préchauffe le cache de la zone ROM.
        c.rom_area().unwrap();

        // Charge un média : le cache doit être invalidé et la zone ROM
        // re-résolue lors de la lecture suivante.
        let r = c.load_media("/chemin/vers/jeu.pce").unwrap();
        assert_eq!(r["success"], true);
        assert_eq!(r["file_path"], "/chemin/vers/jeu.pce");

        let data = c.read_rom(0x10, 4).unwrap();
        assert_eq!(data, vec![0x10, 0x11, 0x12, 0x13]);
    }

    #[test]
    fn test_mcp_resume() {
        let addr = spawn_fake_gear_server();
        let mut c = McpClient::connect("127.0.0.1", addr.port(), None).unwrap();
        let r = c.resume().unwrap();
        assert_eq!(r["success"], true);
        assert_eq!(r["paused"], false);
    }
}

