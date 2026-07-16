import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';

/**
 * Tiny procedural sprite textures shared by every star decoration. They are
 * module-level singletons that live for the whole session, so no per-star
 * texture allocation or disposal bookkeeping is needed.
 */

function buildTexture(
  size: number,
  alphaAt: (nx: number, ny: number) => number,
): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size - 0.5) * 2;
      const ny = ((y + 0.5) / size - 0.5) * 2;
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(Math.max(0, Math.min(1, alphaAt(nx, ny))) * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

let haloTexture: DataTexture | null = null;

/** Soft radial glow with a hot core, for star halos and meteor heads. */
export function getStarHaloTexture(): DataTexture {
  haloTexture ??= buildTexture(64, (nx, ny) => {
    const distance = Math.hypot(nx, ny);
    const core = Math.max(0, 1 - distance / 0.35) ** 1.5;
    const glow = Math.max(0, 1 - distance) ** 2.4;
    return core + glow * 0.55;
  });
  return haloTexture;
}

let spikeTexture: DataTexture | null = null;

/**
 * A thin horizontal light streak — bright center tapering to both ends — used
 * for diffraction spikes. Rendered via rotated, elongated sprites.
 */
export function getStarSpikeTexture(): DataTexture {
  spikeTexture ??= buildTexture(64, (nx, ny) => {
    const along = Math.max(0, 1 - Math.abs(nx)) ** 2.6;
    const across = Math.exp(-((ny * 5.5) ** 2));
    return along * across;
  });
  return spikeTexture;
}
