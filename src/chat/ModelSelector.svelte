<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { ChevronDownIcon, ChevronRightIcon, ClockIcon } from "lucide-svelte";
  import { usePlugin } from "$lib/utils";
  import type { AIAccount } from "../settings/providers.ts";
  import type { ChatModel } from "../settings/settings.ts";
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
    const grouped = {} as Record<string, AIAccount[]>;
    if (!plugin.settings?.accounts) {
      return grouped;
    }
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
    const grouped = {} as Record<string, ChatModel[]>;
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

  // Available providers (those with both accounts and models)
  let availableProviders = $derived(
    Object.keys(accountsByProvider).filter(
      (providerId) => modelsByProvider[providerId]?.length > 0,
    ) as string[],
  );

  // Get display text for current selection
  let selectedText = $derived.by(() => {
    if (!selectedModelId || !selectedAccountId) {
      return "Select model";
    }

    const account = plugin.settings.accounts.find(
      (a) => a.id === selectedAccountId,
    );
    if (!account) {
      return selectedModelId;
    }

    const accountsForProvider = accountsByProvider[account.provider] || [];
    const showAccountName = accountsForProvider.length > 1;

    return showAccountName
      ? `${selectedModelId} (${account.name})`
      : selectedModelId;
  });

  function handleModelSelect(modelId: string, accountId: string) {
    // Call the callback first
    onModelChange(modelId, accountId);

    const account = plugin.settings.accounts.find((a) => a.id === accountId);
    if (!account) {
      console.warn(
        `Account ${accountId} not found, skipping recent model update`,
      );
      return;
    }

    addRecentModel({
      modelId,
      accountId,
      accountName: account.name,
      providerId: account.provider,
    });
  }

  function isValidRecentModel(recent: RecentModel): boolean {
    const accountExists = plugin.settings.accounts.some(
      (account) =>
        account.id === recent.accountId &&
        account.provider === recent.providerId,
    );

    const modelExists = plugin.settings.models.some(
      (model) =>
        model.id === recent.modelId &&
        model.provider === recent.providerId &&
        model.type === "chat",
    );

    return accountExists && modelExists;
  }

  function getRecentModels(): RecentModel[] {
    try {
      const plugin = usePlugin();
      const stored = plugin.app.loadLocalStorage(STORAGE_KEY);
      if (!stored) return [];

      return (stored as RecentModel[]).filter(isValidRecentModel);
    } catch (e) {
      console.error("Failed to load recent models:", e);
      return [];
    }
  }

  function findOldestModelIndex(models: RecentModel[]): number {
    return models.reduce(
      (oldestIndex, current, index) =>
        current.timestamp < models[oldestIndex].timestamp ? index : oldestIndex,
      0,
    );
  }

  function updateExistingModel(index: number): void {
    recentModels[index].timestamp = Date.now();
  }

  function addNewModel(model: Omit<RecentModel, "timestamp">): void {
    if (recentModels.length >= MAX_RECENTS) {
      const oldestIndex = findOldestModelIndex(recentModels);
      recentModels.splice(oldestIndex, 1);
    }

    recentModels.push({
      ...model,
      timestamp: Date.now(),
    });
  }

  function addRecentModel(model: Omit<RecentModel, "timestamp">) {
    try {
      const existingIndex = recentModels.findIndex(
        (m) => m.modelId === model.modelId && m.accountId === model.accountId,
      );

      if (existingIndex !== -1) {
        updateExistingModel(existingIndex);
      } else {
        addNewModel(model);
      }

      // Trigger reactivity and persist
      recentModels = [...recentModels];
      plugin.app.saveLocalStorage(STORAGE_KEY, recentModels);
      debug("Updated recent models:", recentModels);
    } catch (e) {
      console.warn("Failed to save recent models:", e);
    }
  }

  function getProviderInfo(providerId: string) {
    return plugin.settings.providers.find((p) => p.id === providerId);
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
                handleModelSelect(recent.modelId, recent.accountId)}
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
        {@const provider = getProviderInfo(providerId)}
        {@const models = modelsByProvider[providerId] || []}
        {@const accounts = accountsByProvider[providerId] || []}

        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger
            class="flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] focus:bg-[var(--background-modifier-hover)] focus:outline-none"
          >
            <span class="flex-1">{provider?.name}</span>
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
