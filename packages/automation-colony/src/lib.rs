//! First-party programmable automation fixture built entirely above the Kernel.

use std::collections::BTreeMap;

use nexora_foundation_core::{ContainerId, InventoryBook, ItemStack, ItemTypeId, TransferRequest};
use nexora_foundation_spatial::{
    GridBounds, GridMap, GridPoint, MoveIntent, PathRequest, SpatialIndex, resolve_moves,
};
use nexora_kernel::{
    CommandEnvelope, CommandId, CommandRejectionCode, ComponentTypeId, EntityId, EventTypeId,
    GameId, ObjectRef, PrincipalId, SchemaTypeId, TransactionError, WorldId, WorldState,
    WorldStateBuilder,
};
use nexora_package::GamePackageManifest;
use nexora_runtime::{
    BuildError, EngineHost, EngineHostBuilder, GameRuntimeDefinition, System, SystemContext,
    SystemDescriptor, SystemError,
};

const SCHEMA_VERSION: u32 = 1;
const SOURCE_REGENERATION: u64 = 4;
const UNIT_SPAWN_COST: u64 = 300;
const CONTROLLER_PROGRESS_BASE: u64 = 120;
const MAX_CONTROLLER_LEVEL: u64 = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ColonyObjectKind {
    Unit = 1,
    Spawn = 2,
    Source = 3,
    Controller = 4,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ColonyEntities {
    pub unit: EntityId,
    pub spawn: EntityId,
    pub source: EntityId,
    pub controller: EntityId,
}

pub struct AutomationColony {
    host: EngineHost,
    entities: ColonyEntities,
}

impl AutomationColony {
    pub fn new() -> Result<Self, BuildError> {
        let mut state = WorldStateBuilder::new(
            world_id(),
            "0.1.0",
            game_id(),
            "0.1.0",
            "automation-colony.content.v1",
        );
        let spawn = spawn_object(
            &mut state,
            ColonyObjectKind::Spawn,
            GridPoint { x: 2, y: 2 },
        );
        let unit = spawn_object(&mut state, ColonyObjectKind::Unit, GridPoint { x: 3, y: 2 });
        let source = spawn_object(
            &mut state,
            ColonyObjectKind::Source,
            GridPoint { x: 4, y: 2 },
        );
        let controller = spawn_object(
            &mut state,
            ColonyObjectKind::Controller,
            GridPoint { x: 3, y: 4 },
        );

        put_u64(&mut state, spawn, &energy_type(), 298);
        put_u64(&mut state, spawn, &capacity_type(), 300);
        put_u64(&mut state, spawn, &cooldown_type(), 0);

        put_u64(&mut state, unit, &energy_type(), 0);
        put_u64(&mut state, unit, &capacity_type(), 50);
        put_u64(&mut state, unit, &work_power_type(), 1);

        put_u64(&mut state, source, &energy_type(), 100);
        put_u64(&mut state, source, &capacity_type(), 300);

        put_u64(&mut state, controller, &controller_level_type(), 1);
        put_u64(&mut state, controller, &controller_progress_type(), 0);

        let mut builder = EngineHostBuilder::new(runtime_definition(), state.build());
        builder
            .register_system(MaintenanceSystem::new())
            .register_system(ProductionSystem::new())
            .register_system(MovementSystem::new())
            .register_system(ActionSystem::new());
        Ok(Self {
            host: builder.build()?,
            entities: ColonyEntities {
                unit,
                spawn,
                source,
                controller,
            },
        })
    }

    pub fn host(&self) -> &EngineHost {
        &self.host
    }

    pub fn host_mut(&mut self) -> &mut EngineHost {
        &mut self.host
    }

    pub const fn entities(&self) -> ColonyEntities {
        self.entities
    }

    pub fn move_command(
        &self,
        id: &str,
        principal: &str,
        sequence: u64,
        unit: EntityId,
        target: GridPoint,
    ) -> CommandEnvelope {
        self.command(
            id,
            principal,
            sequence,
            move_command_type(),
            unit,
            None,
            encode_point(target),
        )
    }

    pub fn harvest_command(
        &self,
        id: &str,
        principal: &str,
        sequence: u64,
        unit: EntityId,
        source: EntityId,
    ) -> CommandEnvelope {
        self.targeted_command(
            id,
            principal,
            sequence,
            harvest_command_type(),
            unit,
            source,
        )
    }

    pub fn transfer_command(
        &self,
        id: &str,
        principal: &str,
        sequence: u64,
        unit: EntityId,
        spawn: EntityId,
    ) -> CommandEnvelope {
        self.targeted_command(
            id,
            principal,
            sequence,
            transfer_command_type(),
            unit,
            spawn,
        )
    }

    pub fn upgrade_command(
        &self,
        id: &str,
        principal: &str,
        sequence: u64,
        unit: EntityId,
        controller: EntityId,
    ) -> CommandEnvelope {
        self.targeted_command(
            id,
            principal,
            sequence,
            upgrade_command_type(),
            unit,
            controller,
        )
    }

    pub fn spawn_command(
        &self,
        id: &str,
        principal: &str,
        sequence: u64,
        spawn: EntityId,
    ) -> CommandEnvelope {
        self.command(
            id,
            principal,
            sequence,
            spawn_command_type(),
            spawn,
            None,
            Vec::new(),
        )
    }

    pub fn energy(&self, entity: EntityId) -> Option<u64> {
        read_u64_state(self.host.state(), entity, &energy_type()).ok()
    }

    pub fn position(&self, entity: EntityId) -> Option<GridPoint> {
        read_point_state(self.host.state(), entity).ok()
    }

    pub fn controller_progress(&self) -> Option<u64> {
        read_u64_state(
            self.host.state(),
            self.entities.controller,
            &controller_progress_type(),
        )
        .ok()
    }

    fn targeted_command(
        &self,
        id: &str,
        principal: &str,
        sequence: u64,
        payload_type: SchemaTypeId,
        actor: EntityId,
        target: EntityId,
    ) -> CommandEnvelope {
        self.command(
            id,
            principal,
            sequence,
            payload_type,
            actor,
            Some(target),
            encode_u64(target.get()),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn command(
        &self,
        id: &str,
        principal: &str,
        sequence: u64,
        payload_type: SchemaTypeId,
        actor: EntityId,
        target: Option<EntityId>,
        payload: Vec<u8>,
    ) -> CommandEnvelope {
        let command = CommandEnvelope::new(
            CommandId::new(id).expect("sample command ID is valid"),
            format!("correlation:{id}"),
            self.host.state().world_id().clone(),
            PrincipalId::new(principal).expect("sample principal ID is valid"),
            self.host.state().step() + 1,
            sequence,
            payload_type,
            SCHEMA_VERSION,
            payload,
        )
        .with_idempotency_key(format!("{principal}:{sequence}"))
        .with_actor(ObjectRef::Entity(actor));
        match target {
            Some(entity) => command.with_target(ObjectRef::Entity(entity)),
            None => command,
        }
    }
}

struct MaintenanceSystem {
    descriptor: SystemDescriptor,
}

impl MaintenanceSystem {
    fn new() -> Self {
        Self {
            descriptor: descriptor(
                "automation-colony.maintenance-system",
                "automation-colony.maintenance",
            ),
        }
    }
}

impl System for MaintenanceSystem {
    fn descriptor(&self) -> &SystemDescriptor {
        &self.descriptor
    }

    fn run(&self, context: &mut SystemContext<'_>) -> Result<(), SystemError> {
        let mut updates = Vec::new();
        for (entity, _) in context.transaction().state().entities() {
            match read_kind_state(context.transaction().state(), entity)? {
                ColonyObjectKind::Source => {
                    let energy = read_u64(context, entity, &energy_type())?;
                    let capacity = read_u64(context, entity, &capacity_type())?;
                    updates.push((
                        entity,
                        energy_type(),
                        energy.saturating_add(SOURCE_REGENERATION).min(capacity),
                    ));
                }
                ColonyObjectKind::Spawn => {
                    let cooldown = read_u64(context, entity, &cooldown_type())?;
                    if cooldown > 0 {
                        updates.push((entity, cooldown_type(), cooldown - 1));
                    }
                }
                ColonyObjectKind::Unit | ColonyObjectKind::Controller => {}
            }
        }
        for (entity, type_id, value) in updates {
            stage_u64(context, entity, type_id, value)?;
        }
        Ok(())
    }
}

struct ProductionSystem {
    descriptor: SystemDescriptor,
}

impl ProductionSystem {
    fn new() -> Self {
        Self {
            descriptor: descriptor(
                "automation-colony.production-system",
                "automation-colony.production",
            ),
        }
    }
}

impl System for ProductionSystem {
    fn descriptor(&self) -> &SystemDescriptor {
        &self.descriptor
    }

    fn run(&self, context: &mut SystemContext<'_>) -> Result<(), SystemError> {
        for command in context.transaction().commands().to_vec() {
            if command.payload_type != spawn_command_type() {
                continue;
            }
            let Some(actor) = entity_ref(command.actor.as_ref()) else {
                reject(context, &command.id, "spawn_actor_must_be_entity")?;
                continue;
            };
            if command.payload_schema_version != SCHEMA_VERSION
                || !command.payload.is_empty()
                || read_kind_state(context.transaction().state(), actor)? != ColonyObjectKind::Spawn
            {
                reject(context, &command.id, "invalid_spawn_request")?;
                continue;
            }
            let energy = read_u64(context, actor, &energy_type())?;
            let cooldown = read_u64(context, actor, &cooldown_type())?;
            if energy < UNIT_SPAWN_COST || cooldown > 0 {
                reject(context, &command.id, "spawn_not_ready")?;
                continue;
            }
            let origin = read_point(context, actor)?;
            let map = colony_map();
            let index = spatial_index(context)?;
            let Some(position) = map
                .neighbors(origin)
                .find(|point| index.occupants(*point).next().is_none())
            else {
                reject(context, &command.id, "spawn_exit_blocked")?;
                continue;
            };

            stage_u64(context, actor, energy_type(), energy - UNIT_SPAWN_COST)?;
            stage_u64(context, actor, cooldown_type(), 3)?;
            let unit = context
                .transaction_mut()
                .stage_spawn()
                .map_err(transaction_error)?;
            stage_kind(context, unit, ColonyObjectKind::Unit)?;
            stage_point(context, unit, position)?;
            stage_u64(context, unit, energy_type(), 0)?;
            stage_u64(context, unit, capacity_type(), 50)?;
            stage_u64(context, unit, work_power_type(), 1)?;
            context.transaction_mut().emit_event(
                spawned_event_type(),
                SCHEMA_VERSION,
                None,
                vec![ObjectRef::Entity(actor), ObjectRef::Entity(unit)],
                Some(command.id),
                encode_u64(unit.get()),
            );
        }
        Ok(())
    }
}

struct MovementSystem {
    descriptor: SystemDescriptor,
}

impl MovementSystem {
    fn new() -> Self {
        Self {
            descriptor: descriptor(
                "automation-colony.movement-system",
                "automation-colony.movement",
            ),
        }
    }
}

impl System for MovementSystem {
    fn descriptor(&self) -> &SystemDescriptor {
        &self.descriptor
    }

    fn run(&self, context: &mut SystemContext<'_>) -> Result<(), SystemError> {
        let map = colony_map();
        let index = spatial_index(context)?;
        let mut commands = BTreeMap::<EntityId, CommandId>::new();
        let mut intents = Vec::new();
        for command in context.transaction().commands().to_vec() {
            if command.payload_type != move_command_type() {
                continue;
            }
            let Some(actor) = entity_ref(command.actor.as_ref()) else {
                reject(context, &command.id, "move_actor_must_be_entity")?;
                continue;
            };
            if command.payload_schema_version != SCHEMA_VERSION
                || read_kind_state(context.transaction().state(), actor)? != ColonyObjectKind::Unit
            {
                reject(context, &command.id, "invalid_move_request")?;
                continue;
            }
            if commands.contains_key(&actor) {
                reject(context, &command.id, "duplicate_move_intent")?;
                continue;
            }
            let target = decode_point(&command.payload)
                .map_err(|message| SystemError::new("automation-colony.move", message))?;
            let from = index.position(actor).ok_or_else(|| {
                SystemError::new("automation-colony.move", "unit has no position")
            })?;
            let path = map
                .find_path(PathRequest {
                    start: from,
                    goal: target,
                    maximum_expansions: 4096,
                })
                .map_err(|error| SystemError::new("automation-colony.path", error.to_string()))?;
            let Some(next) = path.points.get(1).copied() else {
                reject(context, &command.id, "already_at_destination")?;
                continue;
            };
            commands.insert(actor, command.id);
            intents.push(MoveIntent {
                entity: actor,
                from,
                to: next,
                priority: 0,
            });
        }

        for resolution in resolve_moves(&map, &index, intents) {
            let command = &commands[&resolution.intent.entity];
            if resolution.accepted {
                stage_point(context, resolution.intent.entity, resolution.intent.to)?;
                context.transaction_mut().emit_event(
                    moved_event_type(),
                    SCHEMA_VERSION,
                    None,
                    vec![ObjectRef::Entity(resolution.intent.entity)],
                    Some(command.clone()),
                    encode_point(resolution.intent.to),
                );
            } else {
                reject(
                    context,
                    command,
                    &format!("move_blocked:{:?}", resolution.reason),
                )?;
            }
        }
        Ok(())
    }
}

struct ActionSystem {
    descriptor: SystemDescriptor,
}

impl ActionSystem {
    fn new() -> Self {
        Self {
            descriptor: descriptor(
                "automation-colony.action-system",
                "automation-colony.actions",
            ),
        }
    }
}

impl System for ActionSystem {
    fn descriptor(&self) -> &SystemDescriptor {
        &self.descriptor
    }

    fn run(&self, context: &mut SystemContext<'_>) -> Result<(), SystemError> {
        for command in context.transaction().commands().to_vec() {
            if command.payload_type == harvest_command_type() {
                apply_harvest(context, &command)?;
            } else if command.payload_type == transfer_command_type() {
                apply_transfer(context, &command)?;
            } else if command.payload_type == upgrade_command_type() {
                apply_upgrade(context, &command)?;
            }
        }
        Ok(())
    }
}

fn apply_harvest(
    context: &mut SystemContext<'_>,
    command: &CommandEnvelope,
) -> Result<(), SystemError> {
    let Some((unit, source)) = valid_targeted_command(context, command)? else {
        return Ok(());
    };
    if read_kind_state(context.transaction().state(), unit)? != ColonyObjectKind::Unit
        || read_kind_state(context.transaction().state(), source)? != ColonyObjectKind::Source
        || !is_adjacent(context, unit, source)?
    {
        reject(context, &command.id, "invalid_harvest_target")?;
        return Ok(());
    }
    let unit_energy = read_u64(context, unit, &energy_type())?;
    let capacity = read_u64(context, unit, &capacity_type())?;
    let source_energy = read_u64(context, source, &energy_type())?;
    let work = read_u64(context, unit, &work_power_type())?;
    let amount = work
        .saturating_mul(2)
        .min(source_energy)
        .min(capacity.saturating_sub(unit_energy));
    if amount == 0 {
        reject(
            context,
            &command.id,
            "harvest_has_no_capacity_or_source_energy",
        )?;
        return Ok(());
    }
    stage_u64(context, unit, energy_type(), unit_energy + amount)?;
    stage_u64(context, source, energy_type(), source_energy - amount)?;
    emit_amount_event(
        context,
        harvested_event_type(),
        command,
        unit,
        source,
        amount,
    );
    Ok(())
}

fn apply_transfer(
    context: &mut SystemContext<'_>,
    command: &CommandEnvelope,
) -> Result<(), SystemError> {
    let Some((unit, spawn)) = valid_targeted_command(context, command)? else {
        return Ok(());
    };
    if read_kind_state(context.transaction().state(), unit)? != ColonyObjectKind::Unit
        || read_kind_state(context.transaction().state(), spawn)? != ColonyObjectKind::Spawn
        || !is_adjacent(context, unit, spawn)?
    {
        reject(context, &command.id, "invalid_transfer_target")?;
        return Ok(());
    }
    let unit_energy = read_u64(context, unit, &energy_type())?;
    let unit_capacity = read_u64(context, unit, &capacity_type())?;
    let spawn_energy = read_u64(context, spawn, &energy_type())?;
    let spawn_capacity = read_u64(context, spawn, &capacity_type())?;
    let Some((remaining, delivered, amount)) = transfer_energy(
        unit,
        spawn,
        unit_energy,
        unit_capacity,
        spawn_energy,
        spawn_capacity,
    )?
    else {
        reject(context, &command.id, "transfer_has_no_available_capacity")?;
        return Ok(());
    };
    stage_u64(context, unit, energy_type(), remaining)?;
    stage_u64(context, spawn, energy_type(), delivered)?;
    emit_amount_event(
        context,
        transferred_event_type(),
        command,
        unit,
        spawn,
        amount,
    );
    Ok(())
}

fn apply_upgrade(
    context: &mut SystemContext<'_>,
    command: &CommandEnvelope,
) -> Result<(), SystemError> {
    let Some((unit, controller)) = valid_targeted_command(context, command)? else {
        return Ok(());
    };
    if read_kind_state(context.transaction().state(), unit)? != ColonyObjectKind::Unit
        || read_kind_state(context.transaction().state(), controller)?
            != ColonyObjectKind::Controller
        || !is_adjacent(context, unit, controller)?
    {
        reject(context, &command.id, "invalid_upgrade_target")?;
        return Ok(());
    }
    let unit_energy = read_u64(context, unit, &energy_type())?;
    let work = read_u64(context, unit, &work_power_type())?;
    let mut level = read_u64(context, controller, &controller_level_type())?;
    if level >= MAX_CONTROLLER_LEVEL {
        reject(context, &command.id, "controller_is_max_level")?;
        return Ok(());
    }
    let amount = work.min(unit_energy);
    if amount == 0 {
        reject(context, &command.id, "upgrade_requires_energy")?;
        return Ok(());
    }
    let mut progress = read_u64(context, controller, &controller_progress_type())?
        .checked_add(amount)
        .ok_or_else(|| SystemError::new("automation-colony.upgrade", "progress overflow"))?;
    while level < MAX_CONTROLLER_LEVEL {
        let required = controller_requirement(level)?;
        if progress < required {
            break;
        }
        progress -= required;
        level += 1;
    }
    stage_u64(context, unit, energy_type(), unit_energy - amount)?;
    stage_u64(context, controller, controller_progress_type(), progress)?;
    stage_u64(context, controller, controller_level_type(), level)?;
    emit_amount_event(
        context,
        upgraded_event_type(),
        command,
        unit,
        controller,
        amount,
    );
    Ok(())
}

fn valid_targeted_command(
    context: &mut SystemContext<'_>,
    command: &CommandEnvelope,
) -> Result<Option<(EntityId, EntityId)>, SystemError> {
    let actor = entity_ref(command.actor.as_ref());
    let target = entity_ref(command.target.as_ref());
    let valid_payload =
        target.is_some_and(|entity| decode_u64(&command.payload).ok() == Some(entity.get()));
    if command.payload_schema_version != SCHEMA_VERSION
        || actor.is_none()
        || target.is_none()
        || !valid_payload
    {
        reject(context, &command.id, "invalid_targeted_command")?;
        return Ok(None);
    }
    Ok(actor.zip(target))
}

#[allow(clippy::too_many_arguments)]
fn transfer_energy(
    source_entity: EntityId,
    target_entity: EntityId,
    source_energy: u64,
    source_capacity: u64,
    target_energy: u64,
    target_capacity: u64,
) -> Result<Option<(u64, u64, u64)>, SystemError> {
    let quantity = source_energy.min(target_capacity.saturating_sub(target_energy));
    if quantity == 0 || source_capacity == 0 || target_capacity == 0 {
        return Ok(None);
    }
    let source_id = container_id(source_entity);
    let target_id = container_id(target_entity);
    let item_type =
        ItemTypeId::new("automation-colony.item.energy").expect("constant item type ID is valid");
    let mut inventory = InventoryBook::default();
    inventory
        .create_container(source_id.clone(), 1, source_capacity)
        .map_err(inventory_error)?;
    inventory
        .create_container(target_id.clone(), 1, target_capacity)
        .map_err(inventory_error)?;
    inventory
        .put_stack(
            &source_id,
            0,
            ItemStack::new(item_type.clone(), source_energy, source_capacity, 1)
                .map_err(inventory_error)?,
        )
        .map_err(inventory_error)?;
    if target_energy > 0 {
        inventory
            .put_stack(
                &target_id,
                0,
                ItemStack::new(item_type, target_energy, target_capacity, 1)
                    .map_err(inventory_error)?,
            )
            .map_err(inventory_error)?;
    }
    inventory
        .transfer(TransferRequest {
            source: source_id.clone(),
            source_slot: 0,
            target: target_id.clone(),
            target_slot: Some(0),
            quantity,
        })
        .map_err(inventory_error)?;
    let remaining = inventory
        .stack(&source_id, 0)
        .map_or(0, |stack| stack.quantity);
    let delivered = inventory
        .stack(&target_id, 0)
        .map_or(0, |stack| stack.quantity);
    Ok(Some((remaining, delivered, quantity)))
}

fn emit_amount_event(
    context: &mut SystemContext<'_>,
    event_type: EventTypeId,
    command: &CommandEnvelope,
    actor: EntityId,
    target: EntityId,
    amount: u64,
) {
    context.transaction_mut().emit_event(
        event_type,
        SCHEMA_VERSION,
        None,
        vec![ObjectRef::Entity(actor), ObjectRef::Entity(target)],
        Some(command.id.clone()),
        encode_u64(amount),
    );
}

fn is_adjacent(
    context: &SystemContext<'_>,
    first: EntityId,
    second: EntityId,
) -> Result<bool, SystemError> {
    Ok(read_point(context, first)?.manhattan_distance(read_point(context, second)?) <= 1)
}

fn spatial_index(context: &SystemContext<'_>) -> Result<SpatialIndex, SystemError> {
    let mut index = SpatialIndex::default();
    for (entity, record) in context.transaction().state().entities() {
        if let Some(position) = record.component(&position_type()) {
            index
                .insert(
                    entity,
                    decode_point(position.payload()).map_err(|message| {
                        SystemError::new("automation-colony.position", message)
                    })?,
                )
                .map_err(|error| {
                    SystemError::new("automation-colony.spatial-index", error.to_string())
                })?;
        }
    }
    Ok(index)
}

fn colony_map() -> GridMap {
    let bounds = GridBounds::new(GridPoint { x: 0, y: 0 }, GridPoint { x: 11, y: 7 })
        .expect("constant colony bounds are valid");
    let mut map = GridMap::new(bounds);
    for point in [
        GridPoint { x: 6, y: 1 },
        GridPoint { x: 6, y: 2 },
        GridPoint { x: 6, y: 3 },
    ] {
        map.set_blocked(point, true)
            .expect("constant obstacle is inside bounds");
    }
    map
}

fn read_kind_state(state: &WorldState, entity: EntityId) -> Result<ColonyObjectKind, SystemError> {
    let payload = state
        .component(entity, &kind_type())
        .ok_or_else(|| SystemError::new("automation-colony.kind", "entity has no kind"))?
        .payload();
    match payload {
        [1] => Ok(ColonyObjectKind::Unit),
        [2] => Ok(ColonyObjectKind::Spawn),
        [3] => Ok(ColonyObjectKind::Source),
        [4] => Ok(ColonyObjectKind::Controller),
        _ => Err(SystemError::new(
            "automation-colony.kind",
            "entity kind encoding is invalid",
        )),
    }
}

fn read_point(context: &SystemContext<'_>, entity: EntityId) -> Result<GridPoint, SystemError> {
    read_point_state(context.transaction().state(), entity)
}

fn read_point_state(state: &WorldState, entity: EntityId) -> Result<GridPoint, SystemError> {
    state
        .component(entity, &position_type())
        .ok_or_else(|| SystemError::new("automation-colony.position", "entity has no position"))
        .and_then(|value| {
            decode_point(value.payload())
                .map_err(|message| SystemError::new("automation-colony.position", message))
        })
}

fn read_u64(
    context: &SystemContext<'_>,
    entity: EntityId,
    type_id: &ComponentTypeId,
) -> Result<u64, SystemError> {
    read_u64_state(context.transaction().state(), entity, type_id)
}

fn read_u64_state(
    state: &WorldState,
    entity: EntityId,
    type_id: &ComponentTypeId,
) -> Result<u64, SystemError> {
    state
        .component(entity, type_id)
        .ok_or_else(|| {
            SystemError::new(
                "automation-colony.component",
                format!("entity {entity} is missing {type_id}"),
            )
        })
        .and_then(|value| {
            decode_u64(value.payload())
                .map_err(|message| SystemError::new("automation-colony.component", message))
        })
}

fn stage_kind(
    context: &mut SystemContext<'_>,
    entity: EntityId,
    kind: ColonyObjectKind,
) -> Result<(), SystemError> {
    context
        .transaction_mut()
        .stage_put_component(entity, kind_type(), SCHEMA_VERSION, vec![kind as u8])
        .map_err(transaction_error)
}

fn stage_point(
    context: &mut SystemContext<'_>,
    entity: EntityId,
    point: GridPoint,
) -> Result<(), SystemError> {
    context
        .transaction_mut()
        .stage_put_component(entity, position_type(), SCHEMA_VERSION, encode_point(point))
        .map_err(transaction_error)
}

fn stage_u64(
    context: &mut SystemContext<'_>,
    entity: EntityId,
    type_id: ComponentTypeId,
    value: u64,
) -> Result<(), SystemError> {
    context
        .transaction_mut()
        .stage_put_component(entity, type_id, SCHEMA_VERSION, encode_u64(value))
        .map_err(transaction_error)
}

fn reject(
    context: &mut SystemContext<'_>,
    command: &CommandId,
    detail: &str,
) -> Result<(), SystemError> {
    context
        .transaction_mut()
        .reject_command(
            command,
            CommandRejectionCode::GameplayRule,
            None,
            false,
            detail,
        )
        .map_err(transaction_error)
}

fn spawn_object(
    state: &mut WorldStateBuilder,
    kind: ColonyObjectKind,
    point: GridPoint,
) -> EntityId {
    let entity = state
        .spawn_entity()
        .expect("sample entity allocation is valid");
    state
        .put_component(entity, kind_type(), SCHEMA_VERSION, vec![kind as u8])
        .expect("sample entity exists");
    state
        .put_component(entity, position_type(), SCHEMA_VERSION, encode_point(point))
        .expect("sample entity exists");
    entity
}

fn put_u64(state: &mut WorldStateBuilder, entity: EntityId, type_id: &ComponentTypeId, value: u64) {
    state
        .put_component(entity, type_id.clone(), SCHEMA_VERSION, encode_u64(value))
        .expect("sample entity exists");
}

fn entity_ref(reference: Option<&ObjectRef>) -> Option<EntityId> {
    match reference {
        Some(ObjectRef::Entity(entity)) => Some(*entity),
        Some(ObjectRef::Resource(_)) | None => None,
    }
}

fn controller_requirement(level: u64) -> Result<u64, SystemError> {
    level
        .checked_mul(level)
        .and_then(|value| value.checked_mul(CONTROLLER_PROGRESS_BASE))
        .ok_or_else(|| SystemError::new("automation-colony.upgrade", "level requirement overflow"))
}

fn descriptor(system: &str, phase: &str) -> SystemDescriptor {
    SystemDescriptor::new(system_id(system), phase_id(phase))
}

fn runtime_definition() -> GameRuntimeDefinition {
    GamePackageManifest::parse(include_str!("../game.package.json"))
        .expect("checked-in Automation Colony game definition must validate")
        .runtime_definition()
        .expect("Automation Colony game definition must provide a runtime profile")
}

fn world_id() -> WorldId {
    WorldId::new("automation-colony.demo").expect("constant world ID is valid")
}

fn game_id() -> GameId {
    GameId::new("dev.nexora.example.automation-colony").expect("constant game ID is valid")
}

fn phase_id(value: &str) -> nexora_kernel::PhaseId {
    nexora_kernel::PhaseId::new(value).expect("constant phase ID is valid")
}

fn system_id(value: &str) -> nexora_kernel::SystemId {
    nexora_kernel::SystemId::new(value).expect("constant system ID is valid")
}

fn kind_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.kind").unwrap()
}

fn position_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.position").unwrap()
}

fn energy_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.energy").unwrap()
}

