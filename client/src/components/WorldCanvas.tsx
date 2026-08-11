import { Maximize2, Minus, Plus } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { ButtonGroup } from "@astryxdesign/core/ButtonGroup";
import { IconButton } from "@astryxdesign/core/IconButton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { useEffect, useRef, useState } from "react";
import type {
  ControllerObject,
  Position,
  SourceObject,
  SpawnObject,
  UnitObject,
  WorldObject,
  WorldState
} from "../../../shared/types";

interface WorldCanvasProps {
  state?: WorldState;
  selectedId?: string;
  onSelect: (id: string) => void;
}

interface Viewport {
  width: number;
  height: number;
  cell: number;
  originX: number;
  originY: number;
}

interface MotionState {
  from: Position;
  to: Position;
  startedAt: number;
  duration: number;
}

interface UnitLabel {
  text: string;
  center: Position;
  selected: boolean;
}

interface LabelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function WorldCanvas({ state, selectedId, onSelect }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport | undefined>(undefined);
  const stateRef = useRef<WorldState | undefined>(state);
  const selectedRef = useRef<string | undefined>(selectedId);
  const zoomRef = useRef(1);
  const resizeRef = useRef<(() => void) | undefined>(undefined);
  const motionsRef = useRef(new Map<string, MotionState>());
  const [zoom, setZoom] = useState(1);
  const [hoveredId, setHoveredId] = useState<string>();
  const hovered = state?.objects.find((object) => object.id === hoveredId);

  useEffect(() => {
    const previous = stateRef.current;
    const previousObjects = new Map(previous?.objects.map((object) => [object.id, object]));
    const nextMotions = new Map<string, MotionState>();
    const now = performance.now();
    if (state) {
      const duration = Math.min(700, Math.max(90, state.tickRate * 0.9));
      for (const object of state.objects) {
        const previousObject = previousObjects.get(object.id);
        const activeMotion = motionsRef.current.get(object.id);
        const from = activeMotion
          ? motionPosition(activeMotion, now)
          : previousObject
            ? { x: previousObject.x, y: previousObject.y }
            : { x: object.x, y: object.y };
        const to = { x: object.x, y: object.y };
        if (from.x !== to.x || from.y !== to.y) {
          nextMotions.set(object.id, { from, to, startedAt: now, duration });
        }
      }
    }
    motionsRef.current = nextMotions;
    stateRef.current = state;
    resizeRef.current?.();
  }, [state]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    zoomRef.current = zoom;
    resizeRef.current?.();
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => clampZoom(current + (event.deltaY < 0 ? 0.1 : -0.1)));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    let frame = 0;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.floor(bounds.width * ratio));
      const pixelHeight = Math.max(1, Math.floor(bounds.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const world = stateRef.current;
      if (!world) {
        viewportRef.current = undefined;
        return;
      }
      const baseCell = Math.min(
        (bounds.width - 36) / world.width,
        (bounds.height - 36) / world.height
      );
      const cell = baseCell * zoomRef.current;
      viewportRef.current = {
        width: bounds.width,
        height: bounds.height,
        cell,
        originX: (bounds.width - world.width * cell) / 2,
        originY: (bounds.height - world.height * cell) / 2
      };
    };
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const render = (time: number) => {
      const viewport = viewportRef.current;
      const world = stateRef.current;
      if (viewport && world) {
        drawWorld(context, world, viewport, motionsRef.current, selectedRef.current, time);
      } else {
        const bounds = canvas.getBoundingClientRect();
        context.fillStyle = "#0b0e0c";
        context.fillRect(0, 0, bounds.width, bounds.height);
      }
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      resizeRef.current = undefined;
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const objectAtEvent = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const world = stateRef.current;
    const viewport = viewportRef.current;
    if (!world || !viewport) {
      return undefined;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const hitRadius = viewport.cell * 0.48;
    return [...world.objects]
      .sort((left, right) => objectLayer(right) - objectLayer(left))
      .find((object) => {
        const center = cellCenter(renderPosition(object, motionsRef.current, performance.now()), viewport);
        return Math.hypot(pointer.x - center.x, pointer.y - center.y) <= hitRadius;
      });
  };

  return (
    <section className="world-panel">
      <Toolbar
        className="world-panel-header"
        label="World viewport context"
        size="sm"
        dividers={["bottom"]}
        startContent={
          <div className="world-context">
            <span>LIVE ROOM</span>
            <strong>{state?.roomName ?? "CONNECTING"}</strong>
          </div>
        }
        endContent={
          <div className="world-legend" aria-label="World legend">
            <Badge icon={<StatusDot variant="success" label="Unit" />} label="Unit" variant="neutral" />
            <Badge icon={<StatusDot variant="accent" label="Source" />} label="Source" variant="neutral" />
            <Badge icon={<StatusDot variant="warning" label="Structure" />} label="Structure" variant="neutral" />
          </div>
        }
      />
      <div className="canvas-stage">
        <canvas
          ref={canvasRef}
          onMouseMove={(event) => setHoveredId(objectAtEvent(event)?.id)}
          onMouseLeave={() => setHoveredId(undefined)}
          onClick={(event) => {
            const object = objectAtEvent(event);
            if (object) {
              onSelect(object.id);
            }
          }}
          aria-label="Programmable world map"
        />
        <ButtonGroup className="canvas-toolbar" label="World viewport controls" size="sm" elevation="low">
          <IconButton
            label="Zoom in"
            icon={<Plus size={15} />}
            onClick={() => setZoom((value) => clampZoom(value + 0.15))}
            tooltip="Zoom in"
            variant="secondary"
          />
          <IconButton
            label="Zoom out"
            icon={<Minus size={15} />}
            onClick={() => setZoom((value) => clampZoom(value - 0.15))}
            tooltip="Zoom out"
            variant="secondary"
          />
          <IconButton label="Reset zoom" icon={<Maximize2 size={14} />} onClick={() => setZoom(1)} tooltip="Reset zoom" variant="secondary" />
        </ButtonGroup>
        {hovered && (
          <div className="canvas-tooltip" role="status">
            <Badge label={hovered.kind.toUpperCase()} variant="neutral" />
            <div>
              <strong>{objectName(hovered)}</strong>
              <small>
              {hovered.x}, {hovered.y}
              </small>
            </div>
          </div>
        )}
        <Badge className="coordinate-readout" label={`${Math.round(zoom * 100)}%`} variant="neutral" />
      </div>
    </section>
  );
}

function drawWorld(
  context: CanvasRenderingContext2D,
  state: WorldState,
  viewport: Viewport,
  motions: ReadonlyMap<string, MotionState>,
  selectedId: string | undefined,
  time: number
) {
  const { width, height, cell, originX, originY } = viewport;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0b0e0c";
  context.fillRect(0, 0, width, height);

  context.save();
  context.beginPath();
  context.rect(originX, originY, state.width * cell, state.height * cell);
  context.clip();
  context.fillStyle = "#141a16";
  context.fillRect(originX, originY, state.width * cell, state.height * cell);

  drawTerrain(context, state, viewport);
  drawGrid(context, state, viewport);
  drawActionLines(context, state, viewport, motions, time);

  const objects = [...state.objects].sort((left, right) => objectLayer(left) - objectLayer(right));
  const labels: UnitLabel[] = [];
  for (const object of objects) {
    const center = cellCenter(renderPosition(object, motions, time), viewport);
    const selected = object.id === selectedId;
    if (object.kind === "source") {
      drawSource(context, object, center, cell, time, selected);
    } else if (object.kind === "spawn") {
      drawSpawn(context, object, center, cell, time, selected);
    } else if (object.kind === "controller") {
      drawController(context, object, center, cell, time, selected);
    } else {
      drawUnit(context, object, center, cell, time, selected);
      if (cell >= 14) {
        labels.push({ text: object.name, center, selected });
      }
    }
  }
  drawUnitLabels(context, labels, viewport, state.width, state.height);
  context.restore();

  context.strokeStyle = "rgba(218, 231, 220, 0.22)";
  context.lineWidth = 1;
  context.strokeRect(originX - 0.5, originY - 0.5, state.width * cell + 1, state.height * cell + 1);
}

function drawTerrain(context: CanvasRenderingContext2D, state: WorldState, viewport: Viewport) {
  const { cell, originX, originY } = viewport;
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const terrain = state.terrain[y * state.width + x];
      const left = originX + x * cell;
      const top = originY + y * cell;
      if (terrain === "wall") {
        context.fillStyle = "#242924";
        context.fillRect(left, top, cell, cell);
        context.strokeStyle = "rgba(4, 7, 5, 0.72)";
        context.lineWidth = Math.max(1, cell * 0.08);
        context.beginPath();
        context.moveTo(left + cell * 0.18, top + cell * 0.72);
        context.lineTo(left + cell * 0.46, top + cell * 0.25);
        context.lineTo(left + cell * 0.82, top + cell * 0.6);
        context.stroke();
      } else if (terrain === "swamp") {
        context.fillStyle = "#15231f";
        context.fillRect(left, top, cell, cell);
        context.strokeStyle = "rgba(57, 163, 142, 0.16)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left + cell * 0.12, top + cell * 0.78);
        context.lineTo(left + cell * 0.78, top + cell * 0.12);
        context.moveTo(left + cell * 0.5, top + cell);
        context.lineTo(left + cell, top + cell * 0.5);
        context.stroke();
      }
    }
  }
}

