import type { SvelteViteAgentPlugin } from "./plugin/main";

declare global {
  interface Window {
    Env: {
      Plugin: SvelteViteAgentPlugin;
    };
  }
}

export {};
