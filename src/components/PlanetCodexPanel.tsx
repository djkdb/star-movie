import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

import {
  RARITY_COLORS,
  RARITY_LABELS,
  getPlanetSpecies,
  type PlanetSpecies,
} from '../domain/planetCatalog';
import type { ArchiveStoreApi } from '../store/archiveStore';
import { selectPlanetCodexViewModel } from '../store/selectors';

export interface PlanetCodexPanelProps {
  store: ArchiveStoreApi;
}

/** Small CSS rendering of a planet, driven entirely by its species palette. */
function PlanetChip({ species, size = 48 }: { species: PlanetSpecies; size?: number }) {
  const glow =
    species.rarity === 'legendary'
      ? `0 0 16px ${species.emissiveColor}, inset 0 0 10px rgba(255,255,255,0.15)`
      : species.rarity === 'epic'
        ? `0 0 9px ${species.emissiveColor}`
        : 'inset 0 0 8px rgba(0,0,0,0.35)';
  return (
    <span
      aria-hidden="true"
      className="planet-chip"
      data-geometry={species.geometry}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, ${species.accentColor} 0%, ${species.baseColor} 55%, #05060a 100%)`,
        boxShadow: glow,
      }}
    >
      {species.ring !== undefined && (
        <span className="planet-chip-ring" style={{ borderColor: species.ring.color }} />
      )}
    </span>
  );
}

interface RevealState {
  species: PlanetSpecies;
  isNewSpecies: boolean;
  nonce: number;
}

export function PlanetCodexPanel({ store }: PlanetCodexPanelProps) {
  const persisted = useStore(store, (state) => state.persisted);
  const runtime = useStore(store, (state) => state.runtime);
  const viewModel = useMemo(
    () => selectPlanetCodexViewModel({ persisted, runtime }),
    [persisted, runtime],
  );
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pull = () => {
    const result = store.getState().commands.pullPlanet();
    if (result.ok) {
      const species = getPlanetSpecies(result.value.speciesId);
      if (species !== undefined) {
        setError(null);
        setReveal({
          species,
          isNewSpecies: result.value.isNewSpecies,
          nonce: Date.now(),
        });
      }
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div className="planet-codex">
      <header className="planet-codex-header">
        <h2>행성 도감</h2>
        <span className="planet-codex-rate">
          수집 {viewModel.collected}/{viewModel.total}
        </span>
      </header>

      <section className="planet-gacha" aria-label="행성 뽑기">
        <div className="planet-gacha-status">
          <p className="planet-ticket-count">
            <span className="ticket-icon" aria-hidden="true">🎟️</span>
            가챠 티켓 <strong>{viewModel.tickets}</strong>장
          </p>
          <p className="planet-ticket-progress">
            다음 티켓까지 별 {viewModel.starsUntilNextTicket}개
          </p>
        </div>

        <div className={`planet-reveal-slot${reveal !== null ? ' has-reveal' : ''}`}>
          {reveal !== null ? (
            <div className="planet-reveal-card" key={reveal.nonce}>
              <div className="planet-reveal-inner">
                <div className="planet-reveal-back" aria-hidden="true">
                  <span>?</span>
                </div>
                <div
                  className="planet-reveal-front"
                  style={{ borderColor: RARITY_COLORS[reveal.species.rarity] }}
                >
                  <PlanetChip species={reveal.species} size={64} />
                  <strong>{reveal.species.name}</strong>
                  <span
                    className="rarity-chip"
                    style={{ color: RARITY_COLORS[reveal.species.rarity] }}
                  >
                    {RARITY_LABELS[reveal.species.rarity]}
                  </span>
                  {reveal.isNewSpecies && <span className="new-badge">NEW</span>}
                </div>
              </div>
            </div>
          ) : (
            <p className="planet-reveal-placeholder">티켓으로 새 행성을 뽑아보세요</p>
          )}
        </div>

        <button
          className="primary-action planet-pull-button"
          disabled={viewModel.tickets < 1}
          onClick={pull}
          type="button"
        >
          {viewModel.tickets < 1 ? '티켓이 없습니다' : '행성 뽑기'}
        </button>
        {error !== null && (
          <p className="planet-gacha-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <ul className="planet-dex-grid">
        {viewModel.entries.map((entry) => (
          <li
            key={entry.species.id}
            className={`planet-dex-cell${entry.owned ? ' is-owned' : ' is-locked'}`}
            style={entry.owned ? { borderColor: RARITY_COLORS[entry.species.rarity] } : undefined}
          >
            {entry.owned ? (
              <>
                <PlanetChip species={entry.species} />
                <span className="planet-dex-name">{entry.species.name}</span>
                <span
                  className="planet-dex-rarity"
                  style={{ color: RARITY_COLORS[entry.species.rarity] }}
                >
                  {RARITY_LABELS[entry.species.rarity]}
                </span>
                {entry.count > 1 && <span className="planet-dex-count">×{entry.count}</span>}
              </>
            ) : (
              <>
                <span className="planet-chip planet-chip-locked" aria-hidden="true">
                  ?
                </span>
                <span className="planet-dex-name planet-dex-name-locked">미발견</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
