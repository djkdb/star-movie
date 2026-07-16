# 구현 계획: 자연스러운 별 표류 및 선택 해제 시 카메라 복귀

## 개요

이 계획은 설계 문서를 기반으로 두 기능(3축 별 표류, 선택 해제 시 자유 시점 복귀)을 점진적·테스트 주도 방식으로 구현하기 위한 것이다. 순수 모델/수학 함수와 그 테스트를 먼저 작성하고, 렌더러 배선, 카메라 상태/명령, 컴포넌트 배선 순으로 진행한 뒤 기존 테스트를 갱신하고 마지막에 전체 검증을 수행한다. 각 작업은 이전 작업 위에 점진적으로 쌓이며 최종적으로 모든 코드가 연결되도록 구성한다.

`*` 표시가 붙은 하위 작업은 선택적 테스트 작업이다.

## 작업 목록

- [ ] 1. 공유 표류 순수 함수 구현 (`src/scene/starVisualModel.ts`)
  - `STAR_DRIFT_AMPLITUDE`(0.34), `STAR_DRIFT_ANGULAR_FREQUENCIES`(x:0.21, y:0.24, z:0.27), `STAR_DRIFT_AXIS_PHASE_OFFSETS`(0, 2π/3, 4π/3) 상수 추가
  - `StarRenderTransform` 인터페이스(`position`, `rotationY`, `scale`) 추가
  - `sampleStarDriftOffset(elapsedVisibleSeconds, phaseSeed): Vec3` 를 설계의 사인 공식(축별 진폭·각속도·위상)으로 구현, 유한·비음수 입력 검증(`RangeError`) 포함
  - `sampleStarRenderTransform(star, elapsedVisibleSeconds, phaseSeed, hovered, reducedMotion): StarRenderTransform` 구현: `reducedMotion=true` 이면 오프셋 0·rotationY 0, 아니면 `star.position + sampleStarDriftOffset(...)` 및 `rotationY = elapsed × (π/6)`
  - 기존 `STAR_OSCILLATION_*` 상수, `sampleStarMotion`, `StarMotionSample` 제거
  - `STAR_ROTATION_RADIANS_PER_SECOND`(π/6) 유지
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 1.9, 1.10_

- [ ]* 1.1 `sampleStarDriftOffset` 크기 경계 속성 테스트 작성
  - **Property 1: 표류 오프셋 크기 경계** — 임의의 유한·비음수 elapsed 와 임의의 phaseSeed 에 대해 오프셋 크기 ≤ 0.6, 유한
  - fast-check, 최소 100회 반복, 주석 태그: `Feature: natural-star-drift-and-camera-return, Property 1`
  - _Requirements: 1.1, 1.2_

- [ ]* 1.2 `sampleStarDriftOffset` 속도·연속성 속성 테스트 작성
  - **Property 2: 표류 속도·연속성 경계** — 임의의 elapsed, seed, 작은 Δ 에 대해 `‖offset(t+Δ) − offset(t)‖ ≤ 0.15·Δ`(수치 허용오차 포함)
  - fast-check, 최소 100회 반복, 주석 태그: `Feature: natural-star-drift-and-camera-return, Property 2`
  - _Requirements: 1.3, 1.5_

- [ ]* 1.3 표류 결정성·자전 보존 속성 테스트 작성
  - **Property 3: 식별자 기반 결정성** — 동일 입력이면 동일 오프셋, 서로 다른 id 는 서로 다른 위상 시드 (`getStarInstancePhase` 와 함께)
  - **Property 6: 자전 각속도 보존** — `rotationY == elapsed × (π/6)`
  - **Property 5: 모션 축소 시 기준 위치 고정** — `reducedMotion=true` 이면 렌더링 위치가 `star.position` 과 정확히 일치
  - fast-check, 각 속성 단일 테스트·최소 100회 반복, 주석 태그: Property 3/5/6
  - _Requirements: 1.4, 1.6, 1.7, 1.8, 1.9_

