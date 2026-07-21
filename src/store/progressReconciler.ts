import type {
  Achievement,
  Galaxy,
  PersistedStateV2,
  RuntimeEvent,
  Star,
} from '../domain/models';
import { getStarUniqueWorkKey } from '../domain/normalization';

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

/**
 * The director the user has recorded the most unique works for, and that count.
 * Drives the dynamic "○○ 마스터" achievement — no hard-coded director. Ties are
 * broken by first appearance, so the leader is stable as works accrue.
 */
export function topDirectorUniqueWork(
  stars: readonly Star[],
): { director: string | null; count: number } {
  const byDirector = new Map<string, { display: string; works: Set<string> }>();
  for (const star of stars) {
    let entry = byDirector.get(star.normalizedDirector);
    if (entry === undefined) {
      entry = { display: star.director, works: new Set() };
      byDirector.set(star.normalizedDirector, entry);
    }
    entry.works.add(getStarUniqueWorkKey(star));
  }

  let best: { director: string | null; count: number } = { director: null, count: 0 };
  for (const entry of byDirector.values()) {
    if (entry.works.size > best.count) {
      best = { director: entry.display, count: entry.works.size };
    }
  }
  return best;
}

/** Dynamic display for the director-master achievement, keyed on the leader. */
export function directorMasterDisplay(
  stars: readonly Star[],
): { name: string; description: string } {
  const { director } = topDirectorUniqueWork(stars);
  if (director === null) {
    return { name: '감독 마스터', description: '한 감독의 작품을 10편 기록하세요.' };
  }
  return {
    name: `${director} 마스터`,
    description: `${director} 감독의 작품 10편을 기록하세요.`,
  };
}

/** Everything an achievement rule may need to measure its progress. */
export type AchievementProgressContext = Pick<
  PersistedStateV2,
  'stars' | 'constellations' | 'blackholeArchive' | 'planetCollection'
>;

function distinctCount<T>(items: readonly T[], key: (item: T) => string): number {
  const seen = new Set<string>();
  for (const item of items) seen.add(key(item));
  return seen.size;
}

export function calculateAchievementProgress(
  achievement: Pick<Achievement, 'ruleId'>,
  context: AchievementProgressContext,
): number {
  switch (achievement.ruleId) {
    case 'director-master':
      return topDirectorUniqueWork(context.stars).count;
    case 'genre-explorer':
      return distinctCount(context.stars, (star) => star.genre);
    case 'five-star-curator':
      return context.stars.filter((star) => star.rating === 5).length;
    case 'constellation-architect':
      return context.constellations.length;
    case 'blackhole-keeper':
      return context.blackholeArchive.length;
    case 'planet-pioneer':
      return distinctCount(context.planetCollection.planets, (planet) => planet.speciesId);
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
    const progress = calculateAchievementProgress(achievement, candidate);

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
      // The stored name stays generic; the toast names the actual director.
      const announced =
        achievement.ruleId === 'director-master'
          ? { ...unlocked, ...directorMasterDisplay(candidate.stars) }
          : unlocked;
      events.push(createAchievementUnlockEvent(announced, nowIso));
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
