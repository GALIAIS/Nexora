import { describe, expect, it } from "vitest";
import { gameSnapshotOf } from "../../shared/example-replication";
import { ReplicationStore } from "../../shared/replication";
import type { ConsoleEntry, WorldObject } from "../../shared/types";
import type {
  AutomationDynamicState,
  AutomationStaticState
} from "../../shared/example-replication";
import { createWorld } from "./world";
import { AutomationReplicationEncoder } from "./replication";

function snapshot() {
  return { state: createWorld(), console: [] as ConsoleEntry[] };
}

function store() {
  return new ReplicationStore<
    AutomationStaticState,
    AutomationDynamicState,
    WorldObject,
    ConsoleEntry[]
  >({
    mergeTransient: (current, incoming) => [...current, ...incoming]
  });
}

describe("AutomationReplicationEncoder", () => {
  it("encodes object changes and console appends as a contiguous delta", () => {
    const initial = snapshot();
    const encoder = new AutomationReplicationEncoder(initial);
    const target = store();
    const keyframe = encoder.currentKeyframe();
    expect(target.apply(keyframe).status).toBe("applied");

    const next = structuredClone(initial);
    next.state.tick += 1;
    const unit = next.state.objects.find((object) => object.kind === "unit");
    expect(unit).toBeDefined();
    if (unit) {
      unit.x += 1;
    }
    next.console.push({
      id: "entry-1",
      tick: next.state.tick,
      level: "system",
      message: "advanced",
      timestamp: "2026-08-10T00:00:00.000Z"
    });
    const frame = encoder.encode(next);
    expect(frame.kind).toBe("delta");
    if (frame.kind === "delta") {
      expect(frame.previousSequence).toBe(keyframe.sequence);
      expect(frame.sequence).toBe(keyframe.sequence + 1);
      expect(frame.upserts).toHaveLength(1);
      expect(frame.transientMode).toBe("append");
      expect(frame.transient).toHaveLength(1);
    }
    expect(target.apply(frame).status).toBe("applied");
    expect(gameSnapshotOf(target.snapshot()!)).toEqual(next);
  });

  it("uses a replacement transient set when console history is truncated", () => {
    const initial = snapshot();
    initial.console = [
      {
        id: "old",
        tick: 0,
        level: "system",
        message: "old",
        timestamp: "2026-08-10T00:00:00.000Z"
      }
    ];
    const encoder = new AutomationReplicationEncoder(initial);
    const next = structuredClone(initial);
    next.console = [
      {
        id: "new",
        tick: 0,
        level: "system",
        message: "new",
        timestamp: "2026-08-10T00:00:01.000Z"
      }
    ];
    const frame = encoder.encode(next);
    expect(frame.kind).toBe("delta");
    if (frame.kind === "delta") {
      expect(frame.transientMode).toBe("replace");
      expect(frame.transient).toEqual(next.console);
    }
  });

  it("publishes a new keyframe when the world resets", () => {
    const initial = snapshot();
    initial.state.tick = 20;
    const encoder = new AutomationReplicationEncoder(initial);
    const first = encoder.currentKeyframe();
    const reset = snapshot();
    const frame = encoder.encode(reset);
    expect(frame.kind).toBe("keyframe");
    expect(frame.snapshotId).toBe(first.snapshotId + 1);
    expect(frame.sequence).toBe(first.sequence + 1);
  });

  it("does not mutate sequence when producing keyframes for new connections", () => {
    const encoder = new AutomationReplicationEncoder(snapshot());
    const first = encoder.currentKeyframe();
    const second = encoder.currentKeyframe();
    expect(second.sequence).toBe(first.sequence);
    expect(second.frameId).toBe(first.frameId);
  });
});
