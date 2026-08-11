export type GameStatus = "running" | "paused";
export type TerrainType = "plain" | "wall" | "swamp";
export type BodyPart = "move" | "work" | "carry";
export type ObjectKind = "unit" | "spawn" | "source" | "controller";
export type ConsoleLevel = "log" | "warn" | "error" | "system";

export interface Position {
  x: number;
  y: number;
}

export interface BaseWorldObject extends Position {
  id: string;
  kind: ObjectKind;
}

export interface UnitObject extends BaseWorldObject {
  kind: "unit";
  name: string;
  body: BodyPart[];
  energy: number;
  capacity: number;
  hits: number;
  hitsMax: number;
  fatigue: number;
  lastAction?: ActionEvent;
  say?: string;
  sayUntil?: number;
}

export interface SpawnObject extends BaseWorldObject {
  kind: "spawn";
  name: string;
  energy: number;
  capacity: number;
  cooldown: number;
}

export interface SourceObject extends BaseWorldObject {
  kind: "source";
  energy: number;
  capacity: number;
}

export interface ControllerObject extends BaseWorldObject {
  kind: "controller";
  level: number;
  progress: number;
  progressTotal: number;
}

export type WorldObject = UnitObject | SpawnObject | SourceObject | ControllerObject;

export interface ActionEvent {
  type: "move" | "harvest" | "transfer" | "upgrade" | "spawn";
  targetId?: string;
  amount?: number;
  from?: Position;
}

export interface WorldStats {
  energyHarvested: number;
  energyDelivered: number;
  controllerProgress: number;
  unitsCreated: number;
  runtimeMs: number;
  intents: number;
}

export interface WorldState {
  version: 1;
  roomName: string;
  width: number;
  height: number;
  tick: number;
  status: GameStatus;
  tickRate: number;
  terrain: TerrainType[];
  objects: WorldObject[];
  stats: WorldStats;
  memory: Record<string, unknown>;
}

export interface ConsoleEntry {
  id: string;
  tick: number;
  level: ConsoleLevel;
  message: string;
  timestamp: string;
}

export interface GameSnapshot {
  state: WorldState;
  console: ConsoleEntry[];
  connectedAt?: string;
}

export interface MoveIntent {
  type: "move";
  objectId: string;
  target: Position;
}

export interface HarvestIntent {
  type: "harvest";
  objectId: string;
  targetId: string;
}

export interface TransferIntent {
  type: "transfer";
  objectId: string;
  targetId: string;
}

export interface UpgradeIntent {
  type: "upgrade";
  objectId: string;
  targetId: string;
}

export interface SpawnIntent {
  type: "spawn";
  objectId: string;
  name: string;
  body: BodyPart[];
}

export interface SayIntent {
  type: "say";
  objectId: string;
  message: string;
}

export type Intent =
  | MoveIntent
  | HarvestIntent
  | TransferIntent
  | UpgradeIntent
  | SpawnIntent
  | SayIntent;

export interface RuntimeResult {
  intents: Intent[];
  memory: Record<string, unknown>;
  console: Omit<ConsoleEntry, "id" | "timestamp">[];
  runtimeMs: number;
  error?: string;
}

export interface ApiReferenceItem {
  signature: string;
  description: string;
  returns?: string;
}

export interface CodePayload {
  code: string;
  updatedAt: string;
}

export interface ControlPayload {
  command: "start" | "pause" | "step" | "reset";
}

export interface SettingsPayload {
  tickRate: number;
}
