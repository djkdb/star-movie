# Implementation Plan: Space Movie Archive

## Overview

React + TypeScript 기반을 먼저 고정하고, schemaVersion 2 도메인·영속화 계층과 Zustand 트랜잭션을 구축한 뒤 DOM UI와 R3F Scene을 점진적으로 연결한다. 각 구현 단계 가까이에 단위·컴포넌트·통합 테스트와 fast-check 속성 테스트를 배치하며, 마지막 단계에서 시각·접근성·성능 및 전체 회귀 검증을 수행한다.

## Tasks

- [x] 1. React + TypeScript 프로젝트 기반과 테스트 환경 구성
  - [x] 1.1 애플리케이션 프로젝트와 고정 버전 의존성 구성
    - Vite 기반 React + TypeScript 프로젝트 구조, 엄격한 TypeScript 설정, ESLint 및 빌드 스크립트를 구성한다.
    - React, Three.js, `@react-three/fiber`, drei, Zustand, Zod, `@react-three/postprocessing`을 호환되는 정확한 버전으로 고정하고 lockfile을 생성한다.
    - 브라우저 진입점이 저장 상태 bootstrap 완료 후 React 애플리케이션을 mount하도록 기본 경계를 만든다.
    - _Requirements: 1.1, 8.10, 13.6_

  - [x] 1.2 자동화 테스트 기반과 결정론적 provider 구성
    - Vitest, React Testing Library, fast-check, Playwright 및 WebGL 테스트 보조 도구를 정확한 버전으로 고정한다.
    - fake clock, UUID, 현재 시각, seed PRNG, fake localStorage adapter를 주입할 수 있는 테스트 provider와 공용 fixture를 만든다.
    - `typecheck`, 단위/컴포넌트, PBT, headless 통합, 시각·성능 검증을 단일 실행 모드로 수행하는 스크립트를 구성한다.
    - _Requirements: 2.9, 8.13, 11.5, 13.2_

- [x] 2. 도메인 모델, 기본 상태 및 schemaVersion 2 영속화 구현
  - [x] 2.1 도메인 타입, 정규화 함수 및 결정론적 기본 상태 구현
    - 8개 Genre, Star, Constellation, ArchivedStar, Galaxy, Milestone, Achievement 및 persisted/runtime Store 타입을 정의한다.
    - Unicode NFC 기반 텍스트 정규화, Unique Work Key, 8개 기본 은하 중심·반경·테마, 50/100 마일스톤 및 Nolan Master 기본 상태를 구현한다.
    - 은하 중심 간 최소 거리 25와 최초 실행 표시 gate를 기본 상태 생성 과정에서 보장한다.
    - _Requirements: 1.9, 2.16, 3.12, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 16.11, 17.1, 17.7_

  - [x] 2.2 schemaVersion 2 codec과 전체 문서 validator 구현
    - Zod 기반 encode/decode schema로 필수 필드, UUID, ISO 날짜, 실제 달력 날짜, enum, 길이, 유한 좌표와 null 연계를 검증한다.
    - 장르 은하 8개, 은하 중심 거리, Star 배치 거리, collection 상호배타성, ID·reward 유일성 및 Constellation 참조 계약을 문서 단위로 검증한다.
    - canonical encode/decode 후 배열 순서를 포함한 deep equality가 깨지면 문서 전체를 거부한다.
    - _Requirements: 2.2-2.8, 8.1-8.9, 8.13, 8.17_

  - [x] 2.3 schema codec과 기본 상태 단위 테스트 작성
    - 유효·무효 날짜, UUID/ISO, null 연계, 은하 거리, 중복 ID, collection 중복 소속 및 순서 손상 사례를 검증한다.
    - 기본 상태가 빈 작품 컬렉션, 8개 장르 은하, 잠긴 마일스톤과 Nolan Master를 포함하는지 검증한다.
    - _Requirements: 1.9, 8.2-8.9, 8.11, 8.17_

  - [x] 2.4 입력 정규화 및 검증 폐쇄성 속성 테스트 작성
    - **Property 2: 입력 정규화 및 검증의 폐쇄성**
    - Unicode, 공백, 경계 길이, 날짜 및 모든 Genre/Rating arbitrary를 사용하고 `numRuns: 100` 이상으로 검증한다.
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.14, 2.16**

  - [x] 2.5 schemaVersion 2 직렬화 round-trip 속성 테스트 작성
    - **Property 10: schemaVersion 2 직렬화 round-trip**
    - 유효 문서 arbitrary에 대해 모든 필드와 collection 순서의 깊은 동등성을 `numRuns: 100` 이상 검증한다.
    - **Validates: Requirements 1.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.13**

  - [x] 2.6 localStorage 저장·복원 서비스와 autosave 구현
    - 단일 키 `space-movie-archive:v2`에 codec 검증을 거친 JSON을 저장하는 StorageAdapter와 PersistenceService를 구현한다.
    - 첫 렌더 전 load, 실패 시 전체 기본 상태 복구, 1초 이내 debounce autosave, 사용자 저장과 autosave의 직렬화 및 silent diagnostics를 구현한다.
    - 사용자 쓰기 실패를 개별 감지할 수 있는 오류 결과를 반환하고 메모리 상태는 변경하지 않는다.
    - _Requirements: 1.10, 8.1, 8.10-8.18_

  - [x] 2.7 손상 데이터 전체 복구 속성 테스트 작성
    - **Property 11: 손상 데이터의 전체 복구**
    - 읽기 예외, 파싱 불가 JSON, schema 위반 및 round-trip 손상 payload에서 부분 복원 없이 전체 기본 상태가 반환되는지 검증한다.
    - **Validates: Requirements 8.11, 8.12, 8.17**

  - [x] 2.8 저장 실패 메모리 보존 속성 테스트 작성
    - **Property 12: 저장 실패의 메모리 보존**
    - autosave와 사용자 저장 실패를 주입해 메모리 상태 및 command snapshot이 깊은 동등성을 유지하는지 검증한다.
    - **Validates: Requirements 8.14, 8.18**

