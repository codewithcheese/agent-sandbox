import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  execute as todoWriteExecute,
  defaultConfig,
  toolDef,
} from "../../../src/tools/todo/write.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types";
import { invariant } from "@epic-web/invariant";
import {
  type TodoItem,
  type TodoPriority,
  TODOS_STORE_KEY,
  type TodoStatus,
} from "../../../src/tools/todo/shared.ts";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import {
  helpers as mockVaultHelpers,
  vault as mockVault,
} from "../../mocks/obsidian.ts";
import { SessionStore } from "../../../src/chat/session-store.svelte.ts";

describe("TodoWrite tool execute function", () => {
  let toolExecOptions: ToolCallOptionsWithContext;
  let vault: VaultOverlay;
  let mockSessionStore: Record<string, any>;
  let mockAbortController: AbortController;
  let sessionStore: SessionStore;

  const sampleTodo1: TodoItem = {
    id: "task_1",
    content: "Implement feature X",
    status: "pending",
    priority: "high",
  };
  const sampleTodo2: TodoItem = {
    id: "task_2",
    content: "Write tests for X",
    status: "pending",
    priority: "medium",
  };
  const sampleTodo3: TodoItem = {
    id: "task_3",
    content: "Deploy X",
    status: "in_progress",
    priority: "high",
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    await mockVaultHelpers.reset();

    mockAbortController = new AbortController();
    vault = new VaultOverlay(mockVault);
    sessionStore = new SessionStore(vault);

    toolExecOptions = {
      toolCallId: "test-todowrite-call",
      messages: [],
      getContext: () => ({
        config: {}, // Use tool's default config
        vault: null,
        sessionStore,
      }),
      abortSignal: mockAbortController.signal,
    };
  });

  it("should add a new todo list to an empty store", async () => {
    const newTodos = [sampleTodo1, sampleTodo2];
    const params = { todos: newTodos };
    const result = await todoWriteExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "message" in result && !("error" in result),
      "Expected success object",
    );
    expect(result.message).toContain("Todo list updated successfully");
    expect(result.oldTodosCount).toBe(0);
    expect(result.newTodosCount).toBe(2);
    expect(result.llmConfirmation).toContain(
      "Total: 2 (Pending: 2, In Progress: 0, Completed: 0)",
    );

    // Check using SessionStore async API
    const storedTodos = await sessionStore.get(TODOS_STORE_KEY);
    expect(storedTodos).toEqual(newTodos);
  });

  it("should replace an existing todo list in the store", async () => {
    // Set up existing todos using SessionStore API
    await sessionStore.set(TODOS_STORE_KEY, [sampleTodo3]);

    const newTodos = [sampleTodo1, sampleTodo2];
    const params = { todos: newTodos };
    const result = await todoWriteExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "message" in result && !("error" in result),
      "Expected success object",
    );
    expect(result.oldTodosCount).toBe(1);
    expect(result.newTodosCount).toBe(2);

    // Check using SessionStore async API
    const storedTodos = await sessionStore.get(TODOS_STORE_KEY);
    expect(storedTodos).toEqual(newTodos);
  });

  it("should clear the todo list if an empty array is provided", async () => {
    // Set up existing todos using SessionStore API
    await sessionStore.set(TODOS_STORE_KEY, [
      sampleTodo1,
      sampleTodo2,
      sampleTodo3,
    ]);

    const params = { todos: [] };
    const result = await todoWriteExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "message" in result && !("error" in result),
      "Expected success object",
    );
    expect(result.oldTodosCount).toBe(3);
    expect(result.newTodosCount).toBe(0);
    expect(result.llmConfirmation).toContain("Total: 0");

    // Check using SessionStore async API
    const storedTodos = await sessionStore.get(TODOS_STORE_KEY);
    expect(storedTodos).toEqual([]);
  });

  // --- Semantic Validation Tests ---
  it("should return error if more than one task is 'in_progress'", async () => {
    const invalidTodos = [
      { ...sampleTodo1, status: "in_progress" as TodoStatus },
      { ...sampleTodo3, status: "in_progress" as TodoStatus }, // Already in_progress
    ];
    const params = { todos: invalidTodos };
    const result = await todoWriteExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Invalid Todo List Semantics");
    expect(result.message).toContain('Only one task can be "in_progress"');
    expect(await sessionStore.get(TODOS_STORE_KEY)).toBeUndefined(); // Store should not be updated
  });

  it("should return error if duplicate todo IDs are provided", async () => {
    const invalidTodos = [
      { ...sampleTodo1, id: "duplicate_id" },
      { ...sampleTodo2, id: "duplicate_id" },
    ];
    const params = { todos: invalidTodos };
    const result = await todoWriteExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Invalid Todo List Semantics");
    expect(result.message).toContain('Duplicate todo ID found: "duplicate_id"');
    expect(await sessionStore.get(TODOS_STORE_KEY)).toBeUndefined();
  });

  it("should return error if todo list exceeds MAX_TODOS (via Zod schema)", async () => {
    // This tests Zod schema validation, not semantic validation
    const tooManyTodos = Array.from(
      { length: defaultConfig.MAX_TODOS + 1 },
      (_, i) => ({
        id: `task_${i}`,
        content: `Content ${i}`,
        status: "pending" as TodoStatus,
        priority: "low" as TodoPriority,
      }),
    );
    const params = { todos: tooManyTodos };

    expect(() => toolDef.inputSchema.parse(params)).toThrow(/cannot exceed/i);
  });

  it("should return 'Operation aborted' if signal is aborted", async () => {
    mockAbortController.abort();
    const params = { todos: [sampleTodo1] };
    const result = await todoWriteExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Operation aborted");
    expect(await sessionStore.get(TODOS_STORE_KEY)).toBeUndefined(); // Store should not be updated
  });

  it("should correctly report counts in llmConfirmation", async () => {
    const todos = [
      {
        id: "t1",
        content: "c1",
        status: "pending" as TodoStatus,
        priority: "high" as TodoPriority,
      },
      {
        id: "t2",
        content: "c2",
        status: "in_progress" as TodoStatus,
        priority: "medium" as TodoPriority,
      },
      {
        id: "t3",
        content: "c3",
        status: "completed" as TodoStatus,
        priority: "low" as TodoPriority,
      },
      {
        id: "t4",
        content: "c4",
        status: "cancelled" as TodoStatus,
        priority: "low" as TodoPriority,
      },
    ];
    const params = { todos };
    const result = await todoWriteExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "llmConfirmation" in result,
      "Expected success object",
    );
    expect(result.llmConfirmation).toBe(
      "Todo list updated. Total: 4 (Pending: 1, In Progress: 1, Completed: 1).",
    );
  });
});
