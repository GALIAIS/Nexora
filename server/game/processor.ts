import type {
  BodyPart,
  ControllerObject,
  Intent,
  SourceObject,
  SpawnObject,
  UnitObject,
  WorldState
} from "../../shared/types";
import { BODY_COST } from "./constants";
import { findNextStep } from "./pathfinding";
import { distance, getObject, isInside, isWall, positionKey } from "./world";

const MAX_CONTROLLER_LEVEL = 8;

export function processTick(state: WorldState, intents: Intent[]): void {
  state.tick += 1;
  state.stats.intents = intents.length;

  for (const object of state.objects) {
    if (object.kind === "unit") {
      object.lastAction = undefined;
      if (object.sayUntil !== undefined && object.sayUntil < state.tick) {
        object.say = undefined;
        object.sayUntil = undefined;
      }
    } else if (object.kind === "spawn" && object.cooldown > 0) {
      object.cooldown -= 1;
    } else if (object.kind === "source") {
      object.energy = Math.min(object.capacity, object.energy + 4);
    }
  }

  const sorted = [...intents].sort((left, right) => left.objectId.localeCompare(right.objectId));
  applySpawnIntents(state, sorted);
  applyMoveIntents(state, sorted);
  applyActionIntents(state, sorted);
  applySayIntents(state, sorted);
}

function applySpawnIntents(state: WorldState, intents: Intent[]): void {
  const claimedNames = new Set(
    state.objects.filter((object): object is UnitObject => object.kind === "unit").map((unit) => unit.name)
  );

  for (const intent of intents) {
    if (intent.type !== "spawn") {
      continue;
    }
    const spawn = getObject(state, intent.objectId, "spawn") as SpawnObject | undefined;
    if (!spawn || spawn.cooldown > 0 || claimedNames.has(intent.name) || !validBody(intent.body)) {
      continue;
    }
    const cost = intent.body.reduce((sum, part) => sum + BODY_COST[part], 0);
    if (spawn.energy < cost) {
      continue;
    }
    const position = findOpenAdjacent(state, spawn);
    if (!position) {
      continue;
    }
    const carryParts = intent.body.filter((part) => part === "carry").length;
    const unit: UnitObject = {
      id: `unit-${state.tick}-${slug(intent.name)}`,
      kind: "unit",
      name: intent.name,
      x: position.x,
      y: position.y,
      body: [...intent.body],
      energy: 0,
      capacity: carryParts * 50,
      hits: intent.body.length * 100,
      hitsMax: intent.body.length * 100,
      fatigue: 0,
      lastAction: { type: "spawn", targetId: spawn.id }
    };
    spawn.energy -= cost;
    spawn.cooldown = Math.max(1, intent.body.length);
    state.objects.push(unit);
    state.stats.unitsCreated += 1;
    claimedNames.add(intent.name);
  }
}

function applyMoveIntents(state: WorldState, intents: Intent[]): void {
  for (const intent of intents) {
    if (intent.type !== "move") {
      continue;
    }
    const unit = getObject(state, intent.objectId, "unit") as UnitObject | undefined;
    if (!unit || unit.body.every((part) => part !== "move")) {
      continue;
    }
    const from = { x: unit.x, y: unit.y };
    const next = findNextStep(state, from, intent.target, unit.id);
    if (!next) {
      continue;
    }
    unit.x = next.x;
    unit.y = next.y;
    unit.lastAction = { type: "move", from };
  }
}

function applyActionIntents(state: WorldState, intents: Intent[]): void {
  for (const intent of intents) {
    if (intent.type === "harvest") {
      harvest(state, intent.objectId, intent.targetId);
    } else if (intent.type === "transfer") {
      transfer(state, intent.objectId, intent.targetId);
    } else if (intent.type === "upgrade") {
      upgrade(state, intent.objectId, intent.targetId);
    }
  }
}

function harvest(state: WorldState, unitId: string, sourceId: string): void {
  const unit = getObject(state, unitId, "unit") as UnitObject | undefined;
  const source = getObject(state, sourceId, "source") as SourceObject | undefined;
  if (!unit || !source || distance(unit, source) > 1 || unit.energy >= unit.capacity) {
    return;
  }
  const workParts = countParts(unit.body, "work");
  const amount = Math.min(workParts * 2, source.energy, unit.capacity - unit.energy);
  if (amount <= 0) {
    return;
  }
  source.energy -= amount;
  unit.energy += amount;
  unit.lastAction = { type: "harvest", targetId: source.id, amount };
  state.stats.energyHarvested += amount;
}

function transfer(state: WorldState, unitId: string, targetId: string): void {
  const unit = getObject(state, unitId, "unit") as UnitObject | undefined;
  const spawn = getObject(state, targetId, "spawn") as SpawnObject | undefined;
  if (!unit || !spawn || distance(unit, spawn) > 1 || unit.energy <= 0) {
    return;
  }
  const amount = Math.min(unit.energy, spawn.capacity - spawn.energy);
  if (amount <= 0) {
    return;
  }
  unit.energy -= amount;
  spawn.energy += amount;
  unit.lastAction = { type: "transfer", targetId: spawn.id, amount };
  state.stats.energyDelivered += amount;
}

function upgrade(state: WorldState, unitId: string, targetId: string): void {
  const unit = getObject(state, unitId, "unit") as UnitObject | undefined;
  const controller = getObject(state, targetId, "controller") as ControllerObject | undefined;
  if (!unit || !controller || distance(unit, controller) > 1 || unit.energy <= 0) {
    return;
  }
  const amount = Math.min(countParts(unit.body, "work"), unit.energy);
  if (amount <= 0 || controller.level >= MAX_CONTROLLER_LEVEL) {
    return;
  }
  unit.energy -= amount;
  controller.progress += amount;
  state.stats.controllerProgress += amount;
  unit.lastAction = { type: "upgrade", targetId: controller.id, amount };

  while (controller.progress >= controller.progressTotal && controller.level < MAX_CONTROLLER_LEVEL) {
    controller.progress -= controller.progressTotal;
    controller.level += 1;
    controller.progressTotal = 120 * controller.level * controller.level;
  }
}

function applySayIntents(state: WorldState, intents: Intent[]): void {
  for (const intent of intents) {
    if (intent.type !== "say") {
      continue;
    }
    const unit = getObject(state, intent.objectId, "unit") as UnitObject | undefined;
    if (!unit) {
      continue;
    }
    unit.say = intent.message.slice(0, 18);
    unit.sayUntil = state.tick + 2;
  }
}

function findOpenAdjacent(state: WorldState, origin: SpawnObject): { x: number; y: number } | undefined {
  const occupied = new Set(state.objects.map(positionKey));
  for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      if (xOffset === 0 && yOffset === 0) {
        continue;
      }
      const candidate = { x: origin.x + xOffset, y: origin.y + yOffset };
      if (isInside(state, candidate) && !isWall(state, candidate) && !occupied.has(positionKey(candidate))) {
        return candidate;
      }
    }
  }
  return undefined;
}

function validBody(body: BodyPart[]): boolean {
  return body.length >= 2 && body.length <= 12 && body.every((part) => part in BODY_COST);
}

function countParts(body: BodyPart[], part: BodyPart): number {
  return body.filter((candidate) => candidate === part).length;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}
