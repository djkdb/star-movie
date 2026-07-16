# 요구사항 문서

## 개요

이 기능은 우주-영화 아카이브 앱(React + react-three-fiber)에서 서로 관련된 두 가지 문제를 해결합니다.

1. **자연스러운 별 표류(Star Drift):** 현재 별은 제자리에서 회전하고 Y축으로만 약하게 진동(진폭 0.1, 주기 3초)하여 위치가 고정된 것처럼 부자연스럽게 보입니다. 사용자는 별들이 아주 천천히, 자유롭고 자연스럽게 떠다니기를 원합니다.
2. **선택 해제 시 자유 시점 복귀(Camera Return):** 별을 클릭하면 카메라가 해당 별로 초점을 이동하지만, 작품 카드에서 "닫기"를 눌러도(또는 ESC/외부 클릭으로 선택을 해제해도) 카메라가 계속 그 별에 고정되어 자유 시점으로 돌아오지 않습니다. 사용자는 선택을 해제하면 카메라가 자유 시점으로 복귀하기를 원합니다.

이 문서는 두 문제의 관찰 가능한 동작을 정의하며, 구현 방법(어떻게)이 아니라 시스템이 무엇을 해야 하는지에 집중합니다.

## 용어집 (Glossary)

- **Star_Drift_System (별 표류 시스템):** 각 별의 프레임별 렌더링 위치와 회전을 계산하는 시스템. 현재 `sampleStarMotion`(개별 렌더러, 활성 별 50개 이하)과 `sampleStarInstanceTransform`(인스턴스 렌더러, 51개 이상) 두 경로로 구현되어 있음.
- **Camera_Return_System (카메라 복귀 시스템):** 별/별자리 초점 이동 및 선택 해제 시 카메라 자세를 제어하는 시스템(`CameraRig`, `cameraMath`, `pendingCameraRequest` 포함).
- **Base_Position (기준 위치):** 결정적 배치(`deterministicPlacement.ts`)로 정해져 도메인 모델 `star.position`에 저장된, 애니메이션 이전의 원본 좌표.
- **Rendered_Position (렌더링 위치):** 표류/진동 오프셋이 적용되어 화면에 실제로 그려지는 별의 위치.
- **Drift_Offset (표류 오프셋):** Base_Position을 기준으로 매 프레임 적용되는 위치 변위 벡터.
- **Constellation_Line (별자리 선):** 별자리로 묶인 별들을 잇는 선(`ConstellationRenderer`).
- **Camera_Focus (카메라 초점):** 특정 별/별자리를 향해 카메라 위치와 OrbitControls 타깃을 이동하는 동작(`calculateStarFocusPose` 등).
- **Free_Viewpoint (자유 시점):** 특정 별에 고정되지 않아 사용자가 자유롭게 궤도/이동/확대할 수 있는 카메라 상태. 본 기능에서 자유 시점 복귀는 별 초점을 시작하기 직전에 캡처한 Pre_Focus_Pose 를 복원하는 것으로 정의한다(Default_Pose 로의 초기화가 아님).
- **Default_Pose (기본 자세):** 카메라 위치 `[0, 0, 80]`, OrbitControls 타깃 원점 `(0, 0, 0)`인 초기 자세.
- **Pre_Focus_Pose (초점 이전 자세):** 별을 선택하여 초점을 이동하기 직전에 관측된 카메라 위치와 타깃.
- **Deselection (선택 해제):** `runtime.selectedStarId`를 `null`이 아닌 값에서 `null`로 전환하는 모든 동작(닫기 버튼, ESC, 카드 외부 클릭, 선택된 별 삭제, 그 외 진입점에서의 해제 등). 다른 별 선택은 값이 다른 non-null 로 바뀌므로 Deselection 에 포함하지 않는다.
- **Reduced_Motion (모션 축소):** 사용자의 `prefers-reduced-motion` 설정이 활성인 상태(`usePrefersReducedMotion`).
- **Visibility_Clock (가시성 시계):** 화면이 보이는 동안만 경과 시간이 누적되는 시계(`useVisibleElapsedSeconds`).

## 요구사항

### 요구사항 1: 자연스럽고 느린 별 표류

**User Story:** 아카이브를 감상하는 사용자로서, 별들이 고정되지 않고 아주 천천히 자유롭게 떠다니기를 원한다. 그래야 장면이 살아 있는 우주처럼 자연스럽게 느껴진다.

