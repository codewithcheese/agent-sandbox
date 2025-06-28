import { generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { createAIProvider } from "../../src/settings/providers.ts";
import { useRecording } from "../use-recording.ts";

// fixme: not using har in CI
describe.skip("generateText", () => {
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
            "In Hitchhiker's Guide to the Galaxy. What number represents the meaning of life. Answer with numerals only.",
        },
      ],
      maxRetries: 0,
      maxSteps: 1,
      temperature: 0,
      providerOptions: {
        anthropic: {},
      },
    });

    let content = "";
    for await (const part of response.textStream) {
      content += part;
    }

    expect(content).toContain("42");
  });
});
