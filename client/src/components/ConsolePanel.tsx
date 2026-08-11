import { CircleX, Database, TerminalSquare } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Tab } from "@astryxdesign/core/TabList";
import { TabList } from "@astryxdesign/core/TabList";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleEntry, WorldState } from "../../../shared/types";

interface ConsolePanelProps {
  entries: ConsoleEntry[];
  state?: WorldState;
}

export function ConsolePanel({ entries, state }: ConsolePanelProps) {
  const [tab, setTab] = useState<"console" | "memory">("console");
  const [cutoff, setCutoff] = useState<string>();
  const outputRef = useRef<HTMLDivElement>(null);
  const visibleEntries = useMemo(() => {
    if (!cutoff) {
      return entries;
    }
    const cutoffIndex = entries.findIndex((entry) => entry.id === cutoff);
    return cutoffIndex < 0 ? entries : entries.slice(cutoffIndex + 1);
  }, [cutoff, entries]);

  useEffect(() => {
    if (tab === "console") {
      outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [tab, visibleEntries.length]);

  return (
    <section className="console-panel">
      <Toolbar
        className="console-tabs"
        label="Console view controls"
        size="sm"
        dividers={["bottom"]}
        startContent={
          <TabList value={tab} onChange={(value) => setTab(value as "console" | "memory")} aria-label="Console view" size="sm">
            <Tab value="console" label="Console" icon={<TerminalSquare size={13} />} />
            <Tab value="memory" label="Memory" icon={<Database size={13} />} />
          </TabList>
        }
        endContent={
          <>
            <Badge className="console-count" label={tab === "console" ? visibleEntries.length : Object.keys(state?.memory ?? {}).length} variant="neutral" />
            {tab === "console" && (
              <IconButton
                className="clear-console"
                label="Clear console view"
                icon={<CircleX size={13} />}
                onClick={() => setCutoff(entries.at(-1)?.id)}
                size="sm"
                tooltip="Clear console view"
                variant="ghost"
              />
            )}
          </>
        }
      />
      {tab === "console" ? (
        <div className="console-output" ref={outputRef}>
          {visibleEntries.length === 0 ? (
            <EmptyState
              className="console-empty"
              icon={<TerminalSquare size={18} />}
              title="No console output"
              description="Run the simulation to stream runtime messages."
              isCompact
            />
          ) : (
            visibleEntries.map((entry) => (
              <div className={`console-line is-${entry.level}`} key={entry.id}>
                <span>{String(entry.tick).padStart(6, "0")}</span>
                <b>{entry.level.toUpperCase()}</b>
                <pre>{entry.message}</pre>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="memory-view">
          <CodeBlock
            className="memory-code"
            code={JSON.stringify(state?.memory ?? {}, null, 2)}
            language="json"
            hasLanguageLabel={false}
            hasLineNumbers={false}
            hasCopyButton
            isWrapped
            width="100%"
            maxHeight="100%"
            container="section"
          />
        </div>
      )}
    </section>
  );
}
