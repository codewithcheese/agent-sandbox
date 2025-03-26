import { tool } from "ai";
import { z } from "zod";

/**
 * https://www.anthropic.com/engineering/claude-think-tool
 */
export const thinkTool = tool({
  description:
    "Use this tool to think about something. It will not obtain new information or change anything, but just allows for complex reasoning or brainstorming. Use it when you need to analyze tool outputs, verify policy compliance, or make sequential decisions.",
  parameters: z.object({
    thought: z
      .string()
      .describe("Your detailed thoughts, analysis, or reasoning process."),
  }),
  execute: async ({ thought }) => {
    // This is a no-op tool - it simply returns the thought that was passed in
    // The value comes from giving Claude space to think in a structured way
    return thought;
  },
});
