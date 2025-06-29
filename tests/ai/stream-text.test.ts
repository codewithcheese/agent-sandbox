import { stepCountIs, streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { createAIProvider } from "../../src/settings/providers.ts";
import { useRecording } from "../use-recording.ts";
import {
  applyStreamPartToMessages,
  type StreamingState,
} from "$lib/utils/stream.ts";
import { z } from "zod";

describe("generateText", () => {
  useRecording();

  it("should stream text with anthropic sonnet", async () => {
    const provider = createAIProvider({
      provider: "anthropic",
      id: "anthropic",
      name: "Anthropic",
      config: {
        apiKey: process.env.VITE_ANTHROPIC_API_KEY || "dummy-key-for-testing",
      },
    });

    const response = streamText({
      model: provider.languageModel("claude-4-sonnet-20250514"),
      messages: [
        {
          role: "user",
          content:
            "Whats the weather in San Francisco? Answer with numerals only.",
        },
      ],
      tools: {
        get_weather: tool({
          name: "get_weather",
          inputSchema: z.object({
            location: z.string(),
          }),
          description: "Get the weather",
          execute: async () => {
            return "42";
          },
        }),
      },
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      temperature: 0,
      providerOptions: {
        anthropic: {},
      },
    });

    const messages = [];

    const streamingState: StreamingState = {
      partialToolCalls: {},
      activeTextParts: {},
      activeReasoningParts: {},
    };
    for await (const part of response.fullStream) {
      applyStreamPartToMessages(messages, part, streamingState);
    }

    expect(messages).toHaveLength(2);
    expect(messages[1].parts[0].text).toContain("42");
  });
});
