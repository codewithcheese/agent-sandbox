import { z } from "zod";
import { createDebug } from "$lib/debug";
import type { ToolCallOptionsWithContext, LocalToolDefinition } from "../types";
import { invariant } from "@epic-web/invariant";
import { TODOS_STORE_KEY, type TodoItem } from "./shared.ts"; // Import from TodoWrite
import { type ToolUIPart } from "ai";

const debug = createDebug();

// Define the UI tool type for the todo read tool
type TodoReadUITool = {
  input: {};
  output: {
    todos: TodoItem[];
    count: number;
    llmConfirmation: string;
  };
};

type TodoReadToolUIPart = ToolUIPart<{ TodoRead: TodoReadUITool }>;

export const defaultConfig = {} as const;

const inputSchema = z
  .strictObject({})
  .describe(
    "No input parameters are required for this tool. Provide an empty object.",
  );

// --- Tool Info ---
export const TOOL_NAME = "TodoRead"; // Original: yU
export const TOOL_DESCRIPTION = "Read the current todo list for the session."; // Original: _70
export const TOOL_PROMPT_GUIDANCE = `Use this tool to read the current to-do list for the session. This tool should be used proactively and frequently to ensure that you are aware of the status of the current task list.

You should make use of this tool as often as possible, especially in the following situations:
- At the beginning of conversations to see what's pending.
- Before starting new tasks to prioritize work.
- When the user asks about previous tasks or plans.
- Whenever you're uncertain about what to do next.
- After completing tasks to update your understanding of remaining work.
- After every few messages to ensure you're on track.

Usage:
- This tool takes in NO PARAMETERS. You MUST provide an empty object as input (e.g., {}).
- Returns a list of todo items with their status, priority, and content.
- Use this information to track progress and plan next steps.
- If no todos exist yet, an empty list will be returned.`;

type TodoReadToolOutput = {
  todos: TodoItem[];
  count: number;
  // For LLM, a concise confirmation + stringified list is often best
  llmConfirmation: string;
};

export async function execute(
  _params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<TodoReadToolOutput> {
  const { abortSignal } = toolExecOptions;
  const { sessionStore, config: contextConfig } = toolExecOptions.getContext();

  const config = { ...defaultConfig, ...contextConfig };

  if (!sessionStore) {
    throw new Error("Session store not available in execution context for TodoRead tool");
  }

  if (abortSignal.aborted) {
    throw new Error("Operation aborted");
  }

  const currentTodos: TodoItem[] =
    (await sessionStore.get<TodoItem[]>(TODOS_STORE_KEY)) || [];

  debug(`Todo list read from store. Count: ${currentTodos.length}`);

  // Sort todos for consistent output to LLM: completed last, then by priority, then by content
  const sortedTodos = [...currentTodos].sort((a, b) => {
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return a.content.localeCompare(b.content);
  });

  // For the LLM, we provide a string representation as the primary "content" of the tool result.
  // The structured `todos` array is also included in the output object, which the calling application
  // can use for UI rendering, but the LLM will primarily see the string.
  let todosStringForLlm = "Current todo list:\n";
  if (sortedTodos.length === 0) {
    todosStringForLlm += "(empty)";
  } else {
    todosStringForLlm += sortedTodos
      .map(
        (todo, index) =>
          `${index + 1}. ID: ${todo.id}, Status: ${todo.status}, Priority: ${
            todo.priority
          }, Content: "${todo.content}"`,
      )
      .join("\n");
  }

  return {
    todos: sortedTodos,
    count: sortedTodos.length,
    llmConfirmation: `${todosStringForLlm}\n\nRemember to use TodoWrite to update the list as you make progress.`,
  };
}

export const toolDef: LocalToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: TodoReadToolUIPart) => {
    const { state, input } = toolPart;

    // Show reading todos during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      return {
        title: "TodoRead",
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;
      
      // Handle recoverable error output (TodoRead doesn't return error objects, but keeping for consistency)
      if (output && 'error' in output) {
        return {
          title: "TodoRead",
          context: (("message" in output ? output.message : undefined) || ("error" in output ? output.error : undefined)) as string,
          error: true,
        };
      }
      
      // Handle success output
      if (output && 'count' in output) {
        const { count } = output;
        const todoText = count === 1 ? "todo" : "todos";
        
        return {
          title: "TodoRead",
          lines: `${count} ${todoText}`,
        };
      }
    }

    if (state === "output-error") {
      // Show actual error message instead of generic "(error)"
      const errorText = toolPart.errorText || "Unknown error";
      
      return {
        title: "TodoRead",
        lines: errorText,
      };
    }

    return null;
  },
};
