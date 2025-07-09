<script lang="ts">
  import { usePlugin } from "$lib/utils";
  import { mount, onDestroy, onMount, unmount } from "svelte";
  import { PlusCircleIcon, SettingsIcon, Trash2Icon } from "lucide-svelte";
  import { Tabs } from "bits-ui";

  import { createModal } from "$lib/modals/create-modal.ts";
  import TextareaModal from "./TextareaModal.svelte";
  import { Modal, Notice } from "obsidian";
  import type {
    AIAccount,
    ChatModel,
    EmbeddingModel,
    AnyModel,
  } from "./settings.ts";
  import ModelModal from "./ModelModal.svelte";
  import AccountModal from "./AccountModal.svelte";
  import { folderSuggest } from "./folder-suggest.ts";
  import debug from "debug";

  const plugin = usePlugin();
  let settings = $state(plugin.settings);
  let { agents } = $props();

  // Start with chat tab as default
  let activeTab = $state("chat");

  // Provider filter for models tab
  let selectedProviderFilter = $state("all");

  // Compute unique providers from models
  let uniqueProviders = $derived(() => {
    const providers = [
      ...new Set(settings.models.map((m) => m.provider)),
    ] as string[];
    return providers.sort();
  });

  // Filter models based on selected provider, returning both model and original index
  let filteredModels = $derived(() => {
    if (selectedProviderFilter === "all") {
      return settings.models.map((model, index) => ({ model, index }));
    }
    return settings.models
      .map((model, index) => ({ model, index }))
      .filter(({ model }) => model.provider === selectedProviderFilter);
  });

  function getProviderInfo(providerId: string) {
    return (
      settings.providers.find((p) => p.id === providerId) || {
        name: "Unknown Provider",
      }
    );
  }

  onDestroy(() => {
    console.log("Unmounting");
  });

  function save() {
    plugin.saveSettings($state.snapshot(settings));
  }
</script>

