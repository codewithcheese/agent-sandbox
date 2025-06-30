import { z } from "zod";
import { createDebug } from "$lib/debug";
import type { LocalToolDefinition, ToolCallOptionsWithContext } from "../types";
import { invariant } from "@epic-web/invariant";
import { type TodoItem, todoItemSchema, TODOS_STORE_KEY } from "./shared.ts";

const debug = createDebug();

export const defaultConfig = {
  MAX_TODOS: 100, // Safety limit for the number of todos
} as const;

const inputSchema = z.strictObject({
  todos: z
    .array(todoItemSchema)
    .describe(
      "The complete, updated list of all todo items for the current session. This list will replace any existing todo list.",
    )
    .max(
      defaultConfig.MAX_TODOS,
      `The todo list cannot exceed ${defaultConfig.MAX_TODOS} items.`,
    ),
});

export const TOOL_NAME = "TodoWrite";
export const TOOL_DESCRIPTION =
  "Update the todo list for the current session. To be used proactively and often to track progress and pending tasks.";
export const TOOL_PROMPT_GUIDANCE = `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

IMPORTANT: When calling this tool, you MUST provide the *entire, complete, and updated* list of todos. This tool replaces the existing list with the one you provide. Do not provide only changes or new items.

## When to Use This Tool
Use this tool proactively in these scenarios:
1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done
5. After receiving new instructions - Immediately capture user requirements as todos. Feel free to edit the todo list based on new information.
6. After completing a task - Mark it complete and add any new follow-up tasks
7. When you start working on a new task, mark the todo as in_progress. Ideally you should only have one todo as in_progress at a time. Complete existing tasks before starting new ones.

## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management
1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully
   - cancelled: Task no longer needed (use this if a task becomes irrelevant)

2. **Task Management**:
   - Update task status in real-time as you work.
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions).
   - Only have ONE task in_progress at any time.
   - Complete current tasks before starting new ones.
   - Cancel tasks that become irrelevant.

3. **Task Breakdown**:
   - Create specific, actionable items.
   - Break complex tasks into smaller, manageable steps.
   - Use clear, descriptive task names.
   - Ensure each todo item has a unique 'id'. You can generate these (e.g., "task_1", "task_2", or more descriptive like "implement_auth_api").

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.
`;

type TodoWriteToolOutput =
  | {
      message: string;
      oldTodosCount: number;
      newTodosCount: number;
      llmConfirmation: string;
    }
  | {
      error: string;
      message?: string;
    };

function validateTodoSemantics(
  newTodos: TodoItem[],
  config: typeof defaultConfig,
): { valid: boolean; message?: string } {
  const inProgressTasks = newTodos.filter(
    (todo) => todo.status === "in_progress",
  );
  if (inProgressTasks.length > 1) {
    return {
      valid: false,
      message: `Invalid todo list: Only one task can be "in_progress" at a time. Found ${inProgressTasks.length}. Please correct the list.`,
    };
  }

  const ids = new Set<string>();
  for (const todo of newTodos) {
    if (ids.has(todo.id)) {
      return {
        valid: false,
        message: `Invalid todo list: Duplicate todo ID found: "${todo.id}". All todo IDs must be unique.`,
      };
    }
    ids.add(todo.id);
  }
  return { valid: true };
}

// --- Execute Function ---
export async function execute(
  params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<TodoWriteToolOutput> {
  const { abortSignal } = toolExecOptions; // abortSignal might not be heavily used here but good to have
  const { sessionStore, config: contextConfig } = toolExecOptions.getContext();

  const config = { ...defaultConfig, ...contextConfig };

  invariant(
    sessionStore,
    "Session store not available in execution context for TodoWrite tool.",
  );

  const newTodosFromLLM = params.todos;

  const semanticValidation = validateTodoSemantics(newTodosFromLLM, config);
  if (!semanticValidation.valid) {
    return {
      error: "Invalid Todo List Semantics",
      message: semanticValidation.message,
    };
  }

  if (abortSignal.aborted) {
    return {
      error: "Operation aborted",
      message: "TodoWrite operation aborted by user.",
    };
  }

  const oldTodos: TodoItem[] =
    (await sessionStore.get<TodoItem[]>(TODOS_STORE_KEY)) || [];
  // Replace the entire todo list with the new one from the LLM
  await sessionStore.set(TODOS_STORE_KEY, newTodosFromLLM);
  debug(
    `Todo list updated in store. Old count: ${oldTodos.length}, New count: ${newTodosFromLLM.length}`,
  );

  const inProgressCount = newTodosFromLLM.filter(
    (t) => t.status === "in_progress",
  ).length;
  const pendingCount = newTodosFromLLM.filter(
    (t) => t.status === "pending",
  ).length;
  const completedCount = newTodosFromLLM.filter(
    (t) => t.status === "completed",
  ).length;

  return {
    message: "Todo list updated successfully.",
    oldTodosCount: oldTodos.length,
    newTodosCount: newTodosFromLLM.length,
    llmConfirmation: `Todo list updated. Total: ${newTodosFromLLM.length} (Pending: ${pendingCount}, In Progress: ${inProgressCount}, Completed: ${completedCount}).`,
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
