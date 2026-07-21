/**
 * Data + shaders for the GPGPU spiral galaxy that drifts in the deep
 * background. Tens of thousands of stars are seeded into logarithmic spiral
 * arms on circular orbits, then integrated on the GPU under a galaxy rotation
 * curve — rigid-body in the bright core, flat in the disk — so the whole thing
 * swirls with the differential rotation of a real galaxy.
 *
 * This module is deliberately free of Three.js and WebGL objects: it produces
 * the plain typed arrays the GPU textures/attributes are filled from and the
 * GLSL the compute passes run, so the seeding maths can be unit-tested on their
 * own.
 */

const TWO_PI = Math.PI * 2;

/** Texture edge lengths; particle count is the square of these. */
export const GALAXY_TEXTURE_SIZE_FULL = 256;
export const GALAXY_TEXTURE_SIZE_REDUCED = 128;

/** Number of spiral arms the stars are threaded onto. */
export const GALAXY_ARM_COUNT = 2;
/** In-plane radius of the bright rigidly-rotating core. */
export const GALAXY_CORE_RADIUS = 22;
/** Outer edge of the seeded disk, in galaxy-local units. */
export const GALAXY_MAX_RADIUS = 220;
/**
 * Flat-curve orbital speed (units/second). Tuned so a mid-disk orbit takes
 * roughly a minute, a slow hypnotic swirl rather than a spin.
 */
export const GALAXY_ORBITAL_SPEED = 11.5;
/** How tightly the logarithmic arms wind; larger is more tightly coiled. */
const GALAXY_ARM_WIND = 3.2 / GALAXY_MAX_RADIUS;
/** Angular fuzz (radians) smearing stars off the ideal arm centre-line. */
const GALAXY_ARM_SCATTER = 0.5;

