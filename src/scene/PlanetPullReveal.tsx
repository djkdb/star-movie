import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type Mesh,
  type Points,
  type ShaderMaterial,
} from 'three';

import type { PlanetRarity } from '../domain/models';
import {
  RARITY_COLORS,
  RARITY_LABELS,
  type PlanetSpecies,
} from '../domain/planetCatalog';
import { getPlanetSurfaceTexture } from './planetSurfaceTextures';
import { getStarHaloTexture } from './starSpriteTextures';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { flashEnvelope, getPullRevealParams } from './pullRevealModel';

const NO_RAYCAST = () => null;

const RAYS_FRAGMENT = `
  precision highp float;
  uniform float uTime;
  uniform float uCount;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float ang = atan(p.y, p.x);
    float r = length(p);
    float ray = pow(abs(sin(ang * uCount * 0.5 + uTime * 0.4)), 14.0);
    float radial = smoothstep(1.25, 0.12, r) * smoothstep(0.04, 0.3, r);
    float a = ray * radial * uOpacity;
    gl_FragColor = vec4(uColor * (0.6 + a * 2.2), a);
  }
`;

const RAYS_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

interface RevealVisualProps {
  species: PlanetSpecies;
  rarity: PlanetRarity;
  reducedMotion: boolean;
}

