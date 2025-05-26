use wasm_bindgen::prelude::*;
use image::{load_from_memory, RgbaImage, imageops::{overlay, FilterType}};
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};

#[wasm_bindgen]
pub fn compose(g0: &[u8], g1: &[u8]) -> Vec<u8> {
    let img0 = load_from_memory(g0).expect("Failed to load g0");
    let img1 = load_from_memory(g1).expect("Failed to load g1");

    let resized0: RgbaImage = img0.resize_exact(585, 585, FilterType::Lanczos3).to_rgba8();
    let resized1: RgbaImage = img1.resize_exact(585, 585, FilterType::Lanczos3).to_rgba8();

    let mut canvas: RgbaImage = RgbaImage::from_pixel(1200, 605, image::Rgba([20, 20, 20, 255]));

    overlay(&mut canvas, &resized0, 10, 10);
    overlay(&mut canvas, &resized1, 605, 10);

    let mut output = Vec::new();
    let encoder = PngEncoder::new(&mut output);
    encoder.write_image(&canvas, 1200, 605, ColorType::Rgba8).unwrap();

    output
}