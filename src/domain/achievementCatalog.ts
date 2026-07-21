import type { Achievement, AchievementRuleId } from './models';

/** The canonical definition of one achievement, before per-user progress. */
export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  ruleId: AchievementRuleId;
  target: number;
}

/**
 * Every achievement the app ships with. This is the single source of truth for
 * both the default seed (fresh stores) and the persistence backfill (existing
 * documents that predate a newly added achievement gain it locked, keeping any
 * already-earned achievements untouched).
 */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  {
    // Dynamic: any one director with 10 recorded works unlocks this, and the
    // UI shows that director's name ("○○ 마스터"). The stored name is the
    // generic fallback shown before any director leads.
    id: 'director-master',
    name: '감독 마스터',
    description: '한 감독의 작품을 10편 기록하세요.',
    ruleId: 'director-master',
    target: 10,
  },
  {
    id: 'genre-explorer',
    name: '장르 개척자',
    description: '서로 다른 8개 장르를 모두 하나 이상 기록하세요.',
    ruleId: 'genre-explorer',
    target: 8,
  },
  {
    id: 'five-star-curator',
    name: '별점 수집가',
    description: '별점 5점을 준 작품을 10편 기록하세요.',
    ruleId: 'five-star-curator',
    target: 10,
  },
  {
    id: 'constellation-architect',
    name: '별자리 건축가',
    description: '나만의 별자리를 5개 만드세요.',
    ruleId: 'constellation-architect',
    target: 5,
  },
  {
    id: 'blackhole-keeper',
    name: '심연의 관리자',
    description: '블랙홀에 작품 10편을 보관하세요.',
    ruleId: 'blackhole-keeper',
    target: 10,
  },
  {
    id: 'planet-pioneer',
    name: '행성 개척자',
    description: '서로 다른 행성 10종을 수집하세요.',
    ruleId: 'planet-pioneer',
    target: 10,
  },
];

/** A fresh, fully-locked achievement from its definition. */
export function createLockedAchievement(definition: AchievementDefinition): Achievement {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    ruleId: definition.ruleId,
    progress: 0,
    target: definition.target,
    unlocked: false,
    unlockedAt: null,
  };
}

/** The default achievement set for a brand-new store. */
export function createSeedAchievements(): Achievement[] {
  return ACHIEVEMENT_DEFINITIONS.map(createLockedAchievement);
}

/** Every rule id the app defines, for schema validation. */
export const ACHIEVEMENT_RULE_IDS: readonly AchievementRuleId[] =
  ACHIEVEMENT_DEFINITIONS.map((definition) => definition.ruleId);
