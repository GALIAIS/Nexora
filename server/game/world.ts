import type {
  ControllerObject,
  Position,
  SourceObject,
  SpawnObject,
  TerrainType,
  UnitObject,
  WorldObject,
  WorldState
} from "../../shared/types";
import { DEFAULT_TICK_RATE, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";

const PROTECTED_CELLS: Position[] = [
  { x: 8, y: 12 },
  { x: 9, y: 12 },
  { x: 6, y: 5 },
  { x: 29, y: 19 },
  { x: 28, y: 12 }
];

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isProtected(x: number, y: number): boolean {
  return PROTECTED_CELLS.some((cell) => Math.abs(cell.x - x) <= 2 && Math.abs(cell.y - y) <= 2);
}

export function terrainIndex(width: number, position: Position): number {
  return position.y * width + position.x;
}

export function createTerrain(seed = "nexora-alpha"): TerrainType[] {
  const random = mulberry32(hashSeed(seed));
  const terrain: TerrainType[] = [];

  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      const edge = x === 0 || y === 0 || x === WORLD_WIDTH - 1 || y === WORLD_HEIGHT - 1;
      const roll = random();
      let cell: TerrainType = "plain";

      if (!edge && !isProtected(x, y) && roll < 0.085) {
        cell = "wall";
      } else if (!isProtected(x, y) && roll < 0.21) {
        cell = "swamp";
      }

      terrain.push(cell);
    }
  }

  // Keep two broad travel lanes open so every generated objective remains reachable.
  for (let x = 3; x < WORLD_WIDTH - 3; x += 1) {
    terrain[terrainIndex(WORLD_WIDTH, { x, y: 12 })] = x % 7 === 0 ? "swamp" : "plain";
  }
  for (let y = 3; y < WORLD_HEIGHT - 3; y += 1) {
    terrain[terrainIndex(WORLD_WIDTH, { x: 18, y })] = y % 6 === 0 ? "swamp" : "plain";
  }

  return terrain;
}

export function createWorld(seed = "nexora-alpha"): WorldState {
  const spawn: SpawnObject = {
    id: "spawn-core",
    kind: "spawn",
    name: "Core",
    x: 8,
    y: 12,
    energy: 300,
    capacity: 300,
    cooldown: 0
  };
  const unit: UnitObject = {
    id: "unit-worker-1",
    kind: "unit",
    name: "Worker-1",
    x: 10,
    y: 12,
    body: ["work", "carry", "move"],
    energy: 0,
    capacity: 50,
    hits: 100,
    hitsMax: 100,
    fatigue: 0
  };
  const sources: SourceObject[] = [
    { id: "source-north", kind: "source", x: 6, y: 5, energy: 1_500, capacity: 1_500 },
    { id: "source-south", kind: "source", x: 29, y: 19, energy: 1_500, capacity: 1_500 }
  ];
  const controller: ControllerObject = {
    id: "controller-alpha",
    kind: "controller",
    x: 28,
    y: 12,
    level: 1,
    progress: 0,
    progressTotal: 120
  };

  return {
    version: 1,
    roomName: "N0-E0",
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tick: 0,
    status: "paused",
    tickRate: DEFAULT_TICK_RATE,
    terrain: createTerrain(seed),
    objects: [spawn, unit, ...sources, controller],
    stats: {
      energyHarvested: 0,
      energyDelivered: 0,
      controllerProgress: 0,
      unitsCreated: 1,
      runtimeMs: 0,
      intents: 0
    },
    memory: {}
  };
}

export function cloneWorld(state: WorldState): WorldState {
  return structuredClone(state);
}

export function getObject<T extends WorldObject["kind"]>(
  state: WorldState,
  id: string,
  kind?: T
): Extract<WorldObject, { kind: T }> | WorldObject | undefined {
  return state.objects.find((object) => object.id === id && (!kind || object.kind === kind));
}

export function isInside(state: WorldState, position: Position): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < state.width && position.y < state.height;
}

export function isWall(state: WorldState, position: Position): boolean {
  return state.terrain[terrainIndex(state.width, position)] === "wall";
}

export function distance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}
