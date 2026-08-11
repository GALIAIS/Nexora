import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorldState } from "../shared/types";
import { DEFAULT_PLAYER_CODE } from "./game/default-code";
import { createWorld } from "./game/world";

const WORLD_PATH = fileURLToPath(new URL("../data/world.json", import.meta.url));
const CODE_PATH = fileURLToPath(new URL("../data/player-code.js", import.meta.url));

export async function loadWorld(): Promise<WorldState> {
  try {
    const parsed = JSON.parse(await readFile(WORLD_PATH, "utf8")) as WorldState;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.objects) ||
      !Array.isArray(parsed.terrain) ||
      parsed.terrain.length !== parsed.width * parsed.height
    ) {
      throw new Error("Unsupported world file");
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) {
      return createWorld();
    }
    console.error("World data could not be loaded; creating a fresh world.", error);
    return createWorld();
  }
}

export async function saveWorld(state: WorldState): Promise<void> {
  await writeAtomic(WORLD_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export async function loadCode(): Promise<string> {
  try {
    return await readFile(CODE_PATH, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      console.error("Player code could not be loaded; using the default program.", error);
    }
    return DEFAULT_PLAYER_CODE;
  }
}

export async function saveCode(code: string): Promise<void> {
  await writeAtomic(CODE_PATH, code.endsWith("\n") ? code : `${code}\n`);
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, path);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