- [ ] 3. Zustand transactional domain command 구현
  - [x] 3.1 Zustand Store, selector 경계 및 원자 command 실행기 구현
    - persisted/runtime slice, Operation Snapshot, candidate 검증·저장 후 단일 commit, 완료 event queue와 오류 진단을 구현한다.
    - addWork의 deterministic 위치 생성, 폼 validator 연결, 성공 event와 저장 실패 시 무효과 처리를 구현한다.
    - 모든 사용자 저장 실패가 독립 toast event로 전달되고 autosave 실패는 진단에만 기록되도록 한다.
    - _Requirements: 2.9-2.19, 8.15, 8.16, 8.18_

  - [x] 3.2 Hard Delete, Soft Delete 및 Restore reducer와 command 구현
    - 참조 Constellation 영향 목록과 순서 보존 참조 제거를 구현한다.
    - hard delete는 두 collection 모두에서 제거하고, soft delete/restore는 `discardedAt`과 상호배타적 collection 이동을 원자 저장한다.
    - 실패 시 snapshot 소속을 기준으로 중복을 정규화하고 완료 effect를 발행하지 않는다.
    - _Requirements: 4.5-4.14, 10.9-10.14, 12.2-12.5, 12.9-12.14_

  - [-] 3.3 사용자 command 원자성 속성 테스트 작성
    - **Property 5: 사용자 command의 원자성**
    - reducer, validation, serialization 및 storage의 모든 주입 실패 지점에서 snapshot 보존과 완료 event 억제를 검증한다.
    - **Validates: Requirements 2.15, 4.14, 8.18, 9.15, 9.17, 12.4, 12.12**

  - [-] 3.4 Hard Delete 영구 제거 속성 테스트 작성
    - **Property 6: Hard Delete의 영구 제거**
    - 영향 이름 집합, 양 collection 제거, 모든 참조 제거 및 비대상 archive 불변성을 검증한다.
    - **Validates: Requirements 4.5, 4.6, 4.8, 4.9, 10.9, 12.9, 12.13**

  - [x] 3.5 Soft Delete와 Restore 상호배타성 속성 테스트 작성
    - **Property 16: Soft Delete와 Restore의 collection 상호배타성**
    - 성공·실패 및 중복 복구 arbitrary에서 정확히 한 collection 소속과 `discardedAt` 계약을 검증한다.
    - **Validates: Requirements 12.2, 12.3, 12.10, 12.11, 12.14**

  - [x] 3.6 Constellation draft와 수동·자동 생성 command 구현
    - 클릭 순서, 중복 차단, 2~200개 경계, 이름 trim/30자 검증, 결정론적 색상 및 취소 상태를 구현한다.
    - 장르별 createdAt 오름차순·UUID tie-break 자동 생성을 구현하고 operationId 중복 실행을 세션에서 차단한다.
    - 수동/자동 삽입과 persistence를 각각 하나의 원자 command로 연결한다.
    - _Requirements: 9.1-9.18_

  - [-] 3.7 Constellation draft 경계 속성 테스트 작성
    - **Property 13: Constellation draft의 순서·유일성·경계**
    - 임의 클릭 순서, 중복, 201번째 선택 및 무효 이름에서 기존 draft 보존을 검증한다.
    - **Validates: Requirements 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.14**

  - [-] 3.8 자동 별자리 결정론과 멱등성 속성 테스트 작성
    - **Property 14: 자동 별자리의 결정론과 멱등성**
    - 장르별 대상 집합, 정렬 tie-break 및 동일 operationId 반복 결과를 검증한다.
    - **Validates: Requirements 9.10, 9.11, 9.13, 9.16, 9.18**

  - [x] 3.9 마일스톤 및 Achievement reconcile engine 구현
    - Active Work 변경마다 50/100 임계값을 오름차순으로 처리하고 sticky unlock metadata와 유일 reward record를 유지한다.
    - Unique Work Key Set 기반 진행률, Nolan Master exact normalized director 규칙 및 최초 해금 event만 구현한다.
    - bootstrap/복원/panel navigation에서는 해금 event를 만들지 않는다.
    - _Requirements: 16.1-16.14, 17.1-17.13_

  - [~] 3.10 마일스톤 최초 해금과 멱등성 속성 테스트 작성
    - **Property 24: Milestone 최초 해금과 멱등성**
    - 감소·재상승·새로고침·0→100 이상 전이를 포함해 reward 단일성과 50→100 event 순서를 검증한다.
    - **Validates: Requirements 16.1-16.14**

  - [~] 3.11 Achievement 고유 작품 집계 속성 테스트 작성
    - **Property 25: Achievement 고유 작품 집계**
    - 제목·감독 공백/대소문자/Unicode 및 중복 작품 arbitrary로 Nolan Master 진행률을 검증한다.
    - **Validates: Requirements 17.1, 17.2, 17.7, 17.8, 17.9, 17.10**

  - [~] 3.12 Achievement 해금 단조성과 이벤트 단일성 속성 테스트 작성
    - **Property 26: Achievement 해금의 단조성과 이벤트 단일성**
    - 변경·감소·복원·panel 재개방 순서에서 sticky metadata와 단일 notification을 검증한다.
    - **Validates: Requirements 17.3, 17.4, 17.5, 17.6, 17.11, 17.12, 17.13**

