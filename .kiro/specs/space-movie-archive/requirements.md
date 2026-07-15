# Requirements Document

## Introduction

"나만의 밤하늘"은 사용자가 시청한 우주·영화·드라마 작품을 인터랙티브 3D 공간에 기록하고 탐색하는 아카이브 애플리케이션입니다. 각 활성 작품은 장르별 은하 영역의 별로 표현되며, 별점·장르·감독·감상일·감상평을 관리할 수 있습니다. 별자리, 블랙홀 아카이브, 최초 작품 수 마일스톤 및 업적 상태를 포함한 모든 사용자 데이터는 localStorage에 JSON으로 영속화됩니다.

## Glossary

- **Archive_Application**: "나만의 밤하늘" 애플리케이션 전체
- **Scene**: React Three Fiber로 렌더링되는 3D 우주 공간
- **Star**: `stars` 컬렉션에 저장된 활성 작품을 나타내는 3D 구체 오브젝트
- **Active_Work**: `stars` 컬렉션에 존재하며 Hard_Delete 또는 Blackhole 이동되지 않은 작품
- **Background_Star**: 클릭할 수 없는 장식용 배경 별
- **Far_Background_Layer**: 카메라에서 상대적으로 멀리 보이며 기준 변위율을 갖는 Background_Star 레이어
- **Near_Background_Layer**: Far_Background_Layer 변위율의 1.5배로 이동하는 Background_Star 레이어
- **Nebula**: 반투명 스프라이트 또는 GLSL 셰이더로 표현되는 성운 배경
- **Genre**: SF, 로맨스, 스릴러, 드라마, 애니, 코미디, 액션, 기타 중 하나
- **Genre_Galaxy**: 한 Genre의 시각 테마와 Star 배치 영역을 결합한 3D 은하 영역. 기존의 "장르 클러스터"와 동일한 개념을 대체함
- **Galaxy_State**: Genre_Galaxy의 식별자, 장르, 중심 좌표, 배치 반경, 시각 테마, 해금 여부를 저장하는 데이터
- **Placement_Radius**: Galaxy_State에 저장되며 해당 Genre_Galaxy 중심에서 Star를 배치할 수 있는 최대 3차원 직선거리
- **Constellation**: 두 개 이상의 Star 식별자를 순서대로 참조하는 발광 라인 그룹
- **Active_Reference_Star**: Constellation의 `starIds`가 참조하고 현재 `stars` 컬렉션에 존재하는 Star
- **Active_Constellation_Line**: Active_Reference_Star를 2개 이상 연결하여 Scene에 표시되는 Constellation 선
- **Card**: Star 선택 시 표시되는 Glassmorphism 스타일 작품 정보 UI
- **HUD**: 총 활성 작품 수, 평균 별점, 최다 장르 및 마일스톤·업적 요약을 표시하는 통계 오버레이
- **Central_50_Area**: 뷰포트 너비의 25%부터 75%와 높이의 25%부터 75%가 교차하는 중앙 직사각형 영역
- **Achievement_Panel**: 업적 정의, 진행률, 잠금·해금 상태를 표시하는 UI
- **Filter**: Genre별 Star 및 Genre_Galaxy 강조 상태를 제어하는 UI
- **ListView**: 정렬과 검색을 지원하는 작품 목록 사이드바
- **Particle_Effect**: 등록, 삭제, 이동 또는 해금 이벤트에 재생되는 애니메이션
- **Blackhole**: Active_Work를 Soft_Delete 방식으로 보관하는 특수 3D 오브젝트
- **Blackhole_Archive**: Blackhole로 이동된 작품을 저장하는 `blackholeArchive` 컬렉션
- **Hard_Delete**: Card 삭제 동작으로 작품 레코드를 영구 제거하고 관련 Constellation 참조도 제거하는 처리
- **Soft_Delete**: 작품 레코드를 `stars`에서 `blackholeArchive`로 이동하여 복구 가능한 상태로 보존하는 처리
- **Store**: Zustand 기반 전역 상태 관리 모듈
- **Persistence**: 단일 localStorage 키에 Store 상태를 JSON으로 저장하고 복원하는 모듈
- **Rating**: 1부터 5까지의 정수형 별점
- **Director**: 작품 등록 시 사용자가 선택하거나 직접 입력하는 감독 이름
- **Normalized_Text**: 문자열 앞뒤 공백을 제거하고 대소문자를 구분하지 않도록 유니코드 소문자로 변환한 값
- **Normalized_Title**: 작품 제목에 Normalized_Text 변환을 적용한 값
- **Normalized_Director**: Director에 Normalized_Text 변환을 적용한 값
- **Unique_Work_Key**: Normalized_Title과 Normalized_Director를 `::`로 결합한 고유 작품 판정 키
- **Milestone**: Active_Work 총수가 50편 또는 100편 임계값을 아래에서 위로 최초 통과할 때 정확히 한 번 해금되고 작품 수가 감소해도 유지되는 보상
- **Milestone_Unlocks**: `milestoneUnlocks` 속성에 저장되는 50편 행성 보상과 100편 은하 보상의 해금 여부, 최초 해금 시각 및 보상 식별자 집합
- **Achievement**: 식별자, 이름, 설명, 고유 작품 판정 규칙, 목표값, 진행률, 잠금·해금 상태 및 최초 해금 시각을 갖는 성취 정의
- **Nolan_Master**: Unique_Work_Key 기준 Christopher Nolan 감독의 고유 작품 10편 등록 시 해금되는 "놀란 마스터" Achievement
- **Visible_Theme_Area**: Genre_Galaxy의 불투명도 0.1 이상인 픽셀이 차지하는 화면 투영 영역
- **Primary_Color_Area**: Visible_Theme_Area에서 해당 Genre_Galaxy 주 색상과 RGB 각 채널 차이가 32 이하인 픽셀 영역
- **Particle_Density**: Genre_Galaxy의 지정된 3차원 영역 안에 존재하는 테마 입자 수를 해당 영역의 부피로 나눈 값
- **Operation_Snapshot**: 사용자 동작 시작 직전의 `stars`, `constellations`, `blackholeArchive`, `galaxies`, `milestoneUnlocks` 및 `achievements` 전체 상태
- **Operation_Completion**: 사용자 동작의 Store 변경과 해당 변경의 Persistence 저장이 모두 성공한 상태
- **Performance_Test_Environment**: Intel Iris Xe 통합 GPU, CPU 4코어, 메모리 8GB, 1920×1080 뷰포트 및 devicePixelRatio 1을 사용하는 측정 환경

## Requirements

### Requirement 1: 3D 씬 초기화

**User Story:** 개발자로서, 앱을 열었을 때 몰입감 있는 우주 배경이 렌더링되기를 원합니다. 그래야 사용자가 아카이브 공간에 있다는 느낌을 받을 수 있습니다.

#### Acceptance Criteria

