<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { ChevronDownIcon, ChevronRightIcon, ClockIcon } from "lucide-svelte";
  import { usePlugin } from "$lib/utils";
  import type { AIAccount, AIProviderId } from "../settings/providers.ts";
  import { AIProvider } from "../settings/providers.ts";
  import type { ChatModel } from "../settings/models.ts";
  import { onMount } from "svelte";
  import { createDebug } from "$lib/debug.ts";

  const debug = createDebug();

  type Props = {
    selectedModelId?: string;
    selectedAccountId?: string;
    onModelChange: (modelId: string, accountId: string) => void;
  };

  type RecentModel = {
    modelId: string;
    accountId: string;
    accountName: string;
    providerId: string;
    timestamp: number;
  };

  const { Group, Separator } = DropdownMenu;
  const STORAGE_KEY = "agent-sandbox:recent-models";
  const MAX_RECENTS = 5;

  let { selectedModelId, selectedAccountId, onModelChange }: Props = $props();

  let recentModels = $state<RecentModel[]>([]);
  onMount(() => {
    recentModels = getRecentModels();
  });

  const plugin = usePlugin();

  // Group accounts by provider
  let accountsByProvider = $derived.by(() => {
    const grouped = {} as Record<AIProviderId, AIAccount[]>;
    plugin.settings.accounts.forEach((account) => {
      if (!grouped[account.provider]) {
        grouped[account.provider] = [];
      }
      grouped[account.provider].push(account);
    });
    return grouped;
  });

  // Group models by provider (only chat models)
  let modelsByProvider = $derived.by(() => {
    const grouped = {} as Record<AIProviderId, ChatModel[]>;
    plugin.settings.models
      .filter((model): model is ChatModel => model.type === "chat")
      .forEach((model) => {
        if (!grouped[model.provider]) {
          grouped[model.provider] = [];
        }
        grouped[model.provider].push(model);
      });
    return grouped;
  });

  // Get available providers (those that have both models and accounts)
  let availableProviders = $derived.by(() => {
    return Object.keys(modelsByProvider).filter(
      (providerId) =>
        accountsByProvider[providerId] &&
        accountsByProvider[providerId].length > 0,
    ) as AIProviderId[];
  });

  // Get display text for current selection
  let selectedText = $derived.by(() => {
    if (!selectedModelId || !selectedAccountId) {
      return "Select model";
    }

    const account = plugin.settings.accounts.find(
      (a) => a.id === selectedAccountId,
    );
    const accountsForProvider = accountsByProvider[account?.provider] || [];
    const showAccountName = accountsForProvider.length > 1;

    return showAccountName
      ? `${selectedModelId} (${account?.name})`
      : selectedModelId;
  });

  function handleModelSelect(
    modelId: string,
    accountId: string,
    addToRecents = true,
  ) {
    if (addToRecents) {
      const account = plugin.settings.accounts.find((a) => a.id === accountId);
      if (account) {
        recentModels = addRecentModel({
          modelId,
          accountId,
          accountName: account.name,
          providerId: account.provider,
        });
      }
    }
    onModelChange(modelId, accountId);
  }

  function getRecentModels(): RecentModel[] {
    try {
      const stored = plugin.app.loadLocalStorage(STORAGE_KEY);
      if (!stored) return [];
      return stored as RecentModel[];
    } catch (e) {
      console.warn("Failed to load recent models:", e);
      return [];
    }
  }

  function addRecentModel(
    model: Omit<RecentModel, "timestamp">,
  ): RecentModel[] {
    try {
      const recents = getRecentModels();
      // Remove any existing entry for this model-account combination
      const filtered = recents.filter(
        (m) => m.modelId !== model.modelId || m.accountId !== model.accountId,
      );
      // Add new entry at the start
      filtered.unshift({
        ...model,
        timestamp: Date.now(),
      });
      // Keep only the most recent MAX_RECENTS entries
      const trimmed = filtered.slice(0, MAX_RECENTS);
      plugin.app.saveLocalStorage(STORAGE_KEY, trimmed);
      debug("Saving recent models:", trimmed);
      return trimmed;
    } catch (e) {
      console.warn("Failed to save recent model:", e);
      return getRecentModels();
    }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="inline-flex h-9 w-[250px] select-none items-center rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-3 py-1 text-sm text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--background-modifier-border)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span class="truncate flex-1 text-left">{selectedText}</span>
    <ChevronDownIcon class="size-3.5 text-[var(--text-muted)]" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="z-50 min-w-[250px] overflow-hidden rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-1 shadow-md"
      sideOffset={4}
    >
      {#if recentModels.length > 0}
        <Group>
          <DropdownMenu.GroupHeading
            class="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
          >
            <ClockIcon class="size-3" />
            Recent
          </DropdownMenu.GroupHeading>
          {#each recentModels as recent}
            <DropdownMenu.Item
              onclick={() =>
                handleModelSelect(recent.modelId, recent.accountId, false)}
              class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-4 text-sm text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] focus:bg-[var(--background-modifier-hover)] focus:outline-none"
            >
              {recent.modelId}
              <span class="ml-1.5 text-xs text-[var(--text-muted)]"
                >({recent.accountName})</span
              >
            </DropdownMenu.Item>
          {/each}
          <Separator class="my-1 h-px bg-[var(--background-modifier-border)]" />
        </Group>
      {/if}

      {#each availableProviders as providerId}
        {@const provider = AIProvider[providerId]}
        {@const models = modelsByProvider[providerId] || []}
        {@const accounts = accountsByProvider[providerId] || []}

        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger
            class="flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] focus:bg-[var(--background-modifier-hover)] focus:outline-none"
          >
            <span class="flex-1">{provider.name}</span>
            <ChevronRightIcon class="ml-auto size-4 text-[var(--text-muted)]" />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent
            class="z-50 min-w-[200px] overflow-hidden rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-1 shadow-md"
            sideOffset={8}
          >
            <!-- Always show account headers for consistency -->
            {#each accounts as account}
              <Group>
                <DropdownMenu.GroupHeading
                  class="px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
                >
                  {account.name}
                </DropdownMenu.GroupHeading>
                {#each models as model}
                  <DropdownMenu.Item
                    onclick={() => handleModelSelect(model.id, account.id)}
                    class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-4 text-sm text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] focus:bg-[var(--background-modifier-hover)] focus:outline-none"
                  >
                    {model.id}
                  </DropdownMenu.Item>
                {/each}
              </Group>
            {/each}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