- [ ]* 1.4 표류 상수·API 부재 단위 테스트 작성
  - 표류 상수의 구체 값, 특정 경과 시점의 3축 비영 오프셋, 옛 오실레이션 API(`STAR_OSCILLATION_*`, `sampleStarMotion`) 부재 확인
  - _Requirements: 1.10_

- [ ] 2. 렌더러 모델을 공유 함수 기반으로 재작성 (`src/scene/starRendererModel.ts`)
  - `sampleStarInstanceTransform` 를 `sampleStarRenderTransform` 호출로 재작성(오실레이션 상수 import 제거, `reducedMotion` 인자 추가)
  - `updateInstancedStarMatrices` 에 `reducedMotion: boolean` 인자 추가 후 각 인스턴스에 전달
  - `getStarInstancePhase` 를 위상 시드로 계속 사용
  - _Requirements: 1.4, 1.6, 1.7_

- [ ]* 2.1 렌더러 간 통일된 표류 속성 테스트 작성
  - **Property 4: 렌더러 간 통일된 표류** — 임의의 별·elapsed 에 대해 개별 경로와 인스턴스 경로의 렌더링 위치·회전이 동일
  - fast-check, 최소 100회 반복, 주석 태그: `Feature: natural-star-drift-and-camera-return, Property 4`
  - _Requirements: 1.6_

- [ ] 3. 별자리 선 끝점 표류 동기화 함수 구현 (`src/scene/constellationRendererModel.ts`)
  - `sampleConstellationLinePoints(activeStars, elapsedVisibleSeconds, reducedMotion): LinePoint[]` 추가: 각 별에 대해 `base(s.position) + sampleStarDriftOffset(elapsed, getStarInstancePhase(s.id))`, `reducedMotion=true` 이면 base 그대로
  - _Requirements: 2.1, 2.3_

- [ ]* 3.1 별자리 선 끝점 일치 속성 테스트 작성
  - **Property 7: 별자리 선 끝점과 렌더링 위치 일치** — 임의의 별 집합·elapsed 에 대해 각 끝점이 해당 별의 렌더링 위치(Base + 동일 표류 오프셋)와 정확히 일치
  - fast-check, 최소 100회 반복, 주석 태그: `Feature: natural-star-drift-and-camera-return, Property 7`
  - _Requirements: 2.1, 2.3_

- [ ] 4. 개별 렌더러 표류 적용 (`src/scene/IndividualStarMesh.tsx`)
  - `sampleStarMotion` 대신 `sampleStarRenderTransform(star, elapsed, getStarInstancePhase(star.id), hovered, reducedMotion)` 사용
  - `useFrame` 에서 3축 위치(`group.position.set(...)`)와 `group.rotation.y` 모두 갱신
  - `reducedMotion` 을 prop 으로 수신
  - _Requirements: 1.1, 1.6, 1.7, 1.9_

- [ ] 5. 렌더러 배선 (`src/scene/StarRenderer.tsx`, `src/scene/InstancedStarField.tsx`)
  - `StarRenderer` 에 `reducedMotion: boolean` prop 추가 후 `IndividualStarMesh` / `InstancedStarField` 로 전달
  - `SpaceScene` 이 보유한 `reducedMotion` 값을 `StarRenderer` 로 전달
  - `InstancedStarField` 의 `updateInstancedStarMatrices(..., reducedMotion)` 및 라벨 위치 계산(`sampleStarRenderTransform`)에 `reducedMotion` 반영
  - _Requirements: 1.6, 1.7_

- [ ] 6. 별자리 렌더러 프레임 갱신 (`src/scene/ConstellationRenderer.tsx`)
  - `ActiveConstellationLine` 에서 drei `<Line>` ref(`Line2`) 확보, `useFrame` 에서 `sampleConstellationLinePoints` 결과로 `line.geometry.setPositions(flatPoints)` 갱신(글로우/본선 모두)
  - 라벨 위치를 갱신된 끝점으로 `calculateConstellationLabelPosition` 재계산
  - `useVisibleElapsedSeconds` 사용, `reducedMotion` 을 prop 으로 수신, 초기 `points` 는 `createConstellationLineViewModels`(base) 로 생성
  - _Requirements: 2.1, 2.3_

