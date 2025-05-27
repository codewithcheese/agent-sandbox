<script lang="ts">
  import { PlusIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-svelte";
  import type { ChatItem } from "./chat-history-view.svelte.ts";
  import { humanTime } from "$lib/utils/datetime.ts";

  type Props = {
    chats: ChatItem[];
    onChatClick: (path: string) => void;
    onNewChatClick: () => void;
  };

  let { chats, onChatClick, onNewChatClick }: Props = $props();

  // Pagination
  const PAGE_SIZE = 20;
  let currentPage = $state(0);

  // Get current page of chats
  let pagedChats = $derived(
    chats.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
  );

  let totalPages = $derived(Math.ceil(chats.length / PAGE_SIZE));
  let hasNextPage = $derived(currentPage < totalPages - 1);
  let hasPrevPage = $derived(currentPage > 0);

  function nextPage() {
    if (hasNextPage) {
      currentPage++;
    }
  }

  function prevPage() {
    if (hasPrevPage) {
      currentPage--;
    }
  }
</script>

<div class="h-full flex flex-col max-w-md mx-4 mx-auto">
  <div class="py-1 px-2 border-b border-(--background-modifier-border)">
    <div class="flex justify-between items-center">
      <h2 class="text-lg font-medium">All Conversations</h2>
      <button
        class="clickable-icon"
        onclick={onNewChatClick}
        aria-label="New Chat"
      >
        <PlusIcon class="size-4" />
      </button>
    </div>
  </div>

  <div class="overflow-y-auto flex-1 py-2">
    <div class="px-2">
      {#if chats.length === 0}
        <div class="flex flex-col items-center justify-center py-8 gap-2">
          <span class="text-sm text-(--text-muted)">No conversations found</span
          >
          <button
            class="clickable-icon gap-1 flex items-center"
            onclick={onNewChatClick}
          >
            <PlusIcon class="size-3.5" />
            <span>Create a new chat</span>
          </button>
        </div>
      {:else}
        <div class="flex flex-col gap-1">
          {#each pagedChats as chat}
            <button
              style="padding: calc(var(--spacing) * 1.5)"
              class="clickable-icon p-2"
              onclick={() => onChatClick(chat.path)}
            >
              <span class="font-medium truncate">{chat.title}</span>
              <span
                class="ml-auto text-xs text-(--text-muted) whitespace-nowrap"
              >
                {humanTime(chat.lastModified)}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <!-- Pagination controls -->
  {#if totalPages > 1}
    <div class="flex justify-between items-center mt-4 text-sm py-4">
      <button
        class="clickable-icon"
        onclick={prevPage}
        disabled={!hasPrevPage}
        class:opacity-50={!hasPrevPage}
      >
        <ChevronLeftIcon class="size-4" />
        <span>Previous</span>
      </button>

      <span class="text-(--text-muted) text-sm">
        Page {currentPage + 1} of {totalPages}
      </span>

      <button
        class="clickable-icon"
        onclick={nextPage}
        disabled={!hasNextPage}
        class:opacity-50={!hasNextPage}
      >
        <span>Next</span>
        <ChevronRightIcon class="size-4" />
      </button>
    </div>
  {/if}
</div>