<div class="vertical-tab-container">
  <Tabs.Root bind:value={activeTab} orientation="vertical">
    <!-- Use Obsidian's vertical tab navigation pattern -->
    <Tabs.List class="vertical-tab-nav-container">
      <Tabs.Trigger value="chat" class="vertical-tab-nav-item">
        Chat
      </Tabs.Trigger>
      <Tabs.Trigger value="accounts" class="vertical-tab-nav-item">
        Accounts
      </Tabs.Trigger>
      <Tabs.Trigger value="models" class="vertical-tab-nav-item">
        Models
      </Tabs.Trigger>
      <Tabs.Trigger value="recording" class="vertical-tab-nav-item">
        Recording
      </Tabs.Trigger>
      <Tabs.Trigger value="agents" class="vertical-tab-nav-item">
        Agents
      </Tabs.Trigger>
    </Tabs.List>

    <!-- Content area using Obsidian's settings content classes -->
    <div class="vertical-tab-content-container">
      <Tabs.Content value="chat" class="tab-content">
        <!-- General tab content -->
        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Files</div>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Save path</div>
            <div class="setting-item-description">
              Where to save your chat files
            </div>
          </div>
          <div class="setting-item-control">
            <input
              type="text"
              value={settings.vault.chatsPath}
              oninput={(e) => {
                settings.vault.chatsPath = e.currentTarget.value;
                save();
              }}
              {@attach folderSuggest(plugin.app)}
            />
          </div>
        </div>

        <!-- Defaults section moved from defaults tab -->
        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Defaults</div>
            <div class="setting-item-description">
              Default AI account and model for new chats and tools
            </div>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Account</div>
            <div class="setting-item-description">
              Select a default account
            </div>
          </div>
          <div class="setting-item-control">
            <select
              value={settings.defaults.accountId}
              onchange={(e) => {
                settings.defaults.accountId = e.currentTarget.value;
                settings.defaults.modelId = "";
                save();
              }}
            >
              <option value="">Select account...</option>
              {#each settings.accounts as account}
                <option value={account.id}
                  >{getProviderInfo(account.provider).name} / {account.name}</option
                >
              {/each}
            </select>
          </div>
        </div>

        {#if settings.defaults.accountId}
          <div class="setting-item">
            <div class="setting-item-info">
              <div class="setting-item-name">Model</div>
              <div class="setting-item-description">
                Select a default model
              </div>
            </div>
            <div class="setting-item-control">
              <select
                value={settings.defaults.modelId}
                onchange={(e) => {
                  settings.defaults.modelId = e.currentTarget.value;
                  save();
                }}
              >
                <option value="">Select model...</option>
                {#each settings.models.filter((m) => m.type === "chat" && (settings.defaults.accountId ? m.provider === settings.accounts.find((a) => a.id === settings.defaults.accountId).provider : true)) as model}
                  <option value={model.id}>{model.id}</option>
                {/each}
              </select>
            </div>
          </div>
        {/if}

        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Titles</div>
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
                  >{getProviderInfo(account.provider).name} / {account.name}</option
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
                {#each settings.models.filter((m) => m.type === "chat" && (settings.title.accountId ? m.provider === settings.accounts.find((a) => a.id === settings.title.accountId).provider : true)) as model}
                  <option value={model.id}>{model.id}</option>
                {/each}
              </select>
            </div>
          </div>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="accounts" class="tab-content">
        <!-- AI Accounts section -->
        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Accounts</div>
          </div>
          <div class="setting-item-control">
            <PlusCircleIcon
              class="clickable-icon extra-setting-button"
              onclick={() => {
                const modal = createModal(AccountModal, {
                  save: (account: AIAccount) => {
                    modal.close();
                    settings.accounts.push(account);
                    console.log("pushed account", settings, account);
                    save();
                  },
                  close: () => {
                    modal.close();
                  },
                });
                modal.open();
              }}
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
        {#each settings.accounts as account, index}
          <div class="setting-item">
            <div class="setting-item-info">
              <div class="setting-item-name">{account.name}</div>
              <div class="setting-item-description">
                Provider: {getProviderInfo(account.provider).name}
              </div>
            </div>
            <div class="setting-item-control">
              <button
                onclick={() => {
                  const modal = createModal(AccountModal, {
                    save: (newAccount: AIAccount) => {
                      modal.close();
                      settings.accounts[index] = newAccount;
                      save();
                    },
                    current: $state.snapshot(account),
                    close: () => {
                      modal.close();
                    },
                  });
                  modal.open();
                }}
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
      </Tabs.Content>

      <Tabs.Content value="models" class="tab-content">
        <!-- Provider filter -->
        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Filter by provider</div>
            <div class="setting-item-description">
              Show models from a specific provider
            </div>
          </div>
          <div class="setting-item-control px-2">
            <select
              value={selectedProviderFilter}
              onchange={(e) => {
                selectedProviderFilter = e.currentTarget.value;
              }}
            >
              <option value="all">All providers</option>
              {#each uniqueProviders() as providerId}
                <option value={providerId}>
                  {getProviderInfo(providerId).name}
                </option>
              {/each}
            </select>
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
        {:else if filteredModels().length === 0}
          <div class="setting-item">
            <div class="setting-item-info">
              <div class="setting-item-name">
                No models for selected provider
              </div>
              <div class="setting-item-description">
                No models found for the selected provider filter.
              </div>
            </div>
            <div class="setting-item-control"></div>
          </div>
        {/if}
        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Models</div>
          </div>
          <div class="setting-item-control">
            <PlusCircleIcon
              class="clickable-icon extra-setting-button"
              onclick={() => {
                const modal = createModal(ModelModal, {
                  save: (model: AnyModel) => {
                    modal.close();
                    settings.models.push(model);
                    save();
                  },
                  close: () => {
                    modal.close();
                  },
                });
                modal.open();
              }}
            />
          </div>
        </div>
        {#each filteredModels() as { model, index }}
          <div class="setting-item">
            <div class="setting-item-info">
              <div class="setting-item-name">{model.id}</div>
              <div class="setting-item-description">
                Provider: {getProviderInfo(model.provider).name}
                {#if model.type === "chat"}
                  , Input: {model.inputTokenLimit.toLocaleString()} tokens, Output:
                  {model.outputTokenLimit.toLocaleString()}
                  tokens
                {:else if model.type === "embedding"}
                  , Dimensions: {model.dimensions}
                {:else if model.type === "transcription"}
                  , Transcription model
                {/if}
              </div>
            </div>
            <div class="setting-item-control">
              <button
                onclick={() => {
                  const modal = createModal(ModelModal, {
                    save: (updatedModel: AnyModel) => {
                      modal.close();
                      settings.models[index] = updatedModel;
                      save();
                    },
                    current: $state.snapshot(model),
                    close: () => {
                      modal.close();
                    },
                  });
                  modal.open();
                }}
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
      </Tabs.Content>

      <Tabs.Content value="recording" class="tab-content">
        <!-- Recording settings -->
        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Recording</div>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Account</div>
            <div class="setting-item-description">
              Select an account for transcription. Supported providers:
              AssemblyAI.
            </div>
          </div>
          <div class="setting-item-control">
            <select
              bind:value={settings.recording.accountId}
              onchange={(e) => {
                settings.recording.accountId = e.currentTarget.value;
                settings.recording.modelId = undefined;
                save();
              }}
            >
              <option value="">Select account...</option>
              {#each settings.accounts.filter((a) => a.provider === "assemblyai") as account}
                <option value={account.id}
                  >{getProviderInfo(account.provider).name} / {account.name}</option
                >
              {/each}
            </select>
          </div>
        </div>

        {#if settings.recording.accountId}
          <!-- Model setting commented out - streaming endpoint uses a fixed model
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
          -->
        {/if}

        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Post-Processing</div>
            <div class="setting-item-description">
              Use AI to clean up transcriptions (remove filler words, fix
              punctuation, etc.)
            </div>
          </div>
          <div class="setting-item-control">
            <label
              class="checkbox-container"
              class:is-enabled={settings.recording.postProcessing.enabled}
            >
              <input
                type="checkbox"
                bind:checked={settings.recording.postProcessing.enabled}
                onchange={save}
              />
              <span class="checkmark"></span>
            </label>
          </div>
        </div>

        {#if settings.recording.postProcessing.enabled}
          <div class="setting-item">
            <div class="setting-item-info">
              <div class="setting-item-name">Post-Processing Prompt</div>
              <div class="setting-item-description">
                Prompt for cleaning transcriptions. Must contain {"{{ transcript }}"}
                variable.
              </div>
            </div>
            <div class="setting-item-control">
              <button
                class="mod-cta"
                type="button"
                onclick={() => {
                  const modal = createModal(TextareaModal, {
                    name: "Transcription post-processing prompt",
                    description:
                      "Prompt must contain {{ transcript }} variable to be replaced with the transcript text.",
                    content: settings.recording.postProcessing.prompt,
                    onSave: (content) => {
                      settings.recording.postProcessing.prompt = content;
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
                Select an account for transcription post-processing
              </div>
            </div>
            <div class="setting-item-control">
              <select
                value={settings.recording.postProcessing.accountId}
                onchange={(e) => {
                  settings.recording.postProcessing.accountId =
                    e.currentTarget.value;
                  settings.recording.postProcessing.modelId = undefined;
                  save();
                }}
              >
                <option value="">Select account...</option>
                {#each settings.accounts as account}
                  <option value={account.id}
                    >{getProviderInfo(account.provider).name} / {account.name}</option
                  >
                {/each}
              </select>
            </div>
          </div>

          {#if settings.recording.postProcessing.accountId}
            <div class="setting-item">
              <div class="setting-item-info">
                <div class="setting-item-name">Model</div>
                <div class="setting-item-description">
                  Select a chat model for transcription post-processing
                </div>
              </div>
              <div class="setting-item-control">
                <select
                  value={settings.recording.postProcessing.modelId}
                  onchange={(e) => {
                    settings.recording.postProcessing.modelId =
                      e.currentTarget.value;
                    save();
                  }}
                >
                  <option value="">Select model...</option>
                  {#each settings.models.filter((m) => m.type === "chat" && (settings.recording.postProcessing.accountId ? m.provider === settings.accounts.find((a) => a.id === settings.recording.postProcessing.accountId).provider : true)) as model}
                    <option value={model.id}>{model.id}</option>
                  {/each}
                </select>
              </div>
            </div>
          {/if}
        {/if}

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Transcriptions Path</div>
            <div class="setting-item-description">
              Folder path where transcription files will be saved
            </div>
          </div>
          <div class="setting-item-control">
            <input
              type="text"
              placeholder="transcriptions"
              value={settings.recording.transcriptionsPath || ""}
              oninput={(e) => {
                settings.recording.transcriptionsPath =
                  e.currentTarget.value || undefined;
                save();
              }}
              {@attach folderSuggest(plugin.app)}
            />
          </div>
        </div>
      </Tabs.Content>

      <Tabs.Content value="agents" class="tab-content">
        <!-- Agents Section -->
        <div class="setting-item setting-item-heading">
          <div class="setting-item-info">
            <div class="setting-item-name">Agents</div>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Template Repair Agent</div>
            <div class="setting-item-description">
              Select an agent that can repair other agents' templates.
            </div>
          </div>
          <div class="setting-item-control">
            <select
              value={settings.agents.templateRepairAgentPath}
              onchange={(e) => {
                settings.agents.templateRepairAgentPath =
                  e.currentTarget.value || null;
                save();
              }}
            >
              <option value="">None</option>
              {#each agents.entries as agent}
                <option value={agent.file.path}>{agent.name}</option>
              {/each}
            </select>
          </div>
        </div>
      </Tabs.Content>
    </div>
  </Tabs.Root>
</div>

<style>
  /* Only need to handle Bits-UI specific styling */
  :global([data-state="active"].vertical-tab-nav-item) {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
    border-left: 2px solid var(--interactive-accent);
  }

  /* Hide inactive content */
  :global(.tab-content[data-state="inactive"]) {
    display: none;
  }

  :global(.tab-content) {
    padding-top: var(--size-4-8);
  }

  /* Keep existing checkbox styles */
  .checkbox-container {
    display: inline-block;
    position: relative;
    width: 40px;
    height: 20px;
    border-radius: 10px;
    background-color: var(--background-modifier-border);
    transition: background-color 0.2s ease;
    cursor: pointer;
  }

  .checkbox-container.is-enabled {
    background-color: var(--color-accent);
  }

  .checkbox-container input[type="checkbox"] {
    display: none;
  }

  .checkmark {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: var(--background-primary);
    transition: transform 0.2s ease;
  }

  .checkbox-container.is-enabled .checkmark {
    transform: translateX(20px);
  }
</style>
