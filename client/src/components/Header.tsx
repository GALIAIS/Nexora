import {
  Activity,
  Cpu,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  TimerReset
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { ButtonGroup } from "@astryxdesign/core/ButtonGroup";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Selector } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import type { ControlPayload, WorldState } from "../../../shared/types";
import type { ConnectionState } from "../hooks/useGame";

interface HeaderProps {
  state?: WorldState;
  connection: ConnectionState;
  busy: boolean;
  onControl: (command: ControlPayload["command"]) => void;
  onTickRate: (tickRate: number) => void;
}

export function Header({ state, connection, busy, onControl, onTickRate }: HeaderProps) {
  const running = state?.status === "running";
  const connectionVariant = connection === "live" ? "green" : connection === "connecting" ? "warning" : "red";
  const connectionDotVariant = connection === "live" ? "success" : connection === "connecting" ? "warning" : "error";
  return (
    <Toolbar
      className="topbar"
      label="Automation Colony simulation controls"
      size="sm"
      startContent={
        <>
          <div className="brand-lockup" aria-label="Nexora">
            <div className="brand-mark">NX</div>
            <div>
              <strong>NEXORA</strong>
              <span>AUTOMATION WORLD</span>
            </div>
          </div>
          <div className="room-telemetry" aria-label="Simulation telemetry">
            <Badge icon={<Activity size={13} />} label={`Tick ${state?.tick ?? "--"}`} variant="neutral" />
            <Badge icon={<Cpu size={13} />} label={`CPU ${state ? `${state.stats.runtimeMs.toFixed(2)} ms` : "--"}`} variant="neutral" />
            <Badge
              className="connection-state"
              icon={<StatusDot variant={connectionDotVariant} label={`Connection ${connection}`} isPulsing={connection === "connecting"} />}
              label={connection}
              variant={connectionVariant}
            />
          </div>
        </>
      }
      endContent={
        <div className="simulation-controls">
          <Selector
            className="tick-rate-control"
            label="Tick interval"
            isLabelHidden
            startIcon={<TimerReset size={15} />}
            value={String(state?.tickRate ?? 600)}
            onChange={(value) => onTickRate(Number(value))}
            options={[
              { value: "250", label: "250 ms" },
              { value: "600", label: "600 ms" },
              { value: "1000", label: "1 sec" },
              { value: "2000", label: "2 sec" }
            ]}
            isDisabled={!state || busy}
            size="sm"
            variant="ghost"
          />
          <ButtonGroup className="control-cluster" label="Simulation controls" size="sm">
            <IconButton
              label={running ? "Pause simulation" : "Run simulation"}
              icon={running ? <Pause size={16} /> : <Play size={16} />}
              onClick={() => onControl(running ? "pause" : "start")}
              isDisabled={!state || busy}
              tooltip={running ? "Pause simulation" : "Run simulation"}
              variant={running ? "primary" : "secondary"}
            />
            <IconButton
              label="Run one tick"
              icon={<StepForward size={16} />}
              onClick={() => onControl("step")}
              isDisabled={!state || busy}
              tooltip="Run one tick"
              variant="secondary"
            />
            <IconButton
              label="Reset world"
              icon={<RotateCcw size={15} />}
              onClick={() => onControl("reset")}
              isDisabled={!state || busy}
              tooltip="Reset world"
              variant="destructive"
            />
          </ButtonGroup>
        </div>
      }
    />
  );
}