fn capacity_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.capacity").unwrap()
}

fn work_power_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.work-power").unwrap()
}

fn cooldown_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.cooldown").unwrap()
}

fn controller_level_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.controller-level").unwrap()
}

fn controller_progress_type() -> ComponentTypeId {
    ComponentTypeId::new("automation-colony.controller-progress").unwrap()
}

fn move_command_type() -> SchemaTypeId {
    SchemaTypeId::new("automation-colony.command.move").unwrap()
}

fn harvest_command_type() -> SchemaTypeId {
    SchemaTypeId::new("automation-colony.command.harvest").unwrap()
}

fn transfer_command_type() -> SchemaTypeId {
    SchemaTypeId::new("automation-colony.command.transfer").unwrap()
}

fn upgrade_command_type() -> SchemaTypeId {
    SchemaTypeId::new("automation-colony.command.upgrade").unwrap()
}

fn spawn_command_type() -> SchemaTypeId {
    SchemaTypeId::new("automation-colony.command.spawn").unwrap()
}

fn moved_event_type() -> EventTypeId {
    EventTypeId::new("automation-colony.event.moved").unwrap()
}

fn harvested_event_type() -> EventTypeId {
    EventTypeId::new("automation-colony.event.harvested").unwrap()
}

fn transferred_event_type() -> EventTypeId {
    EventTypeId::new("automation-colony.event.transferred").unwrap()
}

