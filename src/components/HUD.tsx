import { useMemo } from 'react';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { selectHudViewModel } from '../store/selectors';

export interface HUDProps {
  store: ArchiveStoreApi;
}

export function HUD({ store }: HUDProps) {
  const persisted = useStore(store, (state) => state.persisted);
  const runtime = useStore(store, (state) => state.runtime);
  const viewModel = useMemo(
    () => selectHudViewModel({ persisted, runtime }),
    [persisted, runtime],
  );

  return (
    <section className="hud glass-panel" aria-labelledby="hud-heading">
      <h2 id="hud-heading">아카이브 현황</h2>
      <dl className="hud-statistics">
        <div>
          <dt>작품 수</dt>
          <dd>{viewModel.activeWorkCount}</dd>
        </div>
        <div>
          <dt>평균 별점</dt>
          <dd>{viewModel.averageRatingLabel}</dd>
        </div>
        <div>
          <dt>최다 장르</dt>
          <dd className="badge-list">
            {viewModel.topGenres.length === 0
              ? '없음'
              : viewModel.topGenres.map((genre) => (
                  <span className="genre-badge" key={genre}>{genre}</span>
                ))}
          </dd>
        </div>
      </dl>

      <div className="milestone-summary" aria-label="마일스톤 진행률">
        {Object.values(viewModel.milestones).map((milestone) => (
          <div key={milestone.target}>
            <span>{milestone.target}편 {milestone.unlocked ? '해금' : '진행 중'}</span>
            <progress
              aria-label={`${milestone.target}편 마일스톤`}
              max={milestone.target}
              value={milestone.current}
            />
            <span>{milestone.current}/{milestone.target}</span>
          </div>
        ))}
      </div>

      <button
        className="panel-action"
        type="button"
        aria-haspopup="dialog"
        onClick={() => store.getState().commands.setAchievementPanelOpen(true)}
      >
        업적 {viewModel.achievementSummary.unlockedCount}/{viewModel.achievementSummary.totalCount}
      </button>
    </section>
  );
}
