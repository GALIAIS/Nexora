import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApiReferenceItem,
  ControlPayload,
  GameSnapshot
} from "../../../shared/types";
import {
  gameSnapshotOf,
  isAutomationReplicationFrame,
  type AutomationDynamicState,
  type AutomationStaticState
} from "../../../shared/example-replication";
import { ReplicationStore } from "../../../shared/replication";
import type { ConsoleEntry, WorldObject } from "../../../shared/types";
import * as api from "../lib/api";

export type ConnectionState = "connecting" | "live" | "offline";

export function useGame(enabled = true) {
  const [snapshot, setSnapshot] = useState<GameSnapshot>();
  const [code, setCode] = useState<string>();
  const [reference, setReference] = useState<ApiReferenceItem[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const reconnectTimer = useRef<number | undefined>(undefined);
  const replicationStore = useRef<
    ReplicationStore<AutomationStaticState, AutomationDynamicState, WorldObject, ConsoleEntry[]>
  >(undefined);
  if (!replicationStore.current) {
    replicationStore.current = new ReplicationStore({
      mergeTransient: (current, incoming) => [...current, ...incoming].slice(-500)
    });
  }

  useEffect(() => {
    if (!enabled) {
      setConnection("offline");
      return;
    }
    let active = true;
    void Promise.all([api.getSnapshot(), api.getCode(), api.getReference()])
      .then(([nextSnapshot, codePayload, apiReference]) => {
        if (!active) {
          return;
        }
        setSnapshot(nextSnapshot);
        setCode(codePayload.code);
        setReference(apiReference);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    let socket: WebSocket | undefined;
    const connect = () => {
      setConnection("connecting");
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/socket`);
      socket.addEventListener("open", () => setConnection("live"));
      socket.addEventListener("message", (event) => {
        try {
          const frame: unknown = JSON.parse(String(event.data));
          if (!isAutomationReplicationFrame(frame)) {
            throw new TypeError("Unsupported replication frame");
          }
          const result = replicationStore.current?.apply(frame);
          if (result?.status === "applied") {
            const replicated = replicationStore.current?.snapshot();
            if (replicated) {
              setSnapshot(gameSnapshotOf(replicated));
              setError(undefined);
            }
          } else if (result?.status === "reset-required") {
            setError(`World stream requires a new baseline (${result.reason}).`);
            replicationStore.current?.clear();
            socket?.close();
          } else if (result?.status === "rejected") {
            setError(`Received an invalid world update (${result.reason}).`);
          }
        } catch (reason) {
          setError(
            reason instanceof Error
              ? `Received an invalid world update: ${reason.message}`
              : "Received an invalid world update."
          );
        }
      });
      socket.addEventListener("close", () => {
        if (!active) {
          return;
        }
        setConnection("offline");
        replicationStore.current?.clear();
        reconnectTimer.current = window.setTimeout(connect, 1_500);
      });
      socket.addEventListener("error", () => socket?.close());
    };
    connect();

    return () => {
      active = false;
      window.clearTimeout(reconnectTimer.current);
      socket?.close();
    };
  }, [enabled]);

  const runAction = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const control = useCallback(
    async (command: ControlPayload["command"]) => {
      const result = await runAction(() => api.sendControl(command));
      if (result) {
        setSnapshot(result);
      }
    },
    [runAction]
  );

  const updateCode = useCallback(
    async (nextCode: string) => {
      const result = await runAction(() => api.saveCode(nextCode));
      if (result) {
        setCode(result.code);
        return true;
      }
      return false;
    },
    [runAction]
  );

  const updateTickRate = useCallback(
    async (tickRate: number) => {
      const result = await runAction(() => api.saveSettings({ tickRate }));
      if (result) {
        setSnapshot(result);
      }
    },
    [runAction]
  );

  return {
    snapshot,
    code,
    reference,
    connection,
    busy,
    error,
    control,
    updateCode,
    updateTickRate
  };
}
