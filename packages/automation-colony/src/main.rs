use automation_colony::AutomationColony;
use nexora_foundation_spatial::GridPoint;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut colony = AutomationColony::new()?;
    let entities = colony.entities();
    let harvest = colony.harvest_command(
        "command:harvest",
        "player:first",
        1,
        entities.unit,
        entities.source,
    );
    colony.host_mut().step(vec![harvest])?;
    let movement = colony.move_command(
        "command:move",
        "player:first",
        2,
        entities.unit,
        GridPoint { x: 3, y: 3 },
    );
    colony.host_mut().step(vec![movement])?;
    let upgrade = colony.upgrade_command(
        "command:upgrade",
        "player:first",
        3,
        entities.unit,
        entities.controller,
    );
    let report = colony.host_mut().step(vec![upgrade])?;
    println!(
        "step={} hash={} unit_energy={} controller_progress={}",
        report.commit.step,
        report.commit.state_hash,
        colony.energy(entities.unit).unwrap_or_default(),
        colony.controller_progress().unwrap_or_default()
    );
    Ok(())
}
