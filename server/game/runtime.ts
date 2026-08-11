import { Script, createContext } from "node:vm";
import { performance } from "node:perf_hooks";
import type {
  BodyPart,
  ConsoleLevel,
  Intent,
  Position,
  RuntimeResult,
  SpawnObject,
  UnitObject,
  WorldObject,
  WorldState
} from "../../shared/types";
import {
  BODY_COST,
  FIND_TYPES,
  MAX_MEMORY_BYTES,
  RETURN_CODES,
  SCRIPT_TIMEOUT_MS
} from "./constants";
import { distance } from "./world";

type ApiTarget = {
  id?: string;
  x?: number;
  y?: number;
  pos?: Position;
};

class IntentCollector {
  private readonly intents = new Map<string, Intent>();

  set(category: string, intent: Intent): void {
    this.intents.set(`${intent.objectId}:${category}`, intent);
  }

  values(): Intent[] {
    return [...this.intents.values()];
  }
}

export class ScriptRuntime {
  validate(code: string): string | undefined {
    try {
      new Script(`"use strict";\n${code}`, { filename: "main.js" });
      return undefined;
    } catch (error) {
      return formatError(error);
    }
  }

  execute(code: string, state: WorldState): RuntimeResult {
    const start = performance.now();
    const collector = new IntentCollector();
    const output: RuntimeResult["console"] = [];
    const memory = structuredClone(state.memory);
    const objectById = new Map(state.objects.map((object) => [object.id, object]));
    const apiById = new Map<string, Record<string, unknown>>();
    const unitNames = new Set(
      state.objects.filter((object): object is UnitObject => object.kind === "unit").map((unit) => unit.name)
    );

    const makePosition = (position: Position) =>
      Object.freeze({
        x: position.x,
        y: position.y,
        distanceTo: (target: ApiTarget) => {
          const resolved = resolvePosition(target);
          return resolved ? distance(position, resolved) : Number.POSITIVE_INFINITY;
        },
        isNearTo: (target: ApiTarget) => {
          const resolved = resolvePosition(target);
          return resolved ? distance(position, resolved) <= 1 : false;
        },
        isEqualTo: (target: ApiTarget) => {
          const resolved = resolvePosition(target);
          return resolved ? distance(position, resolved) === 0 : false;
        }
      });

    const makeUnit = (unit: UnitObject) => {
      const api = {
        id: unit.id,
        kind: unit.kind,
        name: unit.name,
        pos: makePosition(unit),
        body: Object.freeze([...unit.body]),
        store: Object.freeze({ energy: unit.energy, capacity: unit.capacity }),
        hits: unit.hits,
        hitsMax: unit.hitsMax,
        moveTo: (target: ApiTarget) => {
          const position = resolvePosition(target);
          if (!position) {
            return RETURN_CODES.ERR_INVALID_TARGET;
          }
          collector.set("move", { type: "move", objectId: unit.id, target: position });
          return RETURN_CODES.OK;
        },
        harvest: (target: ApiTarget) => queueTargetIntent("harvest", unit.id, target, collector),
        transfer: (target: ApiTarget) => queueTargetIntent("transfer", unit.id, target, collector),
        upgradeController: (target: ApiTarget) => queueTargetIntent("upgrade", unit.id, target, collector),
        say: (message: unknown) => {
          collector.set("say", {
            type: "say",
            objectId: unit.id,
            message: String(message).slice(0, 18)
          });
          return RETURN_CODES.OK;
        }
      };
      return Object.freeze(api);
    };

    const makeObject = (object: WorldObject): Record<string, unknown> => {
      if (apiById.has(object.id)) {
        return apiById.get(object.id) as Record<string, unknown>;
      }

      let api: Record<string, unknown>;
      if (object.kind === "unit") {
        api = makeUnit(object);
      } else if (object.kind === "spawn") {
        api = makeSpawn(object, makePosition, collector, unitNames);
      } else if (object.kind === "source") {
        api = Object.freeze({
          id: object.id,
          kind: object.kind,
          pos: makePosition(object),
          energy: object.energy,
          capacity: object.capacity
        });
      } else {
        api = Object.freeze({
          id: object.id,
          kind: object.kind,
          pos: makePosition(object),
          level: object.level,
          progress: object.progress,
          progressTotal: object.progressTotal
        });
      }
      apiById.set(object.id, api);
      return api;
    };

    const units = Object.fromEntries(
      state.objects
        .filter((object): object is UnitObject => object.kind === "unit")
        .map((unit) => [unit.name, makeObject(unit)])
    );
    const spawns = Object.fromEntries(
      state.objects
        .filter((object): object is SpawnObject => object.kind === "spawn")
        .map((spawn) => [spawn.name, makeObject(spawn)])
    );
    const sources = state.objects.filter((object) => object.kind === "source").map(makeObject);
    const controller = state.objects.find((object) => object.kind === "controller");
    const structures = state.objects.filter(
      (object) => object.kind === "spawn" || object.kind === "controller"
    );

    const game = Object.freeze({
      tick: state.tick,
      roomName: state.roomName,
      units: Object.freeze(units),
      spawns: Object.freeze(spawns),
      sources: Object.freeze(sources),
      controller: controller ? makeObject(controller) : undefined,
      getObjectById: (id: string) => {
        const object = objectById.get(String(id));
        return object ? makeObject(object) : null;
      },
      find: (type: number) => {
        if (type === FIND_TYPES.FIND_UNITS) {
          return Object.freeze(Object.values(units));
        }
        if (type === FIND_TYPES.FIND_SOURCES) {
          return Object.freeze([...sources]);
        }
        if (type === FIND_TYPES.FIND_STRUCTURES) {
          return Object.freeze(structures.map(makeObject));
        }
        return Object.freeze([]);
      }
    });

    const runtimeConsole = Object.freeze({
      log: (...values: unknown[]) => pushConsole(output, state.tick, "log", values),
      warn: (...values: unknown[]) => pushConsole(output, state.tick, "warn", values),
      error: (...values: unknown[]) => pushConsole(output, state.tick, "error", values)
    });

    const sandbox: Record<string, unknown> = {
      Game: game,
      Memory: memory,
      console: runtimeConsole,
      ...RETURN_CODES,
      ...FIND_TYPES,
      MOVE: "move",
      WORK: "work",
      CARRY: "carry"
    };
    const context = createContext(sandbox, {
      name: "nexora-player-runtime",
      codeGeneration: { strings: false, wasm: false }
    });

    let errorMessage: string | undefined;
    try {
      const script = new Script(`"use strict";\n${code}`, { filename: "main.js" });
      script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS, breakOnSigint: true });
    } catch (error) {
      errorMessage = formatError(error);
    }

    let persistedMemory = state.memory;
    try {
      const serialized = JSON.stringify(context.Memory);
      if (serialized === undefined) {
        throw new Error("Memory must be a JSON object");
      }
      if (Buffer.byteLength(serialized, "utf8") > MAX_MEMORY_BYTES) {
        throw new Error(`Memory exceeds ${MAX_MEMORY_BYTES / 1024} KB`);
      }
      const parsed: unknown = JSON.parse(serialized);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Memory must remain an object");
      }
      persistedMemory = parsed as Record<string, unknown>;
    } catch (memoryError) {
      const message = formatError(memoryError);
      pushConsole(output, state.tick, "error", [`Memory was not saved: ${message}`]);
    }

    return {
      intents: collector.values(),
      memory: persistedMemory,
      console: output,
      runtimeMs: performance.now() - start,
      error: errorMessage
    };
  }
}

