export const REPLICATION_PROTOCOL = "nexora.replication.v1" as const;

export interface RevisionedRecord<TRecord> {
  id: string;
  revision: number;
  value: TRecord;
}

interface FrameHeader {
  protocol: typeof REPLICATION_PROTOCOL;
  subscriptionId: string;
  schemaCatalogHash: string;
  snapshotId: number;
  sequence: number;
  step: number;
  frameId: string;
}

export interface ReplicationKeyframe<TStatic, TDynamic, TRecord, TTransient>
  extends FrameHeader {
  kind: "keyframe";
  staticState: TStatic;
  dynamicState: TDynamic;
  records: RevisionedRecord<TRecord>[];
  transient: TTransient;
}

export interface RecordUpsert<TRecord> extends RevisionedRecord<TRecord> {
  expectedRevision?: number;
}

export interface RecordRemoval {
  id: string;
  expectedRevision: number;
}

export interface ReplicationDelta<TDynamic, TRecord, TTransient> extends FrameHeader {
  kind: "delta";
  baseSnapshotId: number;
  previousSequence: number;
  dynamicState: TDynamic;
  upserts: RecordUpsert<TRecord>[];
  removals: RecordRemoval[];
  transient: TTransient;
  transientMode: "append" | "replace";
}

export type ReplicationFrame<TStatic, TDynamic, TRecord, TTransient> =
  | ReplicationKeyframe<TStatic, TDynamic, TRecord, TTransient>
  | ReplicationDelta<TDynamic, TRecord, TTransient>;

export type ApplyResult =
  | { status: "applied"; sequence: number }
  | { status: "duplicate"; sequence: number }
  | { status: "reset-required"; reason: string }
  | { status: "rejected"; reason: string };

export interface ReplicationSnapshot<TStatic, TDynamic, TRecord, TTransient> {
  subscriptionId: string;
  schemaCatalogHash: string;
  snapshotId: number;
  sequence: number;
  step: number;
  staticState: TStatic;
  dynamicState: TDynamic;
  records: ReadonlyMap<string, RevisionedRecord<TRecord>>;
  transient: TTransient;
  appliedAt: number;
}

export interface ReplicationStoreOptions<TTransient> {
  mergeTransient: (current: TTransient, incoming: TTransient) => TTransient;
  now?: () => number;
  duplicateWindow?: number;
}

export class ReplicationStore<TStatic, TDynamic, TRecord, TTransient> {
  private current?: ReplicationSnapshot<TStatic, TDynamic, TRecord, TTransient>;
  private readonly frameHistory = new Map<number, string>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly duplicateWindow: number;

  constructor(private readonly options: ReplicationStoreOptions<TTransient>) {
    this.now = options.now ?? Date.now;
    this.duplicateWindow = Math.max(8, options.duplicateWindow ?? 256);
  }

  apply(frame: ReplicationFrame<TStatic, TDynamic, TRecord, TTransient>): ApplyResult {
    const headerError = validateHeader(frame);
    if (headerError) {
      return { status: "rejected", reason: headerError };
    }
    if (frame.kind === "keyframe") {
      return this.applyKeyframe(frame);
    }
    return this.applyDelta(frame);
  }

  snapshot(): ReplicationSnapshot<TStatic, TDynamic, TRecord, TTransient> | undefined {
    return this.current;
  }

  record(id: string): RevisionedRecord<TRecord> | undefined {
    return this.current?.records.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.current = undefined;
    this.frameHistory.clear();
    this.publish();
  }

  private applyKeyframe(
    frame: ReplicationKeyframe<TStatic, TDynamic, TRecord, TTransient>
  ): ApplyResult {
    const duplicate = this.detectDuplicate(frame.sequence, frame.frameId);
    if (duplicate) {
      return duplicate;
    }
    if (this.current && frame.sequence < this.current.sequence) {
      return { status: "reset-required", reason: "stale-keyframe" };
    }
    const records = new Map<string, RevisionedRecord<TRecord>>();
    for (const record of frame.records) {
      const error = validateRecord(record);
      if (error) {
        return { status: "rejected", reason: error };
      }
      if (records.has(record.id)) {
        return { status: "rejected", reason: `duplicate-keyframe-record:${record.id}` };
      }
      records.set(record.id, record);
    }
    this.current = {
      subscriptionId: frame.subscriptionId,
      schemaCatalogHash: frame.schemaCatalogHash,
      snapshotId: frame.snapshotId,
      sequence: frame.sequence,
      step: frame.step,
      staticState: frame.staticState,
      dynamicState: frame.dynamicState,
      records,
      transient: frame.transient,
      appliedAt: this.now()
    };
    this.rememberFrame(frame.sequence, frame.frameId);
    this.publish();
    return { status: "applied", sequence: frame.sequence };
  }

