import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { AdditiveBlending, BackSide, DoubleSide, type Group } from 'three';

import type { OwnedPlanet } from '../domain/models';
import { RARITY_COLORS, RARITY_LABELS, type PlanetSpecies } from '../domain/planetCatalog';
import { getPlanetSurfaceTexture } from './planetSurfaceTextures';
import {
  planetOrbitPosition,
  resolvePlanetVisual,
  type PlanetOrbit,
} from './planetVisualModel';
import { useVisibleElapsedSeconds } from './VisibilityClock';

interface PlanetBodyProps {
  species: PlanetSpecies;
  size: number;
}

/** The planet mesh itself: geometry + procedural surface, ring, aura, moons. */
function PlanetBody({ species, size }: PlanetBodyProps) {
  const texture = useMemo(() => getPlanetSurfaceTexture(species), [species]);
  const isCrystal = species.geometry === 'crystal';
  const isTwin = species.geometry === 'twin';

  const surface = (radius: number, position?: readonly [number, number, number]) => (
    <mesh position={position === undefined ? undefined : [...position]}>
      {isCrystal ? (
        <icosahedronGeometry args={[radius, 0]} />
      ) : (
        <sphereGeometry args={[radius, 32, 24]} />
      )}
      <meshStandardMaterial
        map={texture}
        emissive={species.emissiveColor}
        emissiveIntensity={species.emissiveIntensity}
        flatShading={isCrystal}
        metalness={isCrystal ? 0.35 : 0.1}
        roughness={isCrystal ? 0.25 : 0.85}
      />
    </mesh>
  );

  const moonCount = species.moons ?? 0;

  return (
    <group>
      {isTwin ? (
        <>
          {surface(size * 0.66, [size * 0.6, 0, 0])}
          {surface(size * 0.5, [-size * 0.7, size * 0.1, 0])}
        </>
      ) : (
        surface(size)
      )}

      {species.atmosphere !== undefined && (
        <mesh scale={[1.18, 1.18, 1.18]}>
          <sphereGeometry args={[size, 24, 18]} />
          <meshBasicMaterial
            color={species.atmosphere}
            transparent
            opacity={0.22}
            side={BackSide}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {species.ring !== undefined && (
        <mesh rotation={[Math.PI / 2.4, 0.35, 0]}>
          <ringGeometry
            args={[size * species.ring.innerScale, size * species.ring.outerScale, 64]}
          />
          <meshBasicMaterial
            color={species.ring.color}
            transparent
            opacity={0.55}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {Array.from({ length: moonCount }, (_, index) => {
        const angle = (index / Math.max(1, moonCount)) * Math.PI * 2;
        const distance = size * (1.7 + index * 0.4);
        return (
          <mesh
            key={`moon-${index}`}
            position={[Math.cos(angle) * distance, Math.sin(angle) * distance * 0.4, 0]}
          >
            <sphereGeometry args={[size * 0.16, 12, 10]} />
            <meshStandardMaterial color="#d8dbe2" emissive="#20242c" emissiveIntensity={0.2} />
          </mesh>
        );
      })}

      {species.emissiveIntensity >= 0.7 && (
        <pointLight color={species.emissiveColor} distance={size * 12} intensity={1.4} />
      )}
    </group>
  );
}

interface PlanetInstanceProps {
  planet: OwnedPlanet;
  species: PlanetSpecies;
  orbit: PlanetOrbit;
  reducedMotion: boolean;
}

function PlanetInstance({ planet, species, orbit, reducedMotion }: PlanetInstanceProps) {
  const orbitRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const [hovered, setHovered] = useState(false);

  useFrame(() => {
    const time = reducedMotion ? 0 : elapsedVisibleSeconds.current;
    const [x, y, z] = planetOrbitPosition(orbit, time);
    orbitRef.current?.position.set(x, y, z);
    if (spinRef.current !== null && !reducedMotion) {
      spinRef.current.rotation.y = time * orbit.spinSpeed;
    }
  });

  return (
    <group
      name={`collected-planet-${species.id}`}
      ref={orbitRef}
      userData={{
        archiveObjectType: 'collected-planet',
        planetId: planet.id,
        speciesId: species.id,
      }}
    >
      <group
        ref={spinRef}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          setHovered(false);
        }}
      >
        <PlanetBody species={species} size={orbit.size} />
      </group>
      {hovered && (
        <Html center position={[0, orbit.size + 1.4, 0]} style={{ pointerEvents: 'none' }}>
          <span className="planet-hover-label" style={{ borderColor: RARITY_COLORS[species.rarity] }}>
            <b>{species.name}</b>
            <em>{RARITY_LABELS[species.rarity]}</em>
          </span>
        </Html>
      )}
    </group>
  );
}

export interface PlanetCollectionRendererProps {
  planets: readonly OwnedPlanet[];
  reducedMotion?: boolean;
}

/** Renders every owned planet drifting on its own inclined orbit in the sky. */
export function PlanetCollectionRenderer({
  planets,
  reducedMotion = false,
}: PlanetCollectionRendererProps) {
  const visuals = useMemo(
    () =>
      planets.flatMap((planet) => {
        const visual = resolvePlanetVisual(planet);
        return visual === null ? [] : [{ planet, ...visual }];
      }),
    [planets],
  );

  if (visuals.length === 0) return null;

  return (
    <group name="collected-planets">
      {/* A soft sun so the belt worlds are modeled instead of flatly lit. */}
      <directionalLight color="#fff4e6" intensity={1.15} position={[40, 26, 30]} />
      {visuals.map(({ planet, species, orbit }) => (
        <PlanetInstance
          key={planet.id}
          orbit={orbit}
          planet={planet}
          reducedMotion={reducedMotion}
          species={species}
        />
      ))}
    </group>
  );
}
