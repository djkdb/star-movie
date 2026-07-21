---
name: safe-feature
description: >-
  Add a new user-facing feature to the Asteron archive without breaking
  saved data or frame rate. Use when adding fields to a Star/watchlist/
  persisted model, wiring a new store command, or introducing a new scene
  element. Encodes the schema-safe persistence pattern (additive optional
  fields + backfill, no version bump), the FPS quality-gating contract, and
  the validation gate every change must pass.
---

# Adding a feature safely

Two invariants must never break: **saved universes keep loading** and
**frame rate degrades gracefully on weak devices**. This skill is the
checklist that protects both.

## 1. Persistence: additive, never a version bump

State is persisted through a Zod codec: `src/persistence/persistedStateCodec.ts`
(document is `schemaVersion: 2`). The rule that has held all along:

> **New data on an existing model = optional field + backfill. Do NOT bump
> `schemaVersion`.**

A version bump forces a migration and risks orphaning every saved universe.
Instead:

- Add the field to the model in `src/domain/models.ts`.
- Add it to the schema in `persistedStateCodec.ts` as **`.optional()`**
  (see the existing `watchedWith`, `emotion`, `rewatchCount` on the star
  schema — all optional, `.strict()` object).
- If old documents need a sensible default, add it in the backfill chain
  (`backfillLegacyShape` → `migrateLegacyAchievements` →
  `backfillMissingAchievements`), following the existing pattern.
- Round-trip test in `persistedStateCodec.test.ts`: an old document
  (without the field) must still parse, and a new document must survive
  serialize→parse unchanged.

### Reference models
- `Star` carries the optional engagement fields; `WatchlistEntry` and
  `PersistedStore.watchlist` are the watchlist shape;
  `RuntimeStore.watchlistPrefill` is transient (not persisted).
- `EMOTION_TAGS` is a `z.enum` — extend the array, it stays backward-compatible.

### TypeScript traps seen before
- Indexing `updateDraft` by key breaks for non-string fields
  (`watchedWith`/`emotion`) — early-return those cases.
- `candidate.watchlist` is readonly at the parse boundary — mutate via
  `.length = 0; .push(...)`, not reassignment.

## 2. Store commands

State lives in a **Zustand vanilla store**: `src/store/archiveStore.ts`.
User actions are **commands** on the store (e.g. `markRewatched`,
`addToWatchlist`, `removeFromWatchlist`, `beginWatchlistPromotion`,
`clearWatchlistPrefill`, `pushGentleToast`, `requestCameraHome`).

- Add new mutations as commands there; components dispatch commands, they
  don't reach into state directly.
- **Camera note:** `requestCameraFocus` rejects the `'free'` pose type by
  design — use `requestCameraHome(pose)` for "return home" / recenter.
- Gentle, non-nagging tone: surface things via `pushGentleToast`, not
  blocking modals or streak pressure (see the "한 달 전 오늘" memory note in
  `App.tsx` — one soft toast per day, guarded by a `localStorage` date key).

## 3. Scene elements must be quality-gated

Frame rate is actively defended. `FpsDegradationController` walks
`qualityLevel` down this order (`src/domain/qualityLevel.ts`):

```
full → reducedBackground → minimumParticles → reducedBloom
```

If your feature adds a **heavy** scene element (extra particles, a shader
pass, GPGPU, a big instanced field):

- Gate it to the top tiers. The backdrop hole/galaxies pattern is:
  `qualityLevel === 'full' || qualityLevel === 'reducedBackground'`.
- Respect `getSceneQualitySettings(level)` — e.g. `reducedParticles`,
  `reducedBloom`, `backgroundStarScale`.
- Respect `prefers-reduced-motion`: no essential information may depend on
  motion, and animation loops should quiet down when it's set.

Cheap DOM/UI features don't need gating — only GPU-heavy scene additions do.

## 4. Interaction & mobile

- Coarse-pointer (touch) is detected via `useCoarsePointer` /
  `src/scene/useCoarsePointer.ts`; camera speeds come from
  `getTrackballSpeeds(coarsePointer)` and the target is clamped
  (`CAMERA_TARGET_MAX_RADIUS`, `clampTargetLength`) so users can't fly out
  of the star field.
- Tappable 3D objects need a **generous invisible hit target** — the star
  core sphere alone is too small on touch; `IndividualStarMesh.tsx` adds a
  hit-sphere ~3× the core (min radius) for this reason.

## 5. Validation gate (run before every commit)

```
npm run typecheck
npm run test:unit
npm run test:component
npm run test:pbt
npm run build            # tsc --noEmit && vite build
```
or the bundled `npm run validate` (adds integration).
Integration/visual tests run headless Chromium — if you touch those, note
the executablePath / reduced-motion gotchas documented in the
`blackhole-tuning` skill.

## Quick checklist

- [ ] New persisted data = optional field + backfill, **no schemaVersion bump**
- [ ] Codec round-trip test covers old-doc and new-doc
- [ ] Mutations go through store commands; camera-home uses `requestCameraHome`
- [ ] Heavy scene element is quality-gated and respects reduced-motion
- [ ] Touch: hit targets generous, camera target clamped
- [ ] `npm run validate` (or the individual gates) passes
