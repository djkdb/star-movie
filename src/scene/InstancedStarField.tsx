import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Object3D,
} from 'three';

import type { Genre, Star } from '../domain/models';
import { useThreeResourceTracking } from './threeResourceRegistry';
import { useVisibleElapsedSeconds } from './VisibilityClock';
import {
  createStarDragPayload,
  getRatingVisual,
  STAR_LABEL_FADE_SECONDS,
  type StarDragPayload,
} from './starVisualModel';
import {
  createInstancedStarBuckets,
  getStarInstancePhase,
  resolveStarIdFromInstance,
  sampleStarInstanceTransform,
  updateInstancedStarColors,
  updateInstancedStarMatrices,
  type InstancedStarBucket,
} from './starRendererModel';
import { resolveGenreOpacity } from './genreSpotlight';

export interface InstancedStarFieldProps {
  stars: readonly Star[];
  selectedStarId: string | null;
  selectedGenres: ReadonlySet<Genre>;
  reducedMotion: boolean;
  onSelect: (starId: string) => void;
  onDragStart?: (payload: StarDragPayload) => void;
  onDragEnd?: (payload: StarDragPayload) => void;
}

interface RatingInstancedMeshProps {
  bucket: InstancedStarBucket;
  hoveredStarId: string | null;
  selectedStarId: string | null;
  selectedGenres: ReadonlySet<Genre>;
  reducedMotion: boolean;
  onHoverChange: (starId: string | null) => void;
  onSelect: (starId: string) => void;
  onDragStart?: (payload: StarDragPayload) => void;
  onDragEnd?: (payload: StarDragPayload) => void;
}

function RatingInstancedMesh({
  bucket,
  hoveredStarId,
  selectedStarId,
  selectedGenres,
  reducedMotion,
  onHoverChange,
  onSelect,
  onDragStart,
  onDragEnd,
}: RatingInstancedMeshProps) {
  const meshRef = useRef<InstancedMesh | null>(null);
  const trackMeshResources = useThreeResourceTracking<InstancedMesh>();
  const activeDragStarId = useRef<string | null>(null);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const temporaryObject = useMemo(() => new Object3D(), []);
  const visual = getRatingVisual(bucket.rating);
  const scratchColor = useMemo(() => new Color(), []);
  const starsById = useMemo(
    () => new Map(bucket.stars.map((star) => [star.id, star])),
    [bucket.stars],
  );
  const setMeshRef = useCallback((mesh: InstancedMesh | null) => {
    meshRef.current = mesh;
    trackMeshResources(mesh);
  }, [trackMeshResources]);

  const updateMatrices = useCallback((elapsedSeconds: number) => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    updateInstancedStarMatrices(
      mesh,
      bucket,
      elapsedSeconds,
      hoveredStarId,
      temporaryObject,
      reducedMotion,
    );
  }, [bucket, hoveredStarId, reducedMotion, temporaryObject]);

  // Genre spotlight: dim filtered-out stars toward black so only the selected
  // genre still glows. Re-runs whenever the bucket or the selection changes.
  const applyColors = useCallback(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    updateInstancedStarColors(mesh, bucket, scratchColor, (star) =>
      resolveGenreOpacity(star.genre, selectedGenres),
    );
  }, [bucket, scratchColor, selectedGenres]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;

    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    applyColors();
    updateMatrices(elapsedVisibleSeconds.current);
  }, [applyColors, bucket, elapsedVisibleSeconds, updateMatrices]);

  useFrame(() => updateMatrices(elapsedVisibleSeconds.current));

  const stopAndResolve = <TEvent extends Event,>(event: ThreeEvent<TEvent>) => {
    event.stopPropagation();
    return resolveStarIdFromInstance(bucket.instanceIdToStarId, event.instanceId);
  };

  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    const eventStarId = stopAndResolve(event);
    const starId = eventStarId ?? activeDragStarId.current;
    activeDragStarId.current = null;
    if (starId === null) return;
    const star = starsById.get(starId);
    if (star !== undefined) onDragEnd?.(createStarDragPayload(star.id, star.position));
  };

  return (
    <instancedMesh
      args={[undefined, undefined, bucket.stars.length]}
      dispose={null}
      frustumCulled={false}
      name={`stars-instanced-rating-${bucket.rating}`}
      onClick={(event) => {
        const starId = stopAndResolve(event);
        if (starId !== null) onSelect(starId);
      }}
      onPointerCancel={endDrag}
      onPointerDown={(event) => {
        const starId = stopAndResolve(event);
        if (starId === null) return;
        activeDragStarId.current = starId;
        const star = starsById.get(starId);
        if (star !== undefined) onDragStart?.(createStarDragPayload(star.id, star.position));
      }}
      onPointerMove={(event) => {
        const starId = stopAndResolve(event);
        if (starId !== null) onHoverChange(starId);
      }}
      onPointerOut={(event) => {
        const starId = stopAndResolve(event);
        if (starId === null || hoveredStarId === starId) onHoverChange(null);
      }}
      onPointerOver={(event) => {
        const starId = stopAndResolve(event);
        if (starId !== null) onHoverChange(starId);
      }}
      onPointerUp={endDrag}
      ref={setMeshRef}
      userData={{
        archiveObjectType: 'star-field',
        instanceIdToStarId: bucket.instanceIdToStarId,
        rating: bucket.rating,
        selectiveBloomTarget: true,
        selectedStarId,
      }}
    >
      <sphereGeometry args={[visual.radius, 24, 16]} />
      {/* Unlit so each instance shows its identity tint; the selective bloom
          pass supplies the glow, brighter tints blooming harder. */}
      <meshBasicMaterial color="#ffffff" toneMapped={false} vertexColors />
    </instancedMesh>
  );
}

