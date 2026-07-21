import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Vector3,
  type Group,
  type ShaderMaterial,
} from 'three';

import type { ArchivedStar, QualityLevel } from '../domain/models';
import type { StarDragPayload } from './starVisualModel';
import {
  BLACKHOLE_DISTORTION_MAX_STRENGTH,
  BLACKHOLE_DISTORTION_RADIUS,
  BLACKHOLE_POSITION,
  EMBER_ORBIT_MAX_RADIUS,
  getArchivedEmberOrbit,
  getBlackholeMassScale,
  isBlackholeDropHit,
  isValidBlackholeDragPayload,
} from './blackholeModel';
import { GENRE_FIREWORK_COLORS } from './particleManagerModel';
import { getStarHaloTexture } from './starSpriteTextures';
import { useVisibleElapsedSeconds } from './VisibilityClock';

/**
 * Half-size of the billboarded quad the black hole is raymarched through. The
 * quad only needs to cover the lensed footprint; it is scaled with the hole's
 * mass so a heavier hole still fits.
 */
const BLACKHOLE_RAYMARCH_HALF = 12;

/** Raymarch step budget per quality tier; degrades with the FPS controller. */
const RAYMARCH_STEPS_BY_QUALITY: Readonly<Record<QualityLevel, number>> = {
  full: 120,
  reducedBackground: 88,
  minimumParticles: 60,
  reducedBloom: 48,
};

