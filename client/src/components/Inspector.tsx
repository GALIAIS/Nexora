import { Crosshair, MapPin } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { MetadataList } from "@astryxdesign/core/MetadataList";
import { MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import type { WorldObject } from "../../../shared/types";

export function Inspector({ object }: { object?: WorldObject }) {
  return (
    <section className="inspector">
      <Toolbar
        className="panel-heading"
        label="Selected object inspector"
        size="sm"
        dividers={["bottom"]}
        startContent={<Badge icon={<Crosshair size={13} />} label="Inspector" variant="neutral" />}
        endContent={object ? <Badge label={object.kind.toUpperCase()} variant={objectBadgeVariant(object)} /> : undefined}
      />
      {!object ? (
        <EmptyState
          className="empty-inspector"
          icon={<Crosshair size={18} />}
          title="No object selected"
          description="Select a unit or structure from the world."
          isCompact
        />
      ) : (
        <div className="inspector-content">
          <div className="inspector-identity">
            <Badge label={object.kind.toUpperCase()} variant={objectBadgeVariant(object)} />
            <div>
              <strong>{object.kind === "unit" || object.kind === "spawn" ? object.name : object.kind}</strong>
              <code>{object.id}</code>
            </div>
          </div>
          <MetadataList className="object-inspector-metadata" columns="single" label={{ position: "start", width: 76 }}>
            <MetadataListItem label="POSITION" icon={<MapPin size={12} />}><code>{object.x}, {object.y}</code></MetadataListItem>
            {object.kind === "unit" && <MetadataListItem label="BODY">{object.body.join(" / ")}</MetadataListItem>}
            {object.kind === "spawn" && <MetadataListItem label="COOLDOWN">{object.cooldown}</MetadataListItem>}
            {object.kind === "controller" && <MetadataListItem label="LEVEL">{object.level}</MetadataListItem>}
          </MetadataList>
          <div className="inspector-meters">
          {object.kind === "unit" && (
            <>
              <ObjectMeter label="Energy" value={object.energy} maximum={object.capacity} tone="energy" />
              <ObjectMeter label="Integrity" value={object.hits} maximum={object.hitsMax} tone="health" />
            </>
          )}
          {object.kind === "spawn" && (
            <>
              <ObjectMeter label="Energy" value={object.energy} maximum={object.capacity} tone="energy" />
            </>
          )}
          {object.kind === "source" && (
            <ObjectMeter label="Reserve" value={object.energy} maximum={object.capacity} tone="source" />
          )}
          {object.kind === "controller" && (
            <>
              <ObjectMeter label="Progress" value={object.progress} maximum={object.progressTotal} tone="controller" />
            </>
          )}
          </div>
        </div>
      )}
    </section>
  );
}

function ObjectMeter({
  label,
  value,
  maximum,
  tone
}: {
  label: string;
  value: number;
  maximum: number;
  tone: string;
}) {
  return (
    <div className="meter-block">
      <ProgressBar
        label={label}
        value={Math.max(0, value)}
        max={Math.max(1, maximum)}
        hasValueLabel
        formatValueLabel={(current, max) => `${current} / ${max}`}
        variant={progressVariant(tone)}
      />
    </div>
  );
}

function objectBadgeVariant(object: WorldObject): "blue" | "cyan" | "green" | "orange" {
  switch (object.kind) {
    case "unit":
      return "green";
    case "spawn":
      return "orange";
    case "source":
      return "cyan";
    case "controller":
      return "blue";
  }
}

function progressVariant(tone: string): "accent" | "success" | "warning" | "error" {
  switch (tone) {
    case "energy":
      return "warning";
    case "health":
      return "error";
    case "source":
      return "success";
    default:
      return "accent";
  }
}