function drawGrid(context: CanvasRenderingContext2D, state: WorldState, viewport: Viewport) {
  const { cell, originX, originY } = viewport;
  if (cell < 8) {
    return;
  }
  context.beginPath();
  for (let x = 0; x <= state.width; x += 1) {
    context.moveTo(originX + x * cell, originY);
    context.lineTo(originX + x * cell, originY + state.height * cell);
  }
  for (let y = 0; y <= state.height; y += 1) {
    context.moveTo(originX, originY + y * cell);
    context.lineTo(originX + state.width * cell, originY + y * cell);
  }
  context.strokeStyle = "rgba(205, 230, 211, 0.045)";
  context.lineWidth = 1;
  context.stroke();
}

function drawActionLines(
  context: CanvasRenderingContext2D,
  state: WorldState,
  viewport: Viewport,
  motions: ReadonlyMap<string, MotionState>,
  time: number
) {
  for (const object of state.objects) {
    if (object.kind !== "unit" || !object.lastAction?.targetId) {
      continue;
    }
    const target = state.objects.find((candidate) => candidate.id === object.lastAction?.targetId);
    if (!target) {
      continue;
    }
    const from = cellCenter(renderPosition(object, motions, time), viewport);
    const to = cellCenter(renderPosition(target, motions, time), viewport);
    const alpha = 0.24 + Math.sin(time / 130) * 0.08;
    context.save();
    context.setLineDash([viewport.cell * 0.24, viewport.cell * 0.16]);
    context.lineDashOffset = -time / 80;
    context.strokeStyle = actionColor(object.lastAction.type, alpha);
    context.lineWidth = Math.max(1.4, viewport.cell * 0.08);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }
}

