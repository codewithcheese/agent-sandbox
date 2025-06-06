import { z } from "zod";

export const todoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoPrioritySchema = z.enum(["high", "medium", "low"]);

export type TodoPriority = z.infer<typeof todoPrioritySchema>;

export const todoItemSchema = z.strictObject({
  id: z.string().min(1, "Todo ID cannot be empty."),
  content: z.string().min(1, "Todo content cannot be empty."),
  status: todoStatusSchema,
  priority: todoPrioritySchema,
});

export type TodoItem = z.infer<typeof todoItemSchema>;

export const TODOS_STORE_KEY = "todoList" as const;