export const BLACKHOLE_VERTEX_SHADER = `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * A true raymarched "Gargantua" black hole. For every fragment a view ray is
 * bent by the hole's gravity as it steps through the influence sphere: rays
 * that fall past the horizon are the pure-black shadow (opaque, so it occludes
 * the sky), rays that graze it draw the bright photon ring, and rays that cross
 * the equatorial accretion plane pick up its Doppler-beamed, blackbody-colored,
 * turbulent light — including the far side of the disk lensed up and over the
 * shadow. Everything else stays transparent so the hole composites into the
 * existing star sky. The disk lives in the world horizontal plane, so orbiting
 * the camera reveals its real 3D structure rather than a fixed billboard.
 */
export const BLACKHOLE_RAYMARCH_FRAGMENT_SHADER = `
  precision highp float;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform float uArousal;
  uniform vec3 uCameraPos;
  uniform vec3 uCenter;
  uniform float uScale;
  uniform int uSteps;
  uniform float uDiskTilt;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)),
          c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  vec3 blackbody(float x){ // x: 0 = white-hot (inner), 1 = deep red (outer)
    vec3 hot  = vec3(1.0, 0.98, 0.92);
    vec3 warm = vec3(1.0, 0.60, 0.24);
    vec3 deep = vec3(0.66, 0.20, 0.08);
    vec3 c = mix(hot, warm, smoothstep(0.0, 0.5, x));
    return mix(c, deep, smoothstep(0.5, 1.0, x));
  }

  // Rotate a point about the local X axis, to tilt the disk plane.
  vec3 tiltX(vec3 p, float c, float s){
    return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  }

  void main(){
    float sc = max(uScale, 0.001);
    // Length scales grow with the hole's mass; LENS carries 1/sc so the
    // deflection angle stays identical at every size.
    float RS    = 1.9 * sc;   // event-horizon (shadow) radius
    float DIN   = 2.4 * sc;   // disk inner radius
    float DOUT  = 6.8 * sc;   // disk outer radius
    float RINF  = 13.0 * sc;  // influence sphere
    float STEP  = 0.22 * sc;
    float LENS  = 1.45 / sc;
    float RINGB = 3.05 * sc;  // photon-ring impact parameter
    float RINGW = 0.32 * sc;

    vec3 ro = uCameraPos - uCenter;
    vec3 rd0 = normalize(vWorldPos - uCameraPos);
    vec3 rd = rd0;

    // Enter the influence sphere; skip the empty space in front of it.
    float b = dot(ro, rd);
    float c = dot(ro, ro) - RINF * RINF;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    vec3 posv = ro + rd * max(-b - sqrt(disc), 0.0);

    // Straight-line impact parameter: continuous across the screen, so a photon
    // ring keyed to it never bands with the step size.
    float bImpact = length(ro - dot(ro, rd0) * rd0);

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    float captured = 0.0;
    vec3 prev = posv;

    for (int i = 0; i < 220; i++){
      if (i >= uSteps) break;
      float r = length(posv);
      if (r < RS){ captured = 1.0; break; }
      if (r > RINF + STEP) break;

      vec3 toC = -posv / r;
      rd = normalize(rd + toC * (RS * RS) / (r * r) * STEP * LENS);
      prev = posv;
      posv += rd * STEP;

      // Accretion disk in a plane tilted by uDiskTilt about the local X axis, so
      // a distant hole can present a fuller 3/4 disk instead of a thin edge.
      float ct = cos(uDiskTilt);
      float st = sin(uDiskTilt);
      vec3 tPrev = tiltX(prev, ct, st);
      vec3 tPos = tiltX(posv, ct, st);
      if (tPrev.y * tPos.y < 0.0 && alpha < 0.99){
        float t = -tPrev.y / (tPos.y - tPrev.y);
        vec3 hit = mix(tPrev, tPos, t);
        float hr = length(hit.xz);
        if (hr > DIN && hr < DOUT){
          float ang = atan(hit.z, hit.x);
          float nR = (hr - DIN) / (DOUT - DIN);
          float temp = pow(1.0 - nR, 1.25);
          vec3 dcol = blackbody(1.0 - temp);

          // Keplerian swirl + turbulence (scale-normalized so texture is stable).
          float phase = uTime * -1.1 / pow(hr / sc, 1.5);
          float swirl = fbm(vec2(ang * 2.2 + phase * 6.2831, (hr / sc) * 0.7 + phase));
          float tex = 0.45 + 0.7 * swirl;

          // Relativistic Doppler beaming on the tangential orbital velocity.
          vec3 vel = normalize(vec3(-sin(ang), 0.0, cos(ang)));
          float beta = 0.42 * inversesqrt(hr / DIN);
          float dopp = pow(1.0 / (1.0 - beta * dot(vel, tiltX(rd, ct, st))), 3.0);

          float edge = smoothstep(0.0, 0.10, nR) * smoothstep(1.0, 0.72, nR);
          float bright = tex * edge * clamp(dopp, 0.25, 4.5);
          bright *= 1.7 + uArousal * 0.9;

          float rem = 1.0 - alpha;
          col += dcol * bright * rem;
          alpha += rem * clamp(bright, 0.0, 1.0) * edge;
        }
      }
    }

    float ring = exp(-pow((bImpact - RINGB) / RINGW, 2.0));
    col += vec3(1.0, 0.96, 0.88) * ring * (1.3 + uArousal * 0.7);
    alpha = max(alpha, ring);

    float outA = captured > 0.5 ? 1.0 : clamp(alpha, 0.0, 1.0);
    if (outA <= 0.003) discard;
    gl_FragColor = vec4(pow(col, vec3(1.0 / 1.5)), outA);
  }
`;

/** Ember tint per genre: the genre color dimmed toward a warm ember glow. */
function emberColor(genre: string): string {
  const base = new Color(GENRE_FIREWORK_COLORS[genre] ?? '#ffb37a');
  return `#${base.lerp(new Color('#ff8a4a'), 0.35).multiplyScalar(0.85).getHexString()}`;
}

interface ArchivedEmberRingProps {
  archivedWorks: readonly ArchivedStar[];
  reducedMotion: boolean;
  onOpenArchive(): void;
}

/**
 * Every archived work is visible as a dim genre-tinted ember circling the
 * accretion disk — the black hole holds your discarded works rather than
 * deleting them. Hovering names the work; clicking opens the archive.
 */
