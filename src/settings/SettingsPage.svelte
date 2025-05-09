<script lang="ts">
  import { usePlugin } from "$lib/utils";
  import { onDestroy, onMount } from "svelte";
  import { PlusCircleIcon, SettingsIcon, Trash2Icon } from "lucide-svelte";

  import { AIProvider } from "./providers.ts";
  import { createModal } from "$lib/modals/create-modal.ts";
  import TextareaModal from "./TextareaModal.svelte";
  import { Notice } from "obsidian";

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

<div class="setting-item setting-item-heading">
  <div class="setting-item-info">
    <div class="setting-item-name">Vault</div>
  </div>
</div>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Chats path</div>
    <div class="setting-item-description">Where to save your chat files</div>
  </div>
  <div class="setting-item-control">
    <input
      type="text"
      value={settings.vault.chatsPath}
      onchange={(e) => {
        plugin.settings.vault.chatsPath = e.currentTarget.value;
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
        Add models to use with your agents.
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

<div class="setting-item setting-item-heading">
  <div class="setting-item-info">
    <div class="setting-item-name">Recording</div>
  </div>
</div>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Account</div>
    <div class="setting-item-description">
      Select an account for transcription. Supported providers: AssemblyAI.
    </div>
  </div>
  <div class="setting-item-control">
    <select
      value={settings.recording.accountId}
      onchange={(e) => {
        settings.recording.accountId = e.currentTarget.value;
        settings.recording.modelId = undefined;
        save();
      }}
    >
      <option value="">Select account...</option>
      {#each settings.accounts.filter((a) => a.provider === "assemblyai") as account}
        <option value={account.id}
          >{AIProvider[account.provider].name} / {account.name}</option
        >
      {/each}
    </select>
  </div>
</div>

{#if settings.recording.accountId}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Model</div>
      <div class="setting-item-description">Select a transcription model</div>
    </div>
    <div class="setting-item-control">
      <select
        value={settings.recording.modelId}
        onchange={(e) => {
          settings.recording.modelId = e.currentTarget.value;
          save();
        }}
      >
        <option value="">Select model...</option>
        {#each settings.models.filter((m) => m.type === "transcription" && m.provider === "assemblyai") as model}
          <option value={model.id}>{model.id}</option>
        {/each}
      </select>
    </div>
  </div>
{/if}

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Language</div>
    <div class="setting-item-description">
      Select the primary language for transcription
    </div>
  </div>
  <div class="setting-item-control">
    <select
      value={settings.recording.language}
      onchange={(e) => {
        settings.recording.language = e.currentTarget.value
          ? e.currentTarget.value
          : undefined;
        save();
      }}
    >
      <option value="">Auto-detect</option>
      <option value="en">Global English</option>
      <option value="en_au">Australian English</option>
      <option value="en_uk">British English</option>
      <option value="en_us">US English</option>
      <option value="es">Spanish</option>
      <option value="fr">French</option>
      <option value="de">German</option>
      <option value="it">Italian</option>
      <option value="pt">Portuguese</option>
      <option value="nl">Dutch</option>
      <option value="hi">Hindi</option>
      <option value="ja">Japanese</option>
      <option value="zh">Chinese</option>
      <option value="fi">Finnish</option>
      <option value="ko">Korean</option>
      <option value="pl">Polish</option>
      <option value="ru">Russian</option>
      <option value="tr">Turkish</option>
      <option value="uk">Ukrainian</option>
      <option value="vi">Vietnamese</option>
    </select>
  </div>
</div>

<div class="setting-item setting-item-heading">
  <div class="setting-item-info">
    <div class="setting-item-name">Chat Title Generation</div>
  </div>
</div>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Prompt</div>
    <div class="setting-item-description">
      The prompt used to generate chat titles
    </div>
  </div>
  <div class="setting-item-control">
    <button
      class="mod-cta"
      type="button"
      onclick={() => {
        console.log("creating modal");
        const modal = createModal(TextareaModal, {
          name: "Chat title generation prompt",
          description: `Prompt must contain {{ conversation }} variable, to be replaced with current chat messages.\nPrompt must require that the response generates a title with in <title></title> tags.`,
          content: settings.title.prompt,
          onSave: (content) => {
            settings.title.prompt = content;
            save();
            modal.close();
            new Notice("Saved", 3000);
          },
          onCancel: () => {
            modal.close();
          },
        });
        modal.open();
      }}>Edit</button
    >
  </div>
</div>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Account</div>
    <div class="setting-item-description">
      Select an account for chat title generation
    </div>
  </div>
  <div class="setting-item-control">
    <select
      value={settings.title.accountId}
      onchange={(e) => {
        settings.title.accountId = e.currentTarget.value;
        settings.title.modelId = undefined;
        save();
      }}
    >
      <option value="">Select account...</option>
      {#each settings.accounts as account}
        <option value={account.id}
          >{AIProvider[account.provider].name} / {account.name}</option
        >
      {/each}
    </select>
  </div>
</div>

{#if settings.title.accountId}
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Model</div>
      <div class="setting-item-description">
        Select a model for chat title generation
      </div>
    </div>
    <div class="setting-item-control">
      <select
        value={settings.title.modelId}
        onchange={(e) => {
          settings.title.modelId = e.currentTarget.value;
          save();
        }}
      >
        <option value="">Select model...</option>
        {#each settings.models.filter((m) => m.type === "chat" && (settings.title.accountId ? m.provider === settings.accounts.find((a) => a.id === settings.title.accountId)?.provider : true)) as model}
          <option value={model.id}>{model.id}</option>
        {/each}
      </select>
    </div>
  </div>
{/if}