- [~] 4. Checkpoint - 도메인과 영속화 검증
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. 파생 selector와 DOM 기반 작품 관리 UI 구현
  - [~] 5.1 HUD, 업적 및 ListView selector 구현
    - 활성 수, half-away-from-zero 평균, 모든 최다 장르, 마일스톤 진행률과 Achievement view model을 구현한다.
    - Rating/최신 정렬 tie-break, 검색·Genre predicate, active Constellation 및 archive section selector를 구현한다.
    - _Requirements: 5.1-5.10, 7.1-7.10, 10.6, 12.7, 17.11_

  - [~] 5.2 HUD 통계 정확성 속성 테스트 작성
    - **Property 7: HUD 통계의 정확성**
    - 빈 상태, `.05` 경계, Genre 동률 및 milestone cap을 포함한 arbitrary를 검증한다.
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.8**

  - [~] 5.3 ListView 전순서와 조건 일치 속성 테스트 작성
    - **Property 9: ListView의 결정론적 전순서와 조건 일치**
    - 두 정렬 옵션, 동일 timestamp/title, 검색, 다중 Genre 및 잘못된 별도 count를 검증한다.
    - **Validates: Requirements 7.4, 7.5, 7.8, 7.10**

  - [~] 5.4 작품 추가 폼과 저장 오류 피드백 구현
    - 제목, Genre, Rating, 감상평, 감상일, 기존/직접 입력 Director 필드와 필드별 오류·focus 이동을 구현한다.
    - 성공 시에만 draft를 초기화하고 실패 시 원문 입력과 Store 상태를 유지하며 live toast를 표시한다.
    - _Requirements: 2.1-2.8, 2.12-2.15, 2.19, 8.15_

  - [~] 5.5 Card, 삭제 확인 대화상자 및 Blackhole Archive DOM UI 구현
    - Card 정보/스타일, 별자리 시작, 외부 클릭·Escape 닫기, hard/soft 영향 이름 전체와 취소 동작을 구현한다.
    - archive 빈 상태, 상세 목록, restore 및 접근 가능한 대체 삭제·복원 경로를 구현한다.
    - _Requirements: 4.2-4.13, 10.8, 12.6-12.9, 12.13_

  - [~] 5.6 HUD, AchievementPanel, Filter 및 ListView 컴포넌트 구현
    - 다음 렌더 주기에 Store selector 결과를 반영하고 empty state, drawer용 구조와 camera request dispatch를 구현한다.
    - Filter의 다중 선택 Set, 선택 스타일 및 목표값이 같은 경우 tween을 만들지 않는 scene view model을 구현한다.
    - _Requirements: 5.1-5.10, 6.1-6.16, 7.1-7.10, 10.6-10.8, 12.7-12.8_

  - [~] 5.7 Genre Filter 상태 전이와 멱등성 속성 테스트 작성
    - **Property 8: Genre Filter 상태 전이와 멱등성**
    - 임의 toggle 순서에 대한 Set, Star opacity, Galaxy intensity 및 no-op tween 생성을 검증한다.
    - **Validates: Requirements 6.1-6.8, 6.10-6.16**

  - [~] 5.8 핵심 DOM UI 단위·컴포넌트 테스트 작성
    - 폼 필드와 오류 유지/reset, HUD 빈 상태·정확히 100 경계, Card 내용/닫기, 확인 취소, archive empty state를 검증한다.
    - 접근성 query로 dialog focus trap, Escape, focus restore, live region 및 키보드 ListView 동작을 검증한다.
    - _Requirements: 2.1, 2.12-2.15, 4.2-4.13, 5.3, 7.9, 12.8, 16.12, 17.13_