- [ ]* 6.1 렌더링 계층 반영 예시 테스트 작성
  - three 객체를 목/스텁으로 두고 공유 샘플러가 반환한 좌표가 인스턴스 행렬·선 지오메트리에 그대로 반영되는지 1–2개 예시로 확인
  - _Requirements: 2.1, 2.3, 1.6_

- [ ] 7. 체크포인트 - 표류 관련 테스트 통과 확인
  - 모든 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

- [ ] 8. 카메라 상태 모델 변경 (`src/domain/models.ts`, `src/domain/defaultState.ts`)
  - `CameraPose` 인터페이스를 `models.ts` 로 이동/정의하고 `src/scene/cameraMath.ts` 에서 재-export(기존 import 경로 보존)
  - `CameraRequest` 에 `{ type: 'free'; pose: CameraPose }` 변형 추가
  - `RuntimeStore` 에 `preFocusPose: CameraPose | null` 필드 추가
  - `createDefaultRuntimeStore` 에 `preFocusPose: null` 초기값 추가
  - _Requirements: 3.1, 3.2, 3.6_

- [ ] 9. 카메라 복귀 스토어 명령 구현 (`src/store/archiveStore.ts`)
  - `capturePreFocusPose(pose)`: `runtime.preFocusPose === null` 일 때만 저장(capture-once)
  - `requestCameraReturn()`: `preFocusPose` 가 있으면 `pendingCameraRequest = { type:'free', pose: preFocusPose }` 설정, 없으면 무동작
  - `completeCameraReturn()`: `pendingCameraRequest=null`, `preFocusPose=null`, `selectedStarId=null` 설정
  - `clearCameraRequest` 기존 시그니처 유지
  - _Requirements: 3.2, 3.3, 3.5, 3.6_

- [ ]* 9.1 Pre_Focus_Pose 캡처-원스 속성 테스트 작성
  - **Property 9: Pre_Focus_Pose 캡처-원스** — 첫 진입 시 저장된 `preFocusPose` 가 진입 직전 포즈와 동일하고, 이미 저장된 상태에서 재호출해도 값 불변
  - fast-check, 최소 100회 반복, 주석 태그: `Feature: natural-star-drift-and-camera-return, Property 9`
  - _Requirements: 3.2, 3.5_

- [ ]* 9.2 카메라 복귀 명령 단위 테스트 작성
  - `requestCameraReturn`(preFocusPose 부재 시 무동작 포함), `completeCameraReturn` 의 상태 정리(3.6) 검증
  - _Requirements: 3.6_

- [ ] 10. CameraRig 확장 (`src/scene/CameraRig.tsx`)
  - `CameraRigProps` 에 `selectedStarId: string | null`, `onCapturePreFocusPose?: (pose) => void` 추가
  - `request.type === 'free'`: `resolveCameraFocusRequest` 를 거치지 않고 `destination = request.pose` 사용, `reducedMotion` 이면 즉시 적용 후 완료, 아니면 `tweenController.replace(currentPose, destination)`(0.7초·cubicEaseInOut)
  - `request.type === 'star'`: `currentPose` 읽은 직후 `selectedStarId !== null` 이면 `onCapturePreFocusPose?.(currentPose)` 호출(선택 아닌 초점에서는 캡처 안 함)
  - `constellation` 흐름은 기존 유지
  - _Requirements: 3.2, 4.1, 4.2, 4.3, 4.4_

