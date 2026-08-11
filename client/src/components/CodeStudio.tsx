import Editor, { type BeforeMount } from "@monaco-editor/react";
import { BookOpen, Braces, Check, CloudUpload, Save } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { Tab } from "@astryxdesign/core/TabList";
import { TabList } from "@astryxdesign/core/TabList";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useEffect, useState } from "react";
import type { ApiReferenceItem } from "../../../shared/types";
import "../monaco";

interface CodeStudioProps {
  code: string;
  dirty: boolean;
  busy: boolean;
  error?: string;
  reference: ApiReferenceItem[];
  onChange: (code: string) => void;
  onSave: () => void;
}

export function CodeStudio({ code, dirty, busy, error, reference, onChange, onSave }: CodeStudioProps) {
  const [tab, setTab] = useState<"code" | "api">("code");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSave]);

  const configureMonaco: BeforeMount = (monaco) => {
    monaco.editor.defineTheme("nexora", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6f8175", fontStyle: "italic" },
        { token: "keyword", foreground: "ff8f70" },
        { token: "string", foreground: "a6e3a1" },
        { token: "number", foreground: "f7d36f" },
        { token: "identifier", foreground: "dce8df" }
      ],
      colors: {
        "editor.background": "#101411",
        "editor.foreground": "#dce8df",
        "editor.lineHighlightBackground": "#182019",
        "editorCursor.foreground": "#ff8f70",
        "editor.selectionBackground": "#31584988",
        "editorLineNumber.foreground": "#4c5a50",
        "editorLineNumber.activeForeground": "#9eafa3",
        "editorIndentGuide.background1": "#273028",
        "editorIndentGuide.activeBackground1": "#4a5f4f"
      }
    });
  };

  return (
    <aside className="code-studio">
      <Toolbar
        className="studio-tabs"
        label="Code studio view controls"
        size="sm"
        dividers={["bottom"]}
        startContent={
          <TabList value={tab} onChange={(value) => setTab(value as "code" | "api")} aria-label="Code studio view" size="sm">
            <Tab value="code" label="Program" icon={<Braces size={14} />} />
            <Tab value="api" label="API" icon={<BookOpen size={14} />} />
          </TabList>
        }
        endContent={
          <Badge
            className="studio-file-status"
            icon={dirty ? <CloudUpload size={13} /> : <Check size={13} />}
            label={dirty ? "Modified" : "Saved"}
            variant={dirty ? "warning" : "green"}
          />
        }
      />

      {tab === "code" ? (
        <div className="editor-shell">
          <Toolbar
            className="file-tab"
            label="Open program file"
            size="sm"
            dividers={["bottom"]}
            startContent={
              <>
                <Badge className="js-badge" label="JS" variant="yellow" />
                <code>main.js</code>
                {dirty && <Badge className="file-dirty-indicator" label="Unsaved" variant="warning" />}
              </>
            }
          />
          <div className="editor-frame">
            <Editor
              path="main.js"
              language="javascript"
              theme="nexora"
              value={code}
              beforeMount={configureMonaco}
              onChange={(value) => onChange(value ?? "")}
              loading={<div className="editor-loading"><Spinner size="md" shade="subtle" label="Editor boot" /></div>}
              options={{
                minimap: { enabled: false },
                fontFamily: '"Cascadia Code", Consolas, monospace',
                fontSize: 13,
                lineHeight: 21,
                letterSpacing: 0,
                padding: { top: 12, bottom: 12 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                renderLineHighlight: "all",
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on"
              }}
            />
          </div>
          <Toolbar
            className="studio-footer"
            label="Program save controls"
            size="sm"
            dividers={["top"]}
            startContent={
              <Badge
                className={error ? "save-message is-error" : "save-message"}
                icon={error ? <CloudUpload size={12} /> : <Check size={12} />}
                label={error ?? (dirty ? "Unsaved buffer" : "Program synchronized")}
                variant={error ? "error" : dirty ? "warning" : "neutral"}
              />
            }
            endContent={
              <Button
                label="Save"
                icon={busy ? <Spinner size="sm" shade="inherit" aria-label="Saving program" /> : <Save size={14} />}
                onClick={onSave}
                isDisabled={busy || !dirty}
                size="sm"
                variant="primary"
              />
            }
          />
        </div>
      ) : (
        <div className="api-reference">
          <Toolbar
            className="api-reference-heading"
            label="Runtime API reference"
            size="sm"
            dividers={["bottom"]}
            startContent={<Badge icon={<BookOpen size={13} />} label="Runtime API" variant="neutral" />}
            endContent={<Badge label={`${reference.length} entries`} variant="neutral" />}
          />
          {reference.length === 0 ? (
            <EmptyState
              className="api-empty"
              icon={<BookOpen size={20} />}
              title="No API reference loaded"
              description="The runtime did not publish callable APIs for this package."
              isCompact
            />
          ) : (
            <List className="api-reference-list" density="compact" hasDividers>
              {reference.map((item) => (
                <ListItem
                  key={item.signature}
                  label={<code>{item.signature}</code>}
                  description={item.description}
                  endContent={item.returns ? <Badge label={item.returns} variant="neutral" /> : undefined}
                />
              ))}
            </List>
          )}
        </div>
      )}
    </aside>
  );
}
