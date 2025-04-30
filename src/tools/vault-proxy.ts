import { type DataWriteOptions, type TFile, Vault } from "obsidian";
import * as diff from "diff";
import type { Chat } from "../chat/chat.svelte.ts";
import {
  getPatchStats,
  type ReadToolRequest,
  type ToolRequest,
} from "./tool-request.ts";
import { nanoid } from "nanoid";

export function createVaultProxy(vault: Vault, toolCallId: string, chat: Chat) {
  return new Proxy<Vault>(vault, {
    get(target, propKey, receiver) {
      if (propKey === "modify") {
        return async (
          file: TFile,
          data: string,
          options?: DataWriteOptions,
        ): Promise<void> => {
          const content = await target.read(file);
          const patch = diff.createPatch(file.name, content, data);

          chat.toolRequests.push({
            id: nanoid(),
            toolCallId,
            type: "modify",
            path: file.path,
            patch,
            stats: getPatchStats(patch),
            status: "pending",
          });

          return Promise.resolve();
        };
      } else if (propKey === "read") {
        return async (file: TFile): Promise<string> => {
          console.log("Vault proxy read file: ", file.path);
          const request: ReadToolRequest = {
            id: nanoid(),
            toolCallId,
            type: "read",
            path: file.path,
            status: "pending",
          };
          chat.toolRequests.push(request);
          try {
            const contents = vault.read(file);
            updateRequestStatus(chat, request.id, "success");
            return contents;
          } catch (e) {
            updateRequestStatus(chat, request.id, "failure");
            throw e;
          }
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

function updateRequestStatus(
  chat: Chat,
  id: string,
  status: ToolRequest["status"],
) {
  const request = chat.toolRequests.find((r) => r.id === id);
  if (request) {
    request.status = status;
  }
}
