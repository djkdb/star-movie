import { Color, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';

import type { PlanetSpecies } from '../domain/planetCatalog';

/**
 * Deterministic per-species equirectangular surface textures, generated once and
 * cached. Each species' pattern (bands, blotches, swirls, cracks…) is painted
 * from its own palette so every world reads distinctly.
 */
const textureCache = new Map<string, DataTexture>();

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 0x1_0000_0000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise that wraps horizontally so the equirectangular seam is hidden. */
function wrappedNoise(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const wrap = (n: number) => ((n % freq) + freq) % freq;
  const x0 = wrap(ix);
  const x1 = wrap(ix + 1);
  const a = hash2(x0, iy, seed);
  const b = hash2(x1, iy, seed);
  const c = hash2(x0, iy + 1, seed);
  const d = hash2(x1, iy + 1, seed);
  const ux = smooth(fx);
  const uy = smooth(fy);
  return (
    a * (1 - ux) * (1 - uy) +
    b * ux * (1 - uy) +
    c * (1 - ux) * uy +
    d * ux * uy
  );
}

function fbm(u: number, v: number, seed: number, baseFreq: number): number {
  let value = 0;
  let amplitude = 0.5;
  let freq = baseFreq;
  for (let octave = 0; octave < 4; octave += 1) {
    value += amplitude * wrappedNoise(u, v, Math.max(2, Math.round(freq)), seed + octave * 97);
    freq *= 2;
    amplitude *= 0.5;
  }
  return value;
}

function seedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildTexture(species: PlanetSpecies): DataTexture {
  const width = 128;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  const base = new Color(species.baseColor);
  const accent = new Color(species.accentColor);
  const emissive = new Color(species.emissiveColor);
  const seed = seedFromId(species.id);
  const mixColor = new Color();

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      let t: number; // 0 = base, 1 = accent
      let glow = 0; // extra emissive contribution along cracks

      switch (species.pattern) {
        case 'bands': {
          const wobble = (fbm(u, v, seed, 3) - 0.5) * 0.12;
          const band = Math.sin((v + wobble) * Math.PI * 7);
          t = 0.5 + 0.5 * band * (0.6 + 0.4 * fbm(u, v, seed + 11, 5));
          break;
        }
        case 'swirl': {
          const warp = fbm(u + 0.3, v, seed, 3);
          const swirl = Math.sin((u * 6 + warp * 4 + v * 2) * Math.PI);
          t = 0.5 + 0.5 * swirl * (0.5 + 0.5 * fbm(u, v, seed + 5, 6));
          break;
        }
        case 'blotches': {
          const n = fbm(u, v, seed, 5);
          t = smooth(Math.min(1, Math.max(0, (n - 0.42) * 3.2)));
          break;
        }
        case 'cracks': {
          const n = fbm(u, v, seed, 6);
          const ridge = 1 - Math.abs(n - 0.5) * 2; // bright along mid-value ridges
          const crack = Math.pow(Math.max(0, ridge), 6);
          t = crack;
          glow = crack;
          break;
        }
        case 'facets': {
          const cell = Math.floor(u * 8) * 13 + Math.floor(v * 6) * 7;
          t = 0.3 + 0.7 * hash2(cell, cell + 1, seed);
          break;
        }
        case 'solid':
        default: {
          t = 0.35 * fbm(u, v, seed, 4);
          break;
        }
      }

      mixColor.copy(base).lerp(accent, Math.min(1, Math.max(0, t)));
      if (glow > 0) mixColor.lerp(emissive, Math.min(1, glow));

      const index = (y * width + x) * 4;
      data[index] = Math.round(mixColor.r * 255);
      data[index + 1] = Math.round(mixColor.g * 255);
      data[index + 2] = Math.round(mixColor.b * 255);
      data[index + 3] = 255;
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function getPlanetSurfaceTexture(species: PlanetSpecies): DataTexture {
  const cached = textureCache.get(species.id);
  if (cached !== undefined) return cached;
  const texture = buildTexture(species);
  textureCache.set(species.id, texture);
  return texture;
}
