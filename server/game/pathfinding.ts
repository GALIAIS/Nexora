import type { Position, WorldState } from "../../shared/types";
import { distance, isInside, isWall, positionKey } from "./world";

const DIRECTIONS: Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 }
];

interface Node extends Position {
  firstStep: Position;
}

export function findNextStep(
  state: WorldState,
  start: Position,
  target: Position,
  movingObjectId: string
): Position | undefined {
  const targetOccupied = state.objects.some(
    (object) => object.id !== movingObjectId && object.x === target.x && object.y === target.y
  );
  if ((targetOccupied && distance(start, target) <= 1) || (!targetOccupied && distance(start, target) === 0)) {
    return undefined;
  }
  const occupied = new Set(
    state.objects
      .filter((object) => object.id !== movingObjectId && (object.kind !== "unit" || object.hits > 0))
      .map(positionKey)
  );
  const visited = new Set<string>([positionKey(start)]);
  const queue: Node[] = [];

  for (const direction of DIRECTIONS) {
    const next = { x: start.x + direction.x, y: start.y + direction.y };
    if (canVisit(state, next, occupied, visited)) {
      visited.add(positionKey(next));
      queue.push({ ...next, firstStep: next });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const reached = targetOccupied ? distance(current, target) <= 1 : distance(current, target) === 0;
    if (reached) {
      return current.firstStep;
    }

    const sortedDirections = [...DIRECTIONS].sort((left, right) => {
      const leftDistance = distance(
        { x: current.x + left.x, y: current.y + left.y },
        target
      );
      const rightDistance = distance(
        { x: current.x + right.x, y: current.y + right.y },
        target
      );
      return leftDistance - rightDistance;
    });

    for (const direction of sortedDirections) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (!canVisit(state, next, occupied, visited)) {
        continue;
      }
      visited.add(positionKey(next));
      queue.push({ ...next, firstStep: current.firstStep });
    }
  }

  return undefined;
}

function canVisit(
  state: WorldState,
  position: Position,
  occupied: Set<string>,
  visited: Set<string>
): boolean {
  const key = positionKey(position);
  return isInside(state, position) && !isWall(state, position) && !occupied.has(key) && !visited.has(key);
}
