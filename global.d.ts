import type { AgentSandboxPlugin } from "./plugin/main";

declare global {
  interface Window {
    Env: {
      Plugin: AgentSandboxPlugin;
    };
  }
}

export {};
