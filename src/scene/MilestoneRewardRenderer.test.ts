import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { Galaxy } from '../domain/models';
import { selectMilestoneRewardViewModels } from './MilestoneRewardRenderer';

const FIFTY_REWARD_ID = '71000000-0000-4000-8000-000000000050';
const HUNDRED_REWARD_ID = '71000000-0000-4000-8000-000000000100';

function rewardGalaxy(id: string, z: number): Galaxy {
  return {
    id,
    kind: { type: 'reward', rewardType: 'milestone-100' },
    center: { x: 0, y: 0, z },
    placementRadius: 18,
    themeId: 'milestone-100-reward',
    primaryColor: '#8B5CF6',
    unlocked: true,
  };
}

describe('milestone reward rendering view model', () => {
  it('R16.2 R16.5 R16.9 renders one planet and one authoritative galaxy per rewardId', () => {
    const persisted = createDefaultStore(true).persisted;
    persisted.milestoneUnlocks.fifty = {
      target: 50,
      unlocked: true,
      unlockedAt: '2025-06-01T00:00:00.000Z',
      rewardId: FIFTY_REWARD_ID,
    };
    persisted.milestoneUnlocks.hundred = {
      target: 100,
      unlocked: true,
      unlockedAt: '2025-07-01T00:00:00.000Z',
      rewardId: HUNDRED_REWARD_ID,
    };
    persisted.galaxies.push(
      rewardGalaxy(HUNDRED_REWARD_ID, 90),
      rewardGalaxy(HUNDRED_REWARD_ID, 120),
      rewardGalaxy('71000000-0000-4000-8000-000000000999', 150),
    );

    const rewards = selectMilestoneRewardViewModels(persisted);

    expect(rewards).toHaveLength(2);
    expect(rewards.map(({ kind, rewardId }) => [kind, rewardId])).toEqual([
      ['planet', FIFTY_REWARD_ID],
      ['galaxy', HUNDRED_REWARD_ID],
    ]);
    expect(rewards[1]).toMatchObject({
      kind: 'galaxy',
      galaxy: { center: { z: 90 } },
    });
    expect(new Set(rewards.map(({ rewardId }) => rewardId)).size).toBe(rewards.length);
  });

  it('R16.9 ignores locked, missing, stale, and cross-type duplicate rewards', () => {
    const persisted = createDefaultStore(true).persisted;
    persisted.milestoneUnlocks.fifty = {
      target: 50,
      unlocked: true,
      unlockedAt: '2025-06-01T00:00:00.000Z',
      rewardId: FIFTY_REWARD_ID,
    };
    persisted.milestoneUnlocks.hundred = {
      target: 100,
      unlocked: true,
      unlockedAt: '2025-07-01T00:00:00.000Z',
      rewardId: FIFTY_REWARD_ID,
    };
    persisted.galaxies.push(
      rewardGalaxy(FIFTY_REWARD_ID, 90),
      rewardGalaxy(HUNDRED_REWARD_ID, 120),
    );

    expect(selectMilestoneRewardViewModels(persisted)).toEqual([
      expect.objectContaining({ kind: 'planet', rewardId: FIFTY_REWARD_ID }),
    ]);

    persisted.milestoneUnlocks.fifty = {
      target: 50,
      unlocked: false,
      unlockedAt: null,
      rewardId: null,
    };
    persisted.milestoneUnlocks.hundred.rewardId = HUNDRED_REWARD_ID;
    persisted.galaxies = [];
    expect(selectMilestoneRewardViewModels(persisted)).toEqual([]);
  });
});
