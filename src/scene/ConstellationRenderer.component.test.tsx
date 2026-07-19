import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it } from 'vitest';
import type { Material } from 'three';

import type { Constellation, ConstellationDraft, Star } from '../domain/models';
import { ConstellationRenderer } from './ConstellationRenderer';
import { VisibilityClock } from './VisibilityClock';

function star(id: string, x: number): Star {
  return {
    id,
    title: `Star ${id}`,
    normalizedTitle: `star ${id}`,
    genre: 'SF',
    rating: 5,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

const IDLE_DRAFT: ConstellationDraft = {
  active: false,
  phase: 'selecting',
  starIds: [],
  error: null,
};

const STARS: Star[] = [
  star('10000000-0000-4000-8000-000000000001', -5),
  star('10000000-0000-4000-8000-000000000002', 5),
];

const CONSTELLATIONS: Constellation[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Orion',
    starIds: STARS.map(({ id }) => id),
    color: '#88ccff',
    createdAt: '2025-01-02T00:00:00.000Z',
  },
];

describe('ConstellationRenderer disposal safety', () => {
  // Regression: a `dispose={null}` prop on the constellation <Line> leaked
  // through drei onto the underlying LineMaterial, nulling its dispose. drei's
  // own unmount cleanup then called `lineMaterial.dispose()` and threw
  // "dispose is not a function", tripping the SceneErrorBoundary whenever a star
  // was added or moved into the black hole while any constellation existed.
  it('keeps constellation line materials disposable and unmounts cleanly', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <VisibilityClock>
        <ConstellationRenderer
          constellations={CONSTELLATIONS}
          draft={IDLE_DRAFT}
          reducedMotion={false}
          stars={STARS}
        />
      </VisibilityClock>,
    );
    await renderer.advanceFrames(2, 0.2);

    // drei's <Line> spreads leftover props (the leaked `dispose={null}`) onto
    // the underlying LineMaterial primitive, so the material instance itself is
    // where a nulled dispose would surface.
    const lineMaterials = renderer.scene
      .findAll(
        (node) =>
          node.props.userData?.archiveObjectType === 'active-constellation-line',
      )
      .map((node) => node.instance as unknown as Material)
      .filter((instance): instance is Material => instance?.isMaterial === true);
    expect(lineMaterials.length).toBeGreaterThan(0);

    for (const material of lineMaterials) {
      expect(typeof material.dispose).toBe('function');
    }

    // The crash surfaced during unmount cleanup; it must complete without throwing.
    await renderer.unmount();
  });
});