1. THE Scene SHALL 배경색 `#03040a`, 시야각 75의 PerspectiveCamera 및 OrbitControls를 사용하여 렌더링한다.
2. THE Scene SHALL Background_Star를 Far_Background_Layer와 Near_Background_Layer의 정확히 2개 레이어로 표시한다.
3. WHEN 카메라가 회전하면, THE Near_Background_Layer SHALL Far_Background_Layer가 같은 시간 동안 이동한 화면상 변위의 1.5배로 이동한다.
4. THE Scene SHALL 불투명도 0.1 이상 0.5 이하와 `#0b1030`부터 `#1a1550` 범위의 색상을 사용하는 Nebula를 1개 이상 3개 이하로 표시한다.
5. WHILE `document.visibilityState`가 `visible`인 동안, THE Background_Star SHALL 기본값 대비 ±30% 범위와 1초 이상 4초 이하의 독립 주기로 불투명도 또는 크기를 진동한다.
6. WHEN `document.visibilityState`가 `hidden`으로 변경되면, THE Background_Star SHALL 각 레이어의 현재 애니메이션 진행 위치를 보존하고 애니메이션 진행을 정지한다.
7. WHEN `document.visibilityState`가 `hidden`에서 `visible`로 변경되면, THE Background_Star SHALL 보존한 애니메이션 진행 위치부터 애니메이션을 재개한다.
8. THE OrbitControls SHALL 씬 원점으로부터 최대 줌아웃 거리를 1000 단위로 제한한다.
9. IF 저장 데이터가 없는 최초 실행이면, THEN THE Scene SHALL 메모리에 등록 콘텐츠가 존재하더라도 등록 Star와 Constellation 표시를 차단하고 Background_Star, Nebula 및 기본 Genre_Galaxy만 렌더링한다.
10. WHEN 사용자가 작품을 한 번 이상 등록한 이후 Archive_Application을 다시 실행하면, THE Persistence SHALL 저장된 Star와 Constellation을 세션 간 복원하고 Scene에 표시한다.

### Requirement 2: 작품 등록 및 감독 데이터

**User Story:** 사용자로서, 시청한 작품과 감독 정보를 입력하고 별로 등록하고 싶습니다. 그래야 작품을 관리하고 감독 기반 업적을 진행할 수 있습니다.

#### Acceptance Criteria

1. THE Archive_Application SHALL 제목, Genre, Rating, 감상평, 감상일 및 Director를 입력하는 작품 추가 폼을 제공한다.
2. THE 작품 추가 폼 SHALL 앞뒤 공백을 제거한 필수 제목을 1자 이상 200자 이하로 검증한다.
3. THE 작품 추가 폼 SHALL 필수 Genre를 정의된 8개 값 중 하나로 검증한다.
4. THE 작품 추가 폼 SHALL 필수 Rating을 1부터 5까지의 정수로 검증한다.
5. THE 작품 추가 폼 SHALL 선택 감상평을 100자 이하 문자열로 검증한다.
6. THE 작품 추가 폼 SHALL 필수 감상일을 `YYYY-MM-DD` 형식이며 달력에 존재하는 유효 날짜로 검증한다.
7. THE 작품 추가 폼 SHALL Director를 기존 감독 목록에서 선택하거나 직접 입력할 수 있게 한다.
8. THE 작품 추가 폼 SHALL 앞뒤 공백을 제거한 필수 Director를 1자 이상 200자 이하로 검증한다.
9. WHEN 사용자가 유효한 필수 필드와 Director를 제출하면, THE Store SHALL UUID, 제출 필드, Genre_Galaxy 내부의 의사 난수 3D 좌표 및 ISO 8601 `createdAt`을 가진 Star를 생성한다.
10. WHEN Store가 Star의 좌표를 생성하면, THE Store SHALL Genre_Galaxy 중심과 생성 좌표 사이의 3차원 직선거리가 해당 Placement_Radius 이하이면서 10단위 이하가 되게 한다.
11. WHEN Store가 Star를 생성하면, THE Scene SHALL 페이지 새로고침 없이 해당 Genre_Galaxy에 Star를 렌더링한다.
12. WHEN Store가 Star를 생성하면, THE 작품 추가 폼 SHALL 빈 초기 상태로 재설정된다.
13. IF 작품 추가 폼의 필드가 형식, 허용값 또는 길이 검증에 실패하면, THEN THE 작품 추가 폼 SHALL 실패한 각 필드에 검증 오류를 표시하고 제출을 차단한다.
14. IF 필수 필드가 비어 있거나 제목 또는 Director가 공백 문자만 포함하면, THEN THE 작품 추가 폼 SHALL 해당 필드 오류를 표시하고 제출을 차단한다.
15. IF Star 생성 또는 Persistence 저장이 실패하면, THEN THE Archive_Application SHALL 제출 시도 후 제출 당시의 폼 입력값과 제출 전 Store 상태를 유지하고 오류를 표시하며 Star 렌더링, 폼 초기화, 등록 Particle_Effect, Milestone 및 Achievement 갱신을 포함한 모든 등록 효과를 억제한다.
16. WHEN 사용자가 작품을 제출하면, THE Store SHALL 제목과 Director의 앞뒤 공백을 제거한 표시값과 각 표시값의 Normalized_Text를 저장한다.
17. WHEN Rating 5인 Star 생성과 Persistence 저장이 완료되면, THE Scene SHALL 유성우 Particle_Effect와 불꽃놀이 Particle_Effect를 재생한다.
18. WHEN Rating 1부터 4인 Star 생성과 Persistence 저장이 완료되면, THE Scene SHALL 새 Star 위치에서 불꽃놀이 Particle_Effect를 재생한다.
19. WHEN 작품 추가 폼의 모든 필드가 검증을 통과한 상태에서 사용자가 제출하면, THE 작품 추가 폼 SHALL Star 생성과 Persistence 저장을 시도한 후 발생하는 생성 또는 저장 실패를 Requirement 2.15에 따라 처리한다.

### Requirement 3: Star 시각 표현과 장르 은하 배치

**User Story:** 사용자로서, 작품의 별점과 장르를 3D 공간에서 시각적으로 구분하고 싶습니다. 그래야 선호 작품과 장르 영역을 한눈에 파악할 수 있습니다.

#### Acceptance Criteria

1. THE Star SHALL Rating 5에 반지름 1.4·Bloom 1.0·색상 `#fff8e0`, Rating 4에 1.1·0.75·`#ffe9b8`, Rating 3에 0.85·0.5·`#cfe0ff`, Rating 2에 0.6·0.25·`#9aa8d0`, Rating 1에 0.4·0.1·`#6a7290`을 적용한다.
2. WHILE `document.visibilityState`가 `visible`인 동안, THE Star SHALL 초당 30도로 자전한다.
3. WHILE `document.visibilityState`가 `visible`인 동안, THE Star SHALL 저장된 3D 좌표의 y축 값을 중심으로 최소 `-0.1`부터 최대 `+0.1`까지의 범위와 주기 3초로 수직 진동한다.
4. WHEN `document.visibilityState`가 `hidden`으로 변경되면, THE Star SHALL 현재 자전 및 수직 진동 진행 위치를 보존하고 애니메이션 진행을 정지한다.
5. WHEN `document.visibilityState`가 `hidden`에서 `visible`로 변경되면, THE Star SHALL 보존한 자전 및 수직 진동 진행 위치부터 애니메이션을 재개한다.
6. WHILE 포인터가 Star를 가리키지 않는 동안, THE Star SHALL 기본 scale을 1.0으로 유지한다.
7. WHEN 사용자가 Star를 가리키기 시작하면, THE Star SHALL scale을 1.5로 변경한다.
8. WHEN 사용자가 Star를 가리키기 시작하면, THE Scene SHALL 제목 라벨 표시를 즉시 시작하고 0.3초에 fade-in 애니메이션을 완료한다.
9. WHEN 포인터가 Star를 벗어나면, THE Star SHALL scale을 1.0으로 복원한다.
10. WHEN 포인터가 Star를 벗어나면, THE Scene SHALL 0.3초 이내에 제목 라벨을 숨긴다.
11. THE Scene SHALL 각 Star의 저장 좌표와 해당 Genre_Galaxy 중심 사이의 3차원 직선거리를 해당 Placement_Radius 이하이면서 10단위 이하로 유지한다.
12. THE Scene SHALL 서로 다른 Genre_Galaxy 중심 사이의 3차원 직선거리를 25단위 이상으로 유지한다.

