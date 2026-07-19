import { createDeterministicStarPosition } from '../store/deterministicPlacement';
import { createDefaultPersistedStore } from './defaultState';
import { normalizeText } from './normalization';
import type {
  ArchivedStar,
  Genre,
  PersistedStore,
  Rating,
  Star,
} from './models';

/**
 * Presentation-ready demo archive planted on a visitor's very first run:
 * fifteen well-known movies across every genre, two "disappointments" already
 * swallowed by the black hole (so its ember ring and extra mass show), and one
 * SF constellation. All IDs and positions are fixed so every fresh browser
 * sees the identical sky.
 */

interface DemoWorkSeed {
  id: string;
  title: string;
  genre: Genre;
  rating: Rating;
  review: string;
  watchedDate: string;
  director: string;
}

const DEMO_ACTIVE_WORKS: readonly DemoWorkSeed[] = [
  { id: 'd0000000-0000-4000-8000-000000000001', title: '인터스텔라', genre: 'SF', rating: 5, review: '우주를 건너 닿는 사랑과 시간', watchedDate: '2025-01-04', director: 'Christopher Nolan' },
  { id: 'd0000000-0000-4000-8000-000000000002', title: '컨택트', genre: 'SF', rating: 5, review: '언어가 시간을 바꾼다', watchedDate: '2025-01-11', director: 'Denis Villeneuve' },
  { id: 'd0000000-0000-4000-8000-000000000003', title: '블레이드 러너 2049', genre: 'SF', rating: 4, review: '네온과 안개 속의 존재론', watchedDate: '2025-02-02', director: 'Denis Villeneuve' },
  { id: 'd0000000-0000-4000-8000-000000000004', title: '인셉션', genre: 'SF', rating: 5, review: '꿈속의 꿈, 무너지는 도시', watchedDate: '2025-02-15', director: 'Christopher Nolan' },
  { id: 'd0000000-0000-4000-8000-000000000005', title: '라라랜드', genre: '로맨스', rating: 5, review: '꿈과 사랑 사이의 왈츠', watchedDate: '2025-03-01', director: 'Damien Chazelle' },
  { id: 'd0000000-0000-4000-8000-000000000006', title: '이터널 선샤인', genre: '로맨스', rating: 5, review: '지워도 남는 기억의 온도', watchedDate: '2025-03-09', director: 'Michel Gondry' },
  { id: 'd0000000-0000-4000-8000-000000000007', title: '기생충', genre: '스릴러', rating: 5, review: '계단 아래의 냄새', watchedDate: '2025-03-22', director: '봉준호' },
  { id: 'd0000000-0000-4000-8000-000000000008', title: '살인의 추억', genre: '스릴러', rating: 5, review: '밥은 먹고 다니냐', watchedDate: '2025-04-05', director: '봉준호' },
  { id: 'd0000000-0000-4000-8000-000000000009', title: '쇼생크 탈출', genre: '드라마', rating: 5, review: '희망은 좋은 것이죠', watchedDate: '2025-04-19', director: 'Frank Darabont' },
  { id: 'd0000000-0000-4000-8000-00000000000a', title: '센과 치히로의 행방불명', genre: '애니', rating: 5, review: '이름을 잃지 않는 용기', watchedDate: '2025-05-03', director: '미야자키 하야오' },
  { id: 'd0000000-0000-4000-8000-00000000000b', title: '스파이더맨: 뉴 유니버스', genre: '애니', rating: 4, review: '누구나 마스크를 쓸 수 있다', watchedDate: '2025-05-17', director: 'Bob Persichetti' },
  { id: 'd0000000-0000-4000-8000-00000000000c', title: '그랜드 부다페스트 호텔', genre: '코미디', rating: 4, review: '분홍빛 액자 속 소동극', watchedDate: '2025-05-31', director: 'Wes Anderson' },
  { id: 'd0000000-0000-4000-8000-00000000000d', title: '극한직업', genre: '코미디', rating: 3, review: '지금까지 이런 맛은 없었다', watchedDate: '2025-06-07', director: '이병헌' },
  { id: 'd0000000-0000-4000-8000-00000000000e', title: '매드 맥스: 분노의 도로', genre: '액션', rating: 5, review: '화염과 모래의 질주', watchedDate: '2025-06-14', director: 'George Miller' },
  { id: 'd0000000-0000-4000-8000-00000000000f', title: '보헤미안 랩소디', genre: '기타', rating: 4, review: '전설이 된 20분의 무대', watchedDate: '2025-06-21', director: 'Bryan Singer' },
];

const DEMO_ARCHIVED_WORKS: readonly DemoWorkSeed[] = [
  { id: 'd0000000-0000-4000-8000-000000000010', title: '캣츠', genre: '기타', rating: 1, review: '기대와 달랐던 뮤지컬', watchedDate: '2024-11-02', director: 'Tom Hooper' },
  { id: 'd0000000-0000-4000-8000-000000000011', title: '수어사이드 스쿼드', genre: '액션', rating: 2, review: '아쉬움이 남는 팀업', watchedDate: '2024-12-14', director: 'David Ayer' },
];

const DEMO_CONSTELLATION_ID = 'd0000000-0000-4000-8000-000000000020';

function toStar(seed: DemoWorkSeed, index: number): Star {
  return {
    id: seed.id,
    title: seed.title,
    normalizedTitle: normalizeText(seed.title),
    genre: seed.genre,
    rating: seed.rating,
    review: seed.review,
    watchedDate: seed.watchedDate,
    director: seed.director,
    normalizedDirector: normalizeText(seed.director),
    position: createDeterministicStarPosition(seed.id, seed.genre),
    createdAt: new Date(Date.UTC(2025, 0, 5 + index * 3, 12)).toISOString(),
  };
}

function toArchivedStar(seed: DemoWorkSeed, index: number): ArchivedStar {
  return {
    ...toStar(seed, index),
    createdAt: new Date(Date.UTC(2024, 10, 3 + index * 7, 12)).toISOString(),
    discardedAt: new Date(Date.UTC(2024, 11, 20 + index * 3, 12)).toISOString(),
  };
}

/** Builds the complete demo document on top of the pristine default store. */
export function createDemoSeedPersistedStore(): PersistedStore {
  const store = createDefaultPersistedStore();
  store.stars = DEMO_ACTIVE_WORKS.map(toStar);
  store.blackholeArchive = DEMO_ARCHIVED_WORKS.map(toArchivedStar);
  store.constellations = [
    {
      id: DEMO_CONSTELLATION_ID,
      name: 'SF 걸작선',
      starIds: [
        'd0000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000002',
        'd0000000-0000-4000-8000-000000000004',
      ],
      color: '#7FD8FF',
      createdAt: '2025-02-20T12:00:00.000Z',
    },
  ];
  // Two unique Christopher Nolan works are seeded (인터스텔라, 인셉션).
  store.achievements = store.achievements.map((achievement) =>
    achievement.ruleId === 'nolan-unique-work'
      ? { ...achievement, progress: 2 }
      : achievement,
  );
  // Credit the seeded collection so a first-run visitor already has a few gacha
  // tickets to try the planet dex (one per five works, active + archived).
  store.planetCollection = {
    lifetimeStarsAdded: store.stars.length + store.blackholeArchive.length,
    pullsPerformed: 0,
    planets: [],
  };
  return store;
}
