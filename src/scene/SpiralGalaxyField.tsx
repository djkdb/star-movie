import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  FloatType,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

import {
  GALAXY_POSITION_SHADER,
  GALAXY_RENDER_FRAGMENT_SHADER,
  GALAXY_RENDER_VERTEX_SHADER,
  GALAXY_VELOCITY_SHADER,
  createGalaxySeedData,
} from './spiralGalaxyModel';

export interface SpiralGalaxyFieldProps {
  /** GPGPU texture edge length; particle count is its square. */
  textureSize: number;
  reducedMotion: boolean;
}

/** Where the galaxy hangs in the sky and how it is tilted and scaled. */
const GALAXY_ORIGIN = new Vector3(-300, 135, -470);
const GALAXY_TILT = new Euler(1.12, 0.35, 0.42);
const GALAXY_SCALE = 0.8;
/** Longest GPGPU step; clamps integration when a frame hitches or tab-switches. */
const MAX_STEP_SECONDS = 1 / 30;

/**
 * A GPGPU spiral galaxy adrift in the deep background. Star positions and
 * velocities live in floating-point textures that are integrated on the GPU
 * every frame under the galaxy's rotation curve, so tens of thousands of stars
 * swirl with genuine differential rotation rather than a canned spin. It is a
 * pure ambient backdrop: non-interactive, additively blended, drawn behind the
 * archive. Freezes (stops stepping) under reduced motion, and silently renders
 * nothing on GPUs without float-texture render support.
 */
export function SpiralGalaxyField({ textureSize, reducedMotion }: SpiralGalaxyFieldProps) {
  const gl = useThree((state) => state.gl);
  const pointsRef = useRef<Points>(null);

  // All resources share one memo and one lifetime, so they are only ever
  // created and disposed together — disposing them on separate keys risks
  // freeing a still-referenced material and blanking the whole field.
  const resources = useMemo(() => {
    const seed = createGalaxySeedData(textureSize);
    const gpu = new GPUComputationRenderer(textureSize, textureSize, gl);
    gpu.setDataType(FloatType);

    const positionTexture = gpu.createTexture();
    const velocityTexture = gpu.createTexture();
    positionTexture.image.data.set(seed.positions);
    velocityTexture.image.data.set(seed.velocities);

    const positionVariable = gpu.addVariable(
      'texturePosition',
      GALAXY_POSITION_SHADER,
      positionTexture,
    );
    const velocityVariable = gpu.addVariable(
      'textureVelocity',
      GALAXY_VELOCITY_SHADER,
      velocityTexture,
    );
    gpu.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
    gpu.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
    positionVariable.material.uniforms.uDelta = { value: 0 };
    velocityVariable.material.uniforms.uDelta = { value: 0 };

    if (gpu.init() !== null) {
      gpu.dispose();
      return null;
    }

    const count = textureSize * textureSize;
    const geometry = new BufferGeometry();
    // A zeroed position attribute only sets the draw count; the vertex shader
    // reads the real position from the GPGPU texture via aReference.
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aReference', new Float32BufferAttribute(seed.references, 2));
    geometry.setAttribute('aColor', new Float32BufferAttribute(seed.colors, 3));
    geometry.setAttribute('aSize', new Float32BufferAttribute(seed.sizes, 1));

    const material = new ShaderMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      fragmentShader: GALAXY_RENDER_FRAGMENT_SHADER,
      transparent: true,
      toneMapped: false,
      uniforms: {
        texturePosition: { value: null },
        uPixelRatio: { value: gl.getPixelRatio() },
      },
      vertexShader: GALAXY_RENDER_VERTEX_SHADER,
    });

    return { gpu, positionVariable, velocityVariable, geometry, material };
  }, [gl, textureSize]);

  useEffect(() => {
    if (resources === null) return undefined;
    return () => {
      resources.gpu.dispose();
      resources.geometry.dispose();
      resources.material.dispose();
    };
  }, [resources]);

  useFrame((_, delta) => {
    if (resources === null) return;
    if (!reducedMotion) {
      const step = Math.min(delta, MAX_STEP_SECONDS);
      resources.positionVariable.material.uniforms.uDelta!.value = step;
      resources.velocityVariable.material.uniforms.uDelta!.value = step;
      resources.gpu.compute();
    }
    resources.material.uniforms.texturePosition!.value = resources.gpu
      .getCurrentRenderTarget(resources.positionVariable)
      .texture;
  });

  if (resources === null) return null;

  return (
    <points
      frustumCulled={false}
      geometry={resources.geometry}
      material={resources.material}
      name="spiral-galaxy"
      position={GALAXY_ORIGIN}
      ref={pointsRef}
      rotation={GALAXY_TILT}
      scale={GALAXY_SCALE}
    />
  );
}