### Requirement 4: 작품 카드와 Hard Delete

**User Story:** 사용자로서, 선택한 작품의 상세 정보를 확인하고 필요하면 영구 삭제하고 싶습니다. 그래야 아카이브를 정확하게 관리할 수 있습니다.

#### Acceptance Criteria

1. WHEN 사용자가 Star를 클릭하면, THE Scene SHALL 0.6초 이상 0.8초 이하의 보간으로 카메라를 선택 Star 방향으로 이동한다.
2. WHEN 사용자가 Star를 클릭하면, THE Card SHALL visible 상태가 되고 제목, Genre 배지, Rating 아이콘, 감상평, 감상일, Director, 삭제 버튼 및 "별자리에 묶기" 버튼을 포함하여 표시된다.
3. WHILE 선택된 Star가 없는 동안, THE Card SHALL 숨김 상태를 유지한다.
4. THE Card SHALL `backdrop-filter: blur(20px)`, `rgba(10,15,40,0.85)` 배경 및 Star 색상의 발광 테두리를 적용한다.
5. WHEN 사용자가 Card 삭제 버튼을 선택하면, THE Card SHALL Constellation 참조 유무와 관계없이 Hard_Delete 확인 대화상자를 표시한다.
6. IF Hard_Delete 대상 Star가 하나 이상의 Constellation에 참조되면, THEN THE Card SHALL 영향받는 모든 Constellation 이름을 확인 대화상자에 표시한다.
7. WHEN 사용자가 Hard_Delete 확인 대화상자에서 취소하면, THE Store SHALL Star, Constellation 및 Blackhole_Archive 데이터를 변경하지 않는다.
8. WHEN 사용자가 Card 삭제 버튼을 확인하면, THE Store SHALL 해당 작품 제거, 모든 Constellation 참조 제거 및 Persistence 저장을 Operation_Snapshot 기준의 하나의 원자적 Hard_Delete로 수행한다.
9. WHEN Hard_Delete가 Operation_Completion에 도달하면, THE Store SHALL 삭제 작품을 `blackholeArchive`에 추가하지 않는다.
10. WHEN Hard_Delete가 Operation_Completion에 도달하면, THE Scene SHALL 삭제 위치에서 소행성 충돌 Particle_Effect를 재생한다.
11. WHEN Hard_Delete가 Operation_Completion에 도달하면, THE Card SHALL 진행 중인 Particle_Effect와 관계없이 즉시 닫힌다.
12. WHEN 사용자가 "별자리에 묶기" 버튼을 클릭하면, THE Scene SHALL 선택 Star를 첫 노드로 지정한 Constellation 연결 모드에 진입한다.
13. WHEN Card 외부를 클릭하거나 Escape 키를 누르면, THE Card SHALL 데이터 변경 없이 닫힌다.
14. IF Hard_Delete의 작품 제거, Constellation 참조 제거 또는 Persistence 저장 단계가 실패하면, THEN THE Store SHALL Operation_Snapshot 전체를 복원하고 오류를 표시하며 소행성 충돌 Particle_Effect와 Card 닫힘을 억제한다.

### Requirement 5: 통계 HUD와 업적 가시성

**User Story:** 사용자로서, 현재 아카이브 현황과 보상 진행률을 한눈에 확인하고 싶습니다. 그래야 시청 패턴과 성취 상태를 파악할 수 있습니다.

#### Acceptance Criteria

1. THE HUD SHALL Active_Work 총수, 모든 Active_Work Rating 합계를 Active_Work 총수로 나눈 산술평균 및 최다 Genre 배지를 표시한다.
2. WHEN HUD가 평균 Rating을 표시하면, THE HUD SHALL 산술평균을 소수점 둘째 자리에서 반올림하여 소수점 첫째 자리로 표시하고 정확히 `.05`인 경계값을 절댓값이 큰 쪽 소수점 첫째 자리로 반올림한다.
3. WHEN Active_Work 총수가 0이면, THE HUD SHALL 작품 수 `0`, 평균 Rating `—`, 최다 Genre `없음`을 표시한다.
4. WHEN 두 개 이상의 Genre가 최다 등록 수로 동률이면, THE HUD SHALL 동률인 모든 Genre를 배지로 표시한다.
5. WHEN Store 상태가 변경되고 다음 렌더 주기가 실행되면, THE HUD SHALL 해당 렌더 주기 이내에 통계를 갱신한다.
6. THE HUD SHALL 불투명도 0.8의 반투명 유리 패널로 렌더링되고 Central_50_Area와 겹치지 않는다.
7. THE HUD SHALL 50편 및 100편 Milestone의 진행률과 해금 상태 요약을 표시한다.
8. WHEN HUD가 Milestone 진행률을 계산하면, THE HUD SHALL `min(Active_Work 총수, Milestone 목표값)`을 현재 진행값으로 사용한다.
9. THE Achievement_Panel SHALL 각 Achievement의 이름, 설명, 현재 진행률, 목표값 및 잠금·해금 상태를 표시한다.
10. WHEN 사용자가 HUD의 업적 요약을 선택하면, THE Archive_Application SHALL Achievement_Panel을 표시한다.

### Requirement 6: 장르 필터와 은하 강조

**User Story:** 사용자로서, 특정 장르의 작품과 은하를 함께 강조하고 싶습니다. 그래야 장르별 아카이브를 공간적으로 탐색할 수 있습니다.

#### Acceptance Criteria

