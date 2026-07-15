import type {
  Achievement,
  Galaxy,
  PersistedStateV2,
  RuntimeEvent,
  Star,
} from '../domain/models';
import {
  getStarUniqueWorkKey,
  normalizeText,
} from '../domain/normalization';

const NOLAN_NORMALIZED_DIRECTOR = normalizeText('Christopher Nolan');

const MILESTONES = [
  { key: 'fifty', target: 50, rewardType: 'planet' },
  { key: 'hundred', target: 100, rewardType: 'galaxy' },
] as const;

const DEFAULT_HUNDRED_REWARD_GALAXY: Omit<Galaxy, 'id'> = {
  kind: { type: 'reward', rewardType: 'milestone-100' },
  center: { x: 0, y: 0, z: 90 },
  placementRadius: 18,
  themeId: 'milestone-100-reward',
  primaryColor: '#8B5CF6',
  unlocked: true,
};

export interface ProgressReconcileOptions {
  nowIso: string;
  nextRewardId(): string;
}

export interface ProgressReconcileResult {
  candidate: PersistedStateV2;
  completionEvents: RuntimeEvent[];
}

function nolanUniqueWorkProgress(stars: readonly Star[]): number {
  const uniqueWorks = new Set<string>();
  for (const star of stars) {
    if (star.normalizedDirector === NOLAN_NORMALIZED_DIRECTOR) {
      uniqueWorks.add(getStarUniqueWorkKey(star));
    }
  }
  return uniqueWorks.size;
}

export function calculateAchievementProgress(
  achievement: Pick<Achievement, 'ruleId'>,
  stars: readonly Star[],
): number {
  switch (achievement.ruleId) {
    case 'nolan-unique-work':
      return nolanUniqueWorkProgress(stars);
  }
}

function createMilestoneUnlockEvent(
  target: 50 | 100,
  rewardId: string,
  rewardType: 'planet' | 'galaxy',
  occurredAt: string,
): RuntimeEvent {
  return {
    id: `milestone-unlocked:${target}:${rewardId}`,
    type: 'milestone-unlocked',
    occurredAt,
    payload: { target, rewardId, rewardType },
  };
}

function createAchievementUnlockEvent(
  achievement: Achievement,
  occurredAt: string,
): RuntimeEvent {
  return {
    id: `achievement-unlocked:${achievement.id}:${occurredAt}`,
    type: 'achievement-unlocked',
    occurredAt,
    payload: {
      achievementId: achievement.id,
      name: achievement.name,
      description: achievement.description,
    },
  };
}

function upsertHundredRewardGalaxy(
  galaxies: readonly Galaxy[],
  rewardId: string,
): Galaxy[] {
  const matching = galaxies.find(
    (galaxy) => galaxy.kind.type === 'reward' && galaxy.id === rewardId,
  );
  const reward: Galaxy = matching === undefined
    ? { id: rewardId, ...structuredClone(DEFAULT_HUNDRED_REWARD_GALAXY) }
    : {
        ...structuredClone(matching),
        id: rewardId,
        kind: { type: 'reward', rewardType: 'milestone-100' },
        themeId: 'milestone-100-reward',
        unlocked: true,
      };

  const reconciled: Galaxy[] = [];
  let inserted = false;
  for (const galaxy of galaxies) {
    if (galaxy.kind.type !== 'reward') {
      reconciled.push(structuredClone(galaxy));
    } else if (!inserted) {
      reconciled.push(reward);
      inserted = true;
    }
  }
  if (!inserted) reconciled.push(reward);
  return reconciled;
}

function reconcileAchievements(
  previous: PersistedStateV2,
  candidate: PersistedStateV2,
  nowIso: string,
  emitUnlockEvents: boolean,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  candidate.achievements = candidate.achievements.map((achievement) => {
    const prior = previous.achievements.find(({ id }) => id === achievement.id);
    const progress = calculateAchievementProgress(achievement, candidate.stars);

    if (prior?.unlocked === true) {
      return {
        ...achievement,
        progress,
        unlocked: true,
        unlockedAt: prior.unlockedAt,
      };
    }

    if (emitUnlockEvents && progress >= achievement.target) {
      const unlocked = {
        ...achievement,
        progress,
        unlocked: true,
        unlockedAt: nowIso,
      };
      events.push(createAchievementUnlockEvent(unlocked, nowIso));
      return unlocked;
    }

    return {
      ...achievement,
      progress,
      unlocked: prior?.unlocked ?? achievement.unlocked,
      unlockedAt: prior?.unlockedAt ?? achievement.unlockedAt,
    };
  });
  return events;
}

/**
 * Reconciles a committed active-work mutation. Unlocks are evaluated only on
 * locked-to-unlocked transitions; milestone thresholds are always processed
 * in ascending order.
 */
export function reconcileProgressAfterMutation(
  previous: Readonly<PersistedStateV2>,
  nextCandidate: PersistedStateV2,
  options: ProgressReconcileOptions,
): ProgressReconcileResult {
  const candidate = structuredClone(nextCandidate);
  const completionEvents: RuntimeEvent[] = [];
  const previousCount = previous.stars.length;
  const nextCount = candidate.stars.length;

  for (const definition of MILESTONES) {
    const prior = previous.milestoneUnlocks[definition.key];

    if (prior.unlocked) {
      candidate.milestoneUnlocks[definition.key] = structuredClone(prior);
      if (definition.target === 100 && prior.rewardId !== null) {
        candidate.galaxies = upsertHundredRewardGalaxy(
          candidate.galaxies,
          prior.rewardId,
        );
      }
      continue;
    }

    if (previousCount < definition.target && nextCount >= definition.target) {
      const rewardId = options.nextRewardId();
      candidate.milestoneUnlocks[definition.key] = {
        target: definition.target,
        unlocked: true,
        unlockedAt: options.nowIso,
        rewardId,
      };
      if (definition.target === 100) {
        candidate.galaxies = upsertHundredRewardGalaxy(
          candidate.galaxies,
          rewardId,
        );
      }
      completionEvents.push(
        createMilestoneUnlockEvent(
          definition.target,
          rewardId,
          definition.rewardType,
          options.nowIso,
        ),
      );
    } else {
      candidate.milestoneUnlocks[definition.key] = structuredClone(prior);
    }
  }

  completionEvents.push(
    ...reconcileAchievements(previous as PersistedStateV2, candidate, options.nowIso, true),
  );
  return { candidate, completionEvents };
}

/**
 * Recomputes current achievement progress for a persisted bootstrap without
 * creating unlocks or runtime events. Saved sticky unlock metadata remains the
 * authority during restore.
 */
export function reconcileRestoredProgress(
  restoredState: PersistedStateV2,
): PersistedStateV2 {
  const candidate = structuredClone(restoredState);
  reconcileAchievements(restoredState, candidate, '', false);

  const hundred = restoredState.milestoneUnlocks.hundred;
  candidate.galaxies = hundred.unlocked && hundred.rewardId !== null
    ? upsertHundredRewardGalaxy(candidate.galaxies, hundred.rewardId)
    : candidate.galaxies.filter((galaxy) => galaxy.kind.type !== 'reward');

  return candidate;
}
