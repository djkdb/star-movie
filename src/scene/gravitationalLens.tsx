import { wrapEffect } from '@react-three/postprocessing';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, type ForwardRefExoticComponent, type RefAttributes, type RefObject } from 'react';
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, Vector3 } from 'three';

/**
 * A depth-aware, screen-space gravitational lens. The black hole hangs in the
 * deep background, so only the stars *behind* it should bend around it — the
 * interactive foreground work-stars, which sit in front, must never move (their
 * click targets don't follow a screen-space warp). So the bend is gated two
 * ways: an annular band that hugs the disk edge (leaving the raymarched disk
 * alone) and a depth test that only warps pixels as far as, or farther than,
 * the hole. Together they confine the effect to the real background stars.
 */
const LENS_FRAGMENT = /* glsl */ `
  uniform vec2 uLensCenter;
  uniform float uLensRadius;
  uniform float uLensStrength;
  uniform float uInnerT;
  uniform float uAspect;
  uniform float uHoleViewZ;

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    outputColor = inputColor;
    if (uLensRadius <= 0.0) return;
    vec2 d = uv - uLensCenter;
    d.x *= uAspect;
    float r = length(d);
    if (r >= uLensRadius) return;
    float t = r / uLensRadius;                 // 0 core .. 1 rim
    // Annular band hugging the disk edge — never distorts the disk itself.
    float inner = smoothstep(uInnerT, uInnerT + 0.05, t);
    float outer = 1.0 - smoothstep(uInnerT + 0.14, 1.0, t);
    float bend = uLensStrength * inner * outer;
    if (bend <= 0.0) return;
    // Depth gate: only bend pixels at least ~80% as far as the hole. viewZ is
    // negative (farther = more negative), so a nearer foreground star has a
    // larger (less negative) viewZ and is skipped, at any zoom level.
    float viewZ = getViewZ(depth);
    if (viewZ > uHoleViewZ * 0.8) return;
    vec2 dir = d / max(r, 1e-4);
    dir.x /= uAspect;
    outputColor = texture(inputBuffer, uv - dir * bend);
  }
`;

class GravitationalLensEffect extends Effect {
  constructor() {
    super('GravitationalLensEffect', LENS_FRAGMENT, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uLensCenter', new Uniform(new Vector2(0.5, 0.5))],
        ['uLensRadius', new Uniform(0)],
        ['uLensStrength', new Uniform(0)],
        ['uInnerT', new Uniform(0.4)],
        ['uAspect', new Uniform(1)],
        ['uHoleViewZ', new Uniform(-1)],
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
  /** Peak UV deflection near the ring; small (~0.05) reads as a gentle lens. */
  strength: number;
  enabled: boolean;
}

/**
 * Projects the hole's world center to screen space each frame and feeds the
 * lens effect its center, apparent radius, aspect and view-space depth. Lives
 * outside the composer (it only needs the shared effect ref) so it can read the
 * camera.
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
    () => ({ c: new Vector3(), e: new Vector3(), v: new Vector3(), right: new Vector3() }),
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
    // View-space depth of the hole (negative) for the foreground/background gate.
    const holeViewZ = scratch.v.copy(center).applyMatrix4(camera.matrixWorldInverse).z;
    (effect.uniforms.get('uLensCenter') as Uniform).value.set(cx, cy);
    radiusUniform.value = outerRadius;
    (effect.uniforms.get('uInnerT') as Uniform).value = outerRadius <= 0 ? 0.5 : Math.min(0.9, diskScreen / outerRadius);
    (effect.uniforms.get('uHoleViewZ') as Uniform).value = holeViewZ;
    (effect.uniforms.get('uLensStrength') as Uniform).value = strength;
  });

  return null;
}