1. THE Filter SHALL 8개 Genre 각각에 대한 토글 버튼을 제공하고 0개 이상의 Genre 동시 선택을 허용한다.
2. WHEN 하나 이상의 Genre가 선택되고 선택 Genre의 Star 불투명도가 1.0이 아니면, THE Scene SHALL 선택 Genre의 Star를 0.4초 동안 시각적으로 전환하여 불투명도 1.0으로 변경한다.
3. WHEN 하나 이상의 Genre가 선택되고 비선택 Genre의 Star 불투명도가 0.15가 아니면, THE Scene SHALL 비선택 Genre의 Star를 0.4초 동안 시각적으로 전환하여 불투명도 0.15로 변경한다.
4. WHEN 하나 이상의 Genre가 선택되고 선택 Genre_Galaxy의 시각 효과 강도가 기본값의 1.5배가 아니면, THE Scene SHALL 선택 Genre_Galaxy의 시각 효과 강도를 0.4초 동안 시각적으로 전환하여 기본값의 1.5배로 변경한다.
5. WHEN 하나 이상의 Genre가 선택되고 비선택 Genre_Galaxy의 시각 효과 강도가 기본값의 0.25배가 아니면, THE Scene SHALL 비선택 Genre_Galaxy의 시각 효과 강도를 0.4초 동안 시각적으로 전환하여 기본값의 0.25배로 변경한다.
6. WHEN 선택 Genre가 0개이면, THE Scene SHALL 모든 Star의 불투명도를 1.0으로 설정한다.
7. WHEN 선택 Genre가 0개이면, THE Scene SHALL 모든 Genre_Galaxy의 시각 효과 강도를 기본값의 1.0배로 설정한다.
8. WHEN 사용자가 2개 이상 선택된 Genre 중 하나의 버튼을 다시 선택하면, THE Filter SHALL 해당 Genre만 선택 해제하고 나머지 선택 Genre를 유지한다.
9. THE Filter SHALL 현재 선택된 Genre 버튼에 비선택 버튼과 구분되는 테두리 또는 배경을 표시한다.
10. WHEN 사용자가 마지막 선택 Genre의 버튼을 다시 선택하면, THE Filter SHALL 마지막 선택 Genre를 선택 해제하여 선택 Genre가 0개인 상태를 허용한다.
11. WHEN 선택 Genre의 Star 불투명도가 이미 1.0이면, THE Scene SHALL 해당 Star의 불투명도를 재애니메이션하지 않고 1.0으로 유지한다.
12. WHEN 선택 Genre_Galaxy의 시각 효과 강도가 이미 기본값의 1.5배이면, THE Scene SHALL 해당 Genre_Galaxy의 시각 효과 강도를 재애니메이션하지 않고 기본값의 1.5배로 유지한다.
13. WHEN 하나 이상의 Genre가 선택되고 Genre_Galaxy가 현재 실제로 비선택 상태이며 시각 효과 강도가 이미 기본값의 0.25배이면, THE Scene SHALL 해당 Genre_Galaxy의 시각 효과 강도를 재애니메이션하지 않고 기본값의 0.25배로 유지한다.
14. WHEN 비선택 Genre의 Star 불투명도가 이미 0.15이면, THE Scene SHALL 해당 Star의 불투명도를 재애니메이션하지 않고 0.15로 유지한다.
15. WHEN 선택 Genre가 0개이고 Star 불투명도가 이미 1.0이면, THE Scene SHALL 해당 Star의 불투명도를 재애니메이션하지 않고 1.0으로 유지한다.
16. WHEN 선택 Genre가 0개이고 Genre_Galaxy의 시각 효과 강도가 이미 기본값의 1.0배이면, THE Scene SHALL 해당 Genre_Galaxy의 시각 효과 강도를 재애니메이션하지 않고 기본값의 1.0배로 유지한다.

### Requirement 7: 리스트뷰 및 정렬

**User Story:** 사용자로서, 등록 작품을 별점순 또는 최신순으로 정렬하고 필터링하고 싶습니다. 그래야 원하는 작품을 빠르게 찾을 수 있습니다.

#### Acceptance Criteria

1. THE ListView SHALL 모든 Active_Work를 제목, Genre 배지, Rating 아이콘 및 Director와 함께 표시한다.
2. THE ListView SHALL Rating 내림차순과 `createdAt` 내림차순 정렬 옵션을 제공한다.
3. THE ListView SHALL Rating 내림차순을 기본 정렬로 적용한다.
4. WHEN Rating 내림차순 정렬에서 두 Active_Work의 Rating이 같으면, THE ListView SHALL `createdAt` 내림차순으로 동률을 처리한다.
5. WHEN 현재 정렬 옵션과 관계없이 두 Active_Work의 `createdAt`이 같으면, THE ListView SHALL Normalized_Title 오름차순과 UUID 오름차순의 우선순위로 최종 동률을 처리한다.
6. WHEN 사용자가 ListView 항목을 클릭하면, THE Scene SHALL 0.6초 이상 0.8초 이하에 해당 Star로 카메라를 이동한다.
7. WHEN 정렬 옵션이 변경되면, THE ListView SHALL 정렬 변경이 발생한 렌더 주기 이내에 새 순서로 갱신된다.
8. WHEN Filter에 하나 이상의 Genre가 선택되면, THE ListView SHALL 선택 Genre와 일치하는 Active_Work만 표시한다.
9. WHEN 현재 Filter와 검색 조건에 일치하는 Active_Work가 0개이면, THE ListView SHALL 빈 목록 대신 `조건에 맞는 작품이 없습니다` 상태를 표시한다.
10. WHEN Filter와 검색 논리가 Active_Work를 조건 일치로 판정하면, THE ListView SHALL 별도로 집계된 표시 개수가 일치하지 않더라도 해당 Active_Work를 표시한다.

### Requirement 8: 데이터 스키마 및 영속화

**User Story:** 사용자로서, 브라우저를 다시 열어도 작품, 은하, 마일스톤 및 업적 상태가 유지되기를 원합니다. 그래야 아카이브를 지속적으로 관리할 수 있습니다.

#### Acceptance Criteria

1. WHEN Store 상태가 변경되면, THE Persistence SHALL 1초 이내에 `{ "schemaVersion": 2, "stars": [...], "constellations": [...], "blackholeArchive": [...], "galaxies": [...], "milestoneUnlocks": {...}, "achievements": [...] }` 스키마의 JSON 문자열을 단일 localStorage 키에 저장한다.
2. THE `stars` 항목 SHALL UUID, 제목, Normalized_Title, Genre, Rating, 감상평, `YYYY-MM-DD` 감상일, Director, Normalized_Director, x·y·z 3D 좌표 및 ISO 8601 `createdAt`을 필수 필드로 포함한다.
3. THE `constellations` 항목 SHALL UUID, 공백 제거 이름, 순서가 있는 `starIds`, 색상 및 ISO 8601 `createdAt`을 필수 필드로 포함한다.
4. THE `blackholeArchive` 항목 SHALL `stars` 항목의 모든 필수 필드와 ISO 8601 `discardedAt`을 필수 필드로 포함한다.
5. THE `galaxies` 항목 SHALL 각 Galaxy_State의 식별자, Genre 또는 보상 유형, x·y·z 중심 좌표, Placement_Radius, 테마 식별자, 주 색상 및 해금 상태를 필수 필드로 포함한다.
6. THE `milestoneUnlocks` 항목 SHALL 50편과 100편 각각의 목표값, 해금 여부, ISO 8601 `unlockedAt` 또는 `null`, 보상 식별자 `rewardId` 또는 `null`을 필수 필드로 포함한다.
7. WHILE Milestone이 잠금 상태인 동안, THE Persistence SHALL 해당 Milestone의 `unlockedAt`과 `rewardId`를 `null`로 저장한다.
8. THE `achievements` 항목 SHALL 각 Achievement의 식별자, 이름, 설명, 판정 규칙 식별자, 진행률, 목표값, 해금 여부 및 ISO 8601 `unlockedAt` 또는 `null`을 필수 필드로 포함한다.
9. WHILE Achievement가 잠금 상태인 동안, THE Persistence SHALL 해당 Achievement의 `unlockedAt`을 `null`로 저장한다.
10. WHEN Archive_Application이 초기화되면, THE Persistence SHALL 첫 렌더 전에 localStorage JSON을 읽어 Store 복원을 시도한다.
11. IF localStorage 읽기, JSON 파싱, 스키마 검증 또는 Store 복원 단계가 실패하면, THEN THE Persistence SHALL 빈 작품 컬렉션과 기본 Genre_Galaxy·Milestone·Achievement 상태로 Store를 초기화한다.
12. IF Store 복원 단계가 실패하면, THEN THE Persistence SHALL 처리되지 않은 예외 대신 복구 가능한 초기 상태를 반환한다.
13. WHEN 유효한 Store 상태를 JSON으로 저장한 후 복원하면, THE Persistence SHALL 모든 필드 값과 `stars`, `constellations`, `blackholeArchive`, `galaxies`, `achievements` 컬렉션의 항목 순서를 원래 상태와 정확히 동일하게 반환한다.
14. WHERE localStorage 쓰기가 백그라운드 자동 저장에서 시작된 경우, IF localStorage 쓰기가 실패하면, THEN THE Persistence SHALL 쓰기 시점의 메모리 Store 상태를 유지한다.
15. IF 사용자 동작으로 시작된 localStorage 쓰기가 실패하면, THEN THE Archive_Application SHALL 빠른 연속 실패 여부와 관계없이 각 쓰기 실패를 감지한 후 1초 이내에 실패별 저장 실패 알림을 표시한다.
16. IF 백그라운드 자동 저장의 localStorage 쓰기가 실패하면, THEN THE Archive_Application SHALL 사용자 알림 없이 실패 상태를 기록한다.
17. IF Store round-trip 복원 결과에서 필드 값 또는 컬렉션 항목 순서가 저장 전 상태와 하나라도 다르거나 손상되면, THEN THE Persistence SHALL 부분 복원을 차단하고 전체 복원을 실패로 처리하여 빈 작품 컬렉션과 기본 Genre_Galaxy·Milestone·Achievement 상태로 Store를 초기화한다.
18. WHERE localStorage 쓰기가 사용자 동작에서 시작된 경우, IF localStorage 쓰기가 실패하면, THEN THE Store SHALL 해당 사용자 동작을 정의한 Requirement의 실패 기준에 따라 Operation_Snapshot 전체를 복원한다.

