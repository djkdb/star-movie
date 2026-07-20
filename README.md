- 포스터 썸네일과 개봉 연도 표시
- 작품을 선택하면 장르 자동 입력
- 영화 크레딧에서 감독 정보 자동 보완
- 포스터는 작품 카드와 목록에서 확인
- API 키가 없어도 수동 입력으로 모든 기본 기능 사용 가능

### 3D 우주 아카이브

- 전체 화면 WebGL 밤하늘과 은하수 배경
- 약 15,000개의 배경 별과 별빛·성운 효과
- 장르별 은하: SF, 로맨스, 스릴러, 드라마, 애니, 코미디, 액션, 기타
- 마우스·터치로 자유롭게 회전하는 360° Trackball 카메라
- 휠 줌과 작품·별자리 선택 시 카메라 포커스
- 별을 선택하면 포스터, 감독, 감상일, 감상평을 담은 상세 카드 표시
- `prefers-reduced-motion` 대응 및 FPS 기반 품질 저하 단계

### 리뷰 아카이브 관리

- 작품 목록 검색: 제목 또는 감독
- 정렬: 별점 높은 순, 최신 등록 순
- 장르 필터와 현재 아카이브 통계
- 작품 수, 평균 별점, 최다 장르, 50편·100편 마일스톤
- 작품을 블랙홀 아카이브로 이동하는 Soft Delete
- 블랙홀 아카이브에서 작품 복원
- 확인 절차가 포함된 영구 삭제(Hard Delete)
- 3D Canvas를 사용할 수 없는 환경을 위한 DOM 탐색 경로

### 별자리

- 원하는 작품을 원하는 순서로 직접 연결
- 최대 200개의 작품을 하나의 별자리에 연결
- 장르별 작품을 자동으로 별자리로 묶기
- 별자리 선택 시 연결된 작품들을 한 번에 조망
- 작품 삭제·블랙홀 이동 시 별자리 참조 무결성 유지

### 행성 도감과 수집

- 작품을 5개 추가할 때마다 행성 가챠 티켓 1장 획득
- 일반·레어·에픽·전설 4단계 희귀도
- 42종 행성 종을 수집하는 도감
- 중복 행성 수량 표시 및 종별 수집률 확인
- 뽑은 행성은 각자의 궤도와 3D 표현을 가짐
- 현재 밤하늘을 `내가 본 작품들로 만든 우주` 이미지로 저장

### 업적

- 기록한 작품 수에 따른 마일스톤 보상
- 고유 작품 기준 업적 진행률
- 현재 구현된 업적: `놀란 마스터` — 크리스토퍼 놀란 감독의 고유 작품 10편 기록

## 🗺️ 화면 구성

앱은 3D 장면을 중심에 두고, 오른쪽 아이콘 Dock(모바일에서는 하단 Dock)에서 필요한 패널을 여는 방식입니다.

| 패널 | 역할 |
| --- | --- |
| 아카이브 현황 | 작품 수·평균 별점·최다 장르·마일스톤·업적 확인 |
| 작품 목록 | 검색·정렬·작품/별자리/블랙홀 보관함 탐색 |
| 작품 추가 | 리뷰와 메타데이터를 입력해 새로운 별 등록 |
| 별자리 만들기 | 수동 또는 장르 기반으로 작품 연결 |
| 행성 도감 | 가챠, 수집 현황, 우주 이미지 저장 |
| 작품 DOM 탐색 | Canvas 없이 키보드와 DOM으로 작품 관리 |

패널은 닫혀도 언마운트되지 않기 때문에 작성 중인 입력과 Store 상태가 유지됩니다. `Escape` 또는 바깥 영역 클릭으로 패널을 닫을 수 있습니다.

## 🧱 기술 구조

```text
React + TypeScript + Vite
          │
          ├─ Zustand archive store
          │    ├─ 작품·별자리·블랙홀·행성·업적 상태
          │    └─ 원자적 command와 상태 불변식
          │
          ├─ React Three Fiber + Three.js
          │    ├─ 우주 배경·은하·별·별자리·블랙홀
          │    └─ 카메라 포커스·파티클·Bloom·성능 모드
          │
          ├─ localStorage persistence
          │    ├─ schemaVersion 2
          │    ├─ 1초 debounce autosave
          │    └─ 손상 데이터 전체 기본 상태 복구
          │
          └─ TMDB REST API (선택)
               └─ 영화 검색·포스터·감독 크레딧
```

주요 의존성은 `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `three`, `zustand`, `zod`입니다. 테스트에는 Vitest, Testing Library, Playwright, axe-core, fast-check를 사용합니다.

## 🚀 시작하기

### 요구 사항

- Node.js 20 권장 (`.node-version`에 고정)
- npm

### 설치 및 실행

```bash
npm install
npm run dev
```

브라우저에서 Vite가 출력한 로컬 주소를 엽니다.

### TMDB 자동완성 설정(선택)

```bash
cp .env.example .env
```

`.env`에 읽기 전용 TMDB v3 API 키를 입력합니다.

```env
VITE_TMDB_API_KEY=your_tmdb_api_key
```

키가 없어도 작품 직접 입력, 리뷰 작성, 3D 아카이브, 저장 기능은 정상적으로 사용할 수 있습니다. 키가 설정된 경우 앱에는 TMDB 필수 출처 문구가 표시됩니다.

## 🧪 테스트 및 검증

```bash
# 타입 검사와 프로덕션 빌드
npm run typecheck
npm run build

# 기본 테스트
npm test
npm run test:unit
npm run test:component

# 속성 기반·통합·시각·성능 테스트
npm run test:pbt
npm run test:integration
npm run test:visual
npm run test:performance

# 핵심 검증 전체
npm run validate

# 시각·성능 검증
npm run validate:visual-performance
```

도메인 로직과 Store에는 fast-check 기반 속성 테스트가 포함되어 있으며, Playwright 테스트로 반응형·접근성·WebGL 장면을 검증합니다.

## ☁️ 배포

Asteron은 백엔드 없는 정적 Vite SPA라 Cloudflare Pages에 배포할 수 있습니다.

```bash
npm run build
npx wrangler pages deploy dist --project-name star-movie
```

Cloudflare Pages 설정값:

| 항목 | 값 |
| --- | --- |
| Build command | `npm run build` |
