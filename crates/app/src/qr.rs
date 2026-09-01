//! Génère un QR code en PNG à partir d'une chaîne (l'URL du serveur mobile).
//!
//! On encode nous-mêmes la matrice de modules en PNG via `png` (déjà utilisé
//! par `edlink-core/src/image.rs`) plutôt que d'activer la feature `image` de
//! `qrcode` — évite de tirer la dépendance `image`, inutile ici.

use qrcode::{Color, QrCode};

/// Taille d'un module (case) en pixels dans l'image de sortie.
const SCALE: usize = 8;
/// Marge blanche (« quiet zone ») en modules autour du code, requise par la
/// norme QR pour une lecture fiable par les scanners.
const QUIET: usize = 4;

/// Construit un PNG (niveaux de gris, noir/blanc) du QR code encodant `data`.
pub fn png_for(data: &str) -> Result<Vec<u8>, String> {
    let code = QrCode::new(data.as_bytes()).map_err(|e| e.to_string())?;
    let width = code.width();
    let colors = code.to_colors();

    let out_modules = width + QUIET * 2;
    let out_px = out_modules * SCALE;

    // Fond blanc (255), modules sombres peints en noir (0).
    let mut buf = vec![255u8; out_px * out_px];
    for y in 0..width {
        for x in 0..width {
            if colors[y * width + x] == Color::Dark {
                let px0 = (x + QUIET) * SCALE;
                let py0 = (y + QUIET) * SCALE;
                for dy in 0..SCALE {
                    let row = (py0 + dy) * out_px;
                    for dx in 0..SCALE {
                        buf[row + px0 + dx] = 0;
                    }
                }
            }
        }
    }

    let mut png_bytes = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut png_bytes, out_px as u32, out_px as u32);
        enc.set_color(png::ColorType::Grayscale);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&buf).map_err(|e| e.to_string())?;
    }
    Ok(png_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_a_valid_png_signature() {
        let bytes = png_for("http://192.168.1.23:4590").unwrap();
        // Signature PNG standard (8 octets) — suffisant pour vérifier qu'on a
        // bien écrit un fichier PNG et pas juste des octets bruts.
        assert_eq!(&bytes[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn rejects_empty_data() {
        // La norme QR ne permet pas d'encoder une chaîne vide dans ce mode.
        // Peu importe le comportement exact ici : on veut juste ne jamais
        // paniquer sur une entrée limite.
        let _ = png_for("");
    }
}