#### Acceptance Criteria

1. WHILE Reduced_Motion 이 비활성이고 Visibility_Clock 이 진행 중, THE Star_Drift_System SHALL 각 별의 Rendered_Position 을 Base_Position 을 중심으로 시간에 따라 연속적으로 변화하는 경로를 따라 이동시킨다.
2. THE Star_Drift_System SHALL 각 별의 Drift_Offset 크기를 Base_Position 으로부터 0.6 유닛 이내로 제한한다.
3. THE Star_Drift_System SHALL 각 별의 순간 표류 속도를 0.15 유닛/초 이하로 유지한다.
4. THE Star_Drift_System SHALL 서로 다른 별이 서로 다른 위상으로 표류하도록 각 별의 Drift_Offset 을 해당 별의 식별자에서 결정적으로 파생한다.
5. WHEN Visibility_Clock 의 경과 시간이 임의의 두 인접 프레임 사이에서 증가할 때, THE Star_Drift_System SHALL Rendered_Position 을 불연속 도약 없이 연속적으로 변화시킨다.
6. THE Star_Drift_System SHALL 개별 렌더러(활성 별 50개 이하)와 인스턴스 렌더러(51개 이상) 모두에서 동일한 표류 규칙을 적용한다.
7. WHILE Reduced_Motion 이 활성, THE Star_Drift_System SHALL 각 별을 Base_Position 에 정지시켜 표류를 적용하지 않는다.
8. THE Star_Drift_System SHALL 표류 위상을 Visibility_Clock 에서 파생하여, 화면이 숨겨진 구간 동안에는 위상이 진행되지 않도록 한다.
9. THE Star_Drift_System SHALL 각 별의 자전을 기존과 동일한 각속도 π/6 rad/s 로 유지한다.
10. THE Star_Drift_System SHALL 기존의 Y축 단일 진동(진폭 0.1 유닛, 주기 3초)을 제거하고 요구사항 1.1~1.8 의 3축 Drift_Offset 으로 대체한다.

### 요구사항 2: 표류와 별자리 선·카메라 초점의 시각적 일관성

**User Story:** 사용자로서, 별이 떠다니더라도 별자리 선과 카메라 초점이 별의 실제 위치와 어긋나 보이지 않기를 원한다. 그래야 표류가 시각적 오류처럼 느껴지지 않는다.

#### Acceptance Criteria

1. WHILE 별이 표류 중, THE Star_Drift_System SHALL 해당 별의 Constellation_Line 끝점을 그 별의 Rendered_Position 과 일치시킨다.
2. WHEN 사용자가 표류 중인 별을 선택할 때, THE Camera_Return_System SHALL Camera_Focus 타깃을 선택 시점의 별 위치와 일치시킨다.
3. THE Star_Drift_System SHALL 임의의 별에 대해 Rendered_Position 과 별자리 선 끝점 사이의 시각적 어긋남이 발생하지 않도록 동일한 위치 값을 사용한다.

### 요구사항 3: 선택 해제 시 자유 시점 복귀

**User Story:** 별을 살펴본 사용자로서, 카드를 닫거나 선택을 해제하면 카메라가 별을 선택하기 직전에 보고 있던 시점으로 돌아오기를 원한다. 그래야 다시 아카이브 전체를 자유롭게 둘러볼 수 있다.

#### Acceptance Criteria