function ArchivedEmberRing({
  archivedWorks,
  reducedMotion,
  onOpenArchive,
}: ArchivedEmberRingProps) {
  const ringRef = useRef<Group>(null);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const [hoveredWorkId, setHoveredWorkId] = useState<string | null>(null);
  const embers = useMemo(
    () => archivedWorks.map((work) => ({
      work,
      orbit: getArchivedEmberOrbit(work.id),
      color: emberColor(work.genre),
    })),
    [archivedWorks],
  );

  useFrame(() => {
    const ring = ringRef.current;
    if (ring === null) return;
    embers.forEach((ember, index) => {
      const child = ring.children[index];
      if (child === undefined) return;
      const angle = ember.orbit.phaseRadians
        + (reducedMotion ? 0 : elapsedVisibleSeconds.current * ember.orbit.angularSpeedRadiansPerSecond);
      child.position.set(
        Math.cos(angle) * ember.orbit.radius,
        Math.sin(angle) * ember.orbit.radius * 0.36,
        0.2,
      );
    });
  });

  const hovered = embers.find(({ work }) => work.id === hoveredWorkId);

  return (
    <group name="blackhole-embers" ref={ringRef}>
      {embers.map((ember) => (
        <sprite
          key={ember.work.id}
          name="blackhole-ember"
          scale={[ember.orbit.size, ember.orbit.size, 1]}
          onClick={(event) => {
            event.stopPropagation();
            onOpenArchive();
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            setHoveredWorkId((current) =>
              current === ember.work.id ? null : current);
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHoveredWorkId(ember.work.id);
          }}
          userData={{ archiveObjectType: 'blackhole-ember', workId: ember.work.id }}
        >
          <spriteMaterial
            blending={AdditiveBlending}
            color={ember.color}
            depthWrite={false}
            map={getStarHaloTexture()}
            opacity={0.85}
            transparent
            toneMapped={false}
          />
        </sprite>
      ))}
      {hovered !== undefined && (
        <Html
          center
          position={[0, EMBER_ORBIT_MAX_RADIUS * 0.55 + 1.6, 0.4]}
          style={{ pointerEvents: 'none' }}
          wrapperClass="star-title-label-anchor"
        >
          <span className="star-title-label" role="tooltip">
            {hovered.work.title}
          </span>
        </Html>
      )}
    </group>
  );
}

export interface BlackholeRendererProps {
  activeDragPayload?: StarDragPayload | null;
  archivedWorks?: readonly ArchivedStar[];
  reducedMotion?: boolean;
  qualityLevel?: QualityLevel;
  onDropStar(payload: StarDragPayload): void;
  onOpenArchive(): void;
}

