---
name: blackhole-tuning
description: >-
  Tune the raymarched Gargantua black hole and other GLSL scene visuals
  (fireworks, galaxies, nebula) in the Asteron archive. Use when changing
  the look of the black hole disk/horizon/lensing, adjusting shader
  constants in BlackholeRenderer.tsx / BackgroundBlackhole.tsx, or when a
  visual change needs to be verified with a headless screenshot. Encodes
  the prototype-then-screenshot loop and the headless-Chromium gotchas that
  otherwise make WebGL scenes render black or frozen.
---

# Black hole & scene visual tuning

The signature visual is a **raymarched** black hole drawn in a GLSL fragment
shader on a camera-facing billboard — not geometry. Tuning it is an
iterative loop: change a constant, screenshot, compare to the reference,
repeat. This skill captures the exact knobs and the headless-render traps.

## Where the shader lives

- `src/scene/BlackholeRenderer.tsx` — the **source of truth**. Exports
  `BLACKHOLE_RAYMARCH_FRAGMENT_SHADER` and `BLACKHOLE_VERTEX_SHADER`.
- `src/scene/BackgroundBlackhole.tsx` — the decorative backdrop hole. Reuses
  the same exported shader; recomputes disk-frame basis uniforms
  (`uDiskX/uDiskN/uDiskZ`) from the camera each frame so framing stays
  cinematic. Heavy — gated to the top two quality tiers.
- `src/scene/blackholeModel.ts` (+ `.test.ts`) — pure math/uniform helpers.

## The knobs (current values, in the fragment shader)

All disk/horizon sizes are scaled by `sc` (the `uScale`-derived factor):

| Constant | Meaning | Current |
|----------|---------|---------|
| `RS`   | Schwarzschild horizon radius | `1.15 * sc` |
| `DIN`  | Disk inner edge | `1.6 * sc` |
| `DOUT` | Disk outer edge | `9.6 * sc` |
| `RINGB`| Photon-ring impact band (halo shaping only) | `1.9 * sc` |
| `LENS` | Gravitational bend strength (in `bend = RS²/r² · (1 + 1.15·RS/r) · STEP · LENS`) | tune with care |
| `uGain`| Tone-map exposure uniform | `1` in `BlackholeRenderer`, `0.42` in `BackgroundBlackhole` |

### Disk palette — `diskRamp(x)`
White-hot inner → gold → orange → deep. This is where "make it more
orange / less washed-out" lives. Reference target is Interstellar's
Gargantua: a **clear yellow→orange gradient**, not a flat cream disk.
Keep the inner hot point near `vec3(1.2, 1.08, 0.78)` and let it fall to a
deep orange `~vec3(0.92, 0.27, 0.015)`.

### Tone map (hue-preserving)
```glsl
vec3 hueKept = col * ((1.0 - exp(-lum * 1.5 * uGain)) / lum);
vec3 clipped = vec3(1.0) - exp(-col * 1.5 * uGain);
// final = mix(hueKept, clipped, 0.18)
```
**Why it matters:** per-channel exposure (`clipped` alone) desaturates the
disk — orange collapses toward yellow at high brightness. The `hueKept`
term preserves the ramp's hue; keep the mix low (~0.18). If the disk looks
"washed cream", suspect this mix crept up or `uGain` is too high.

## Lessons already paid for (do not re-learn)

- **No painted photon ring.** The bright ring IS the lensed inner edge of
  the disk wrapping over the top/bottom. A separately painted `bImpact`
  ring reads as a detached white halo — it was removed. Shape the halo via
  `RINGB` smoothstep only.
- **Over-bending washes the sphere.** Cranking `LENS` too high smears the
  whole disk into a bright fog around the horizon. Increase gradually.
- **Shadow too fat?** Shrink `RS`, not the disk. The black center is the
  horizon; `DIN` controls where light starts.
- Background hole uses a **lower `uGain` (0.42)** and higher step count so
  it stays subtle behind the foreground stars.

## Verifying a change with a screenshot (headless)

The prototype harness (`_bh2/` standalone Vite page) is **not committed** —
recreate it ad hoc when needed, or screenshot the running dev server. Either
way, headless Chromium has two traps that make WebGL scenes look broken:

1. **SwiftShader GL.** Launch Chromium with:
   ```
   executablePath: '/opt/pw-browsers/chromium'   // or the pinned chromium-<n>/chrome-linux/chrome
   args: ['--use-gl=angle', '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
   ```
   Without this the canvas renders black.
2. **Reduced-motion freezes animation.** Headless Chromium reports
   `prefers-reduced-motion: reduce`, which flips R3F to `frameloop='demand'`
   and freezes every animated shader at `t=0` (fireworks collapse to a
   point at the origin with alpha 0 → invisible). Force full motion before
   the app boots:
   ```js
   await page.addInitScript(() => {
     const mm = window.matchMedia;
     window.matchMedia = (q) =>
       /prefers-reduced-motion/.test(q)
         ? { ...mm(q), matches: false }
         : mm(q);
   });
   ```

Save screenshots to the scratchpad dir, not the repo.

## Related visual systems (same file neighborhood)

- **Fireworks / meteors:** `src/scene/ParticleManager.tsx` +
  `particleManagerModel.ts`. Fireworks burst far in the background
  (`FIREWORK_STAGE_DISTANCE`), enormous scale, made of many fine star-like
  sparks (sharpened fragment shader) — not fat glowing blobs. Meteor
  shimmer is deliberately calmed to avoid strobing the screen.
- **Spiral galaxies:** `SpiralGalaxyField.tsx` — GPGPU via
  `three/examples/jsm/misc/GPUComputationRenderer.js`, parameterized
  `origin/tilt/scale`, quality-gated.
- **Background scatter:** `backgroundModel.ts` scatters nebula/galaxies on
  the full 360° sphere (`randomDirection`), never a flat band.

## Workflow checklist

1. Identify the knob (table above) — change the **exported** shader in
   `BlackholeRenderer.tsx` so both holes update.
2. `npm run dev`, screenshot with the two overrides above, compare to the
   reference the user gave.
3. Iterate on ONE knob at a time; the interactions (lens × gain × ramp)
   are non-obvious.
4. `npm run typecheck && npm run build` before committing.
5. If `blackholeModel.ts` math changed, run its unit test.