/** Rating-bucket renderer used when at least 51 active works are visible. */
export function InstancedStarField({
  stars,
  selectedStarId,
  selectedGenres,
  reducedMotion,
  onSelect,
  onDragStart,
  onDragEnd,
}: InstancedStarFieldProps) {
  const buckets = useMemo(() => createInstancedStarBuckets(stars), [stars]);
  const starsById = useMemo(() => new Map(stars.map((star) => [star.id, star])), [stars]);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const labelGroupRef = useRef<Group>(null);
  const [hoveredStarId, setHoveredStarId] = useState<string | null>(null);
  const [labelStarId, setLabelStarId] = useState<string | null>(null);

  const handleHoverChange = useCallback((starId: string | null) => {
    setHoveredStarId(starId);
    if (starId !== null) setLabelStarId(starId);
  }, []);

  useEffect(() => {
    if (hoveredStarId !== null && !starsById.has(hoveredStarId)) {
      setHoveredStarId(null);
    }
    if (labelStarId !== null && !starsById.has(labelStarId)) {
      setLabelStarId(null);
    }
  }, [hoveredStarId, labelStarId, starsById]);

  const labelStar = labelStarId === null ? undefined : starsById.get(labelStarId);
  useFrame(() => {
    const group = labelGroupRef.current;
    if (group === null || labelStar === undefined) return;
    const transform = sampleStarInstanceTransform(
      labelStar,
      elapsedVisibleSeconds.current,
      getStarInstancePhase(labelStar.id),
      hoveredStarId === labelStar.id,
      reducedMotion,
    );
    const visual = getRatingVisual(labelStar.rating);
    group.position.set(
      transform.position.x,
      transform.position.y + visual.radius * transform.scale + 0.65,
      transform.position.z,
    );
  });

  const labelVisible = labelStar !== undefined && hoveredStarId === labelStar.id;

  return (
    <group
      name="stars-instanced"
      userData={{ renderMode: 'instanced', selectedStarId }}
    >
      {buckets.map((bucket) => (
        <RatingInstancedMesh
          bucket={bucket}
          hoveredStarId={hoveredStarId}
          key={`${bucket.rating}:${bucket.stars.length}`}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onHoverChange={handleHoverChange}
          onSelect={onSelect}
          reducedMotion={reducedMotion}
          selectedGenres={selectedGenres}
          selectedStarId={selectedStarId}
        />
      ))}
      <group ref={labelGroupRef} visible={labelStar !== undefined}>
        <Html
          center
          style={{
            opacity: labelVisible ? 1 : 0,
            pointerEvents: 'none',
            transition: `opacity ${STAR_LABEL_FADE_SECONDS}s ease`,
            visibility: labelVisible ? 'visible' : 'hidden',
            transitionProperty: 'opacity, visibility',
            transitionDuration: `${STAR_LABEL_FADE_SECONDS}s, 0s`,
            transitionDelay: labelVisible
              ? '0s, 0s'
              : `0s, ${STAR_LABEL_FADE_SECONDS}s`,
          }}
          wrapperClass="star-title-label-anchor"
        >
          <span className="star-title-label" role="tooltip">
            {labelStar?.title ?? ''}
          </span>
        </Html>
      </group>
    </group>
  );
}
