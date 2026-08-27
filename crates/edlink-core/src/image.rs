//! Conversion du contenu VRAM + palette du menu EverDrive en image PNG
//! (port Rust de `DEV_TED/MenuImage.cs`).

use crate::error::Result;

const PLAN_W: usize = 64; // 512/8
const SCREEN_W: usize = 40; // 320/8
const SCREEN_H: usize = 28; // 224/8
const SCREEN_PX_W: usize = 320;
const SCREEN_PX_H: usize = 224;

/// Construit une image PNG RVB 320x224 à partir de la VRAM et de la palette
/// (1024 octets) renvoyées par le dump du menu.
pub fn make_png(vram: &[u8], pal8: &[u8]) -> Result<Vec<u8>> {
    let pal16 = get_pal16(pal8);
    let pal32 = get_pal32(&pal16);
    let tilemap = get_tilemap(vram);

    let n = SCREEN_PX_W * SCREEN_PX_H;
    let mut rgb: Vec<u8> = Vec::with_capacity(n * 3);
    for i in 0..n {
        let x = i % SCREEN_PX_W;
        let y = i / SCREEN_PX_W;
        let tile_ptr = x / 8 + y / 8 * SCREEN_W;
        let tile_pal = (tilemap[tile_ptr] >> 12) as usize;
        let tile_idx = (tilemap[tile_ptr] & 0x0fff) as usize;
        let pixel = get_pixel(vram, tile_idx, x, y);
        let c = pal32[tile_pal * 16 + pixel];
        rgb.push(((c >> 16) & 0xFF) as u8);
        rgb.push(((c >> 8) & 0xFF) as u8);
        rgb.push((c & 0xFF) as u8);
    }

    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, SCREEN_PX_W as u32, SCREEN_PX_H as u32);
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

fn get_tilemap(vram: &[u8]) -> Vec<u16> {
    let mut map = vec![0u16; SCREEN_W * SCREEN_H];
    for y in 0..SCREEN_H {
        for x in 0..SCREEN_W {
            let off = (x + y * PLAN_W) * 2;
            let lo = vram.get(off).copied().unwrap_or(0) as u16;
            let hi = vram.get(off + 1).copied().unwrap_or(0) as u16;
            map[x + y * SCREEN_W] = lo | (hi << 8);
        }
    }
    map
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
