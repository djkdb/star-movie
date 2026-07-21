import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Group, Points, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import { FireworksVisual, MeteorVisual } from './ParticleManager';
import {
  EffectLifecycleRegistry,
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
  it('gives every spark a slot in the figure, a comet trail, and a running clock', async () => {
    const controller = createController();
    const effect = descriptor({
      kind: 'fireworks',
      particleCount: 40,
      shape: 'star',
      color: '#3B82F6',
      durationSeconds: 2.4,
    });
    controller.start(effect);

    const renderer = await ReactThreeTestRenderer.create(
      <FireworksVisual controller={controller} effect={effect} />,
    );
    await renderer.advanceFrames(3, 0.2);

    const sparks = renderer.scene.findByProps({ name: 'firework-sparks' })
      .instance as Points;
    // One vertex per requested spark; positions hold the figure's slots.
    expect(sparks.geometry.getAttribute('position').count).toBe(40);
    for (const attribute of ['aSize', 'aDelay', 'aColor', 'aGlitter', 'aSeed']) {
      expect(sparks.geometry.getAttribute(attribute)).toBeDefined();
    }

    // Every spark drags a light trail: one head/tail vertex pair per spark.
    const trails = renderer.scene.findByProps({ name: 'firework-trails' })
      .instance as Points;
    expect(trails.geometry.getAttribute('position').count).toBe(80);
    expect(trails.geometry.getAttribute('aTrail')).toBeDefined();

    // The rocket climb, launch flash, and shockwave ring open the show.
    expect(renderer.scene.findByProps({ name: 'firework-rocket' })).toBeDefined();
    expect(renderer.scene.findByProps({ name: 'firework-flash' })).toBeDefined();
    expect(renderer.scene.findByProps({ name: 'firework-shockwave' })).toBeDefined();

    const material = sparks.material as ShaderMaterial;
    expect(material.uniforms.uTime!.value).toBeCloseTo(0.6);
    expect(material.uniforms.uDuration!.value).toBe(2.4);

    await renderer.unmount();
  });

  it('stages the archive figure huge on the deep backdrop sky', async () => {
    const controller = createController();
    const effect = descriptor({
      kind: 'fireworks',
      particleCount: 200,
      shape: 'planet',
      color: '#F97316',
      celebrationScope: 'archive',
      durationSeconds: 3.6,
    });
    controller.start(effect);

    const renderer = await ReactThreeTestRenderer.create(
      <FireworksVisual controller={controller} effect={effect} />,
    );
    await renderer.advanceFrames(1, 0.1);

    const group = renderer.scene.findByProps({ name: 'particle-effect-fireworks' })
      .instance as Group;
    // The figure is staged far along the gaze — deep in the background sky,
    // never at the work — and blown up enormously there.
    const distanceFromOrigin = Math.hypot(
      group.position.x,
      group.position.y,
      group.position.z,
    );
    expect(distanceFromOrigin).toBeGreaterThan(500);
    expect(group.scale.x).toBeGreaterThan(1);

    // The figure's slots span a vast, screen-filling region of the backdrop.
    const sparks = renderer.scene.findByProps({ name: 'firework-sparks' })
      .instance as Points;
    const positions = sparks.geometry.getAttribute('position');
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < positions.count; index += 1) {
      minX = Math.min(minX, positions.getX(index));
      maxX = Math.max(maxX, positions.getX(index));
    }
    expect(maxX - minX).toBeGreaterThan(100);

    await renderer.unmount();
  });
});
