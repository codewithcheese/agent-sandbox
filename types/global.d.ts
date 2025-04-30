import * as ObsidianType from "obsidian";
import * as CodeMirrorViewType from "@codemirror/view";
import * as CodeMirrorStateType from "@codemirror/state";

declare global {
  interface Window {
    bridge: {
      obsidian: typeof ObsidianType;
      "@codemirror/view": typeof CodeMirrorViewType;
      "@codemirror/state": typeof CodeMirrorStateType;
    };
    devModule: any;
    Env: {
      Plugin: AgentSandboxPlugin;
    };
  }
}
