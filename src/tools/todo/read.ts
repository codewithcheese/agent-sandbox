import { z } from "zod";
import { createDebug } from "$lib/debug";
import type {
  ToolExecutionOptionsWithContext,
  LocalToolDefinition,
} from "../types";
import { invariant } from "@epic-web/invariant";
import { TODOS_STORE_KEY, type TodoItem } from "./shared.ts"; // Import from TodoWrite

const debug = createDebug();

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

type TodoReadToolOutput =
  | {
      todos: TodoItem[];
      count: number;
      // For LLM, a concise confirmation + stringified list is often best
      llmConfirmation: string;
    }
  | {
      error: string;
      message?: string;
    };

export async function execute(
  _params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolExecutionOptionsWithContext,
): Promise<TodoReadToolOutput> {
  const { abortSignal } = toolExecOptions;
  const { sessionStore, config: contextConfig } = toolExecOptions.getContext();

  const config = { ...defaultConfig, ...contextConfig };

  invariant(
    sessionStore,
    "Session store not available in execution context for TodoRead tool.",
  );

  if (abortSignal.aborted) {
    return {
      error: "Operation aborted",
      message: "TodoRead operation aborted by user.",
    };
  }

  const currentTodos: TodoItem[] = (await sessionStore.get<TodoItem[]>(TODOS_STORE_KEY)) || [];

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
};
