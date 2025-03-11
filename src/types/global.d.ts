import * as ObsidianType from "obsidian";

declare global {
  interface Window {
    obsidianAPI: typeof ObsidianType;
    devModule: any;
    Env: {
      Plugin: AgentSandboxPlugin;
    };
  }
}