function makeSpawn(
  spawn: SpawnObject,
  makePosition: (position: Position) => object,
  collector: IntentCollector,
  unitNames: Set<string>
): Record<string, unknown> {
  let plannedEnergy = spawn.energy;
  return Object.freeze({
    id: spawn.id,
    kind: spawn.kind,
    name: spawn.name,
    pos: makePosition(spawn),
    store: Object.freeze({ energy: spawn.energy, capacity: spawn.capacity }),
    cooldown: spawn.cooldown,
    spawnUnit: (bodyValue: unknown, nameValue: unknown) => {
      if (!Array.isArray(bodyValue) || bodyValue.length < 2 || bodyValue.length > 12) {
        return RETURN_CODES.ERR_INVALID_ARGS;
      }
      const body = bodyValue.map(String) as BodyPart[];
      if (!body.every((part) => part in BODY_COST)) {
        return RETURN_CODES.ERR_INVALID_ARGS;
      }
      const name = String(nameValue ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
        return RETURN_CODES.ERR_INVALID_ARGS;
      }
      if (unitNames.has(name)) {
        return RETURN_CODES.ERR_NAME_EXISTS;
      }
      if (spawn.cooldown > 0) {
        return RETURN_CODES.ERR_BUSY;
      }
      const cost = body.reduce((sum, part) => sum + BODY_COST[part], 0);
      if (plannedEnergy < cost) {
        return RETURN_CODES.ERR_NOT_ENOUGH_ENERGY;
      }
      collector.set("spawn", { type: "spawn", objectId: spawn.id, name, body });
      plannedEnergy -= cost;
      unitNames.add(name);
      return RETURN_CODES.OK;
    }
  });
}

function queueTargetIntent(
  type: "harvest" | "transfer" | "upgrade",
  objectId: string,
  target: ApiTarget,
  collector: IntentCollector
): number {
  if (!target || typeof target.id !== "string") {
    return RETURN_CODES.ERR_INVALID_TARGET;
  }
  collector.set("action", { type, objectId, targetId: target.id });
  return RETURN_CODES.OK;
}

function resolvePosition(target: ApiTarget | undefined): Position | undefined {
  const candidate = target?.pos ?? target;
  if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
    return undefined;
  }
  return { x: Math.trunc(candidate.x as number), y: Math.trunc(candidate.y as number) };
}

function pushConsole(
  output: RuntimeResult["console"],
  tick: number,
  level: ConsoleLevel,
  values: unknown[]
): void {
  output.push({ tick, level, message: values.map(formatValue).join(" ").slice(0, 2_000) });
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "undefined") {
    return "undefined";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.split("\n").slice(0, 5).join("\n") ?? error.message;
  }
  return String(error);
}
