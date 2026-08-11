import { Box, Cpu, Gem, Hexagon, RadioTower } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { MetadataList } from "@astryxdesign/core/MetadataList";
import { MetadataListItem } from "@astryxdesign/core/MetadataList";
import { SideNav } from "@astryxdesign/core/SideNav";
import { SideNavItem } from "@astryxdesign/core/SideNav";
import { SideNavSection } from "@astryxdesign/core/SideNav";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import type { WorldObject, WorldState } from "../../../shared/types";
import { Inspector } from "./Inspector";

interface SidebarProps {
  state?: WorldState;
  selectedId?: string;
  onSelect: (id: string) => void;
}

const KIND_ICON = {
  unit: Cpu,
  spawn: Hexagon,
  source: Gem,
  controller: RadioTower
};

export function Sidebar({ state, selectedId, onSelect }: SidebarProps) {
  const selected = state?.objects.find((object) => object.id === selectedId);
  const grouped = groupObjects(state?.objects ?? []);

  return (
    <SideNav
      className="sidebar"
      header={
        <section className="room-summary">
          <Toolbar
            className="room-summary-heading"
            label="Active sector summary"
            size="sm"
            startContent={
              <div className="room-name-block">
                <span>ACTIVE SECTOR</span>
                <strong>{state?.roomName ?? "N0-E0"}</strong>
              </div>
            }
            endContent={
              <Badge
                className="status-pill"
                icon={
                  <StatusDot
                    variant={state?.status === "running" ? "success" : "neutral"}
                    label={`Simulation ${state?.status ?? "offline"}`}
                    isPulsing={state?.status === "running"}
                  />
                }
                label={state?.status ?? "offline"}
                variant={state?.status === "running" ? "green" : "neutral"}
              />
            }
          />
          <MetadataList className="room-summary-metadata" columns={2} label={{ position: "top" }}>
            <MetadataListItem label="UNITS">{grouped.unit.length.toLocaleString()}</MetadataListItem>
            <MetadataListItem label="RCL">{grouped.controller[0]?.kind === "controller" ? grouped.controller[0].level : 0}</MetadataListItem>
            <MetadataListItem label="HARVEST">{(state?.stats.energyHarvested ?? 0).toLocaleString()}</MetadataListItem>
            <MetadataListItem label="INTENTS">{(state?.stats.intents ?? 0).toLocaleString()}</MetadataListItem>
          </MetadataList>
        </section>
      }
      footer={<Inspector object={selected} />}
    >
      <SideNavSection title="Objects" endContent={<Badge label={state?.objects.length ?? 0} variant="neutral" />}>
        {(["unit", "spawn", "source", "controller"] as const).map((kind) => {
          const Icon = KIND_ICON[kind];
          const objects = grouped[kind];
          return (
            <SideNavItem
              key={kind}
              label={kind.toUpperCase()}
              icon={<Icon size={13} />}
              endContent={<Badge label={objects.length} variant="neutral" />}
              collapsible={{ defaultIsCollapsed: false }}
            >
              {objects.map((object) => (
                <SideNavItem
                  key={object.id}
                  label={objectLabel(object)}
                  isSelected={selectedId === object.id}
                  endContent={<span className="object-position">{object.x}:{object.y}</span>}
                  onClick={() => onSelect(object.id)}
                  size="sm"
                />
              ))}
            </SideNavItem>
          );
        })}
      </SideNavSection>
    </SideNav>
  );
}

function groupObjects(objects: WorldObject[]) {
  return {
    unit: objects.filter((object) => object.kind === "unit"),
    spawn: objects.filter((object) => object.kind === "spawn"),
    source: objects.filter((object) => object.kind === "source"),
    controller: objects.filter((object) => object.kind === "controller")
  };
}

function objectLabel(object: WorldObject): string {
  if (object.kind === "unit" || object.kind === "spawn") {
    return object.name;
  }
  if (object.kind === "source") {
    return object.id === "source-north" ? "North vein" : "South vein";
  }
  return "Room controller";
}
