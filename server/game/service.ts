import { EventEmitter } from "node:events";
import type {
  CodePayload,
  ConsoleEntry,
  ControlPayload,
  GameSnapshot,
  GameStatus,
  SettingsPayload,
  WorldState
} from "../../shared/types";
import { loadCode, loadWorld, saveCode, saveWorld } from "../persistence";
import { MAX_CONSOLE_ENTRIES, MAX_TICK_RATE, MIN_TICK_RATE } from "./constants";
import { processTick } from "./processor";
import { ScriptRuntime } from "./runtime";
import { cloneWorld, createWorld } from "./world";

export class GameService extends EventEmitter {
  private readonly runtime = new ScriptRuntime();
  private state: WorldState;
  private code: string;
  private consoleEntries: ConsoleEntry[] = [];
  private interval: NodeJS.Timeout | undefined;
  private processing = false;

  private constructor(state: WorldState, code: string) {
    super();
    this.state = state;
    this.code = code;
  }

  static async create(): Promise<GameService> {
    const [state, code] = await Promise.all([loadWorld(), loadCode()]);
    const service = new GameService(state, code);
    service.appendConsole("system", `World ${state.roomName} loaded at tick ${state.tick}.`);
    if (state.status === "running") {
      service.startTimer();
    }
    return service;
  }

  getSnapshot(): GameSnapshot {
    return {
      state: cloneWorld(this.state),
      console: structuredClone(this.consoleEntries)
    };
  }

  getCode(): CodePayload {
    return { code: this.code, updatedAt: new Date().toISOString() };
  }

  async updateCode(code: string): Promise<CodePayload> {
    const validationError = this.runtime.validate(code);
    if (validationError) {
      throw new SyntaxError(validationError);
    }
    this.code = code;
    await saveCode(code);
    this.appendConsole("system", "Player program saved. It will run on the next tick.");
    this.publish();
    return this.getCode();
  }

  async control(command: ControlPayload["command"]): Promise<GameSnapshot> {
    if (command === "start") {
      this.setStatus("running");
      this.startTimer();
      this.appendConsole("system", `Simulation running at ${this.state.tickRate} ms per tick.`);
    } else if (command === "pause") {
      this.setStatus("paused");
      this.stopTimer();
      this.appendConsole("system", "Simulation paused.");
    } else if (command === "step") {
      if (this.state.status !== "paused") {
        this.setStatus("paused");
        this.stopTimer();
      }
      await this.step();
      return this.getSnapshot();
    } else if (command === "reset") {
      const tickRate = this.state.tickRate;
      this.stopTimer();
      this.state = createWorld();
      this.state.tickRate = tickRate;
      this.consoleEntries = [];
      this.appendConsole("system", "World reset to the initial seed. Player code was preserved.");
      await saveWorld(this.state);
    }

    await saveWorld(this.state);
    this.publish();
    return this.getSnapshot();
  }

  async updateSettings(settings: SettingsPayload): Promise<GameSnapshot> {
    const tickRate = Math.max(MIN_TICK_RATE, Math.min(MAX_TICK_RATE, Math.round(settings.tickRate)));
    this.state.tickRate = tickRate;
    if (this.state.status === "running") {
      this.startTimer();
    }
    this.appendConsole("system", `Tick interval set to ${tickRate} ms.`);
    await saveWorld(this.state);
    this.publish();
    return this.getSnapshot();
  }

  async step(): Promise<boolean> {
    if (this.processing) {
      return false;
    }
    this.processing = true;
    try {
      const runtimeState = cloneWorld(this.state);
      runtimeState.tick += 1;
      const runtimeResult = this.runtime.execute(this.code, runtimeState);
      this.state.memory = runtimeResult.memory;
      processTick(this.state, runtimeResult.intents);
      this.state.stats.runtimeMs = Number(runtimeResult.runtimeMs.toFixed(2));

      for (const entry of runtimeResult.console) {
        this.appendConsole(entry.level, entry.message, entry.tick);
      }
      if (runtimeResult.error) {
        this.appendConsole("error", runtimeResult.error, this.state.tick);
      }

      await saveWorld(this.state);
      this.publish();
      return true;
    } finally {
      this.processing = false;
    }
  }

  async shutdown(): Promise<void> {
    this.stopTimer();
    await saveWorld(this.state);
  }

  private setStatus(status: GameStatus): void {
    this.state.status = status;
  }

  private startTimer(): void {
    this.stopTimer();
    this.interval = setInterval(() => {
      void this.step();
    }, this.state.tickRate);
  }

  private stopTimer(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private appendConsole(level: ConsoleEntry["level"], message: string, tick = this.state.tick): void {
    this.consoleEntries.push({
      id: `${Date.now()}-${this.consoleEntries.length}`,
      tick,
      level,
      message,
      timestamp: new Date().toISOString()
    });
    if (this.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
      this.consoleEntries.splice(0, this.consoleEntries.length - MAX_CONSOLE_ENTRIES);
    }
  }

  private publish(): void {
    this.emit("snapshot", this.getSnapshot());
  }
}
