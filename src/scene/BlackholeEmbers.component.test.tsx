import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { ArchivedStar } from '../domain/models';
import { BlackholeRenderer } from './BlackholeRenderer';
import {
  EMBER_ORBIT_MAX_RADIUS,
  EMBER_ORBIT_MIN_RADIUS,
  getBlackholeMassScale,
} from './blackholeModel';
import { VisibilityClock } from './VisibilityClock';

function archivedWork(id: string, title: string): ArchivedStar {
  return {
    id,
    title,
    normalizedTitle: title.toLowerCase(),
    genre: 'SF',
    rating: 4,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
    discardedAt: '2025-02-01T00:00:00.000Z',
  };
}

describe('BlackholeRenderer archive presence', () => {
  it('orbits one genre-tinted ember per archived work and grows with mass', async () => {
    const works = [
      archivedWork('10000000-0000-4000-8000-000000000001', 'Moon'),
      archivedWork('10000000-0000-4000-8000-000000000002', 'Sunshine'),
      archivedWork('10000000-0000-4000-8000-000000000003', 'Coherence'),
    ];
    const renderer = await ReactThreeTestRenderer.create(
      <VisibilityClock>
        <BlackholeRenderer
          archivedWorks={works}
          onDropStar={vi.fn()}
          onOpenArchive={vi.fn()}
        />
      </VisibilityClock>,
    );
    await renderer.advanceFrames(3, 0.2);

    const embers = renderer.scene.findAll(
      (node) => node.props.name === 'blackhole-ember',
    );
    expect(embers).toHaveLength(3);

    for (const ember of embers) {
      const { position } = ember.instance as { position: { x: number; y: number } };
      const planarRadius = Math.hypot(position.x, position.y / 0.36);
      expect(planarRadius).toBeGreaterThanOrEqual(EMBER_ORBIT_MIN_RADIUS - 1e-6);
      expect(planarRadius).toBeLessThanOrEqual(EMBER_ORBIT_MAX_RADIUS + 1e-6);
    }

    // The billboard group carries the archive's mass in its scale.
    const disk = renderer.scene.findByProps({ name: 'blackhole-accretion-disk' });
    const billboard = disk.parent!.instance as { scale: { x: number } };
    expect(billboard.scale.x).toBeGreaterThanOrEqual(
      getBlackholeMassScale(works.length) * 0.9,
    );

    await renderer.unmount();
  });
});
