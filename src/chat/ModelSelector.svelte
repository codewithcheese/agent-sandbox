<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { ChevronDownIcon, ChevronRightIcon } from "lucide-svelte";
  import { usePlugin } from "$lib/utils";
  import type { AIAccount, AIProviderId } from "../settings/providers.ts";
  import { AIProvider } from "../settings/providers.ts";
  import type { ChatModel } from "../settings/models.ts";

  const { Group } = DropdownMenu;

  type Props = {
    selectedModelId?: string;
    selectedAccountId?: string;
    onModelChange: (modelId: string, accountId: string) => void;
  };

  let { selectedModelId, selectedAccountId, onModelChange }: Props = $props();

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

  function handleModelSelect(modelId: string, accountId: string) {
    onModelChange(modelId, accountId);
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