export function BlackholeRenderer({
  activeDragPayload = null,
  archivedWorks = [],
  reducedMotion = false,
  qualityLevel = 'full',
  onDropStar,
  onOpenArchive,
}: BlackholeRendererProps) {
  const billboardRef = useRef<Group>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const arousalRef = useRef(0);
  const didDropRef = useRef(false);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const position = useMemo(
    () => [BLACKHOLE_POSITION.x, BLACKHOLE_POSITION.y, BLACKHOLE_POSITION.z] as const,
    [],
  );
  const raymarchUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uArousal: { value: 0 },
      uCameraPos: { value: new Vector3() },
      uCenter: {
        value: new Vector3(
          BLACKHOLE_POSITION.x,
          BLACKHOLE_POSITION.y,
          BLACKHOLE_POSITION.z,
        ),
      },
      uScale: { value: 1 },
      uSteps: { value: RAYMARCH_STEPS_BY_QUALITY.full },
      uDiskTilt: { value: 0 },
    }),
    [],
  );
  // Everything the hole has swallowed adds visible mass.
  const massScale = getBlackholeMassScale(archivedWorks.length);
  const baseSteps = RAYMARCH_STEPS_BY_QUALITY[qualityLevel];
  // Reduced motion signals a device that wants less GPU work; cap the march.
  const raymarchSteps = reducedMotion ? Math.min(baseSteps, 72) : baseSteps;

  const dragActive = isValidBlackholeDragPayload(activeDragPayload);

  useFrame((state, delta) => {
    // Face the camera so the raymarch quad always covers the hole's footprint.
    const billboard = billboardRef.current;
    if (billboard !== null) {
      billboard.quaternion.copy(state.camera.quaternion);
    }
    // The black hole "wakes up" — brightening and pulsing — when a star is
    // brought close, giving it presence beyond a plain delete target.
    const target = dragActive ? 1 : 0;
    const rate = Math.min(1, delta * 3.5);
    arousalRef.current += (target - arousalRef.current) * rate;
    const breathe = reducedMotion ? 0 : 0.04 * Math.sin(elapsedVisibleSeconds.current * 1.3);
    const arousal = arousalRef.current + breathe + (massScale - 1) * 0.5;
    const scale = (1 + arousalRef.current * 0.08 + breathe * 0.5) * massScale;
    if (billboard !== null) billboard.scale.setScalar(scale);
    const material = materialRef.current;
    if (material !== null) {
      // Freezing time under reduced motion stills the disk turbulence.
      material.uniforms.uTime!.value = reducedMotion ? 0 : elapsedVisibleSeconds.current;
      material.uniforms.uArousal!.value = arousal;
      material.uniforms.uScale!.value = scale;
      material.uniforms.uSteps!.value = raymarchSteps;
      (material.uniforms.uCameraPos!.value as Vector3).copy(state.camera.position);
    }
  });

  const handleDrop = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (
      isValidBlackholeDragPayload(activeDragPayload)
      && isBlackholeDropHit(event.point)
    ) {
      didDropRef.current = true;
      onDropStar(activeDragPayload);
    }
  };
  const handleOpenArchive = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (didDropRef.current) {
      didDropRef.current = false;
      return;
    }
    onOpenArchive();
  };

  return (
    <group
      name="blackhole"
      position={position}
      userData={{
        archiveObjectType: 'blackhole',
        fixedPosition: BLACKHOLE_POSITION,
        dropRadius: BLACKHOLE_DISTORTION_RADIUS,
        maxDistortion: BLACKHOLE_DISTORTION_MAX_STRENGTH,
      }}
    >
      {/* Axis-aligned, invisible interaction disc. Kept separate from the
          billboard so world-space drop hit-testing stays stable while orbiting. */}
      <mesh
        name="blackhole-core"
        onClick={handleOpenArchive}
        onPointerUp={handleDrop}
      >
        <circleGeometry args={[BLACKHOLE_DISTORTION_RADIUS, 48]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
      </mesh>
      <group ref={billboardRef}>
        {/* The raymarched hole: shadow, photon ring and lensed accretion disk
            all resolved per-fragment on this camera-facing quad, transparent
            everywhere else so it composites into the star sky. */}
        <mesh
          name="blackhole-accretion-disk"
          renderOrder={2}
          onClick={handleOpenArchive}
          onPointerUp={handleDrop}
        >
          <planeGeometry args={[BLACKHOLE_RAYMARCH_HALF * 2, BLACKHOLE_RAYMARCH_HALF * 2]} />
          <shaderMaterial
            depthWrite={false}
            fragmentShader={BLACKHOLE_RAYMARCH_FRAGMENT_SHADER}
            ref={materialRef}
            side={DoubleSide}
            transparent
            toneMapped={false}
            uniforms={raymarchUniforms}
            vertexShader={BLACKHOLE_VERTEX_SHADER}
          />
        </mesh>
        <ArchivedEmberRing
          archivedWorks={archivedWorks}
          onOpenArchive={onOpenArchive}
          reducedMotion={reducedMotion}
        />
      </group>
    </group>
  );
}
