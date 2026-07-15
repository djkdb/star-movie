import { describe, expect, it } from 'vitest';

import { getSceneFrameLoop } from './usePrefersReducedMotion';

describe('reduced motion scene policy', () => {
  it('R14.1 keeps the animated loop normally and switches to static demand rendering for reduced motion', () => {
    expect(getSceneFrameLoop(false)).toBe('always');
    expect(getSceneFrameLoop(true)).toBe('demand');
  });
});
