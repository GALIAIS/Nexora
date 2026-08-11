import type { ApiReferenceItem, BodyPart } from "../../shared/types";

export const WORLD_WIDTH = 36;
export const WORLD_HEIGHT = 24;
export const DEFAULT_TICK_RATE = 600;
export const MIN_TICK_RATE = 150;
export const MAX_TICK_RATE = 3_000;
export const MAX_CONSOLE_ENTRIES = 160;
export const MAX_MEMORY_BYTES = 64 * 1024;
export const SCRIPT_TIMEOUT_MS = 35;

export const BODY_COST: Record<BodyPart, number> = {
  move: 50,
  work: 100,
  carry: 50
};

export const RETURN_CODES = {
  OK: 0,
  ERR_NOT_OWNER: -1,
  ERR_NO_PATH: -2,
  ERR_NAME_EXISTS: -3,
  ERR_BUSY: -4,
  ERR_NOT_FOUND: -5,
  ERR_NOT_ENOUGH_ENERGY: -6,
  ERR_INVALID_TARGET: -7,
  ERR_FULL: -8,
  ERR_NOT_IN_RANGE: -9,
  ERR_INVALID_ARGS: -10
} as const;

export const FIND_TYPES = {
  FIND_UNITS: 1,
  FIND_SOURCES: 2,
  FIND_STRUCTURES: 3
} as const;

export const API_REFERENCE: ApiReferenceItem[] = [
  {
    signature: "Game.units[name]",
    description: "Owned units keyed by name. Units expose pos, store, body and action methods."
  },
  {
    signature: "Game.spawns[name]",
    description: "Owned spawn structures keyed by name."
  },
  {
    signature: "Game.sources",
    description: "Array of energy sources visible in the room."
  },
  {
    signature: "Game.controller",
    description: "The room controller. Feed it energy to increase the room level."
  },
  {
    signature: "unit.moveTo(target)",
    description: "Queues one pathfinding step toward an object or {x, y} position.",
    returns: "OK or an ERR_* code"
  },
  {
    signature: "unit.harvest(source)",
    description: "Harvests 2 energy per WORK part when adjacent to a source.",
    returns: "OK or an ERR_* code"
  },
  {
    signature: "unit.transfer(target)",
    description: "Transfers carried energy to an adjacent spawn.",
    returns: "OK or an ERR_* code"
  },
  {
    signature: "unit.upgradeController(controller)",
    description: "Spends energy on an adjacent controller using WORK parts.",
    returns: "OK or an ERR_* code"
  },
  {
    signature: "unit.say(message)",
    description: "Shows a short message above the unit for two ticks.",
    returns: "OK"
  },
  {
    signature: "spawn.spawnUnit(body, name)",
    description: "Creates a unit on an adjacent free tile. Body parts: move, work, carry.",
    returns: "OK or an ERR_* code"
  },
  {
    signature: "Memory",
    description: "A JSON-serializable object persisted between ticks (64 KB maximum)."
  }
];