- [ ] 6. R3F 우주 배경, 카메라 및 장르 은하 구현
  - [~] 6.1 SpaceCanvas, VisibilityClock, 배경 레이어와 Nebula 구현
    - `#03040a`, FOV 75, maxDistance 1000 OrbitControls와 정확히 2개 배경 레이어를 구성한다.
    - near/far 1.5 parallax, seed별 1~4초 ±30% 진동, hidden pause/resume 및 1~3개 Nebula 범위를 구현한다.
    - 최초 실행 gate가 Star/Constellation만 차단하고 기본 우주 배경과 은하는 유지하도록 연결한다.
    - _Requirements: 1.1-1.9_

  - [~] 6.2 배경 파라랙스와 애니메이션 경계 속성 테스트 작성
    - **Property 1: 배경 파라랙스와 애니메이션 경계**
    - 카메라 회전, visible 시간과 seed arbitrary로 parallax·진동·Nebula 범위를 검증한다.
    - **Validates: Requirements 1.3, 1.4, 1.5**

  - [~] 6.3 8개 Genre Galaxy 테마 전략 구현
    - 공통 `GalaxyTheme` 인터페이스와 SF 나선, 로맨스 중심 성운, 스릴러 비대칭 띠, 드라마 타원 테마를 구현한다.
    - 애니 프리즘, 코미디 고리, 액션 방사 광선, 기타 불규칙 군집을 구현하고 각 정량 metric과 주 색상 contribution을 노출한다.
    - 로맨스 하트 primitive를 금지하고 테마 실패 시 단색 particle fallback을 적용한다.
    - _Requirements: 15.1-15.12_

  - [~] 6.4 Genre Galaxy 테마 수치 구별성 속성 테스트 작성
    - **Property 23: Genre Galaxy 테마의 수치적 구별성**
    - seed와 허용 대체 형태에 대해 8개 shape metric, signature 유일성, 하트 부재와 Primary Color Area 50% 이상을 검증한다.
    - **Validates: Requirements 15.1-15.12**

  - [~] 6.5 CameraRig과 Star/Constellation focus 수학 구현
    - Star focus와 active bounding-box fit을 0.7초 cubic 보간으로 구현하고 새 요청 시 기존 tween을 안전하게 교체한다.
    - active reference 2개 미만이면 fit request를 차단하고 UI에 이유를 제공한다.
    - _Requirements: 4.1, 7.6, 10.7, 10.8_

  - [~] 6.6 Active Constellation 카메라 fit 속성 테스트 작성
    - **Property 27: Active Constellation 카메라 fit**
    - 임의 위치와 viewport aspect에서 최종 frustum의 bounding box 포함 및 2개 미만 차단을 검증한다.
    - **Validates: Requirements 10.7, 10.8**

