import { usePlugin } from "$lib/utils";
import type { AIAccount, ChatModel, AnyModel } from "./settings.ts";

export function getAccount(accountId: string): AIAccount {
  const plugin = usePlugin();
  const account = plugin.settings.accounts.find(
    (a) => a.id === accountId,
  );
  if (!account) {
    throw Error(`AI account ${accountId} not found`);
  }
  return account;
}

export function getChatModel(modelId: string): ChatModel {
  const plugin = usePlugin();
  const model = plugin.settings.models.find(
    (m) => m.id === modelId,
  );
  if (!model) {
    throw Error(`Model ${modelId} not found`);
  }
  if (model.type !== "chat") {
    throw Error(`Model ${modelId} is not a chat model (type: ${model.type})`);
  }
  return model as ChatModel;
}

export function getModel(modelId: string): AnyModel {
  const plugin = usePlugin();
  const model = plugin.settings.models.find(
    (m) => m.id === modelId,
  );
  if (!model) {
    throw Error(`Model ${modelId} not found`);
  }
  return model;
}

export function getAccountAndChatModel(accountId: string, modelId: string): {
  account: AIAccount;
  model: ChatModel;
} {
  return {
    account: getAccount(accountId),
    model: getChatModel(modelId),
  };
}