export interface GalaxySeedData {
  /** RGBA position texture payload: xyz local position, w the seed radius. */
  positions: Float32Array;
  /** RGBA velocity texture payload: xyz local velocity, w unused (1). */
  velocities: Float32Array;
  /** Per-star RGB tint, packed for a static buffer attribute. */
  colors: Float32Array;
  /** Per-star base point size, packed for a static buffer attribute. */
  sizes: Float32Array;
  /** Per-star uv into the GPGPU textures, packed for a buffer attribute. */
  references: Float32Array;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/** Standard-normal sample via Box–Muller. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

/**
 * Orbital speed at a given radius: solid-body inside the core (so the centre
 * does not spin infinitely fast) blending into a flat rotation curve across the
 * disk — the classic galaxy rotation profile.
 */
export function galaxyOrbitalSpeed(radius: number): number {
  if (radius < GALAXY_CORE_RADIUS) {
    return GALAXY_ORBITAL_SPEED * (radius / GALAXY_CORE_RADIUS);
  }
  return GALAXY_ORBITAL_SPEED;
}

function galaxyStarColor(
  radiusFraction: number,
  random: () => number,
): readonly [number, number, number] {
  // Warm yellow-white bulge in the centre, cool blue-white young stars through
  // the arms, dimming to a faint blue at the rim.
  const bulge: readonly [number, number, number] = [1.0, 0.86, 0.62];
  const arm: readonly [number, number, number] = [0.72, 0.82, 1.0];
  const rim: readonly [number, number, number] = [0.5, 0.62, 0.92];
  let base: readonly [number, number, number];
  if (radiusFraction < 0.16) {
    base = bulge;
  } else if (radiusFraction < 0.6) {
    const t = (radiusFraction - 0.16) / 0.44;
    base = [
      bulge[0] + (arm[0] - bulge[0]) * t,
      bulge[1] + (arm[1] - bulge[1]) * t,
      bulge[2] + (arm[2] - bulge[2]) * t,
    ];
  } else {
    const t = (radiusFraction - 0.6) / 0.4;
    base = [
      arm[0] + (rim[0] - arm[0]) * t,
      arm[1] + (rim[1] - arm[1]) * t,
      arm[2] + (rim[2] - arm[2]) * t,
    ];
  }
  // A sprinkle of hot white stars keeps the arms from reading as a flat wash.
  const flare = random() < 0.08 ? 0.3 : 0;
  return [
    Math.min(1, base[0] + flare),
    Math.min(1, base[1] + flare),
    Math.min(1, base[2] + flare),
  ];
}

/**
 * Seeds `size * size` stars into spiral arms with circular orbital velocities.
 * Deterministic for a given size + seed so the galaxy is reproducible.
 */
export function createGalaxySeedData(size: number, seed = 0x9a37c1): GalaxySeedData {
  const count = size * size;
  const positions = new Float32Array(count * 4);
  const velocities = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const references = new Float32Array(count * 2);
  const random = createRandom(seed);

  for (let i = 0; i < count; i += 1) {
    // Radius biased toward the centre so the bulge stays dense, arms thin out.
    const radiusFraction = random() ** 1.7;
    const radius = GALAXY_CORE_RADIUS * 0.15 + radiusFraction * GALAXY_MAX_RADIUS;

    // Log-spiral arm angle plus fuzz; the fuzz widens outward so the arms
    // feather rather than staying razor thin.
    const arm = i % GALAXY_ARM_COUNT;
    const armBase = (arm / GALAXY_ARM_COUNT) * TWO_PI;
    const scatter = gaussian(random) * GALAXY_ARM_SCATTER * (0.4 + radiusFraction);
    const theta = armBase + radius * GALAXY_ARM_WIND + scatter;

    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const px = cos * radius;
    const py = sin * radius;
    // Disk thickness: a rounder bulge in the middle, a thin disk outside.
    const thickness = 10 * Math.exp(-radiusFraction * 3.2) + 1.5;
    const pz = gaussian(random) * thickness;

    const speed = galaxyOrbitalSpeed(radius);
    // Tangential (counter-clockwise) velocity for a circular orbit.
    const vx = -sin * speed;
    const vy = cos * speed;

    positions[i * 4] = px;
    positions[i * 4 + 1] = py;
    positions[i * 4 + 2] = pz;
    positions[i * 4 + 3] = radius;

    velocities[i * 4] = vx;
    velocities[i * 4 + 1] = vy;
    velocities[i * 4 + 2] = 0;
    velocities[i * 4 + 3] = 1;

    const color = galaxyStarColor(radiusFraction, random);
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];

    // Bright fat stars in the bulge, small faint ones at the rim.
    sizes[i] = 2.6 * Math.exp(-radiusFraction * 2.4) + 0.7 + random() * 0.5;

    references[i * 2] = ((i % size) + 0.5) / size;
    references[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
  }

  return { positions, velocities, colors, sizes, references };
}

/**
 * Shared GLSL: the centripetal acceleration that holds a star on its circular
 * orbit, matching {@link galaxyOrbitalSpeed}. Both compute passes evaluate it
 * from the same previous position so the velocity the position pass integrates
 * equals the velocity pass's output — a semi-implicit Euler step, which stays
 * stable over long runs where plain explicit Euler would spiral the disk apart.
 */
const GALAXY_ACCEL_GLSL = `
  const float CORE_R = ${GALAXY_CORE_RADIUS.toFixed(1)};
  const float V0 = ${GALAXY_ORBITAL_SPEED.toFixed(3)};

  vec2 galaxyAccel(vec2 planar) {
    float r = length(planar);
    if (r < 0.0001) return vec2(0.0);
    float v = (r < CORE_R) ? V0 * (r / CORE_R) : V0;
    float accMag = (v * v) / max(r, CORE_R * 0.4);
    return (-planar / r) * accMag;
  }
`;

export const GALAXY_VELOCITY_SHADER = `
  uniform float uDelta;
  ${GALAXY_ACCEL_GLSL}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D(texturePosition, uv).xyz;
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    vel.xy += galaxyAccel(pos.xy) * uDelta;
    vel.z = 0.0;
    gl_FragColor = vec4(vel, 1.0);
  }
`;

export const GALAXY_POSITION_SHADER = `
  uniform float uDelta;
  ${GALAXY_ACCEL_GLSL}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 posData = texture2D(texturePosition, uv);
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    // Recompute the velocity update here so we integrate the *new* velocity
    // (semi-implicit Euler) rather than last frame's.
    vel.xy += galaxyAccel(posData.xyz.xy) * uDelta;
    vel.z = 0.0;
    vec3 pos = posData.xyz + vel * uDelta;
    gl_FragColor = vec4(pos, posData.w);
  }
`;

export const GALAXY_RENDER_VERTEX_SHADER = `
  uniform sampler2D texturePosition;
  uniform float uPixelRatio;
  attribute vec2 aReference;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  void main() {
    vec3 pos = texture2D(texturePosition, aReference).xyz;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 1.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (420.0 / dist), 0.8, 10.0);
  }
`;

export const GALAXY_RENDER_FRAGMENT_SHADER = `
  precision highp float;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float alpha = smoothstep(0.5, 0.0, length(c));
    if (alpha <= 0.01) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;
