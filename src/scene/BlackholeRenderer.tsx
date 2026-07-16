import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  type Group,
  type ShaderMaterial,
} from 'three';

import type { ArchivedStar } from '../domain/models';
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

/** Half-size of the billboarded quad; the event horizon sits at 0.30 of this. */
const BLACKHOLE_PLANE_HALF = 10;

/**
 * A camera-facing "Gargantua" shader: pure-black event horizon, a hot photon
 * ring hugging its edge, a lensed halo that reads as the accretion disk wrapping
 * over and under the shadow, and an equatorial fan that streams outward with
 * Doppler-beamed brightness and slowly churning turbulence. The billboard keeps
 * the photographic front-on read no matter where the camera orbits.
 */
const GARGANTUA_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GARGANTUA_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uArousal;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float ang = atan(p.y, p.x);

    float horizon = 0.30;
    float ringR = 0.355;

    // Inside the event horizon: pure black, fully opaque so it occludes.
    if (r < horizon) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Hot photon ring hugging the shadow.
    float ring = exp(-pow((r - ringR) / 0.028, 2.0));
    // Lensed halo: the disk appears to wrap over and under the shadow.
    float halo = exp(-pow((r - ringR - 0.02) / 0.09, 2.0));
    // Equatorial fan streaming outward on both sides, thin near the ring and
    // widening as it goes.
    float widen = 0.055 + 0.19 * max(0.0, abs(p.x) - ringR);
    float equator = exp(-pow(p.y / widen, 2.0));
    float radialFade = smoothstep(1.55, ringR, r);
    float fan = equator * radialFade * step(ringR - 0.03, r);

    // Slowly churning turbulence for the wispy accretion texture.
    float swirl = fbm(vec2(ang * 1.7 + r * 4.0 - uTime * 0.22, r * 3.0 + uTime * 0.1));
    float texture = 0.62 + 0.38 * swirl;

    // Mild relativistic Doppler beaming: the approaching (right) side reads a
    // touch brighter, but both sides of the disk stay clearly visible.
    float doppler = 1.0 + 0.28 * (p.x / max(r, 0.001));

    float brightness = (ring * 1.7 + halo * 0.85 + fan * 1.5 * texture) * doppler;
    brightness *= 1.0 + uArousal * 0.9;

    // Temperature gradient: white-hot at the ring, amber then deep-red outward.
    vec3 hot = vec3(1.0, 0.98, 0.92);
    vec3 warm = vec3(1.0, 0.63, 0.26);
    vec3 deep = vec3(0.72, 0.26, 0.11);
    float t = clamp((r - ringR) / 0.85, 0.0, 1.0);
    vec3 col = mix(hot, warm, smoothstep(0.0, 0.5, t));
    col = mix(col, deep, smoothstep(0.5, 1.0, t));
    // A faint cool tint on the receding side sells the Doppler shift.
    col = mix(col, vec3(0.55, 0.62, 0.95), clamp(-p.x / max(r, 0.001), 0.0, 1.0) * 0.18);

    vec3 outColor = col * brightness;
    float alpha = clamp(brightness, 0.0, 1.0);
    alpha *= smoothstep(1.0, 0.8, r);

    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(outColor, alpha);
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
  onDropStar(payload: StarDragPayload): void;
  onOpenArchive(): void;
}

export function BlackholeRenderer({
  activeDragPayload = null,
  archivedWorks = [],
  reducedMotion = false,
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
  // Everything the hole has swallowed adds visible mass.
  const massScale = getBlackholeMassScale(archivedWorks.length);

  const dragActive = isValidBlackholeDragPayload(activeDragPayload);

  useFrame((state, delta) => {
    // Face the camera so the disk keeps its photographic front-on silhouette.
    const billboard = billboardRef.current;
    if (billboard !== null) {
      billboard.quaternion.copy(state.camera.quaternion);
    }
    // The black hole "wakes up" — brightening and pulsing — when a star is
    // brought close, giving it presence beyond a plain delete target.
    const target = dragActive ? 1 : 0;
    const rate = Math.min(1, delta * 3.5);
    arousalRef.current += (target - arousalRef.current) * rate;
    const breathe = 0.04 * Math.sin(elapsedVisibleSeconds.current * 1.3);
    if (materialRef.current !== null) {
      materialRef.current.uniforms.uTime!.value = elapsedVisibleSeconds.current;
      materialRef.current.uniforms.uArousal!.value =
        arousalRef.current + breathe + (massScale - 1) * 0.5;
    }
    if (billboard !== null) {
      const scale = (1 + arousalRef.current * 0.08 + breathe * 0.5) * massScale;
      billboard.scale.setScalar(scale);
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
        <mesh
          name="blackhole-accretion-disk"
          renderOrder={2}
          onClick={handleOpenArchive}
          onPointerUp={handleDrop}
        >
          <planeGeometry args={[BLACKHOLE_PLANE_HALF * 2, BLACKHOLE_PLANE_HALF * 2]} />
          <shaderMaterial
            depthWrite={false}
            fragmentShader={GARGANTUA_FRAGMENT_SHADER}
            ref={materialRef}
            side={DoubleSide}
            transparent
            toneMapped={false}
            uniforms={{
              uTime: { value: 0 },
              uArousal: { value: 0 },
            }}
            vertexShader={GARGANTUA_VERTEX_SHADER}
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
