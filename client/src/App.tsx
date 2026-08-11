import { FlaskConical } from "lucide-react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { ControlPayload } from "../../shared/types";
import { ConsolePanel } from "./components/ConsolePanel";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { WorldCanvas } from "./components/WorldCanvas";
import { useGame } from "./hooks/useGame";

const CodeStudio = lazy(async () => ({
  default: (await import("./components/CodeStudio")).CodeStudio
}));

export function App() {
  const game = useGame(true);

  return (
    <AppShell className="application-frame" height="fill" contentPadding={0} mobileNav={false}>
      <div className="workspace-content">
        <AutomationColonyExample game={game} />
      </div>
    </AppShell>
  );
}

function AutomationColonyExample({ game }: { game: ReturnType<typeof useGame> }) {
  const [draft, setDraft] = useState("");
  const [loadedCode, setLoadedCode] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const dirty = loadedCode !== undefined && draft !== loadedCode;

  useEffect(() => {
    if (game.code !== undefined && loadedCode === undefined) {
      setDraft(game.code);
      setLoadedCode(game.code);
    }
  }, [game.code, loadedCode]);

  useEffect(() => {
    if (!selectedId && game.snapshot?.state.objects.length) {
      const firstUnit = game.snapshot.state.objects.find((object) => object.kind === "unit");
      setSelectedId(firstUnit?.id ?? game.snapshot.state.objects[0].id);
    }
  }, [game.snapshot, selectedId]);

  const handleSave = useCallback(async () => {
    if (!dirty) {
      return;
    }
    const saved = await game.updateCode(draft);
    if (saved) {
      setLoadedCode(draft);
    }
  }, [dirty, draft, game]);

  const handleControl = useCallback(
    (command: ControlPayload["command"]) => {
      if (command === "reset") {
        setResetConfirmationOpen(true);
        return;
      }
      void game.control(command);
    },
    [game]
  );

  return (
    <div className="app-shell example-shell">
      <Banner
        className="example-banner"
        container="section"
        status="info"
        icon={<FlaskConical size={13} />}
        title="Automation Colony"
        description="Example game package"
      />
      <Header
        state={game.snapshot?.state}
        connection={game.connection}
        busy={game.busy}
        onControl={handleControl}
        onTickRate={(rate) => void game.updateTickRate(rate)}
      />
      <main className="workbench">
        <Sidebar state={game.snapshot?.state} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="center-stack">
          <WorldCanvas state={game.snapshot?.state} selectedId={selectedId} onSelect={setSelectedId} />
          <ConsolePanel entries={game.snapshot?.console ?? []} state={game.snapshot?.state} />
        </div>
        <Suspense
          fallback={
            <aside className="code-studio studio-loading">
              <Spinner size="lg" shade="subtle" label="Loading editor" />
            </aside>
          }
        >
          <CodeStudio
            code={draft}
            dirty={dirty}
            busy={game.busy}
            error={game.error}
            reference={game.reference}
            onChange={setDraft}
            onSave={() => void handleSave()}
          />
        </Suspense>
      </main>
      {(!game.snapshot || game.code === undefined) && (
        <div className="boot-screen">
          <div className="boot-mark">NX</div>
          <Spinner size="lg" shade="subtle" label="Booting world runtime" />
        </div>
      )}
      <AlertDialog
        isOpen={resetConfirmationOpen}
        onOpenChange={setResetConfirmationOpen}
        title="Reset Automation Colony?"
        description="The world state resets while the current program remains available."
        actionLabel="Reset world"
        actionVariant="destructive"
        onAction={() => {
          void game.control("reset");
          setResetConfirmationOpen(false);
        }}
      />
    </div>
  );
}
