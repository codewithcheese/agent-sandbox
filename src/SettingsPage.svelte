<script lang="ts">
  import { usePlugin } from "$lib/utils";
  import { onDestroy, onMount } from "svelte";
  import { PlusCircleIcon, SettingsIcon, Trash2Icon } from "lucide-svelte";

  import { AIProvider } from "../plugin/ai";

  const plugin = usePlugin();
  let settings = $state(plugin.settings);

  onMount(() => {
    plugin.loadSettings();
    settings = plugin.settings;
  });

  onDestroy(() => {
    console.log("Unmounting");
  });

  function save() {
    plugin.settings = $state.snapshot(settings);
    plugin.saveSettings();
  }
</script>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Chatbots path</div>
    <div class="setting-item-description">Where are your chatbots located?</div>
  </div>
  <div class="setting-item-control">
    <input
      type="text"
      value={settings.chatbotsPath}
      onchange={(e) => {
        plugin.settings.chatbotsPath = e.currentTarget.value;
        plugin.saveSettings();
        settings = plugin.settings;
      }}
    />
  </div>
</div>
<div class="setting-item setting-item-heading">
  <div class="setting-item-info">
    <div class="setting-item-name">AI Accounts</div>
  </div>
  <div class="setting-item-control">
    <PlusCircleIcon
      class="clickable-icon extra-setting-button"
      onclick={() =>
        plugin.openAccountModal((account) => {
          settings.accounts.push(account);
          console.log("pushed account", settings, account);
          save();
        })}
    />
  </div>
</div>
{#if settings.accounts.length === 0}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">No AI accounts.</div>
      <div class="setting-item-description">
        Add an AI account to start using AI.
      </div>
    </div>
    <div class="setting-item-control"></div>
  </div>
{/if}
{#each settings.accounts as provider, index}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">{provider.name}</div>
      <div class="setting-item-description">
        Provider: {AIProvider[provider.provider].name}
      </div>
    </div>
    <div class="setting-item-control">
      <button
        onclick={() =>
          plugin.openAccountModal((profile) => {
            settings.accounts[index] = profile;
            save();
          }, $state.snapshot(provider))}
        class="clickable-icon extra-setting-button"
        aria-label="Options"
      >
        <SettingsIcon class="clickable-icon extra-setting-button" />
      </button>
      <button
        onclick={() => {
          settings.accounts.splice(index, 1);
          save();
        }}
        class="clickable-icon extra-setting-button"
        aria-label="Uninstall"
      >
        <Trash2Icon class="clickable-icon extra-setting-button" />
      </button>
    </div>
  </div>
{/each}

<div class="setting-item setting-item-heading">
  <div class="setting-item-info">
    <div class="setting-item-name">Models</div>
  </div>
  <div class="setting-item-control">
    <PlusCircleIcon
      class="clickable-icon extra-setting-button"
      onclick={() =>
        plugin.openModelModal((model) => {
          settings.models.push(model);
          save();
        })}
    />
  </div>
</div>
{#if settings.models.length === 0}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">No models configured</div>
      <div class="setting-item-description">
        Add models to use with your chatbots.
      </div>
    </div>
    <div class="setting-item-control"></div>
  </div>
{/if}
{#each settings.models as model, index}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">{model.id}</div>
      <div class="setting-item-description">
        Provider: {AIProvider[model.provider].name}, {model.type === "chat"
          ? `Input: ${model.inputTokenLimit.toLocaleString()} tokens, Output: ${model.outputTokenLimit.toLocaleString()} tokens`
          : `Dimensions: ${model.dimensions}`}
      </div>
    </div>
    <div class="setting-item-control">
      <button
        onclick={() =>
          plugin.openModelModal((updatedModel) => {
            settings.models[index] = updatedModel;
            save();
          }, $state.snapshot(model))}
        class="clickable-icon extra-setting-button"
        aria-label="Edit model"
      >
        <SettingsIcon class="clickable-icon extra-setting-button" />
      </button>
      <button
        onclick={() => {
          settings.models.splice(index, 1);
          save();
        }}
        class="clickable-icon extra-setting-button"
        aria-label="Delete model"
      >
        <Trash2Icon class="clickable-icon extra-setting-button" />
      </button>
    </div>
  </div>
{/each}
