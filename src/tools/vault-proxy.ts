import { type DataWriteOptions, type TFile, Vault } from "obsidian";
import type { Change } from "@codemirror/merge";
import * as diff from "diff";
import type { Chat } from "../chat/chat.svelte.ts";

const MUTATING_METHODS = [
  // "create",
  // "createBinary",
  // "createFolder",
  "delete",
  "trash",
  // "rename",
  "modify",
  // "modifyBinary",
  "append",
  // "process",
  // "copy",
];

export function createVaultProxy(vault: Vault, toolCallId: string, chat: Chat) {
  return new Proxy<Vault>(vault, {
    get(target, propKey, receiver) {
      if (propKey === "modify") {
        return async (
          file: TFile,
          data: string,
          options?: DataWriteOptions,
        ): Promise<void> => {
          // read target file and calculate changes
          const content = await target.read(file);
          const patch = diff.createTwoFilesPatch(
            file.name,
            file.name,
            content,
            data,
          );

          chat.toolRequests.push({
            toolCallId,
            type: "modify",
            file,
            patch,
          });

          return Promise.resolve();
        };
      }

      // If it's a function but does not mutate, just forward it to the real vault instance
      if (typeof target[propKey] === "function") {
        return function (...args) {
          return Reflect.apply(target[propKey], target, args);
        };
      }

      // Otherwise, forward as-is (for properties like adapter, configDir, etc.)
      return Reflect.get(target, propKey, receiver);
    },
  });
}
