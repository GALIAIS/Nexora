import type { ConsoleEntry, GameSnapshot, WorldObject, WorldState } from "./types";
import type { ReplicationFrame, ReplicationSnapshot } from "./replication";

export const AUTOMATION_SUBSCRIPTION_ID = "example.automation-colony.world";
export const AUTOMATION_SCHEMA_CATALOG_HASH =
  "sha256:9d350bf1e80b9f7e798de70c029a33aa21ea64897ea1fe58392058e8d13c6f3d";

export type AutomationStaticState = Pick<
  WorldState,
  "version" | "roomName" | "width" | "height" | "terrain"
>;

export interface AutomationDynamicState
  extends Pick<WorldState, "tick" | "status" | "tickRate" | "stats" | "memory"> {
  objectOrder: string[];
}

export type AutomationReplicationFrame = ReplicationFrame<
  AutomationStaticState,
  AutomationDynamicState,
  WorldObject,
  ConsoleEntry[]
>;

export type AutomationReplicationSnapshot = ReplicationSnapshot<
  AutomationStaticState,
  AutomationDynamicState,
  WorldObject,
  ConsoleEntry[]
>;

export function staticStateOf(state: WorldState): AutomationStaticState {
  return {
    version: state.version,
    roomName: state.roomName,
    width: state.width,
    height: state.height,
    terrain: state.terrain
  };
}

export function dynamicStateOf(state: WorldState): AutomationDynamicState {
  return {
    tick: state.tick,
    status: state.status,
    tickRate: state.tickRate,
    stats: state.stats,
    memory: state.memory,
    objectOrder: state.objects.map((object) => object.id)
  };
}

export function gameSnapshotOf(snapshot: AutomationReplicationSnapshot): GameSnapshot {
  const { objectOrder, ...dynamicState } = snapshot.dynamicState;
  const objects = objectOrder
    .map((id) => snapshot.records.get(id)?.value)
    .filter((object): object is WorldObject => object !== undefined);
  return {
    state: {
      ...snapshot.staticState,
      ...dynamicState,
      objects
    },
    console: snapshot.transient
  };
}

export function isAutomationReplicationFrame(value: unknown): value is AutomationReplicationFrame {
  if (!value || typeof value !== "object") {
    return false;
  }
  const frame = value as Record<string, unknown>;
  return frame.protocol === "nexora.replication.v1" && (frame.kind === "keyframe" || frame.kind === "delta");
}
