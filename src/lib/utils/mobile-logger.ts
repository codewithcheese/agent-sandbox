import { Plugin, Platform } from "obsidian";

export function registerMobileLogger(plugin: Plugin) {
  if (!Platform.isMobile) {
    return;
  }

  const logFile = `${plugin.manifest.dir}/logs.txt`;
  const logMessages =
    (prefix: string) =>
    (...args: unknown[]) => {
      const line = [];
      line.push(`\n[${prefix}]`);
      for (const arg of args) {
        if (arg && typeof arg === "object" && !(arg instanceof Error)) {
          line.push(JSON.stringify(arg));
        } else {
          line.push(String(arg));
        }
      }
      plugin.app.vault.adapter.append(logFile, line.join(" "));
    };

  console.debug = logMessages("debug");
  console.error = logMessages("error");
  console.info = logMessages("info");
  console.log = logMessages("log");
  console.warn = logMessages("warn");
}
