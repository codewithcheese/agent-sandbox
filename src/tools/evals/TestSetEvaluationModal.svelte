<script lang="ts">
  import { XIcon } from "lucide-svelte";
  import { usePlugin } from "$lib/utils";
  import type { AIAccount, ChatModel } from "../../settings/settings.ts";

  let { onClose, onSave, judgeModelId = null } = $props();

  const plugin = usePlugin();
  const settings = plugin.settings;

  // Get provider info helper
  function getProviderInfo(providerId: string) {
    return (
      settings.providers.find((p) => p.id === providerId) || {
        name: "Unknown Provider",
      }
    );
  }

  // Initialize state
  let selectedAccountId = $state("");
  let selectedModelId = $state("");

  // Get compatible models for the selected account
  let compatibleModels = $derived.by(() => {
    if (!selectedAccountId) return [];
    const account = settings.accounts.find((a) => a.id === selectedAccountId);
    if (!account) return [];
    return settings.models.filter(
      (m) => m.type === "chat" && m.provider === account.provider,
    );
  });

  // Handle account selection change
  function handleAccountChange(accountId: string) {
    selectedAccountId = accountId;

    if (accountId) {
      const account = settings.accounts.find((a) => a.id === accountId);
      if (account) {
        const newCompatibleModels = settings.models.filter(
          (m) => m.type === "chat" && m.provider === account.provider,
        );

        // If judge has a specific model ID and it's compatible, select it
        if (
          judgeModelId &&
          newCompatibleModels.some((m) => m.id === judgeModelId)
        ) {
          selectedModelId = judgeModelId;
        } else if (newCompatibleModels.length > 0) {
          // Otherwise select the first compatible model
          selectedModelId = newCompatibleModels[0].id;
        } else {
          selectedModelId = "";
        }
      }
    } else {
      selectedModelId = "";
    }
  }

  function handleSave() {
    if (!selectedAccountId || !selectedModelId) {
      return;
    }

    const account = settings.accounts.find((a) => a.id === selectedAccountId);
    const model = settings.models.find((m) => m.id === selectedModelId);

    if (account && model) {
      onSave({ account, model });
    }
  }

  function handleCancel() {
    onClose();
  }

  // Check if save is enabled
  let canSave = $derived(selectedAccountId && selectedModelId);
</script>

<div class="modal-header">
  <h2 class="modal-title">Test Set Evaluation Settings</h2>
  <button
    type="button"
    class="clickable-icon modal-close-button"
    onclick={handleCancel}
    aria-label="Close"
  >
    <XIcon class="size-4" />
  </button>
</div>

<div class="modal-content">
  <div class="setting-item-info" style="margin-bottom: 20px;">
    <div class="setting-item-description">
      <p>Select the account and model to use for evaluating this test set.</p>
      {#if judgeModelId}
        <p class="mt-2">
          The judge is configured to use model "{judgeModelId}".
        </p>
      {/if}
    </div>
  </div>

  <!-- Account Selection -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Account</div>
      <div class="setting-item-description">
        Select an account for test set evaluation
      </div>
    </div>
    <div class="setting-item-control">
      <select
        value={selectedAccountId}
        onchange={(e) => handleAccountChange(e.currentTarget.value)}
        class="dropdown"
      >
        <option value="">Select account...</option>
        {#each settings.accounts as account}
          <option value={account.id}>
            {getProviderInfo(account.provider).name} / {account.name}
          </option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Model Selection -->
  {#if selectedAccountId}
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Model</div>
        <div class="setting-item-description">
          Select a model for test set evaluation
        </div>
      </div>
      <div class="setting-item-control">
        <select bind:value={selectedModelId} class="dropdown">
          <option value="">Select model...</option>
          {#each compatibleModels as model}
            <option value={model.id}>{model.id}</option>
          {/each}
        </select>
      </div>
    </div>
  {/if}

  {#if judgeModelId && selectedModelId && selectedModelId !== judgeModelId}
    <div class="setting-item-info" style="margin-top: 15px;">
      <div class="setting-item-description" style="color: var(--text-muted);">
        <strong>Note:</strong> You're using model "{selectedModelId}" instead of
        the judge's configured model "{judgeModelId}". This is perfectly fine
        for testing different models, but may produce different evaluation
        results.
      </div>
    </div>
  {/if}
</div>

<div class="modal-button-container">
  <button type="button" onclick={handleCancel}>Cancel</button>
  <button
    type="button"
    onclick={handleSave}
    disabled={!canSave}
    class:mod-cta={canSave}
  >
    Run Evaluation
  </button>
</div>

<style>
</style>