function drawSource(
  context: CanvasRenderingContext2D,
  source: SourceObject,
  center: Position,
  cell: number,
  time: number,
  selected: boolean
) {
  const radius = cell * (0.28 + Math.sin(time / 420 + source.x) * 0.018);
  context.save();
  context.translate(center.x, center.y);
  context.rotate(time / 2800);
  context.shadowColor = "#62e7c5";
  context.shadowBlur = cell * 0.45;
  context.fillStyle = "#62e7c5";
  context.beginPath();
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    const pointRadius = index % 2 === 0 ? radius : radius * 0.48;
    context.lineTo(Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius);
  }
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#dffdf1";
  context.beginPath();
  context.arc(0, 0, radius * 0.24, 0, Math.PI * 2);
  context.fill();
  context.restore();
  drawSelection(context, center, cell, selected, "#62e7c5", time);
}

function drawSpawn(
  context: CanvasRenderingContext2D,
  spawn: SpawnObject,
  center: Position,
  cell: number,
  time: number,
  selected: boolean
) {
  const radius = cell * 0.34;
  context.save();
  context.translate(center.x, center.y);
  context.rotate(Math.PI / 6);
  polygon(context, 6, radius);
  context.fillStyle = "#d6574c";
  context.fill();
  context.lineWidth = Math.max(1, cell * 0.09);
  context.strokeStyle = "#ffb04e";
  context.stroke();
  context.rotate(-Math.PI / 6);
  context.fillStyle = "#111612";
  context.fillRect(-radius * 0.32, -radius * 0.32, radius * 0.64, radius * 0.64);
  context.restore();
  drawArcMeter(context, center, radius * 1.25, spawn.energy / spawn.capacity, "#ffd166", cell);
  drawSelection(context, center, cell, selected, "#ff8f70", time);
}