### Requirement 9: 별자리 생성

**User Story:** 사용자로서, 여러 작품을 별자리로 묶어 의미 있는 그룹을 만들고 싶습니다. 그래야 테마별로 작품을 정리할 수 있습니다.

#### Acceptance Criteria

1. WHEN 사용자가 "별자리 만들기"를 활성화하면, THE Scene SHALL Star 클릭 순서대로 식별자를 추가하는 Constellation 연결 모드에 진입한다.
2. WHILE Constellation 연결 모드가 활성 상태인 동안, THE Scene SHALL 선택 Star를 순서대로 연결하는 미리보기 선을 표시한다.
3. WHEN 사용자가 Constellation 연결 모드에서 이미 선택된 Star를 다시 선택하면, THE Scene SHALL 해당 Star 식별자를 중복 추가하지 않고 기존 선택 순서를 유지한다.
4. WHILE Constellation 연결 모드가 활성 상태인 동안, THE Scene SHALL 선택 가능한 Star 수를 최대 200개로 제한한다.
5. WHEN 사용자가 2개 이상 200개 이하의 Star를 선택하고 완료하면, THE Scene SHALL 최대 30자의 이름 입력 모달을 표시한다.
6. WHEN 사용자가 2개 이상 200개 이하의 Star와 유효한 이름으로 Constellation 생성을 명시적으로 확인하면, THE Store SHALL UUID, 공백 제거 이름, 순서가 있는 `starIds`, 기존 Constellation과 구분되는 색상 및 ISO 8601 `createdAt`을 저장한다.
7. IF Constellation 이름이 비어 있거나 공백만 포함하거나 공백 제거 후 30자를 초과하면, THEN THE Scene SHALL 이름 오류를 표시하고 현재 Star 선택과 선택 순서를 유지한 채 생성을 차단한다.
8. IF 선택 Star가 2개 미만이거나 200개를 초과하면, THEN THE Scene SHALL 선택 수 오류를 표시하고 현재 Star 선택과 선택 순서를 유지하며 이름 입력 단계와 모든 Constellation 데이터 저장을 차단한다.
9. WHEN 사용자가 Constellation 연결 모드에서 200개 Star를 선택한 후 201번째 Star를 선택하면, THE Scene SHALL 201번째 선택을 즉시 차단하고 선택 수 오류를 표시하며 이름 입력 단계를 표시하지 않는다.
10. WHEN 사용자가 "장르로 자동 별자리 만들기"를 활성화하면, THE Store SHALL Active_Work가 2개 이상인 Genre마다 `createdAt` 오름차순으로 정렬된 Constellation을 생성한다.
11. WHEN 자동 Constellation의 두 Active_Work가 같은 `createdAt`을 가지면, THE Store SHALL UUID 오름차순으로 동률을 처리한다.
12. WHEN 사용자가 확인 전에 Constellation 연결 모드를 취소하면, THE Scene SHALL Constellation 생성 없이 연결 모드를 종료한다.
13. WHEN 사용자가 "장르로 자동 별자리 만들기"를 활성화하고 Active_Work가 2개 이상인 Genre가 없으면, THE Store SHALL Constellation을 생성하지 않는다.
14. WHEN 사용자가 수동 Constellation 생성을 확인하면, THE Store SHALL Constellation 삽입과 Persistence 저장을 Operation_Snapshot 기준의 하나의 원자적 상태 변경으로 수행한다.
15. IF 수동 Constellation 삽입 또는 Persistence 저장이 실패하면, THEN THE Store SHALL Operation_Snapshot 전체를 복원하고 오류를 표시하며 현재 Star 선택과 선택 순서를 유지한다.
16. WHEN 사용자가 "장르로 자동 별자리 만들기"를 활성화하면, THE Store SHALL 대상 Genre의 모든 Constellation 삽입과 Persistence 저장을 Operation_Snapshot 기준의 하나의 원자적 상태 변경으로 수행한다.
17. IF 자동 Constellation 삽입 또는 Persistence 저장이 실패하면, THEN THE Store SHALL Operation_Snapshot 전체를 복원하고 오류를 표시한다.
18. WHEN 동일한 자동 Constellation 활성화 이벤트가 중복 전달되면, THE Store SHALL 첫 번째 이벤트에서 생성한 Constellation 집합만 유지하고 중복 이벤트에 대한 추가 Constellation을 생성하지 않는다.

### Requirement 10: 별자리 인터랙션과 참조 무결성

**User Story:** 사용자로서, 별자리를 안정적으로 탐색하고 작품 상태 변경 후에도 유효한 연결만 보고 싶습니다. 그래야 손상된 참조 없이 그룹을 감상할 수 있습니다.

#### Acceptance Criteria