  private applyDelta(frame: ReplicationDelta<TDynamic, TRecord, TTransient>): ApplyResult {
    const duplicate = this.detectDuplicate(frame.sequence, frame.frameId);
    if (duplicate) {
      return duplicate;
    }
    const current = this.current;
    if (!current) {
      return { status: "reset-required", reason: "missing-keyframe" };
    }
    if (frame.subscriptionId !== current.subscriptionId) {
      return { status: "reset-required", reason: "subscription-changed" };
    }
    if (frame.schemaCatalogHash !== current.schemaCatalogHash) {
      return { status: "reset-required", reason: "schema-catalog-changed" };
    }
    if (frame.baseSnapshotId !== current.snapshotId) {
      return { status: "reset-required", reason: "baseline-mismatch" };
    }
    if (frame.previousSequence !== current.sequence || frame.sequence !== current.sequence + 1) {
      return { status: "reset-required", reason: "sequence-gap" };
    }
    if (frame.step < current.step) {
      return { status: "reset-required", reason: "step-regression" };
    }

    const records = new Map(current.records);
    const touched = new Set<string>();
    for (const upsert of frame.upserts) {
      const error = validateRecord(upsert);
      if (error) {
        return { status: "rejected", reason: error };
      }
      if (!touched.add(upsert.id)) {
        return { status: "rejected", reason: `record-mutated-twice:${upsert.id}` };
      }
      const existing = records.get(upsert.id);
      if (existing) {
        if (upsert.expectedRevision !== existing.revision) {
          return { status: "reset-required", reason: `revision-conflict:${upsert.id}` };
        }
        if (upsert.revision <= existing.revision) {
          return { status: "rejected", reason: `revision-not-advanced:${upsert.id}` };
        }
      } else if (upsert.expectedRevision !== undefined) {
        return { status: "reset-required", reason: `missing-upsert-record:${upsert.id}` };
      }
      records.set(upsert.id, {
        id: upsert.id,
        revision: upsert.revision,
        value: upsert.value
      });
    }
    for (const removal of frame.removals) {
      if (!validateId(removal.id) || !isPositiveInteger(removal.expectedRevision)) {
        return { status: "rejected", reason: "invalid-record-removal" };
      }
      if (!touched.add(removal.id)) {
        return { status: "rejected", reason: `record-mutated-twice:${removal.id}` };
      }
      const existing = records.get(removal.id);
      if (!existing || existing.revision !== removal.expectedRevision) {
        return { status: "reset-required", reason: `revision-conflict:${removal.id}` };
      }
      records.delete(removal.id);
    }

    this.current = {
      ...current,
      sequence: frame.sequence,
      step: frame.step,
      dynamicState: frame.dynamicState,
      records,
      transient:
        frame.transientMode === "replace"
          ? frame.transient
          : this.options.mergeTransient(current.transient, frame.transient),
      appliedAt: this.now()
    };
    this.rememberFrame(frame.sequence, frame.frameId);
    this.publish();
    return { status: "applied", sequence: frame.sequence };
  }

  private detectDuplicate(sequence: number, frameId: string): ApplyResult | undefined {
    const known = this.frameHistory.get(sequence);
    if (known === frameId) {
      return { status: "duplicate", sequence };
    }
    if (known !== undefined && known !== frameId) {
      return { status: "reset-required", reason: "sequence-reused-with-different-frame" };
    }
    return undefined;
  }

  private rememberFrame(sequence: number, frameId: string): void {
    this.frameHistory.set(sequence, frameId);
    while (this.frameHistory.size > this.duplicateWindow) {
      const oldest = this.frameHistory.keys().next().value as number | undefined;
      if (oldest === undefined) {
        break;
      }
      this.frameHistory.delete(oldest);
    }
  }

  private publish(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function validateHeader(frame: {
  protocol: string;
  subscriptionId: string;
  schemaCatalogHash: string;
  snapshotId: number;
  sequence: number;
  step: number;
  frameId: string;
}): string | undefined {
  if (frame.protocol !== REPLICATION_PROTOCOL) return "unsupported-protocol";
  if (!validateId(frame.subscriptionId)) return "invalid-subscription-id";
  if (!validateId(frame.schemaCatalogHash)) return "invalid-schema-catalog-hash";
  if (!isPositiveInteger(frame.snapshotId)) return "invalid-snapshot-id";
  if (!isPositiveInteger(frame.sequence)) return "invalid-sequence";
  if (!Number.isSafeInteger(frame.step) || frame.step < 0) return "invalid-step";
  if (!validateId(frame.frameId)) return "invalid-frame-id";
  return undefined;
}

function validateRecord(record: RevisionedRecord<unknown>): string | undefined {
  if (!validateId(record.id)) return "invalid-record-id";
  if (!isPositiveInteger(record.revision)) return `invalid-record-revision:${record.id}`;
  return undefined;
}

function validateId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
