import { describe, expect, it } from "vitest";
import type { SourceObject, SpawnObject, UnitObject } from "../../shared/types";
import { processTick } from "./processor";
import { ScriptRuntime } from "./runtime";
import { createWorld, isWall } from "./world";

describe("world generation", () => {
  it("is deterministic and keeps game objects on walkable cells", () => {
    const first = createWorld("test-seed");
    const second = createWorld("test-seed");

    expect(first.terrain).toEqual(second.terrain);
    for (const object of first.objects) {
      expect(isWall(first, object)).toBe(false);
    }
  });
});

describe("intent processor", () => {
  it("harvests energy only when a unit is in range", () => {
    const state = createWorld();
    const unit = state.objects.find((object): object is UnitObject => object.kind === "unit")!;
    const source = state.objects.find((object): object is SourceObject => object.kind === "source")!;
    unit.x = source.x + 1;
    unit.y = source.y;

    processTick(state, [{ type: "harvest", objectId: unit.id, targetId: source.id }]);

    expect(unit.energy).toBe(2);
    expect(source.energy).toBe(source.capacity - 2);
    expect(state.stats.energyHarvested).toBe(2);
  });

  it("spawns a unit and charges its body cost", () => {
    const state = createWorld();
    const spawn = state.objects.find((object): object is SpawnObject => object.kind === "spawn")!;

    processTick(state, [
      { type: "spawn", objectId: spawn.id, name: "Scout-1", body: ["work", "carry", "move"] }
    ]);

    expect(state.objects.some((object) => object.kind === "unit" && object.name === "Scout-1")).toBe(true);
    expect(spawn.energy).toBe(100);
  });

  it("does not move a unit away from an adjacent occupied target", () => {
    const state = createWorld();
    const unit = state.objects.find((object): object is UnitObject => object.kind === "unit")!;
    const spawn = state.objects.find((object): object is SpawnObject => object.kind === "spawn")!;
    unit.x = spawn.x + 1;
    unit.y = spawn.y;

    processTick(state, [{ type: "move", objectId: unit.id, target: { x: spawn.x, y: spawn.y } }]);

    expect({ x: unit.x, y: unit.y }).toEqual({ x: spawn.x + 1, y: spawn.y });
  });
});

describe("script runtime", () => {
  it("collects intents and persists JSON memory", () => {
    const state = createWorld();
    const runtime = new ScriptRuntime();
    const result = runtime.execute(
      `
      Memory.runs = (Memory.runs ?? 0) + 1;
      const unit = Game.units["Worker-1"];
      unit.moveTo(Game.sources[0]);
      unit.say("online");
      console.log("run", Memory.runs);
      `,
      state
    );

    expect(result.error).toBeUndefined();
    expect(result.memory.runs).toBe(1);
    expect(result.intents.map((intent) => intent.type).sort()).toEqual(["move", "say"]);
    expect(result.console[0]?.message).toBe("run 1");
  });

  it("reports the same tick exposed through Game", () => {
    const state = createWorld();
    state.tick = 41;
    const runtime = new ScriptRuntime();
    const result = runtime.execute("console.log(Game.tick);", state);

    expect(result.console[0]?.tick).toBe(41);
    expect(result.console[0]?.message).toBe("41");
  });
});