1. THE Scene SHALL 각 Constellation의 Active_Reference_Star만 사용하여 발광 연결선을 렌더링한다.
2. THE Scene SHALL 포인터가 가리키지 않는 Constellation 선을 기본 불투명도 0.5로 표시한다.
3. WHEN 사용자가 Constellation 선을 가리키면, THE Scene SHALL 해당 Constellation 선을 불투명도 1.0으로 표시한다.
4. WHEN 사용자가 Constellation 선을 가리키면, THE Scene SHALL 0.3초 이내에 Constellation 이름을 표시한다.
5. WHEN 포인터가 Constellation 선을 벗어나면, THE Scene SHALL 선의 불투명도를 0.5로 복원하고 0.3초 이내에 이름을 숨긴다.
6. THE ListView SHALL Active_Reference_Star가 2개 이상인 Constellation 이름을 표시하는 섹션을 제공한다.
7. WHEN 사용자가 Active_Reference_Star가 2개 이상인 Constellation 목록 항목을 클릭하면, THE Scene SHALL 0.6초 이상 0.8초 이하에 모든 Active_Reference_Star의 경계 상자를 화면에 맞춘다.
8. IF Constellation의 Active_Reference_Star가 0개 또는 1개이면, THEN THE Scene SHALL 해당 Constellation의 경계 상자 맞춤 동작을 비활성화하고 `활성 작품이 2개 이상 필요합니다`라는 이유를 표시한다.
9. WHEN Hard_Delete가 작품을 제거하면, THE Store SHALL 모든 Constellation의 `starIds`에서 해당 Star 식별자의 모든 참조를 제거한다.
10. WHEN Soft_Delete가 작품을 Blackhole_Archive로 이동하면, THE Store SHALL 모든 Constellation의 `starIds`에서 해당 Star 식별자의 모든 참조를 제거한다.
11. WHEN Blackhole_Archive 작품이 `stars`로 복원되면, THE Store SHALL 복원된 Star를 기존 Constellation에 자동으로 다시 추가하지 않는다.
12. IF Constellation의 Active_Reference_Star가 2개 미만이면, THEN THE Scene SHALL Active_Reference_Star 감소 경로와 관계없이 해당 연결선을 숨긴다.
13. IF Hard_Delete 또는 Soft_Delete 후 Constellation에 남은 Active_Reference_Star가 2개 미만이면, THEN THE ListView SHALL Hard_Delete 또는 Soft_Delete가 Operation_Completion에 도달한 후 해당 Constellation을 활성 Constellation 목록에서 숨긴다.
14. WHEN Hard_Delete 또는 Soft_Delete가 Constellation 참조를 제거하면, THE Store SHALL 제거되지 않은 `starIds`의 기존 상대 순서를 유지한다.

### Requirement 11: 파티클 이펙트

**User Story:** 사용자로서, 주요 동작 시 명확한 시각적 피드백을 받고 싶습니다. 그래야 인터랙션의 결과를 즉시 인지할 수 있습니다.

#### Acceptance Criteria

1. WHEN 새 Star 등록이 Operation_Completion에 도달하면, THE Particle_Effect SHALL Star 위치에서 30개 이상 60개 이하의 입자가 1.0초 동안 퍼지고 사라지는 불꽃놀이를 재생한다.
2. WHEN Rating 5인 Star 등록이 Operation_Completion에 도달하면, THE Particle_Effect SHALL 2개 이상 3개 이하의 Trail이 1.5초 동안 화면을 가로지르는 유성우를 추가로 재생한다.
3. WHEN Card의 Hard_Delete가 Operation_Completion에 도달하면, THE Particle_Effect SHALL Star가 0 크기로 축소되고 20개 이상 40개 이하의 파편이 0.8초 동안 퍼지는 소행성 충돌을 재생한다.
4. WHEN Star의 Soft_Delete가 Operation_Completion에 도달하면, THE Particle_Effect SHALL Star가 2회 이상 회전하는 감소 나선을 따라 1.2초 동안 0 크기로 축소되는 효과를 재생한다.
5. WHEN Particle_Effect 재생 시간이 종료되면, THE Scene SHALL 해당 Particle_Effect의 geometry, material, texture, 타이머 및 애니메이션 참조를 제거한다.
6. WHILE `document.visibilityState`가 `visible`인 동안, THE Particle_Effect SHALL 15초 이상 40초 이하의 무작위 간격마다 0.5초 이상 1.0초 이하의 배경 유성을 재생한다.
7. WHILE 배경 유성이 재생 중인 동안, THE Particle_Effect SHALL 동시에 존재하는 배경 유성을 최대 1개로 제한한다.
8. WHEN `document.visibilityState`가 `hidden`으로 변경되면, THE Particle_Effect SHALL 새 배경 유성 생성을 정지한다.
9. WHEN `document.visibilityState`가 `hidden`에서 `visible`로 변경되면, THE Particle_Effect SHALL 15초 이상 40초 이하의 새로운 무작위 간격으로 배경 유성 생성을 재시작한다.
10. IF Particle_Effect 재생 종료 후 geometry, material, texture, 타이머 또는 애니메이션 참조 제거가 실패하면, THEN THE Scene SHALL 즉시 제거를 재시도하여 해당 Particle_Effect 리소스를 제거한다.

### Requirement 12: 블랙홀 아카이브와 Soft Delete

**User Story:** 사용자로서, 작품을 영구 삭제하지 않고 별도 보관했다가 복원하고 싶습니다. 그래야 작품 기록을 안전하게 관리할 수 있습니다.

#### Acceptance Criteria

1. THE Scene SHALL 고정 3D 위치에 회전하는 어두운 원반과 광 왜곡 효과를 가진 Blackhole을 표시한다.
2. WHEN 사용자가 Star를 Blackhole에 드롭하고 이동을 확인하면, THE Store SHALL 해당 레코드 제거, `discardedAt` 추가, `blackholeArchive` 삽입, Constellation 참조 정리 및 Persistence 저장을 Operation_Snapshot 기준의 하나의 원자적 Soft_Delete로 수행한다.
3. WHEN Soft_Delete가 Operation_Completion에 도달하면, THE Store SHALL 이동된 작품 레코드를 `stars`와 `blackholeArchive` 중 정확히 하나의 컬렉션에만 유지한다.
4. IF Soft_Delete의 제거, 삽입, Constellation 참조 정리 또는 Persistence 저장 단계가 실패하면, THEN THE Store SHALL Operation_Snapshot 전체의 복원을 시도하고 복원 성공 여부와 관계없이 오류 알림을 표시하며 Soft_Delete Particle_Effect를 억제한다.
5. WHEN Soft_Delete가 Operation_Completion에 도달하면, THE Particle_Effect SHALL Requirement 11.4의 나선 이동 효과를 재생한다.
6. WHEN 사용자가 Blackhole을 클릭하면, THE Scene SHALL Blackhole_Archive 항목의 제목, 감상평, Director 및 `discardedAt`을 표시한다.
7. THE ListView SHALL Blackhole_Archive 항목의 제목, 감상평, Director 및 `discardedAt`을 표시하는 섹션을 제공한다.
8. WHEN Blackhole_Archive 항목이 0개이면, THE Scene과 ListView의 Blackhole_Archive UI SHALL `보관된 작품이 없습니다` 상태를 표시한다.
9. IF 이동 대상 Star가 하나 이상의 Constellation에 참조되면, THEN THE Scene SHALL Soft_Delete 전에 영향받는 모든 Constellation 이름을 포함한 확인 대화상자를 표시한다.
10. WHEN 사용자가 Blackhole_Archive 항목의 복원을 선택하면, THE Store SHALL 해당 레코드 제거, 원래 Genre_Galaxy의 `stars` 삽입, `discardedAt` 제거 및 Persistence 저장을 Operation_Snapshot 기준의 하나의 원자적 복원으로 수행한다.
11. WHEN 복원이 Operation_Completion에 도달하면, THE Store SHALL 복원된 작품 레코드를 `stars`와 `blackholeArchive` 중 정확히 하나의 컬렉션에만 유지한다.
12. IF 복원의 제거, 삽입 또는 Persistence 저장 단계가 실패하면, THEN THE Store SHALL Operation_Snapshot 전체를 복원하고 오류 알림을 표시하며 복원 완료 효과를 억제한다.
13. WHEN 사용자가 Card 삭제 버튼을 사용하면, THE Store SHALL Blackhole_Archive로 이동하지 않고 Hard_Delete를 수행한다.
14. IF Soft_Delete 실패 복구 중 동일한 작품 레코드가 `stars`와 `blackholeArchive`에 함께 존재하면, THEN THE Store SHALL 작업 전 Store 스냅샷에서 해당 레코드가 속한 컬렉션 한 곳에만 레코드를 복원하고 다른 컬렉션의 중복 레코드를 제거한다.

