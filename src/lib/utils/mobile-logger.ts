import { Plugin, Platform } from "obsidian";

/** Register log sink that mirrors the browser console to a vault file (mobile-only). */
export function registerMobileLogger(plugin: Plugin) {
  // if (!Platform.isMobile) return;

  /** One file per day so it never grows without bound. */
  const logFile = `${plugin.manifest.dir}/log-${new Date()
    .toISOString()
    .slice(0, 10)}.txt`;

  /**
   * Stringify any JS value, coping with:
   *   – Errors (message + stack)
   *   – Circular references
   *   – BigInts / Symbols (string-ify fallback)
   */
  const safeSerialize = (value: unknown): string => {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
    }
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(
        value,
        (_k, v) => {
          if (typeof v === "object" && v !== null) {
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
          }
          if (typeof v === "bigint" || typeof v === "symbol") return String(v);
          return v;
        },
        2,
      );
    } catch {
      return String(value);
    }
  };

  /**
   * Write a single log line.  We intentionally don’t await; a failure to append
   * must never block the UI thread.
   */
  const append = (line: string) => {
    // Best-effort defence: never crash if the user deleted the folder, etc.
    void plugin.app.vault.adapter.append(logFile, `${line}\n`).catch(() => {});
  };

  /** Build a console-compatible logger for the given level. */
  const makeLogger =
    (level: keyof Console) =>
    (...args: unknown[]) => {
      const timestamp = new Date().toISOString();

      // The first stack frame outside makeLogger gives “file:line:col”.
      const callSite =
        new Error().stack
          ?.split("\n")?.[3]
          ?.trim()
          ?.replace(/^at\s+/, "") ?? "";

      append(
        `${timestamp} [${level.toUpperCase()}] ${args
          .map(safeSerialize)
          .join(" ")} ${callSite}`,
      );

      // Still forward to the original console so desktop builds behave normally.
      // @ts-expect-error
      original[level](...args);
    };

  // Keep references to the originals so we can still bubble through.
  const original: { [K in keyof Console]: Console[K] } = { ...console };

  // Patch all the standard methods.
  (["debug", "info", "log", "warn", "error"] as (keyof Console)[]).forEach(
    // @ts-expect-error
    (lvl) => (console[lvl] = makeLogger(lvl)),
  );
}
