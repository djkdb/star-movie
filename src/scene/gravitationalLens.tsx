import { wrapEffect } from '@react-three/postprocessing';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, type ForwardRefExoticComponent, type RefAttributes, type RefObject } from 'react';
import { Effect } from 'postprocessing';
import { Uniform, Vector2, Vector3 } from 'three';

/**
 * A screen-space gravitational lens. `mainUv` bends the sampling coordinates of
 * the rendered scene inward around the hole's screen position, so the real
 * stars behind it warp and bunch into a bright ring — the Interstellar look —
 * instead of the raymarched disk lensing only itself. The pull is annular:
 * zero inside the shadow, strongest just outside it, fading to nothing by the
 * lens rim, so it grabs the surrounding starfield without smearing the disk.
 */
const LENS_FRAGMENT = /* glsl */ `
  uniform vec2 uLensCenter;
  uniform float uLensRadius;
  uniform float uLensStrength;
  uniform float uInnerT;
  uniform float uAspect;

  void mainUv(inout vec2 uv) {
    if (uLensRadius <= 0.0) return;
    vec2 d = uv - uLensCenter;
    d.x *= uAspect;
    float r = length(d);
    if (r >= uLensRadius) return;
    float t = r / uLensRadius;               // 0 core .. 1 rim
    // A tight Einstein ring hugging the disk edge: nothing across the disk
    // (t < uInnerT), a bend that peaks just outside it and falls to zero well
    // before the rim, so the surrounding starfield warps into a ring near the
    // hole without reaching — and visually displacing — the interactive stars.
    float inner = smoothstep(uInnerT, uInnerT + 0.05, t);
    float outer = 1.0 - smoothstep(uInnerT + 0.12, 1.0, t);
    float bend = uLensStrength * inner * outer;
    vec2 dir = d / max(r, 1e-4);
    dir.x /= uAspect;
    uv -= dir * bend;                         // pull the background toward the hole
  }
`;

class GravitationalLensEffect extends Effect {
  constructor() {
    super('GravitationalLensEffect', LENS_FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ['uLensCenter', new Uniform(new Vector2(0.5, 0.5))],
        ['uLensRadius', new Uniform(0)],
        ['uLensStrength', new Uniform(0)],
        ['uInnerT', new Uniform(0.4)],
        ['uAspect', new Uniform(1)],
      ]),
    });
  }
}

export type GravitationalLensRef = InstanceType<typeof GravitationalLensEffect>;

// wrapEffect's inferred props type is `never` in this version, which rejects the
// forwarded ref at the call site; re-type it as a plain ref-only component.
export const GravitationalLens = wrapEffect(GravitationalLensEffect) as unknown as
  ForwardRefExoticComponent<RefAttributes<GravitationalLensRef | null>>;

interface DriverProps {
  lensRef: RefObject<GravitationalLensRef | null>;
  center: Vector3;
  /** World-space radius the lens distortion reaches into the surrounding stars. */
  worldRadius: number;
  /** World-space radius of the disk; no bending happens inside it. */
  diskRadius: number;
  /** Peak UV deflection near the ring; small (~0.03) reads as a gentle lens. */
  strength: number;
  enabled: boolean;
}

/**
 * Projects the hole's world center to screen space each frame and feeds the
 * lens effect its center, apparent radius and aspect. Lives outside the
 * composer (it only needs the shared effect ref), so it can read the camera.
 */
export function GravitationalLensDriver({
  lensRef,
  center,
  worldRadius,
  diskRadius,
  strength,
  enabled,
}: DriverProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const scratch = useMemo(
    () => ({ c: new Vector3(), e: new Vector3(), right: new Vector3() }),
    [],
  );

  useFrame(() => {
    const effect = lensRef.current;
    if (effect === null) return;
    const aspect = size.height === 0 ? 1 : size.width / size.height;
    (effect.uniforms.get('uAspect') as Uniform).value = aspect;
    const radiusUniform = effect.uniforms.get('uLensRadius') as Uniform;
    if (!enabled) {
      radiusUniform.value = 0;
      return;
    }
    const ndc = scratch.c.copy(center).project(camera);
    // Behind the camera → no lens.
    if (ndc.z > 1) {
      radiusUniform.value = 0;
      return;
    }
    const cx = ndc.x * 0.5 + 0.5;
    const cy = ndc.y * 0.5 + 0.5;
    scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    // Project the outer reach and the disk edge to screen; their ratio is where
    // the annular bend begins so the disk itself is never distorted.
    const edge = scratch.e.copy(center).addScaledVector(scratch.right, worldRadius).project(camera);
    const outerRadius = Math.hypot((edge.x * 0.5 + 0.5 - cx) * aspect, edge.y * 0.5 + 0.5 - cy);
    const diskEdge = scratch.e.copy(center).addScaledVector(scratch.right, diskRadius).project(camera);
    const diskScreen = Math.hypot((diskEdge.x * 0.5 + 0.5 - cx) * aspect, diskEdge.y * 0.5 + 0.5 - cy);
    (effect.uniforms.get('uLensCenter') as Uniform).value.set(cx, cy);
    radiusUniform.value = outerRadius;
    (effect.uniforms.get('uInnerT') as Uniform).value = outerRadius <= 0 ? 0.5 : Math.min(0.9, diskScreen / outerRadius);
    (effect.uniforms.get('uLensStrength') as Uniform).value = strength;
  });

  return null;
}