### Requirement 13: 성능 최적화

**User Story:** 개발자로서, 다수의 Star가 등록되어도 Scene이 부드럽게 렌더링되기를 원합니다. 그래야 사용자 경험이 유지됩니다.

#### Acceptance Criteria

1. WHEN Active_Work 총수가 51개 이상이면, THE Scene SHALL Three.js InstancedMesh로 Star를 렌더링한다.
2. WHILE Performance_Test_Environment에서 Active_Work 200개와 OrbitControls가 활성 상태인 동안, THE Scene SHALL 5초 측정 구간에서 평균 30fps 이상을 유지한다.
3. IF 5초 측정 구간의 평균 프레임률이 30fps 미만이면, THEN THE Scene SHALL 첫 번째 저하 단계로 Background_Star 수를 낮추는 성능 모드를 활성화한다.
4. IF Background_Star 수를 낮춘 다음 5초 측정 구간의 평균 프레임률이 30fps 미만이면, THEN THE Scene SHALL 두 번째 저하 단계로 Particle_Effect 입자 수를 각 허용 범위의 최솟값까지 낮춘다.
5. IF Particle_Effect 입자 수를 낮춘 다음 5초 측정 구간의 평균 프레임률이 30fps 미만이면, THEN THE Scene SHALL 세 번째 저하 단계로 Bloom 품질을 낮춘다.
6. WHILE Scene에 하나 이상의 Star 또는 Active_Constellation_Line이 존재하는 동안, THE Scene SHALL 선택적 Bloom을 활성화하여 Star와 Active_Constellation_Line에만 @react-three/postprocessing Bloom 선택 레이어를 적용한다.
7. WHEN Star 또는 Constellation 선이 Scene에서 제거되면, THE Scene SHALL 다른 Scene 오브젝트가 참조하지 않는 Three.js geometry, material 및 texture만 dispose한다.
8. WHILE Three.js 리소스를 하나 이상의 Scene 오브젝트가 참조하는 동안, THE Scene SHALL 해당 리소스를 유지한다.
9. WHILE Scene에 Star와 Active_Constellation_Line이 모두 없는 동안, THE Scene SHALL 선택적 Bloom을 비활성화한다.

### Requirement 14: 반응형 레이아웃

**User Story:** 사용자로서, 데스크톱과 태블릿 화면에서 아카이브를 사용하고 싶습니다. 그래야 다양한 화면 크기에서도 기능을 이용할 수 있습니다.

#### Acceptance Criteria

1. WHEN 뷰포트 너비가 768px 이상이면, THE Archive_Application SHALL 중앙 3D 캔버스와 겹치지 않게 HUD, Filter 및 ListView를 동시에 표시한다.
2. WHEN 뷰포트 너비가 768px 미만으로 전환되면, THE Archive_Application SHALL ListView drawer를 기본 닫힘 상태로 표시한다.
3. WHEN 사용자가 768px 미만 뷰포트에서 ListView 토글을 선택하면, THE Archive_Application SHALL 선택할 때마다 ListView drawer의 열림 상태와 닫힘 상태를 전환한다.
4. WHEN 뷰포트 너비가 768px 미만이면, THE Archive_Application SHALL HUD와 Filter를 캔버스 위에 세로로 배치한다.
5. THE Card SHALL 선택 Star의 화면 좌표와 관계없이 보이는 뷰포트 각 경계에서 8px 이상의 여백을 유지한다.
6. IF Card 콘텐츠 높이가 8px 여백을 제외한 가용 뷰포트 높이를 초과하면, THEN THE Card SHALL Card 내부 세로 스크롤을 제공한다.
7. WHEN 뷰포트 너비가 768px 미만이면, THE OrbitControls SHALL 핀치 줌과 한 손가락 회전 터치 제스처를 함께 지원한다.
8. WHEN 뷰포트 너비가 768px breakpoint를 어느 방향으로든 실제 통과하면, THE Archive_Application SHALL 선택된 Star, 선택된 Filter Genre, Constellation 연결 모드의 선택 순서 및 모든 Store 데이터를 하나의 전환 상태로 함께 유지한다.
9. IF 768px breakpoint 전환 중 선택된 Star, 선택된 Filter Genre, Constellation 연결 모드의 선택 순서 또는 Store 데이터 중 하나라도 보존할 수 없으면, THEN THE Archive_Application SHALL 전환 직전의 전체 선택 및 Store 상태를 유지하여 부분 보존을 차단한다.

### Requirement 15: 장르별 은하 시각 테마

**User Story:** 사용자로서, 각 장르 은하를 서로 다른 색상과 형태로 구분하고 싶습니다. 그래야 작품의 장르를 배경만으로도 식별할 수 있습니다.

#### Acceptance Criteria

1. THE SF Genre_Galaxy SHALL 주 색상 `#3B82F6`과 중심 둘레를 각각 360도 이상 회전하는 2개 이상의 나선 팔을 가진 푸른 나선 은하 테마를 사용한다.
2. THE 로맨스 Genre_Galaxy SHALL 주 색상 `#F472B6`, 0보다 큰 바깥쪽 반경 50% 구간의 Particle_Density 및 바깥쪽 반경 50% 구간 Particle_Density의 1.5배 이상인 중심쪽 반경 50% 구간의 Particle_Density를 가진 분홍 성운 테마를 사용한다.
3. THE 스릴러 Genre_Galaxy SHALL 주 색상 `#DC2626`과 길이가 폭의 2배 이상인 비대칭 성운 띠를 3개 이상 가진 붉은 성운 테마를 사용한다.
4. THE 드라마 Genre_Galaxy SHALL 주 색상 `#F59E0B`과 장축 대 단축 비율이 1.5 이상 2.5 이하인 황금 타원 은하 테마를 사용한다.
5. THE 애니 Genre_Galaxy SHALL 주 색상 `#A855F7`과 서로 다른 법선 방향을 가진 반투명 프리즘 면을 3개 이상 포함하는 보라 프리즘 성운 테마를 사용한다.
6. THE 코미디 Genre_Galaxy SHALL 주 색상 `#FDE047`과 외경 대 내경 비율이 1.5 이상인 닫힌 고리를 2개 이상 가진 노란 고리 은하 테마를 사용한다.
7. THE 액션 Genre_Galaxy SHALL 주 색상 `#F97316`과 중심에서 방사형으로 뻗으며 길이가 중심 반경의 1.5배 이상인 광선을 8개 이상 가진 주황 폭발 은하 테마를 사용한다.
8. THE 기타 Genre_Galaxy SHALL 주 색상 `#14B8A6`과 크기 차이가 20% 이상인 비대칭 입자 군집을 3개 이상 가진 청록 불규칙 은하 테마를 사용한다.
9. THE Scene SHALL 각 Genre_Galaxy의 Primary_Color_Area가 Visible_Theme_Area의 50% 이상을 차지하게 렌더링한다.
10. THE Scene SHALL 각 Genre_Galaxy에 정의된 수치화된 형태 특성을 적용하여 나머지 7개 Genre_Galaxy와 구분되게 렌더링한다.
11. THE 로맨스 Genre_Galaxy SHALL 하트 윤곽 테마의 구성과 구성 시도를 차단한다.
12. WHERE 장르별 대체 형태가 구성된 경우, THE Scene SHALL 해당 Genre의 주 색상에 대한 Primary_Color_Area 50% 이상과 나머지 7개 Genre_Galaxy 중 어느 것과도 동일하지 않은 수치화된 형태 특성을 유지한다.

