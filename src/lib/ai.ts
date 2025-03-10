import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import type { AIAccount } from "../../plugin/ai";

export function createAIProvider(account: AIAccount) {
  switch (account.provider) {
    case "openai":
      return createOpenAI({
        ...account.config,
      });
    case "anthropic":
      return createAnthropic({
        ...account.config,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
    case "gemini":
      return createGoogleGenerativeAI({
        ...account.config,
      });
    case "ollama":
      return createOllama({
        ...account.config,
      });
    default:
      // exhaustive check
      const provider: never = account.provider;
      throw new Error(`Unsupported AI provider: ${account.provider}`);
  }
}