- [ ]* 10.1 CameraRig free 요청 단위 테스트 작성
  - reducedMotion 즉시 적용(4.2), 진행 중 트윈 교체(4.3), 기본 지속시간·이즈 곡선(4.1) 검증
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 11. 씬 배선 - 복귀 트리거 및 완료 라우팅 (`src/scene/SpaceCanvas.tsx`)
  - `SpaceCanvas` 최상위에서 `selectedStarId` 이전 값을 `useRef` 로 추적, `useEffect` 로 non-null→null 전이 감지 시 `commands.requestCameraReturn()` 호출(진입 경로 무관)
  - `SpaceScene` 의 완료 콜백을 요청 타입에 따라 분기: `free` → `completeCameraReturn`, 그 외 → `clearCameraRequest`
  - `CameraRig` 에 `onRequestCompleted`/`onRequestRejected`, `onCapturePreFocusPose = commands.capturePreFocusPose`, `selectedStarId` prop 연결
  - `SpaceScene` → `StarRenderer` 로 `reducedMotion` 전달
  - 별 초점 타깃 고정을 위해 `selectStar`·`resolveCameraFocusRequest` 는 변경하지 않음
  - _Requirements: 3.3, 3.4, 3.5, 3.6, 2.2_

- [ ]* 11.1 초점 타깃 고정 속성 테스트 작성
  - **Property 8: 초점 타깃은 선택 시점 위치로 고정** — `resolveCameraFocusRequest` 로 해석된 별 초점 타깃이 요청 시점의 `star.position` 과 동일
  - fast-check, 최소 100회 반복, 주석 태그: `Feature: natural-star-drift-and-camera-return, Property 8`
  - _Requirements: 2.2_

- [ ]* 11.2 해제 경로별 복귀 트리거 컴포넌트 테스트 작성
  - 닫기/ESC/외부 클릭/soft·hardDelete/DOM 탐색 각 경로에서 `pendingCameraRequest` 가 `{ type:'free', pose: preFocusPose }` 로 설정되는지(3.3/3.4)
  - 다른 별 선택 시 복귀 대신 `star` 요청 유지·`preFocusPose` 불변(3.5)
  - 완료 후 `pendingCameraRequest`/`preFocusPose`/`selectedStarId` 정리(3.6/4.4)
  - _Requirements: 3.3, 3.4, 3.5, 3.6, 4.4_

- [ ] 12. 기존 테스트 갱신 - 표류 API 교체
  - `src/scene/starVisualModel.test.ts`: 오실레이션 상수/`sampleStarMotion` 단언 제거, 표류 상수·경계·`sampleStarRenderTransform` 로 교체
  - `tests/pbt/rating-visual-star-motion.pbt.test.ts`: `sampleStarMotion` 의 ±0.1/3초 오실레이션 속성을 표류 경계(Property 1·2)로 대체
  - `src/scene/starRendererModel.test.ts`: `sampleStarInstanceTransform` 예상 좌표를 새 표류·`reducedMotion` 시그니처로 갱신, `updateInstancedStarMatrices` 호출부에 `reducedMotion` 반영
  - _Requirements: 1.6, 1.7, 1.10_

- [ ] 13. 기존 테스트 갱신 - 씬/카메라 통합
  - `src/scene/SceneInteractionLifecycle.component.test.tsx`: `sampleStarMotion`/`sampleStarInstanceTransform` import 및 위치 단언을 새 API로 갱신
  - `SpaceCanvas` 전체를 렌더해 선택→해제 시나리오를 검증하는 기존 단언이 있다면, 해제 후 `pendingCameraRequest` 가 `{ type:'free' }` 로 채워지는 새 동작 기준으로 갱신
  - `cameraMath.test.ts` 는 `CameraPose` 재-export 로 동작하므로 필요 시에만 조정
  - _Requirements: 3.3, 3.6, 1.6_

- [ ] 14. 최종 체크포인트 - 전체 검증
  - `npm run validate` 실행(타입체크 + 단위 + 컴포넌트 + PBT), 실패 시 수정
  - 모든 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

## 참고

- `*` 표시가 붙은 하위 작업은 선택적 테스트 작업으로, 빠른 MVP 를 위해 건너뛸 수 있다.
- 각 작업은 추적성을 위해 특정 요구사항 번호를 참조한다.
- 속성 테스트는 fast-check 로 최소 100회 반복하며 설계의 Correctness Property 를 검증한다.
- 단위·컴포넌트 테스트는 구체 예시·경계·해제 경로 배선을 검증한다.