- [ ] 7. Star와 Constellation 3D 렌더링 구현
  - [~] 7.1 개별 Star mesh, rating 시각 매핑 및 상호작용 구현
    - Rating별 반지름·Bloom·색상, 초당 30도 회전, 3초 ±0.1 y 진동 및 visibility phase 보존을 구현한다.
    - hover scale 1.5/1.0과 0.3초 제목 label, click 선택·camera request 및 Blackhole drag payload를 연결한다.
    - _Requirements: 2.11, 3.1-3.11, 4.1-4.3_

  - [~] 7.2 Star 생성과 배치 불변식 속성 테스트 작성
    - **Property 3: Star 생성 및 배치 불변식**
    - 유효 입력, 모든 Genre Galaxy와 seed에 대해 필수 필드와 `min(placementRadius, 10)` 거리 및 은하 중심 거리를 검증한다.
    - **Validates: Requirements 2.9, 2.10, 3.11, 3.12**

  - [~] 7.3 Rating 시각 매핑과 Star 운동 속성 테스트 작성
    - **Property 4: Rating 시각 매핑과 Star 운동**
    - 모든 Rating과 visible 경과 시간에서 tuple, 회전률 및 y 진동 범위를 검증한다.
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [~] 7.4 51개 이상 InstancedMesh Star renderer 구현
    - 0~50 개별 mesh와 51개 이상 rating bucket InstancedMesh 모드를 구현한다.
    - instance matrix/color/phase 갱신, `instanceId → starId` raycast mapping 및 50↔51 전환 중 선택·camera target 보존을 구현한다.
    - _Requirements: 3.2-3.10, 13.1_

  - [~] 7.5 Constellation line, preview 및 active reference 렌더링 구현
    - draft 순서 preview, active reference 순서 보존 line, 2개 미만 숨김 및 hover opacity/name timing을 구현한다.
    - 수동·자동 생성 UI와 ListView active constellation 선택을 Store command/CameraRig에 연결한다.
    - _Requirements: 4.12, 9.1-9.13, 10.1-10.14_

  - [~] 7.6 별자리 활성 참조와 순서 무결성 속성 테스트 작성
    - **Property 15: 별자리 활성 참조와 순서 무결성**
    - active ID 교집합, line/list gate, hard/soft delete 및 restore 순서에서 참조와 상대 순서를 검증한다.
    - **Validates: Requirements 10.1, 10.6, 10.9-10.14**

- [~] 8. Checkpoint - UI와 핵심 Scene 연결 검증
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. 파티클, Blackhole, 보상 오브젝트 및 후처리 구현
  - [~] 9.1 ParticleManager와 배경 유성 scheduler 구현
    - 등록 불꽃놀이, Rating 5 유성우, hard delete 충돌, soft delete 나선 및 milestone/achievement 완료 event effect를 구현한다.
    - effect별 허용 수량·지속시간, visibility-aware 배경 유성 간격, 동시 1개 제한과 만료 cleanup registry를 구현한다.
    - dispose 실패 즉시 재시도와 반복 실패 quarantine 진단을 구현한다.
    - _Requirements: 2.17, 2.18, 4.10, 11.1-11.10, 12.5_

  - [~] 9.2 파티클 사양과 수명주기 속성 테스트 작성
    - **Property 17: 파티클 사양과 수명주기**
    - 완료 event와 seed별 입자/Trail 수, 지속시간, registry 제거와 참조 수 기반 dispose를 검증한다.
    - **Validates: Requirements 2.17, 2.18, 11.1-11.5, 13.7, 13.8**

  - [~] 9.3 배경 유성 scheduler 안전성 속성 테스트 작성
    - **Property 18: 배경 유성 scheduler 안전성**
    - seed와 visibility 전이 순서에서 생성 간격·수명·동시성 및 재개 지연을 검증한다.
    - **Validates: Requirements 11.6, 11.7, 11.8, 11.9**

  - [~] 9.4 Blackhole renderer와 Soft Delete/Restore 상호작용 연결
    - 고정 위치 회전 원반, 제한된 광 왜곡, drag/drop hit testing 및 영향 확인 후 soft delete를 구현한다.
    - Blackhole 클릭 archive UI, restore, 성공 시 정확한 effect와 실패 시 effect 억제를 연결한다.
    - _Requirements: 10.10-10.13, 12.1-12.14_

  - [~] 9.5 50편 행성, 100편 보상 은하 및 Achievement 알림 렌더링 구현
    - rewardId별 행성/은하를 최대 하나 렌더링하고 복원 시 중복 생성·해금 알림을 억제한다.
    - HUD/AchievementPanel의 진행률과 최초 해금 toast를 completion event에 연결한다.
    - _Requirements: 5.7-5.10, 16.1-16.14, 17.3-17.13_

  - [~] 9.6 Selective Bloom과 공유 Three.js resource registry 구현
    - Star와 active Constellation line만 Bloom selection에 포함하고 대상이 없으면 pass를 unmount한다.
    - geometry/material/texture 참조 수를 추적해 마지막 참조 제거 시에만 dispose한다.
    - _Requirements: 13.6-13.9_

  - [~] 9.7 Selective Bloom 대상 집합 속성 테스트 작성
    - **Property 20: Selective Bloom 대상 집합**
    - 임의 Scene view model에서 정확한 대상 합집합, 비대상 누출 부재 및 빈 집합 비활성을 검증한다.
    - **Validates: Requirements 13.6, 13.9**

