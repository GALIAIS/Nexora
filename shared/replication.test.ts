import { describe, expect, it, vi } from "vitest";
import {
  REPLICATION_PROTOCOL,
  ReplicationStore,
  type ReplicationDelta,
  type ReplicationKeyframe
} from "./replication";

interface RecordValue {
  name: string;
}

type Keyframe = ReplicationKeyframe<{ map: string }, { tickLabel: string }, RecordValue, string[]>;
type Delta = ReplicationDelta<{ tickLabel: string }, RecordValue, string[]>;

function keyframe(sequence = 10): Keyframe {
  return {
    protocol: REPLICATION_PROTOCOL,
    kind: "keyframe",
    subscriptionId: "test.subscription",
    schemaCatalogHash: "sha256:test-catalog",
    snapshotId: 7,
    sequence,
    step: 4,
    frameId: `keyframe:${sequence}`,
    staticState: { map: "alpha" },
    dynamicState: { tickLabel: "four" },
    records: [{ id: "entity.alpha", revision: 2, value: { name: "Alpha" } }],
    transient: ["ready"]
  };
}

function delta(overrides: Partial<Delta> = {}): Delta {
  return {
    protocol: REPLICATION_PROTOCOL,
    kind: "delta",
    subscriptionId: "test.subscription",
    schemaCatalogHash: "sha256:test-catalog",
    snapshotId: 7,
    baseSnapshotId: 7,
    sequence: 11,
    previousSequence: 10,
    step: 5,
    frameId: "delta:11",
    dynamicState: { tickLabel: "five" },
    upserts: [
      {
        id: "entity.alpha",
        expectedRevision: 2,
        revision: 3,
        value: { name: "Alpha 2" }
      },
      { id: "entity.beta", revision: 1, value: { name: "Beta" } }
    ],
    removals: [],
    transient: ["advanced"],
    transientMode: "append",
    ...overrides
  };
}

function store(now = vi.fn(() => 1000)) {
  return new ReplicationStore<{ map: string }, { tickLabel: string }, RecordValue, string[]>({
    mergeTransient: (current, incoming) => [...current, ...incoming],
    now
  });
}

describe("ReplicationStore", () => {
  it("atomically applies a keyframe and contiguous delta", () => {
    const target = store();
    expect(target.apply(keyframe())).toEqual({ status: "applied", sequence: 10 });
    expect(target.apply(delta())).toEqual({ status: "applied", sequence: 11 });
    const snapshot = target.snapshot();
    expect(snapshot?.sequence).toBe(11);
    expect(snapshot?.step).toBe(5);
    expect(snapshot?.dynamicState.tickLabel).toBe("five");
    expect(snapshot?.records.get("entity.alpha")).toEqual({
      id: "entity.alpha",
      revision: 3,
      value: { name: "Alpha 2" }
    });
    expect(snapshot?.records.get("entity.beta")?.revision).toBe(1);
    expect(snapshot?.transient).toEqual(["ready", "advanced"]);
  });

  it("suppresses exact duplicates and rejects sequence reuse", () => {
    const target = store();
    target.apply(keyframe());
    const frame = delta();
    target.apply(frame);
    expect(target.apply(frame)).toEqual({ status: "duplicate", sequence: 11 });
    expect(
      target.apply({ ...frame, frameId: "delta:11:corrupt" })
    ).toEqual({
      status: "reset-required",
      reason: "sequence-reused-with-different-frame"
    });
  });

  it("requires reset for gaps, wrong baselines, and schema changes", () => {
    const target = store();
    target.apply(keyframe());
    expect(
      target.apply(delta({ sequence: 12, previousSequence: 11, frameId: "delta:12" }))
    ).toEqual({ status: "reset-required", reason: "sequence-gap" });
    expect(target.apply(delta({ baseSnapshotId: 8 }))).toEqual({
      status: "reset-required",
      reason: "baseline-mismatch"
    });
    expect(target.apply(delta({ schemaCatalogHash: "sha256:other" }))).toEqual({
      status: "reset-required",
      reason: "schema-catalog-changed"
    });
  });

  it("does not expose partial writes when one mutation conflicts", () => {
    const target = store();
    target.apply(keyframe());
    const conflicting = delta({
      upserts: [
        { id: "entity.beta", revision: 1, value: { name: "Beta" } },
        {
          id: "entity.alpha",
          expectedRevision: 99,
          revision: 100,
          value: { name: "Corrupt" }
        }
      ]
    });
    expect(target.apply(conflicting)).toEqual({
      status: "reset-required",
      reason: "revision-conflict:entity.alpha"
    });
    expect(target.snapshot()?.records.has("entity.beta")).toBe(false);
    expect(target.snapshot()?.records.get("entity.alpha")?.revision).toBe(2);
    expect(target.snapshot()?.sequence).toBe(10);
  });

  it("allows an authoritative newer keyframe to replace the baseline", () => {
    const target = store();
    target.apply(keyframe());
    target.apply(delta());
    const replacement = keyframe(12);
    replacement.snapshotId = 8;
    replacement.step = 2;
    replacement.frameId = "keyframe:replacement";
    replacement.records = [{ id: "entity.gamma", revision: 1, value: { name: "Gamma" } }];
    expect(target.apply(replacement)).toEqual({ status: "applied", sequence: 12 });
    expect(target.snapshot()?.snapshotId).toBe(8);
    expect(target.snapshot()?.records.has("entity.alpha")).toBe(false);
    expect(target.snapshot()?.records.has("entity.gamma")).toBe(true);
  });

  it("notifies subscribers only for applied state changes", () => {
    const target = store();
    const listener = vi.fn();
    const unsubscribe = target.subscribe(listener);
    const frame = keyframe();
    target.apply(frame);
    target.apply(frame);
    target.apply(delta({ sequence: 20 }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    target.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
