import type { GameSnapshot, WorldObject } from "../../shared/types";
import {
  AUTOMATION_SCHEMA_CATALOG_HASH,
  AUTOMATION_SUBSCRIPTION_ID,
  dynamicStateOf,
  staticStateOf,
  type AutomationReplicationFrame
} from "../../shared/example-replication";
import {
  REPLICATION_PROTOCOL,
  type RecordRemoval,
  type RecordUpsert,
  type ReplicationKeyframe
} from "../../shared/replication";

export class AutomationReplicationEncoder {
  private snapshotId = 1;
  private sequence = 1;
  private current: GameSnapshot;
  private revisions = new Map<string, number>();

  constructor(initial: GameSnapshot) {
    this.current = structuredClone(initial);
    for (const object of initial.state.objects) {
      this.revisions.set(object.id, 1);
    }
  }

  currentKeyframe(): AutomationReplicationFrame {
    return this.keyframe(this.current);
  }

  encode(nextSnapshot: GameSnapshot): AutomationReplicationFrame {
    const next = structuredClone(nextSnapshot);
    if (requiresNewBaseline(this.current, next)) {
      this.snapshotId += 1;
      this.sequence += 1;
      this.current = next;
      this.revisions = new Map(next.state.objects.map((object) => [object.id, 1]));
      return this.keyframe(next);
    }

    const previousObjects = new Map(this.current.state.objects.map((object) => [object.id, object]));
    const nextObjects = new Map(next.state.objects.map((object) => [object.id, object]));
    const upserts: RecordUpsert<WorldObject>[] = [];
    const removals: RecordRemoval[] = [];
    for (const object of next.state.objects) {
      const previous = previousObjects.get(object.id);
      if (previous && objectsEqual(previous, object)) {
        continue;
      }
      const expectedRevision = this.revisions.get(object.id);
      const revision = expectedRevision === undefined ? 1 : expectedRevision + 1;
      this.revisions.set(object.id, revision);
      upserts.push({
        id: object.id,
        revision,
        value: object,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
      });
    }
    for (const object of this.current.state.objects) {
      if (nextObjects.has(object.id)) {
        continue;
      }
      const expectedRevision = this.revisions.get(object.id);
      if (expectedRevision === undefined) {
        continue;
      }
      removals.push({ id: object.id, expectedRevision });
      this.revisions.delete(object.id);
    }
    upserts.sort((left, right) => left.id.localeCompare(right.id));
    removals.sort((left, right) => left.id.localeCompare(right.id));

    const consolePrefix = isConsolePrefix(this.current.console, next.console);
    const transient = consolePrefix ? next.console.slice(this.current.console.length) : next.console;
    const previousSequence = this.sequence;
    this.sequence += 1;
    this.current = next;
    return {
      protocol: REPLICATION_PROTOCOL,
      kind: "delta",
      subscriptionId: AUTOMATION_SUBSCRIPTION_ID,
      schemaCatalogHash: AUTOMATION_SCHEMA_CATALOG_HASH,
      snapshotId: this.snapshotId,
      baseSnapshotId: this.snapshotId,
      sequence: this.sequence,
      previousSequence,
      step: next.state.tick,
      frameId: `delta:${this.snapshotId}:${this.sequence}:${next.state.tick}`,
      dynamicState: dynamicStateOf(next.state),
      upserts,
      removals,
      transient,
      transientMode: consolePrefix ? "append" : "replace"
    };
  }

  private keyframe(
    snapshot: GameSnapshot
  ): ReplicationKeyframe<
    ReturnType<typeof staticStateOf>,
    ReturnType<typeof dynamicStateOf>,
    WorldObject,
    GameSnapshot["console"]
  > {
    return {
      protocol: REPLICATION_PROTOCOL,
      kind: "keyframe",
      subscriptionId: AUTOMATION_SUBSCRIPTION_ID,
      schemaCatalogHash: AUTOMATION_SCHEMA_CATALOG_HASH,
      snapshotId: this.snapshotId,
      sequence: this.sequence,
      step: snapshot.state.tick,
      frameId: `keyframe:${this.snapshotId}:${this.sequence}:${snapshot.state.tick}`,
      staticState: staticStateOf(snapshot.state),
      dynamicState: dynamicStateOf(snapshot.state),
      records: snapshot.state.objects
        .map((object) => ({
          id: object.id,
          revision: this.revisions.get(object.id) ?? 1,
          value: object
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      transient: snapshot.console
    };
  }
}

function requiresNewBaseline(previous: GameSnapshot, next: GameSnapshot): boolean {
  const left = previous.state;
  const right = next.state;
  return (
    right.tick < left.tick ||
    left.version !== right.version ||
    left.roomName !== right.roomName ||
    left.width !== right.width ||
    left.height !== right.height ||
    left.terrain.length !== right.terrain.length ||
    left.terrain.some((terrain, index) => terrain !== right.terrain[index])
  );
}

function objectsEqual(left: WorldObject, right: WorldObject): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isConsolePrefix(previous: GameSnapshot["console"], next: GameSnapshot["console"]): boolean {
  return (
    previous.length <= next.length &&
    previous.every((entry, index) => entry.id === next[index]?.id)
  );
}