function drawController(
  context: CanvasRenderingContext2D,
  controller: ControllerObject,
  center: Position,
  cell: number,
  time: number,
  selected: boolean
) {
  const radius = cell * 0.32;
  context.save();
  context.translate(center.x, center.y);
  context.rotate(Math.PI / 4 + time / 6200);
  context.strokeStyle = "#67a7ff";
  context.fillStyle = "rgba(35, 76, 119, 0.7)";
  context.lineWidth = Math.max(1.3, cell * 0.08);
  context.strokeRect(-radius, -radius, radius * 2, radius * 2);
  context.fillRect(-radius * 0.55, -radius * 0.55, radius * 1.1, radius * 1.1);
  context.restore();
  context.fillStyle = "#dcecff";
  context.font = `700 ${Math.max(8, cell * 0.36)}px Bahnschrift`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(controller.level), center.x, center.y + 0.5);
  drawArcMeter(context, center, radius * 1.45, controller.progress / controller.progressTotal, "#67a7ff", cell);
  drawSelection(context, center, cell, selected, "#67a7ff", time);
}

function drawUnit(
  context: CanvasRenderingContext2D,
  unit: UnitObject,
  center: Position,
  cell: number,
  time: number,
  selected: boolean
) {
  const radius = cell * 0.29;
  context.save();
  context.translate(center.x, center.y);
  context.shadowColor = "rgba(0,0,0,0.7)";
  context.shadowBlur = cell * 0.16;
  context.fillStyle = "#e7ede7";
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  const partColors = { move: "#7aa2f7", work: "#f0b25d", carry: "#6fd0a5" };
  const segment = (Math.PI * 2) / unit.body.length;
  unit.body.forEach((part, index) => {
    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, radius * 0.78, index * segment - Math.PI / 2, (index + 1) * segment - Math.PI / 2);
    context.closePath();
    context.fillStyle = partColors[part];
    context.fill();
  });
  context.fillStyle = "#161b17";
  context.beginPath();
  context.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
  context.fill();
  context.restore();

  drawArcMeter(context, center, radius * 1.22, unit.capacity ? unit.energy / unit.capacity : 0, "#f7d04b", cell);
  drawSelection(context, center, cell, selected, "#dfffe9", time);

  if (unit.say) {
    const textWidth = Math.max(cell * 1.1, context.measureText(unit.say).width + 12);
    const bubbleY = center.y - radius * 2.25;
    context.fillStyle = "#f1ead9";
    context.fillRect(center.x - textWidth / 2, bubbleY - 10, textWidth, 18);
    context.fillStyle = "#1a1c18";
    context.font = `600 ${Math.max(8, cell * 0.26)}px "Cascadia Code"`;
    context.textBaseline = "middle";
    context.fillText(unit.say, center.x, bubbleY - 1);
  }
}

function drawUnitLabels(
  context: CanvasRenderingContext2D,
  labels: UnitLabel[],
  viewport: Viewport,
  worldWidth: number,
  worldHeight: number
) {
  const fontSize = Math.max(8, viewport.cell * 0.27);
  const lineHeight = fontSize + 5;
  const placed: LabelRect[] = [];
  context.save();
  context.font = `600 ${fontSize}px "Cascadia Code"`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const label of [...labels].sort((left, right) => Number(right.selected) - Number(left.selected))) {
    const width = Math.min(viewport.cell * 3.8, context.measureText(label.text).width + 10);
    const offset = viewport.cell * 0.58;
    const candidates = [
      labelRect(label.center.x, label.center.y + offset, width, lineHeight),
      labelRect(label.center.x, label.center.y - offset, width, lineHeight),
      labelRect(label.center.x + viewport.cell * 0.9, label.center.y, width, lineHeight),
      labelRect(label.center.x - viewport.cell * 0.9, label.center.y, width, lineHeight)
    ];
    const rect = candidates.find(
      (candidate) =>
        withinWorld(candidate, viewport, worldWidth, worldHeight) &&
        placed.every((existing) => !rectsOverlap(existing, candidate, 3))
    );
    if (!rect) continue;
    placed.push(rect);
    context.fillStyle = label.selected ? "rgba(19, 28, 22, 0.92)" : "rgba(11, 15, 12, 0.72)";
    context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    context.fillStyle = label.selected ? "#f3fff7" : "rgba(226, 236, 228, 0.78)";
    context.fillText(
      label.text,
      (rect.left + rect.right) / 2,
      (rect.top + rect.bottom) / 2,
      width - 6
    );
  }
  context.restore();
}

