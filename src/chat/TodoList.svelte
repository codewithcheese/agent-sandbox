<script lang="ts">
  import {
    CheckSquare,
    Square,
    PlaySquare,
    XSquare,
    AlertTriangle,
    ChevronDownIcon,
    ChevronUpIcon,
  } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import {
    TODOS_STORE_KEY,
    type TodoItem,
    type TodoStatus,
    type TodoPriority,
  } from "../tools/todo/shared";
  import { cn } from "$lib/utils";

  type Props = {
    chat: Chat;
  };
  let { chat }: Props = $props();

  let collapsed = $state(false);
  let todos = $derived<TodoItem[]>(chat.sessionStore?.[TODOS_STORE_KEY] || []);

  const priorityOrder: Record<TodoPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const statusOrder: Record<TodoStatus, number> = {
    in_progress: 0,
    pending: 1,
    cancelled: 2, // Show cancelled before completed
    completed: 3,
  };

  // Sort todos: in_progress first, then pending by priority, then cancelled, then completed
  let displayedTodos = $derived(
    [...todos].sort((a, b) => {
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.content.localeCompare(b.content); // Fallback sort by content
    }),
  );

  function getStatusIcon(status: TodoStatus) {
    switch (status) {
      case "pending":
        return Square;
      case "in_progress":
        return PlaySquare;
      case "completed":
        return CheckSquare;
      case "cancelled":
        return XSquare;
      default:
        return Square;
    }
  }

  function getPriorityIcon(priority: TodoPriority) {
    switch (priority) {
      case "high":
        return AlertTriangle; // Or ArrowUp for a more compact look
      case "medium":
        return undefined; // No icon for medium, or a subtle one like a dash
      case "low":
        return undefined; // No icon for low, or ArrowDown
      default:
        return undefined;
    }
  }

  function getStatusColor(status: TodoStatus): string {
    switch (status) {
      case "in_progress":
        return "text-blue-500"; // Or your theme's accent color
      case "completed":
        return "text-green-500";
      case "cancelled":
        return "text-red-500"; // Or a more muted color for cancelled
      case "pending":
      default:
        return "text-[var(--text-muted)]";
    }
  }
  function getPriorityColor(priority: TodoPriority): string {
    switch (priority) {
      case "high":
        return "text-orange-500"; // Or your theme's warning/high priority color
      case "medium":
        return "text-[var(--text-muted)]";
      case "low":
        return "text-[var(--text-faint)]";
      default:
        return "text-[var(--text-muted)]";
    }
  }
</script>

{#if todos.length > 0}
  <div class="chat-margin px-2 pt-1 pb-2 text-xs">
    <div class="flex">
      <div class="font-semibold mb-1 text-[var(--text-muted)] flex-1">
        Tasks ({todos.filter(
          (t) => t.status !== "completed" && t.status !== "cancelled",
        ).length} active):
      </div>
      <div>
        {#if collapsed}
          <ChevronUpIcon
            class="clickable-icon"
            onclick={() => (collapsed = !collapsed)}
          />
        {:else}
          <ChevronDownIcon
            class="clickable-icon"
            onclick={() => (collapsed = !collapsed)}
          />
        {/if}
      </div>
    </div>
    {#if !collapsed}
      <div class="flex flex-col gap-0.5 max-h-24 overflow-y-auto">
        {#each displayedTodos as todo (todo.id)}
          <div class="flex items-center gap-1.5 group">
            <svelte:component
              this={getStatusIcon(todo.status)}
              class={cn(
                "size-3.5 flex-shrink-0",
                getStatusColor(todo.status),
                todo.status === "completed" || todo.status === "cancelled"
                  ? "opacity-60"
                  : "",
              )}
            />
            <span
              class={cn(
                "truncate flex-grow",
                todo.status === "completed" || todo.status === "cancelled"
                  ? "line-through text-[var(--text-faint)] opacity-70"
                  : "text-[var(--text-normal)]",
                todo.status === "in_progress" ? "font-medium" : "",
              )}
              title={todo.content}
            >
              {todo.content}
            </span>
            {#if todo.status !== "completed" && todo.status !== "cancelled"}
              {@const PriorityIconComponent = getPriorityIcon(todo.priority)}
              {#if PriorityIconComponent}
                <svelte:component
                  this={PriorityIconComponent}
                  class={cn(
                    "size-3 flex-shrink-0",
                    getPriorityColor(todo.priority),
                  )}
                />
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .chat-margin {
    width: 100%;
    max-width: var(--file-line-width);
    margin-left: auto;
    margin-right: auto;
  }
</style>
