import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';

import type { Galaxy, PersistedStore, Vec3 } from '../domain/models';

const FIFTY_REWARD_POSITION: Vec3 = { x: -24, y: 14, z: 18 };

export type MilestoneRewardViewModel =
  | {
      kind: 'planet';
      rewardId: string;
      position: Vec3;
    }
  | {
      kind: 'galaxy';
      rewardId: string;
      galaxy: Galaxy;
    };

/**
 * Selects only milestone-authoritative rewards and de-duplicates across object
 * types, so malformed or concurrently restored records cannot double-render a
 * rewardId.
 */
export function selectMilestoneRewardViewModels(
  persisted: Readonly<PersistedStore>,
): MilestoneRewardViewModel[] {
  const rewards: MilestoneRewardViewModel[] = [];
  const seenRewardIds = new Set<string>();
  const fifty = persisted.milestoneUnlocks.fifty;

  if (fifty.unlocked && fifty.rewardId !== null) {
    seenRewardIds.add(fifty.rewardId);
    rewards.push({
      kind: 'planet',
      rewardId: fifty.rewardId,
      position: FIFTY_REWARD_POSITION,
    });
  }

  const hundred = persisted.milestoneUnlocks.hundred;
  if (
    hundred.unlocked &&
    hundred.rewardId !== null &&
    !seenRewardIds.has(hundred.rewardId)
  ) {
    const galaxy = persisted.galaxies.find(
      (candidate) =>
        candidate.id === hundred.rewardId &&
        candidate.kind.type === 'reward' &&
        candidate.unlocked,
    );
    if (galaxy !== undefined) {
      seenRewardIds.add(hundred.rewardId);
      rewards.push({
        kind: 'galaxy',
        rewardId: hundred.rewardId,
        galaxy,
      });
    }
  }

  return rewards;
}

function MilestonePlanet({ reward }: { reward: Extract<MilestoneRewardViewModel, { kind: 'planet' }> }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (group.current !== null) group.current.rotation.y += delta * 0.18;
  });

  return (
    <group
      name={`milestone-planet-${reward.rewardId}`}
      position={[reward.position.x, reward.position.y, reward.position.z]}
      ref={group}
    >
      <mesh>
        <sphereGeometry args={[3.2, 32, 20]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#92400e"
          emissiveIntensity={0.65}
          metalness={0.2}
          roughness={0.55}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2.5, 0, 0]}>
        <torusGeometry args={[4.8, 0.24, 12, 64]} />
        <meshBasicMaterial color="#fde68a" opacity={0.8} transparent />
      </mesh>
      <pointLight color="#fbbf24" distance={22} intensity={1.5} />
    </group>
  );
}

function MilestoneGalaxy({ reward }: { reward: Extract<MilestoneRewardViewModel, { kind: 'galaxy' }> }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (group.current !== null) group.current.rotation.z += delta * 0.08;
  });

  const { galaxy } = reward;
  return (
    <group
      name={`milestone-galaxy-${reward.rewardId}`}
      position={[galaxy.center.x, galaxy.center.y, galaxy.center.z]}
      ref={group}
    >
      <mesh scale={[1.6, 0.22, 1.6]}>
        <sphereGeometry args={[galaxy.placementRadius, 32, 20]} />
        <meshBasicMaterial
          color={galaxy.primaryColor}
          depthWrite={false}
          opacity={0.16}
          transparent
          wireframe
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[galaxy.placementRadius * 0.72, 0.55, 12, 96]} />
        <meshBasicMaterial
          color="#c4b5fd"
          depthWrite={false}
          opacity={0.72}
          transparent
        />
      </mesh>
      <pointLight color={galaxy.primaryColor} distance={55} intensity={2} />
    </group>
  );
}

export function MilestoneRewardRenderer({
  rewards,
}: {
  rewards: readonly MilestoneRewardViewModel[];
}) {
  return (
    <group name="milestone-rewards">
      {rewards.map((reward) =>
        reward.kind === 'planet' ? (
          <MilestonePlanet key={reward.rewardId} reward={reward} />
        ) : (
          <MilestoneGalaxy key={reward.rewardId} reward={reward} />
        ),
      )}
    </group>
  );
}
