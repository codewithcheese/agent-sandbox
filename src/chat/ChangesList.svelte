<script lang="ts">
  import {
    PlusCircleIcon,
    PencilIcon,
    TrashIcon,
    ArrowRightIcon,
    ChevronDownIcon,
    ChevronUpIcon,
  } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import type { ProposedChange } from "./vault-overlay.svelte.ts";
  import { cn } from "$lib/utils";

  type Props = {
    chat: Chat;
    openMergeView: (change: ProposedChange) => Promise<void>;
  };
  let { chat, openMergeView }: Props = $props();

  let collapsed = $state(false);
  let changes = $derived<ProposedChange[]>(chat.vault.changes || []);

  // Sort changes: creates first, then modifies, renames, deletes
  const typeOrder: Record<ProposedChange["type"], number> = {
    create: 0,
    modify: 1,
    rename: 2,
    delete: 3,
  };

  let displayedChanges = $derived(
    [...changes].sort((a, b) => {
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      return a.path.localeCompare(b.path);
    }),
  );

  function getChangeIcon(type: ProposedChange["type"]) {
    switch (type) {
      case "create":
        return PlusCircleIcon;
      case "modify":
        return PencilIcon;
      case "delete":
        return TrashIcon;
      case "rename":
        return ArrowRightIcon;
      default:
        return PencilIcon;
    }
  }

  function getChangeColor(type: ProposedChange["type"]): string {
    switch (type) {
      case "create":
        return "text-green-500";
      case "modify":
        return "text-blue-500";
      case "delete":
        return "text-red-500";
      case "rename":
        return "text-orange-500";
      default:
        return "text-[var(--text-muted)]";
    }
  }

  function getChangeDescription(change: ProposedChange): string {
    switch (change.type) {
      case "create":
        return change.info.isDirectory ? "Create folder" : "Create file";
      case "modify":
        return "Modify file";
      case "delete":
        return change.info.isDirectory ? "Delete folder" : "Delete file";
      case "rename":
        return change.info.isDirectory ? "Rename folder" : "Rename file";
      default:
        return "Unknown change";
    }
  }

  function getDisplayPath(change: ProposedChange): string {
    if (change.type === "rename" && "oldPath" in change.info) {
      return `${change.info.oldPath} → ${change.path}`;
    }
    return change.path;
  }

  async function handleChangeClick(change: ProposedChange) {
    try {
      await openMergeView(change);
    } catch (error) {
      console.error("Error opening merge view for change:", error);
    }
  }
</script>

{#if changes.length > 0}
  <div class="w-full flex items-center gap-2 px-3 mx-auto pt-2 mb-0">
    <div class="w-full rounded-t-md bg-(--background-secondary-alt)">
      <div class="flex p-2">
        <div class="font-semibold text-xs text-[var(--text-muted)] flex-1">
          Changes ({changes.length} pending):
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
        <div class="flex flex-col gap-0.5 max-h-24 overflow-y-auto px-1 pb-1">
          {#each displayedChanges as change (change.path + change.type)}
            <button
              class="clickable-icon flex items-center gap-1.5 group hover:bg-(--background-modifier-hover) rounded px-1 py-0.5 text-left"
              onclick={(e) => {
                e.preventDefault();
                handleChangeClick(change);
              }}
              title={`${getChangeDescription(change)}: ${getDisplayPath(change)}`}
            >
              <svelte:component
                this={getChangeIcon(change.type)}
                class={cn(
                  "size-3.5 flex-shrink-0",
                  getChangeColor(change.type),
                )}
              />
              <span
                class="text-xs text-[var(--text-muted)] flex-shrink-0 min-w-12"
              >
                {change.type}
              </span>
              <span
                class="truncate flex-grow text-xs text-[var(--text-normal)]"
                title={getDisplayPath(change)}
              >
                {getDisplayPath(change)}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
