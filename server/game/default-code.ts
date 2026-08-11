export const DEFAULT_PLAYER_CODE = `// This program runs once per world tick.
const spawn = Game.spawns.Core;
const controller = Game.controller;

for (const unit of Object.values(Game.units)) {
  const source = Game.sources
    .slice()
    .sort((a, b) => unit.pos.distanceTo(a) - unit.pos.distanceTo(b))[0];

  if (unit.store.energy === 0) {
    if (unit.pos.isNearTo(source)) {
      unit.harvest(source);
    } else {
      unit.moveTo(source);
    }
  } else if (spawn.store.energy < spawn.store.capacity) {
    if (unit.pos.isNearTo(spawn)) {
      unit.transfer(spawn);
    } else {
      unit.moveTo(spawn);
    }
  } else if (unit.pos.isNearTo(controller)) {
    unit.upgradeController(controller);
  } else {
    unit.moveTo(controller);
  }
}

Memory.nextUnit ??= 2;
if (Object.keys(Game.units).length < 4 && spawn.store.energy >= 200) {
  const name = \`Worker-\${Memory.nextUnit}\`;
  if (spawn.spawnUnit([WORK, CARRY, MOVE], name) === OK) {
    Memory.nextUnit += 1;
    console.log(\`Queued \${name}\`);
  }
}
`;
