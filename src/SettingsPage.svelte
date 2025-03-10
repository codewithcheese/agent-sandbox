<script lang="ts">
  import { usePlugin } from "$lib/utils";
  import { onDestroy, onMount } from "svelte";
  import { PlusCircleIcon, SettingsIcon, Trash2Icon } from "lucide-svelte";
  import { ModelProvider } from "$lib/models";

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
    <div class="setting-item-name">Model providers</div>
    <div class="setting-item-description"></div>
  </div>
  <div class="setting-item-control">
    <PlusCircleIcon
      class="clickable-icon extra-setting-button"
      onclick={() =>
        plugin.openAddModelProviderModal((profile) => {
          settings.modelProviders.push(profile);
          save();
        })}
    />
  </div>
</div>
{#if settings.modelProviders.length === 0}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">No model providers setup</div>
      <div class="setting-item-description">
        Add a model provider to start using AI.
      </div>
    </div>
    <div class="setting-item-control"></div>
  </div>
{/if}
{#each settings.modelProviders as provider, index}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">{provider.name}</div>
      <div class="setting-item-description">
        {ModelProvider[provider.provider].name}
      </div>
    </div>
    <div class="setting-item-control">
      <button
        onclick={() =>
          plugin.openAddModelProviderModal((profile) => {
            settings.modelProviders[index] = profile;
            save();
          }, $state.snapshot(provider))}
        class="clickable-icon extra-setting-button"
        aria-label="Options"
      >
        <SettingsIcon class="clickable-icon extra-setting-button" />
      </button>
      <button
        onclick={() => {
          settings.modelProviders.splice(index, 1);
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