function RevealVisual({ species, rarity, reducedMotion }: RevealVisualProps) {
  const params = useMemo(() => getPullRevealParams(rarity), [rarity]);
  const elapsedRef = useRef(0);
  const planetGroupRef = useRef<Group>(null);
  const planetSpinRef = useRef<Mesh>(null);
  const flashRef = useRef<Mesh>(null);
  const raysRef = useRef<Mesh>(null);
  const shockRef = useRef<Mesh>(null);
  const particlesRef = useRef<Points>(null);

  const texture = useMemo(() => getPlanetSurfaceTexture(species), [species]);
  const halo = useMemo(() => getStarHaloTexture(), []);
  const rarityColor = RARITY_COLORS[rarity];

  // Particle burst geometry: unit directions scaled outward over time.
  const particleGeometry = useMemo(() => {
    const count = params.particleCount;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    let state = 0x9e3779b9;
    const rand = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    };
    for (let i = 0; i < count; i += 1) {
      const cosPhi = 2 * rand() - 1;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const theta = 2 * Math.PI * rand();
      const speed = 0.6 + rand() * 0.8;
      positions[i * 3] = sinPhi * Math.cos(theta) * speed;
      positions[i * 3 + 1] = cosPhi * speed;
      positions[i * 3 + 2] = sinPhi * Math.sin(theta) * speed;
      seeds[i] = rand();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
    return geometry;
  }, [params.particleCount]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const progress = reducedMotion
      ? 1
      : Math.min(1.4, elapsedRef.current / params.durationSeconds);
    const p = Math.min(1, progress);

    // Planet emerges after the climax, easing to full size, then gently spins.
    const emerge = Math.max(
      0,
      Math.min(1, (p - params.emergeFraction) / (1 - params.emergeFraction)),
    );
    const scale = reducedMotion ? 1 : 1 - Math.pow(1 - emerge, 3);
    if (planetGroupRef.current !== null) {
      planetGroupRef.current.scale.setScalar(Math.max(0.001, scale) * 1.7);
    }
    if (planetSpinRef.current !== null) {
      planetSpinRef.current.rotation.y = elapsedRef.current * 0.5;
    }

    // Flash: white spike near the emerge point.
    const flash = flashEnvelope(params, p);
    if (flashRef.current !== null) {
      const material = flashRef.current.material as { opacity: number };
      material.opacity = flash;
    }

    // Rays fade in as the planet emerges and hold.
    if (raysRef.current !== null) {
      const material = raysRef.current.material as ShaderMaterial;
      material.uniforms.uTime!.value = elapsedRef.current;
      material.uniforms.uOpacity!.value =
        params.rayCount === 0 ? 0 : 0.7 * Math.min(1, emerge * 1.6);
      raysRef.current.rotation.z = elapsedRef.current * 0.08;
    }

    // Shockwave: a single expanding ring around the climax.
    if (shockRef.current !== null) {
      const t = Math.max(0, Math.min(1, (p - (params.emergeFraction - 0.18)) / 0.5));
      const ringScale = 0.2 + t * 9;
      shockRef.current.scale.setScalar(ringScale);
      const material = shockRef.current.material as { opacity: number };
      material.opacity = params.shockwave ? (1 - t) * 0.7 : 0;
    }

    // Particle burst expands outward and fades.
    if (particlesRef.current !== null) {
      const burst = Math.min(1, p / Math.max(0.001, params.emergeFraction));
      const spread = 0.4 + burst * 6;
      particlesRef.current.scale.setScalar(spread);
      const material = particlesRef.current.material as { opacity: number };
      material.opacity = (1 - burst) * 0.9;
    }
  });

  return (
    <group>
      <ambientLight intensity={0.6} />
      <directionalLight color="#fff4e6" intensity={1.4} position={[6, 5, 8]} />

      {/* Full-screen flash quad near the camera. */}
      <mesh position={[0, 0, 6]} raycast={NO_RAYCAST} ref={flashRef}>
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* Radial light rays behind the planet. */}
      <mesh position={[0, 0, -1.5]} raycast={NO_RAYCAST} ref={raysRef}>
        <planeGeometry args={[16, 16]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          fragmentShader={RAYS_FRAGMENT}
          vertexShader={RAYS_VERTEX}
          uniforms={{
            uTime: { value: 0 },
            uCount: { value: Math.max(1, params.rayCount) },
            uColor: { value: new Color(rarityColor) },
            uOpacity: { value: 0 },
          }}
        />
      </mesh>

      {/* Expanding shockwave ring. */}
      <mesh raycast={NO_RAYCAST} ref={shockRef} rotation={[0, 0, 0]}>
        <ringGeometry args={[0.62, 0.72, 96]} />
        <meshBasicMaterial
          color={rarityColor}
          transparent
          opacity={0}
          side={DoubleSide}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* Particle burst. */}
      <points frustumCulled={false} geometry={particleGeometry} raycast={NO_RAYCAST} ref={particlesRef}>
        <pointsMaterial
          map={halo}
          color={rarityColor}
          size={0.35}
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
          sizeAttenuation
          toneMapped={false}
        />
      </points>

      {/* The revealed planet. */}
      <group ref={planetGroupRef} scale={0.001}>
        <mesh ref={planetSpinRef}>
          <sphereGeometry args={[1, 48, 32]} />
          <meshStandardMaterial
            map={texture}
            emissive={species.emissiveColor}
            emissiveIntensity={Math.max(0.35, species.emissiveIntensity)}
            metalness={0.12}
            roughness={0.8}
          />
        </mesh>
        {species.ring !== undefined && (
          <mesh raycast={NO_RAYCAST} rotation={[Math.PI / 2.3, 0.3, 0]}>
            <ringGeometry args={[species.ring.innerScale, species.ring.outerScale, 80]} />
            <meshBasicMaterial
              color={species.ring.color}
              transparent
              opacity={0.6}
              side={DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        )}
        {species.atmosphere !== undefined && (
          <mesh raycast={NO_RAYCAST} scale={[1.2, 1.2, 1.2]}>
            <sphereGeometry args={[1, 32, 22]} />
            <meshBasicMaterial
              color={species.atmosphere}
              transparent
              opacity={0.25}
              side={BackSide}
              blending={AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

export interface PlanetPullRevealProps {
  species: PlanetSpecies;
  rarity: PlanetRarity;
  isNewSpecies: boolean;
  onDismiss: () => void;
}

/**
 * A full-screen, rarity-scaled reveal that plays when a planet is pulled: a
 * flash, radial rays, a shockwave, and a particle burst out of which the planet
 * emerges. Runs in its own transparent Canvas (no post-processing), so it never
 * touches the main scene's renderer.
 */
export function PlanetPullReveal({
  species,
  rarity,
  isNewSpecies,
  onDismiss,
}: PlanetPullRevealProps) {
  const reducedMotion = usePrefersReducedMotion();
  if (typeof document === 'undefined') return null;

  // Portalled to <body>: the dock panel that owns this component is transformed,
  // which would otherwise trap position:fixed inside the panel instead of the
  // viewport.
  return createPortal(
    <div
      className={`pull-reveal-overlay rarity-${rarity}`}
      onClick={onDismiss}
      role="dialog"
      aria-label={`${species.name} 획득`}
    >
      <div className="pull-reveal-canvas">
        <Canvas
          camera={{ position: [0, 0, 9], fov: 45 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
        >
          <RevealVisual reducedMotion={reducedMotion} rarity={rarity} species={species} />
        </Canvas>
      </div>

      <div className="pull-reveal-caption">
        <span className="rarity-chip" style={{ color: RARITY_COLORS[rarity] }}>
          {RARITY_LABELS[rarity]}
        </span>
        <strong>{species.name}</strong>
        <p>{species.flavor}</p>
        {isNewSpecies && <span className="new-badge pull-reveal-new">NEW</span>}
        <button className="primary-action" onClick={onDismiss} type="button">
          확인
        </button>
      </div>
    </div>,
    document.body,
  );
}
