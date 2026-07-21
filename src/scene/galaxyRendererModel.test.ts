import { describe, expect, it } from 'vitest';

import { createDefaultPersistedStore } from '../domain/defaultState';
import type { Galaxy } from '../domain/models';
import {
  DEFAULT_GALAXY_INTENSITY,
  SELECTED_GALAXY_INTENSITY,
  UNSELECTED_GALAXY_INTENSITY,
} from './genreFilterViewModel';
import {
  GALAXY_INTENSITY_TWEEN_DURATION_SECONDS,
  buildGenreGalaxyRenderModels,
  classifyGalaxyPrimitive,
  effectiveGalaxyOpacity,
  hashGalaxyId,
  primitiveLinePoints,
  primitivePositions,
  resolveGalaxyIntensityTarget,
  stepGalaxyIntensity,
} from './galaxyRendererModel';

const REWARD_GALAXY: Galaxy = {
  id: '00000000-0000-4000-8000-0000000009ff',
  kind: { type: 'reward', rewardType: 'milestone-100' },
  center: { x: 0, y: 0, z: 0 },
  placementRadius: 20,
  themeId: 'milestone-100-reward',
  primaryColor: '#c4b5fd',
  unlocked: true,
};

describe('classifyGalaxyPrimitive', () => {
  it('maps path shapes (including prism faces) to lines and clouds to points', () => {
    expect(classifyGalaxyPrimitive('spiral-arm')).toBe('line');
    expect(classifyGalaxyPrimitive('asymmetric-band')).toBe('line');
    expect(classifyGalaxyPrimitive('ellipse')).toBe('line');
    expect(classifyGalaxyPrimitive('ring')).toBe('line');
    expect(classifyGalaxyPrimitive('radial-ray')).toBe('line');
    expect(classifyGalaxyPrimitive('prism-face')).toBe('line');
    expect(classifyGalaxyPrimitive('core-nebula')).toBe('points');
    expect(classifyGalaxyPrimitive('irregular-cluster')).toBe('points');
    expect(classifyGalaxyPrimitive('particles')).toBe('points');
  });
});

describe('hashGalaxyId', () => {
  it('is deterministic and an unsigned 32-bit integer', () => {
    const first = hashGalaxyId('00000000-0000-4000-8000-000000000101');
    const second = hashGalaxyId('00000000-0000-4000-8000-000000000101');
    expect(first).toBe(second);
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(0xffffffff);
  });

  it('distinguishes distinct ids', () => {
    expect(hashGalaxyId('a')).not.toBe(hashGalaxyId('b'));
  });
});

describe('resolveGalaxyIntensityTarget', () => {
  it('rests every galaxy when nothing is selected', () => {
    expect(resolveGalaxyIntensityTarget('SF', new Set())).toBe(DEFAULT_GALAXY_INTENSITY);
  });

  it('ignites the selected genre and dims the rest', () => {
    const selected = new Set(['SF'] as const);
    expect(resolveGalaxyIntensityTarget('SF', selected)).toBe(SELECTED_GALAXY_INTENSITY);
    expect(resolveGalaxyIntensityTarget('로맨스', selected)).toBe(UNSELECTED_GALAXY_INTENSITY);
  });
});

describe('stepGalaxyIntensity', () => {
  it('snaps once the remaining distance fits inside a single step', () => {
    expect(stepGalaxyIntensity(1.49, 1.5, 1)).toBe(1.5);
  });

  it('advances toward the target without overshooting', () => {
    const next = stepGalaxyIntensity(0.25, 1.5, GALAXY_INTENSITY_TWEEN_DURATION_SECONDS / 10);
    expect(next).toBeGreaterThan(0.25);
    expect(next).toBeLessThan(1.5);
  });

  it('reaches the target within roughly one tween duration', () => {
    const next = stepGalaxyIntensity(0.25, 1.5, GALAXY_INTENSITY_TWEEN_DURATION_SECONDS);
    expect(next).toBe(1.5);
  });
});

describe('effectiveGalaxyOpacity', () => {
  it('scales by intensity and clamps to the visible range', () => {
    expect(effectiveGalaxyOpacity(0.6, 1)).toBeCloseTo(0.6);
    expect(effectiveGalaxyOpacity(0.8, 1.5)).toBe(1);
    expect(effectiveGalaxyOpacity(0.6, 0.25)).toBeCloseTo(0.15);
    expect(effectiveGalaxyOpacity(0.6, -5)).toBe(0);
  });
});

describe('buildGenreGalaxyRenderModels', () => {
  it('builds one render model per unlocked genre galaxy from default state', () => {
    const { galaxies } = createDefaultPersistedStore();
    const models = buildGenreGalaxyRenderModels(galaxies);
    expect(models).toHaveLength(8);
    for (const model of models) {
      expect(model.primitives.length).toBeGreaterThan(0);
      expect(model.fallbackUsed).toBe(false);
    }
  });

  it('excludes reward galaxies and locked galaxies', () => {
    const { galaxies } = createDefaultPersistedStore();
    const locked = { ...galaxies[0]!, unlocked: false };
    const models = buildGenreGalaxyRenderModels([locked, REWARD_GALAXY, ...galaxies.slice(1)]);
    expect(models).toHaveLength(7);
    expect(models.some((model) => model.id === REWARD_GALAXY.id)).toBe(false);
    expect(models.some((model) => model.id === locked.id)).toBe(false);
  });
});

describe('primitive geometry helpers', () => {
  it('closes looped line primitives and leaves open ones untouched', () => {
    const closed = primitiveLinePoints({
      kind: 'ring',
      color: '#fff',
      opacity: 0.7,
      closed: true,
      vertices: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: -1, y: 0, z: 0 },
      ],
    });
    expect(closed).toHaveLength(4);
    expect(closed[0]).toEqual(closed[closed.length - 1]);

    const open = primitiveLinePoints({
      kind: 'spiral-arm',
      color: '#fff',
      opacity: 0.7,
      closed: false,
      vertices: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
    });
    expect(open).toHaveLength(2);
  });

  it('flattens vertices into an xyz Float32Array', () => {
    const positions = primitivePositions({
      kind: 'particles',
      color: '#fff',
      opacity: 0.7,
      closed: false,
      vertices: [
        { x: 1, y: 2, z: 3 },
        { x: 4, y: 5, z: 6 },
      ],
    });
    expect(Array.from(positions)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