- [ ] 10. 성능 저하와 반응형·접근성 구현
  - [~] 10.1 5초 FPS degradation controller 구현
    - requestAnimationFrame 표본으로 5초 평균을 계산하고 30fps 미만마다 배경 감소, 최소 파티클, Bloom 품질 감소를 한 단계씩 적용한다.
    - quality level을 세션 runtime 상태로 유지하고 자동 상승이나 단계 건너뛰기를 차단한다.
    - _Requirements: 13.2-13.5_

  - [~] 10.2 렌더 모드와 성능 저하 순서 속성 테스트 작성
    - **Property 19: 렌더 모드와 성능 저하 순서**
    - 임의 active count와 연속 FPS window에서 50/51 경계와 단방향 단계 순서를 검증한다.
    - **Validates: Requirements 13.1, 13.3, 13.4, 13.5**

  - [~] 10.3 반응형 ArchiveShell과 Card viewport 배치 구현
    - 768px 이상에서 Canvas 중앙 영역과 HUD/Filter/ListView 비겹침, 미만에서 닫힌 drawer와 세로 overlay를 구현한다.
    - breakpoint를 CSS/layout 전환으로 처리해 Store/선택/draft를 재생성하지 않고 mobile touch OrbitControls를 구성한다.
    - Card를 8px 여백으로 clamp하고 높이 초과 시 내부 스크롤을 제공한다.
    - _Requirements: 5.6, 14.1-14.9_

  - [~] 10.4 반응형 전환 상태 보존 속성 테스트 작성
    - **Property 21: 반응형 전환의 상태 보존**
    - 양방향 breakpoint 전환과 실패 주입에서 persisted/runtime 선택 상태의 깊은 동등성과 부분 commit 차단을 검증한다.
    - **Validates: Requirements 14.8, 14.9**

  - [~] 10.5 Card viewport containment 속성 테스트 작성
    - **Property 22: Card viewport containment**
    - 임의 viewport/Card/anchor 크기에서 8px 경계와 overflow scroll 활성화를 검증한다.
    - **Validates: Requirements 14.5, 14.6**

  - [~] 10.6 전체 키보드·스크린 리더·reduced motion 경로 구현
    - 모든 Canvas 핵심 동작의 DOM 대체 경로, accessible name, focus order/trap/restore, live region과 Canvas 대체 설명을 완성한다.
    - 장르·Rating을 텍스트/아이콘과 함께 표현하고 WCAG AA fallback, `prefers-reduced-motion` 정적 동작 및 ErrorBoundary DOM 기능 유지를 구현한다.
    - _Requirements: 2.13-2.15, 4.5-4.13, 6.9, 7.9, 10.8, 12.6-12.8, 14.1-14.9_