function labelRect(centerX: number, centerY: number, width: number, height: number): LabelRect {
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2
  };
}

function withinWorld(
  rect: LabelRect,
  viewport: Viewport,
  worldWidth: number,
  worldHeight: number
): boolean {
  return (
    rect.left >= viewport.originX &&
    rect.top >= viewport.originY &&
    rect.right <= viewport.originX + viewport.cell * worldWidth &&
    rect.bottom <= viewport.originY + viewport.cell * worldHeight
  );
}

function rectsOverlap(left: LabelRect, right: LabelRect, gap: number): boolean {
  return !(
    left.right + gap <= right.left ||
    right.right + gap <= left.left ||
    left.bottom + gap <= right.top ||
    right.bottom + gap <= left.top
  );
}

function drawSelection(
  context: CanvasRenderingContext2D,
  center: Position,
  cell: number,
  selected: boolean,
  color: string,
  time: number
) {
  if (!selected) {
    return;
  }
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.72 + Math.sin(time / 170) * 0.22;
  context.lineWidth = Math.max(1, cell * 0.06);
  context.setLineDash([cell * 0.2, cell * 0.12]);
  context.lineDashOffset = -time / 90;
  context.strokeRect(center.x - cell * 0.46, center.y - cell * 0.46, cell * 0.92, cell * 0.92);
  context.restore();
}

function drawArcMeter(
  context: CanvasRenderingContext2D,
  center: Position,
  radius: number,
  ratio: number,
  color: string,
  cell: number
) {
  context.beginPath();
  context.arc(center.x, center.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, ratio));
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.2, cell * 0.07);
  context.stroke();
}

function polygon(context: CanvasRenderingContext2D, sides: number, radius: number) {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = (Math.PI * 2 * index) / sides;
    context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  context.closePath();
}

function cellCenter(position: Position, viewport: Viewport): Position {
  return {
    x: viewport.originX + (position.x + 0.5) * viewport.cell,
    y: viewport.originY + (position.y + 0.5) * viewport.cell
  };
}

function renderPosition(
  object: WorldObject,
  motions: ReadonlyMap<string, MotionState>,
  time: number
): Position {
  const motion = motions.get(object.id);
  return motion ? motionPosition(motion, time) : object;
}

function motionPosition(motion: MotionState, time: number): Position {
  const progress = Math.min(1, Math.max(0, (time - motion.startedAt) / motion.duration));
  const eased = 1 - (1 - progress) ** 3;
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * eased,
    y: motion.from.y + (motion.to.y - motion.from.y) * eased
  };
}

function objectLayer(object: WorldObject): number {
  if (object.kind === "source") return 1;
  if (object.kind === "controller") return 2;
  if (object.kind === "spawn") return 3;
  return 4;
}

function actionColor(type: string, alpha: number): string {
  if (type === "harvest") return `rgba(98, 231, 197, ${alpha})`;
  if (type === "transfer") return `rgba(255, 209, 102, ${alpha})`;
  return `rgba(103, 167, 255, ${alpha})`;
}

function objectName(object: WorldObject): string {
  if (object.kind === "unit" || object.kind === "spawn") return object.name;
  if (object.kind === "controller") return `Level ${object.level}`;
  return `${object.energy} energy`;
}

function clampZoom(value: number): number {
  return Math.min(1.8, Math.max(0.65, Number(value.toFixed(2))));
}