fn upgraded_event_type() -> EventTypeId {
    EventTypeId::new("automation-colony.event.controller-upgraded").unwrap()
}

fn spawned_event_type() -> EventTypeId {
    EventTypeId::new("automation-colony.event.unit-spawned").unwrap()
}

fn container_id(entity: EntityId) -> ContainerId {
    ContainerId::new(format!("automation-colony.container.{}", entity.get()))
        .expect("entity-derived container ID is valid")
}

fn encode_point(point: GridPoint) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(8);
    encoded.extend_from_slice(&point.x.to_be_bytes());
    encoded.extend_from_slice(&point.y.to_be_bytes());
    encoded
}

fn decode_point(payload: &[u8]) -> Result<GridPoint, String> {
    if payload.len() != 8 {
        return Err("expected two signed 32-bit coordinates".to_owned());
    }
    Ok(GridPoint {
        x: i32::from_be_bytes(payload[..4].try_into().expect("slice length was checked")),
        y: i32::from_be_bytes(payload[4..].try_into().expect("slice length was checked")),
    })
}

fn encode_u64(value: u64) -> Vec<u8> {
    value.to_be_bytes().to_vec()
}

fn decode_u64(payload: &[u8]) -> Result<u64, String> {
    payload
        .try_into()
        .map(u64::from_be_bytes)
        .map_err(|_| "expected an eight-byte unsigned integer".to_owned())
}