1. THE Camera_Return_System SHALL Free_Viewpoint 복귀를 별 Camera_Focus 를 적용하기 직전에 캡처한 Pre_Focus_Pose 로 카메라 위치와 OrbitControls 타깃을 복원하는 동작으로 정의한다.
2. WHEN 사용자가 별을 선택하여 별 Camera_Focus 가 시작될 때, THE Camera_Return_System SHALL Camera_Focus 를 적용하기 직전에 관측된 카메라 위치와 OrbitControls 타깃을 Pre_Focus_Pose 로 저장한다.
3. WHEN 별 Camera_Focus 가 활성인 상태에서 `runtime.selectedStarId` 가 `null` 이 아닌 값에서 `null` 로 전환될 때, THE Camera_Return_System SHALL 진입 경로와 무관하게 카메라를 Free_Viewpoint 로 복귀시킨다.
4. THE Camera_Return_System SHALL 요구사항 3.3 의 복귀를 작품 카드 "닫기" 버튼, ESC 키, 카드 외부 클릭, 선택된 별의 소프트 삭제(블랙홀 이동), 선택된 별의 하드 삭제(영구 삭제), 그리고 `ListView`·`ArchiveDomNavigation`·`ArchiveOverview` 등 다른 진입점에서 발생한 Deselection 에 대해 모두 동일하게 적용한다.
5. WHEN 현재 별에 초점이 맞춰진 상태에서 사용자가 다른 별을 선택할 때, THE Camera_Return_System SHALL Free_Viewpoint 로 복귀하지 않고 새로 선택된 별로 Camera_Focus 를 이동한다.
6. WHEN Free_Viewpoint 복귀가 완료될 때, THE Camera_Return_System SHALL `runtime.selectedStarId` 를 `null` 로, `runtime.pendingCameraRequest` 를 `null` 로 만든다.

### 요구사항 4: 복귀 전환의 부드러움과 모션 축소 처리

**User Story:** 사용자로서, 자유 시점 복귀가 기존 초점 이동과 동일하게 부드럽게 이루어지고, 모션 축소 설정을 존중하기를 원한다.

#### Acceptance Criteria

1. WHILE Reduced_Motion 이 비활성, THE Camera_Return_System SHALL 카메라를 현재 자세에서 Pre_Focus_Pose 로 기존 초점 이동과 동일한 지속 시간(0.7초)과 동일한 큐빅 이즈-인-아웃 곡선으로 애니메이션한다.
2. WHILE Reduced_Motion 이 활성, THE Camera_Return_System SHALL 보간 없이 Pre_Focus_Pose 를 즉시 적용한다.
3. IF 초점 이동 트윈이 진행 중인 상태에서 Free_Viewpoint 복귀가 요청되면, THEN THE Camera_Return_System SHALL 진행 중인 트윈을 현재 자세에서 시작하여 Pre_Focus_Pose 로 향하는 복귀 트윈으로 교체한다.
4. WHEN Free_Viewpoint 복귀가 완료될 때, THE Camera_Return_System SHALL OrbitControls 를 Pre_Focus_Pose 를 기준으로 자유로운 궤도·이동·확대가 가능한 상태로 남긴다.

## 확정된 결정 사항

아래 항목은 검토를 거쳐 확정되었으며, 위 요구사항에 반영되어 있습니다.

1. **표류 범위와 속도 (요구사항 1.2, 1.3):** 기본값인 "Base_Position 기준 0.6 유닛 이내, 0.15 유닛/초 이하"의 미세하고 완만한 표류를 유지한다.
2. **자전·진동 처리 (요구사항 1.9, 1.10):** 기존 자전(π/6 rad/s)은 그대로 유지하고, 기존 Y축 단일 진동(진폭 0.1, 주기 3초)은 3축 Drift_Offset 으로 대체한다.
3. **별자리 선·카메라 초점 (요구사항 2):** Constellation_Line 끝점은 Rendered_Position(표류 적용 위치)을 따라가고, Camera_Focus 타깃은 선택 시점의 별 위치로 고정한다.
4. **자유 시점의 정의 (요구사항 3, 4):** Free_Viewpoint 복귀는 Default_Pose 로의 초기화가 아니라, 별 초점을 시작하기 직전에 캡처한 Pre_Focus_Pose(그 순간의 카메라 위치와 OrbitControls 타깃)를 복원하는 것으로 정의한다. 이를 위해 별 초점이 시작될 때 시스템이 Pre_Focus_Pose 를 저장해야 한다.
5. **복귀를 트리거하는 해제 경로 (요구사항 3):** Free_Viewpoint 복귀는 진입 경로와 무관하게 적용된다. 즉, 별 Camera_Focus 가 활성인 동안 `runtime.selectedStarId` 가 `null` 이 아닌 값에서 `null` 로 전환되는 모든 경우(닫기 버튼, ESC, 외부 클릭, 소프트/하드 삭제, 그리고 `ListView`·`ArchiveDomNavigation`·`ArchiveOverview` 등 다른 진입점에서의 해제)에 복귀가 발생한다. 단, 다른 별을 선택하는 경우는 복귀가 아니라 새 별로의 초점 이동으로 처리한다.