- [ ] 11. 통합, 시각, 접근성 및 성능 자동 검증 완성
  - [~] 11.1 Zustand와 persistence 원자성 통합 테스트 작성
    - bootstrap 선행 load/최초 실행 gate, add/hard delete/soft delete/restore/manual·auto constellation의 실제 Store + fake localStorage 흐름을 검증한다.
    - 1초 autosave, 사용자 실패별 toast, autosave silent diagnostics 및 Store 변경 다음 렌더의 HUD/List/Scene 동기화를 검증한다.
    - _Requirements: 1.9, 1.10, 2.15, 4.14, 5.5, 8.10-8.18, 9.14-9.18, 12.2-12.14_

  - [~] 11.2 Scene 상호작용과 resource lifecycle 통합 테스트 작성
    - visibility pause/resume, camera·hover timing, 50↔51 selection/raycast 안정성, particle cleanup retry와 Bloom pass 제거를 검증한다.
    - Canvas ErrorBoundary 발생 후 DOM 읽기·삭제·복원 경로가 유지되는지 검증한다.
    - _Requirements: 1.5-1.7, 3.2-3.10, 4.1, 10.2-10.8, 11.5, 11.10, 13.1, 13.6-13.9_

  - [~] 11.3 8개 Galaxy와 후처리 시각 회귀 테스트 작성
    - 고정 seed 1920×1080 offscreen snapshot으로 shape metric, Primary Color Area 50%, Nebula 범위와 Bloom leakage를 측정한다.
    - 장르 fallback도 주 색상과 구별 가능한 shape signature를 유지하는지 검증한다.
    - _Requirements: 1.4, 13.6, 15.1-15.12_

  - [~] 11.4 반응형 및 접근성 브라우저 테스트 작성
    - Playwright 767px, 768px, tablet/desktop matrix에서 Central 50 Area 비겹침, drawer, touch 설정, Card 여백/scroll과 상태 보존을 검증한다.
    - axe 기반 접근성 검사와 키보드만으로 등록·선택·필터·삭제·복원·별자리 탐색 경로를 검증한다.
    - _Requirements: 4.2-4.13, 5.6, 6.9, 7.6, 10.7-10.8, 12.6-12.8, 14.1-14.9_

  - [~] 11.5 지정 환경 성능 및 WebGL resource benchmark 작성
    - Active Work 200개와 OrbitControls 활성 상태에서 5초 평균 30fps 기준과 각 degradation 후속 5초 창을 자동 계측한다.
    - mount/unmount 전후 geometry/material/texture, RAF와 timer 수가 baseline으로 복귀하는지 instrumentation으로 검증한다.
    - _Requirements: 11.5, 11.10, 13.2-13.8_

- [~] 12. Final checkpoint - 전체 검증 완료
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*`가 표시된 테스트 하위 작업은 빠른 MVP에서는 건너뛸 수 있는 선택 작업이다.
- 각 fast-check 작업은 설계의 Correctness Property 하나만 구현하고, 파일 상단에 Feature/Property 주석을 추가하며 `numRuns: 100` 이상을 사용한다.
- 테스트 이름은 관련 acceptance criterion에 맞춰 `R{requirement}.{criterion}` 접두사를 사용한다.
- 구현 작업은 TypeScript로 수행하고 모든 npm 의존성은 범위 표기 없이 정확한 버전과 lockfile로 고정한다.
- 실제 GPU 성능과 픽셀 metric 검증은 지정 환경의 별도 자동화 job으로 실행하되 결과는 전체 검증에 포함한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.6"] },
    { "id": 4, "tasks": ["2.7", "2.8", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.6", "3.9"] },
    { "id": 6, "tasks": ["3.3", "3.4", "3.5", "3.7", "3.8", "3.10", "3.11", "3.12"] },
    { "id": 7, "tasks": ["5.1", "6.1", "6.3"] },
    { "id": 8, "tasks": ["5.2", "5.3", "5.4", "6.2", "6.4", "6.5"] },
    { "id": 9, "tasks": ["5.5", "5.6", "6.6", "7.1"] },
    { "id": 10, "tasks": ["5.7", "5.8", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 11, "tasks": ["7.6", "9.1", "9.4", "9.5", "9.6"] },
    { "id": 12, "tasks": ["9.2", "9.3", "9.7", "10.1", "10.3"] },
    { "id": 13, "tasks": ["10.2", "10.4", "10.5", "10.6"] },
    { "id": 14, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5"] }
  ]
}
```
