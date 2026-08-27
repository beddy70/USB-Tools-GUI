//! Conversion du contenu VRAM + palette de la PC-Engine en image PNG.
//! Port Rust de `DEV_TED/MenuImage.cs`, étendu pour un affichage réglable :
//! taille de BAT, résolution de la fenêtre et défilement (horizontal/vertical).

use crate::error::Result;

/// Paramètres d'affichage du visualiseur de l'écran (tilemap VRAM + palette).
#[derive(Debug, Clone, Copy)]
pub struct ScreenOpts {
    /// Largeur du BAT (plan de tuiles) en nombre de tuiles (32 / 64 / 128).
    pub bat_w: usize,
    /// Hauteur du BAT en nombre de tuiles (32 / 64).
    pub bat_h: usize,
    /// Largeur de l'image de sortie en pixels (fenêtre d'affichage).
    pub res_w: usize,
    /// Hauteur de l'image de sortie en pixels.
    pub res_h: usize,
    /// Défilement horizontal du BAT en pixels (0-511, enroulé modulo plan).
    pub scroll_x: usize,
    /// Défilement vertical du BAT en pixels (0-511, enroulé modulo plan).
    pub scroll_y: usize,
}

impl Default for ScreenOpts {
    fn default() -> Self {
        Self {
            bat_w: 64,
            bat_h: 32,
            res_w: 320,
            res_h: 224,
            scroll_x: 0,
            scroll_y: 0,
        }
    }
}

/// Construit une image PNG RVB à partir de la VRAM et de la palette (1024 octets)
/// selon les paramètres d'affichage `o` (taille de BAT, résolution, défilement).
pub fn make_png(vram: &[u8], pal8: &[u8], o: &ScreenOpts) -> Result<Vec<u8>> {
    let bat_w = o.bat_w.clamp(1, 128);
    let bat_h = o.bat_h.clamp(1, 64);
    let res_w = o.res_w.clamp(1, 1024);
    let res_h = o.res_h.clamp(1, 1024);

    let pal16 = get_pal16(pal8);
    let pal32 = get_pal32(&pal16);

    // Dimensions du plan en pixels (chaque tuile fait 8x8).
    let bw_px = bat_w * 8;
    let bh_px = bat_h * 8;
    let sx = o.scroll_x % bw_px;
    let sy = o.scroll_y % bh_px;

    let n = res_w * res_h;
    let mut rgb: Vec<u8> = Vec::with_capacity(n * 3);
    for py in 0..res_h {
        for px in 0..res_w {
            // Position source dans le plan, enroulée sur les bords du BAT.
            let bx = (sx + px) % bw_px;
            let by = (sy + py) % bh_px;
            let tx = bx / 8;
            let ty = by / 8;

            let entry = tile_entry(vram, bat_w, tx, ty);
            let tile_pal = ((entry >> 12) & 0xF) as usize;
            let tile_idx = (entry & 0x0fff) as usize;
            let pixel = get_pixel(vram, tile_idx, bx % 8, by % 8);

            let c = pal32[(tile_pal * 16 + pixel) & 0x1ff];
            rgb.push(((c >> 16) & 0xFF) as u8);
            rgb.push(((c >> 8) & 0xFF) as u8);
            rgb.push((c & 0xFF) as u8);
        }
    }

    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, res_w as u32, res_h as u32);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header()?;
        writer.write_image_data(&rgb)?;
    }
    Ok(buf)
}

fn get_pixel(vram: &[u8], tile_idx: usize, x: usize, y: usize) -> usize {
    let x = x % 8;
    let y = y % 8;
    let ptr = tile_idx.saturating_mul(32) + y * 2;
    let bit_ptr = 7 - x;

    let bit = |off: usize| -> usize {
        (vram.get(ptr + off).copied().unwrap_or(0) as usize >> bit_ptr) & 1
    };
    let b0 = bit(0);
    let b1 = bit(1);
    let b2 = bit(16);
    let b3 = bit(17);
    (b3 << 3) | (b2 << 2) | (b1 << 1) | b0
}

/// Lit l'entrée du BAT (tilemap) à la coordonnée de tuile (tx, ty) d'un plan
/// de `plan_w` tuiles de large. Valeur = palette (bits 12-15) | index de tuile (0-11).
fn tile_entry(vram: &[u8], plan_w: usize, tx: usize, ty: usize) -> u16 {
    let off = (tx + ty * plan_w) * 2;
    let lo = vram.get(off).copied().unwrap_or(0) as u16;
    let hi = vram.get(off + 1).copied().unwrap_or(0) as u16;
    lo | (hi << 8)
}

fn get_pal16(pal8: &[u8]) -> Vec<u16> {
    pal8
        .chunks(2)
        .map(|c| {
            let lo = c.first().copied().unwrap_or(0) as u16;
            let hi = c.get(1).copied().unwrap_or(0) as u16;
            lo | (hi << 8)
        })
        .collect()
}

fn get_pal32(pal16: &[u16]) -> Vec<u32> {
    pal16
        .iter()
        .map(|&p| {
            let r = ((p >> 3) & 7) << 5;
            let g = ((p >> 6) & 7) << 5;
            let b = (p & 7) << 5;
            (0xFFu32 << 24) | ((r as u32) << 16) | ((g as u32) << 8) | (b as u32)
        })
        .collect()
}
