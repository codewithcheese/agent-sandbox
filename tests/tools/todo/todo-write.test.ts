import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  execute as todoReadExecute,
  defaultConfig as defaultConfig,
  toolDef,
} from "../../../src/tools/todo/read";
import type { ToolExecutionOptionsWithContext } from "../../../src/tools/types";
import { invariant } from "@epic-web/invariant";
import {
  type TodoItem,
  todoPrioritySchema,
  TODOS_STORE_KEY,
  todoStatusSchema,
} from "../../../src/tools/todo/shared";

describe("TodoRead tool execute function", () => {
  let toolExecOptions: ToolExecutionOptionsWithContext;
  let mockSessionStore: Record<string, any>;
  let mockAbortController: AbortController;

  // Re-define sample todos using imported types for clarity and type safety
  const sampleTodo1: TodoItem = {
    id: "task_1",
    content: "Implement feature X",
    status: todoStatusSchema.Enum.pending,
    priority: todoPrioritySchema.Enum.high,
  };
  const sampleTodo2: TodoItem = {
    id: "task_2",
    content: "Write tests for X",
    status: todoStatusSchema.Enum.pending,
    priority: todoPrioritySchema.Enum.medium,
  };
  const sampleTodo3: TodoItem = {
    id: "task_3",
    content: "Deploy X",
    status: todoStatusSchema.Enum.completed,
    priority: todoPrioritySchema.Enum.low,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockSessionStore = {};
    mockAbortController = new AbortController();

    toolExecOptions = {
      toolCallId: "test-todoread-call",
      messages: [],
      getContext: () => ({
        sessionStore: mockSessionStore,
        config: { ...defaultConfig },
        vault: null as any,
      }),
      abortSignal: mockAbortController.signal,
    };
  });

  it("should return an empty list and count 0 if store is empty or key not found", async () => {
    const params = {}; // Valid empty object for TodoRead
    // Test with key not present
    let result = await todoReadExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "todos" in result && !("error" in result),
      "Expected success object (key not found)",
    );
    expect(result.todos).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.llmConfirmation).toContain("Current todo list:\n(empty)");

    // Test with key present but list is empty
    mockSessionStore[TODOS_STORE_KEY] = [];
    result = await todoReadExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "todos" in result && !("error" in result),
      "Expected success object (empty list)",
    );
    expect(result.todos).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.llmConfirmation).toContain("Current todo list:\n(empty)");
  });

  it("should return the current todo list from the store, sorted", async () => {
    const todosInStoreUnsorted = [sampleTodo2, sampleTodo3, sampleTodo1]; // Unsorted
    mockSessionStore[TODOS_STORE_KEY] = todosInStoreUnsorted;
    const params = {};
    const result = await todoReadExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "todos" in result && !("error" in result),
      "Expected success object",
    );
    expect(result.count).toBe(3);
    // Expected sort: sampleTodo1 (high prio, pending), then sampleTodo2 (medium prio, pending), then sampleTodo3 (low prio, completed)
    const expectedSortedTodos = [sampleTodo1, sampleTodo2, sampleTodo3];
    expect(result.todos).toEqual(expectedSortedTodos);

    // Verify llmConfirmation content reflects sorted order
    const confirmationLines = result.llmConfirmation.split("\n");
    expect(confirmationLines[1]).toContain(`1. ID: ${sampleTodo1.id}`);
    expect(confirmationLines[2]).toContain(`2. ID: ${sampleTodo2.id}`);
    expect(confirmationLines[3]).toContain(`3. ID: ${sampleTodo3.id}`);
    expect(result.llmConfirmation).toContain("Remember to use TodoWrite");
  });

  it("should handle sorting with mixed statuses and priorities correctly", async () => {
    const todos = [
      {
        id: "c1",
        content: "Task C Low",
        status: "completed",
        priority: "low",
      } as TodoItem,
      {
        id: "p1",
        content: "Task P High",
        status: "pending",
        priority: "high",
      } as TodoItem,
      {
        id: "i1",
        content: "Task I Medium",
        status: "in_progress",
        priority: "medium",
      } as TodoItem,
      {
        id: "p2",
        content: "Task P Low",
        status: "pending",
        priority: "low",
      } as TodoItem,
      {
        id: "p3",
        content: "Task P Medium",
        status: "pending",
        priority: "medium",
      } as TodoItem,
    ];
    mockSessionStore[TODOS_STORE_KEY] = todos;
    const params = {};
    const result = await todoReadExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "todos" in result,
      "Expected success object",
    );

    // Expected order: pending/high, in_progress/medium, pending/medium, pending/low, completed/low
    expect(result.todos.map((t) => t.id)).toEqual([
      "p1",
      "i1",
      "p3",
      "p2",
      "c1",
    ]);
  });

  it("should validate input schema (empty object)", () => {
    // Valid input
    expect(() => toolDef.inputSchema.parse({})).not.toThrow();
    // Invalid input
    expect(() => toolDef.inputSchema.parse({ unexpected: "value" })).toThrow();
  });

  // --- Abort Signal Test ---
  it("should return 'Operation aborted' if signal is aborted", async () => {
    mockAbortController.abort();
    const params = {};
    const result = await todoReadExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Operation aborted");
  });
});