### Requirement 16: 최초 작품 수 마일스톤

**User Story:** 사용자로서, 작품 등록 누적 성취에 따라 우주 공간 보상을 받고 싶습니다. 그래야 아카이브 확장에 대한 동기를 얻을 수 있습니다.

#### Acceptance Criteria

1. WHEN Active_Work 총수가 50 미만인 상태에서 50 이상으로 최초 변경되면, THE Store SHALL 50편 Milestone을 해금 상태로 기록하고 최초 ISO 8601 해금 시각과 고유 행성 보상 ID를 기록한다.
2. WHEN 50편 Milestone이 최초 해금되면, THE Scene SHALL 기록된 보상 ID를 가진 Milestone 행성 오브젝트를 1개 생성한다.
3. WHEN Active_Work 총수가 100 미만인 상태에서 100 이상으로 최초 변경되면, THE Store SHALL 100편 Milestone을 해금 상태로 기록하고 최초 ISO 8601 해금 시각과 고유 은하 보상 ID를 기록한다.
4. WHEN 100편 Milestone이 최초 해금되면, THE Store SHALL 기존 8개 장르 은하와 구분되며 기록된 보상 ID를 가진 보상 Galaxy_State를 1개 생성한다.
5. WHEN 100편 Milestone이 최초 해금되면, THE Scene SHALL 보상 Galaxy_State에 대응하는 새 은하를 1개 렌더링한다.
6. IF 50편 Milestone이 이미 해금 상태이면, THEN THE Store SHALL 이후 Active_Work 수 변화에서 최초 `unlockedAt`과 `rewardId`를 변경하지 않고 추가 해금 이벤트와 행성 보상을 생성하지 않는다.
7. IF 100편 Milestone이 이미 해금 상태이면, THEN THE Store SHALL 이후 Active_Work 수 변화에서 최초 `unlockedAt`과 `rewardId`를 변경하지 않고 추가 해금 이벤트와 은하 보상을 생성하지 않는다.
8. WHEN Active_Work 총수가 어떤 경로로든 50편 또는 100편 Milestone 임계값 아래로 감소하면, THE Store SHALL 기존에 해금된 모든 Milestone의 해금 상태, 최초 해금 시각 및 보상 ID를 유지한다.
9. WHEN Archive_Application이 새로고침 후 Store를 복원하면, THE Store SHALL 각 저장된 `rewardId`별 보상 레코드와 Scene 오브젝트를 최대 1개로 복원한다.
10. WHEN Archive_Application이 새로고침 후 Store를 복원하면, THE Archive_Application SHALL 저장된 Milestone에 대한 추가 해금 이벤트와 해금 알림을 생성하지 않는다.
11. THE Store SHALL 작품 수 기반 보상 조건을 최초 50편 행성 1개와 최초 100편 은하 1개로 한정한다.
12. WHEN Active_Work 총수가 정확히 100이고 두 Milestone이 이미 해금 상태이면, THE Store SHALL 최초 해금 이벤트와 추가 Milestone 보상을 생성하지 않는다.
13. WHEN Milestone 이외의 기능이 행성 상태를 변경하면, THE Store SHALL Milestone 해금 상태와 별개로 해당 변경을 적용한다.
14. WHEN Active_Work 총수가 한 번의 상태 변경으로 0에서 100 이상으로 증가하고 50편 및 100편 Milestone이 모두 잠금 상태이면, THE Store SHALL 50편 Milestone을 먼저 해금한 다음 100편 Milestone을 해금한다.

### Requirement 17: 업적 시스템과 놀란 마스터

**User Story:** 사용자로서, 명확한 목표의 진행률과 해금 결과를 확인하고 싶습니다. 그래야 작품 등록 활동에서 성취감을 얻을 수 있습니다.

#### Acceptance Criteria

1. THE Store SHALL 각 Achievement를 식별자, 이름, 설명, Unique_Work_Key 기반 고유 작품 판정 규칙, 목표값, 진행률, 잠금·해금 상태 및 최초 해금 시각으로 관리한다.
2. WHEN Achievement 판정에 영향을 주는 Star가 생성되거나 Hard_Delete 또는 Soft_Delete되거나 복원되면, THE Store SHALL 현재 Active_Work 중 해당 Achievement 판정 규칙을 충족하는 서로 다른 Unique_Work_Key 수로 진행률을 다시 계산한다.
3. WHEN Achievement 진행률이 목표값에 최초 도달하면, THE Store SHALL 해당 Achievement를 해금 상태로 변경하고 ISO 8601 최초 해금 시각을 기록한다.
4. WHEN Achievement가 최초 해금되면, THE Archive_Application SHALL Achievement 이름과 설명을 포함한 해금 알림을 1회 표시한다.
5. IF Achievement가 이미 해금 상태이면, THEN THE Store SHALL 이후 진행률 재계산에서 해금 상태와 최초 해금 시각을 유지하고 중복 해금 이벤트를 생성하지 않는다.
6. IF 해금된 Achievement의 현재 Active_Work 고유 키 수가 목표값 아래로 감소하면, THEN THE Store SHALL 감소한 현재 진행률을 표시하면서 해금 상태와 최초 해금 시각을 유지한다.
7. THE Nolan_Master SHALL 목표값을 10으로 설정하고 Normalized_Director가 정확히 `christopher nolan`인 현재 Active_Work의 서로 다른 Unique_Work_Key 수를 진행률로 사용한다.
8. WHEN Nolan_Master 진행률이 10 이상이고 Nolan_Master가 잠금 상태이면, THE Store SHALL Nolan_Master를 해금한다.
9. WHEN Normalized_Title과 Normalized_Director가 모두 동일한 Star가 둘 이상 존재하면, THE Nolan_Master SHALL 해당 Star들을 진행률 1편으로 계산한다.
10. WHEN 제목 또는 Director의 대소문자나 앞뒤 공백만 다른 Star가 등록되면, THE Nolan_Master SHALL 해당 Star를 동일 Unique_Work_Key로 계산한다.
11. WHEN Archive_Application이 새로고침 후 Store를 복원하면, THE Achievement_Panel SHALL 현재 Active_Work에서 재계산한 진행률과 저장된 잠금·해금 상태 및 최초 해금 시각을 표시한다.
12. WHEN Archive_Application이 새로고침 후 Store를 복원하면, THE Archive_Application SHALL 이미 해금된 Achievement의 해금 알림을 다시 표시하지 않는다.
13. WHEN 사용자가 Achievement_Panel을 닫은 후 다시 열면, THE Archive_Application SHALL 일반 탐색 동작에 대한 별도 Achievement 해금 알림을 생성하지 않는다.
