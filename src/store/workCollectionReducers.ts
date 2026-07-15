import type {
  ArchivedStar,
  PersistedStateV2,
  Star,
} from '../domain/models';

export interface DeleteWorkMutation {
  candidate: PersistedStateV2;
  work: Star;
  affectedConstellationNames: string[];
}

export interface SoftDeleteWorkMutation extends DeleteWorkMutation {
  archivedWork: ArchivedStar;
}

export interface RestoreWorkMutation {
  candidate: PersistedStateV2;
  work: Star;
}

/** Returns every affected constellation name in persisted collection order. */
export function getAffectedConstellationNames(
  state: Readonly<PersistedStateV2>,
  starId: string,
): string[] {
  return state.constellations
    .filter(({ starIds }) => starIds.includes(starId))
    .map(({ name }) => name);
}

function removeConstellationReferences(
  candidate: PersistedStateV2,
  starId: string,
): void {
  candidate.constellations = candidate.constellations.map((constellation) => ({
    ...constellation,
    starIds: constellation.starIds.filter((candidateId) => candidateId !== starId),
  }));
}

function toActiveStar(archivedWork: ArchivedStar): Star {
  return {
    id: archivedWork.id,
    title: archivedWork.title,
    normalizedTitle: archivedWork.normalizedTitle,
    genre: archivedWork.genre,
    rating: archivedWork.rating,
    review: archivedWork.review,
    watchedDate: archivedWork.watchedDate,
    director: archivedWork.director,
    normalizedDirector: archivedWork.normalizedDirector,
    position: archivedWork.position,
    createdAt: archivedWork.createdAt,
  };
}

/** Permanently removes every record and ordered constellation reference for an ID. */
export function reduceHardDelete(
  snapshot: Readonly<PersistedStateV2>,
  starId: string,
): DeleteWorkMutation {
  const activeWork = snapshot.stars.find(({ id }) => id === starId);
  const archivedWork = snapshot.blackholeArchive.find(({ id }) => id === starId);
  const work = activeWork ?? (archivedWork === undefined ? undefined : toActiveStar(archivedWork));
  if (work === undefined) throw new Error(`Work not found: ${starId}`);

  const candidate: PersistedStateV2 = structuredClone(snapshot);
  candidate.stars = candidate.stars.filter(({ id }) => id !== starId);
  candidate.blackholeArchive = candidate.blackholeArchive.filter(({ id }) => id !== starId);
  removeConstellationReferences(candidate, starId);

  return {
    candidate,
    work,
    affectedConstellationNames: getAffectedConstellationNames(snapshot, starId),
  };
}

/** Moves one active work to the archive and creates exactly one discardedAt field. */
export function reduceSoftDelete(
  snapshot: Readonly<PersistedStateV2>,
  starId: string,
  discardedAt: string,
): SoftDeleteWorkMutation {
  const work = snapshot.stars.find(({ id }) => id === starId);
  if (work === undefined) throw new Error(`Active work not found: ${starId}`);

  const candidate: PersistedStateV2 = structuredClone(snapshot);
  candidate.stars = candidate.stars.filter(({ id }) => id !== starId);
  candidate.blackholeArchive = candidate.blackholeArchive.filter(({ id }) => id !== starId);
  const archivedWork: ArchivedStar = { ...structuredClone(work), discardedAt };
  candidate.blackholeArchive.push(archivedWork);
  removeConstellationReferences(candidate, starId);

  return {
    candidate,
    work,
    archivedWork,
    affectedConstellationNames: getAffectedConstellationNames(snapshot, starId),
  };
}

/** Restores one archived work without recreating any removed constellation reference. */
export function reduceRestoreArchived(
  snapshot: Readonly<PersistedStateV2>,
  starId: string,
): RestoreWorkMutation {
  const archivedWork = snapshot.blackholeArchive.find(({ id }) => id === starId);
  if (archivedWork === undefined) throw new Error(`Archived work not found: ${starId}`);

  const candidate: PersistedStateV2 = structuredClone(snapshot);
  candidate.stars = candidate.stars.filter(({ id }) => id !== starId);
  candidate.blackholeArchive = candidate.blackholeArchive.filter(({ id }) => id !== starId);
  const work = toActiveStar(archivedWork);
  candidate.stars.push(work);

  return { candidate, work };
}