fn transaction_error(error: TransactionError) -> SystemError {
    SystemError::new("automation-colony.transaction", error.to_string())
}

fn inventory_error(error: nexora_foundation_core::InventoryError) -> SystemError {
    SystemError::new("automation-colony.inventory", error.to_string())
}

#[cfg(test)]
mod tests {
    use nexora_foundation_spatial::GridPoint;
    use nexora_kernel::{CommandEnvelope, StateHash};

    use super::AutomationColony;

    #[test]
    fn programmable_colony_uses_the_shared_deterministic_kernel() {
        let mut first = AutomationColony::new().unwrap();
        let mut second = AutomationColony::new().unwrap();
        let entities = first.entities();

        let mut hashes = Vec::<StateHash>::new();
        for colony in [&mut first, &mut second] {
            let entities = colony.entities();
            let command = colony.harvest_command(
                "command:harvest-1",
                "player:first",
                1,
                entities.unit,
                entities.source,
            );
            step_without_rejection(colony, command);
            let command = colony.transfer_command(
                "command:transfer",
                "player:first",
                2,
                entities.unit,
                entities.spawn,
            );
            step_without_rejection(colony, command);
            let command = colony.spawn_command("command:spawn", "player:first", 3, entities.spawn);
            step_without_rejection(colony, command);
            let command = colony.harvest_command(
                "command:harvest-2",
                "player:first",
                4,
                entities.unit,
                entities.source,
            );
            step_without_rejection(colony, command);
            let command = colony.move_command(
                "command:move",
                "player:first",
                5,
                entities.unit,
                GridPoint { x: 3, y: 3 },
            );
            step_without_rejection(colony, command);
            let command = colony.upgrade_command(
                "command:upgrade",
                "player:first",
                6,
                entities.unit,
                entities.controller,
            );
            step_without_rejection(colony, command);
            hashes.push(nexora_kernel::StateHash::digest(colony.host().state()));
        }

        assert_eq!(hashes[0], hashes[1]);
        assert_eq!(first.host().state().entities().count(), 5);
        assert_eq!(first.energy(entities.spawn), Some(0));
        assert_eq!(first.energy(entities.unit), Some(1));
        assert_eq!(
            first.position(entities.unit),
            Some(GridPoint { x: 3, y: 3 })
        );
        assert_eq!(first.controller_progress(), Some(1));
    }

    fn step_without_rejection(colony: &mut AutomationColony, command: CommandEnvelope) {
        let report = colony.host_mut().step(vec![command]).unwrap();
        assert!(
            report.commit.rejected_commands.is_empty(),
            "unexpected command rejection: {:?}",
            report.commit.rejected_commands
        );
    }
}
