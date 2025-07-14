import type { App } from "obsidian";

export const fileShouldDefaultAsChat = (path: string, app: App): boolean => {
  return path?.endsWith(".chat.md");
};
