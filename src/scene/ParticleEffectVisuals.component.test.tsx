import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Group, Points, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import { FireworksVisual, MeteorVisual } from './ParticleManager';
import {
  EffectLifecycleRegistry,
  fireworkSparksPerBurst,
  ParticleEffectController,
  type ParticleEffectDescriptor,
  type ParticleTimer,
} from './particleManagerModel';

const idleTimer: ParticleTimer = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
};

function createController(): ParticleEffectController {
  return new ParticleEffectController(
    idleTimer,
    new EffectLifecycleRegistry(idleTimer),
    () => 0.5,
  );
}

function descriptor(
  overrides: Partial<ParticleEffectDescriptor>,
): ParticleEffectDescriptor {
  return {
    id: 'visual-test',
    sourceEventId: 'visual-test',
    kind: 'fireworks',
    origin: { x: 1, y: 2, z: 3 },
    particleCount: 0,
    trailCount: 0,
    durationSeconds: 1.5,
    rotations: 0,
    seed: 42,
    scaleFrom: 1,
    scaleTo: 1,
    ...overrides,
  };
}

describe('MeteorVisual', () => {
  it('renders one moving, glowing streak per trail with a head sprite', async () => {
    const controller = createController();
    const effect = descriptor({ kind: 'meteor-shower', trailCount: 3 });
    controller.start(effect);

    const renderer = await ReactThreeTestRenderer.create(
      <MeteorVisual controller={controller} effect={effect} />,
    );
    await renderer.advanceFrames(4, 0.15); // 0.6s of a 1.5s flight

    const root = renderer.scene.findByProps({ name: 'particle-effect-meteor-shower' });
    const streakGroups = root.children.filter(
      (child) => (child.instance as { type?: string }).type === 'Group',
    );
    expect(streakGroups).toHaveLength(3);

    const trails = renderer.scene.findAll(
      (node) => node.props.name === 'meteor-trail',
    );
    const heads = renderer.scene.findAll(
      (node) => node.props.name === 'meteor-head',
    );
    expect(trails).toHaveLength(3);
    expect(heads).toHaveLength(3);

    // The lead streak has ignited and travels down-right from its origin.
    const lead = streakGroups[0]!.instance as Group;
    expect(lead.position.x).toBeGreaterThan(effect.origin.x + 10);
    expect(lead.position.y).toBeLessThan(effect.origin.y);

    const leadMaterial = (trails[0]!.instance as unknown as { material: ShaderMaterial })
      .material;
    expect(leadMaterial.uniforms.uFade!.value).toBeGreaterThan(0.5);
    expect(leadMaterial.uniforms.uTime!.value).toBeCloseTo(0.6);

    await renderer.unmount();
  });
});

describe('FireworksVisual', () => {
  it('builds one spark cloud per burst shell and animates its clock', async () => {
    const controller = createController();
    const effect = descriptor({
      kind: 'fireworks',
      particleCount: 40,
      burstCount: 3,
      color: '#3B82F6',
      durationSeconds: 2.4,
    });
    controller.start(effect);

    const renderer = await ReactThreeTestRenderer.create(
      <FireworksVisual controller={controller} effect={effect} />,
    );
    await renderer.advanceFrames(3, 0.2);

    const points = renderer.scene.findByProps({ name: 'particle-effect-fireworks' })
      .instance as Points;
    const geometry = points.geometry;
    // Sparks per shell taper with shell count to bound additive overdraw.
    expect(geometry.getAttribute('position').count)
      .toBe(fireworkSparksPerBurst(40, 3) * 3);
    for (const attribute of ['aDir', 'aSpeed', 'aSize', 'aDelay', 'aColor', 'aGravity', 'aGlitter']) {
      expect(geometry.getAttribute(attribute)).toBeDefined();
    }

    const material = points.material as ShaderMaterial;
    expect(material.uniforms.uTime!.value).toBeCloseTo(0.6);
    expect(material.uniforms.uDuration!.value).toBe(2.4);

    await renderer.unmount();
  });

  it('spreads archive-show shells across the whole sky with widened expansion', async () => {
    const controller = createController();
    const effect = descriptor({
      kind: 'fireworks',
      particleCount: 30,
      burstCount: 4,
      color: '#F97316',
      celebrationScope: 'archive',
      durationSeconds: 3.6,
    });
    controller.start(effect);

    const renderer = await ReactThreeTestRenderer.create(
      <FireworksVisual controller={controller} effect={effect} />,
    );
    await renderer.advanceFrames(1, 0.1);

    const points = renderer.scene.findByProps({ name: 'particle-effect-fireworks' })
      .instance as Points;
    // The show centers on the sky, not the triggering work's position.
    expect([points.position.x, points.position.y, points.position.z])
      .toEqual([0, 6, -10]);

    const material = points.material as ShaderMaterial;
    expect(material.uniforms.uSpread!.value).toBe(34);

    // Shell origins scatter across a screen-wide region.
    const positions = points.geometry.getAttribute('position');
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < positions.count; index += 1) {
      minX = Math.min(minX, positions.getX(index));
      maxX = Math.max(maxX, positions.getX(index));
    }
    expect(maxX - minX).toBeGreaterThan(30);

    await renderer.unmount();
  });
});
