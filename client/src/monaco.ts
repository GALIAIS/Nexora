import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "javascript" || label === "typescript") {
      return new TypeScriptWorker();
    }
    return new EditorWorker();
  }
};

loader.config({ monaco: monaco as typeof import("monaco-editor") });
