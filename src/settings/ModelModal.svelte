<script lang="ts">
  import type { ChatModel, EmbeddingModel, TranscriptionModel } from "./models.ts";

  import { AIProvider } from "./providers.ts";
  import type { AllowEmpty } from "$lib/types/allow-empty.ts";

  type Props = {
    current?: ChatModel | EmbeddingModel | TranscriptionModel;
    close: () => void;
    save: (model: ChatModel | EmbeddingModel | TranscriptionModel) => void;
  };
  let { current, close, save }: Props = $props();

  let model = $state(
    current ??
      ({
        id: "",
        provider: "",
        type: "chat",
        inputTokenLimit: 0,
        outputTokenLimit: 0,
      } as
        | AllowEmpty<ChatModel, "provider" | "id">
        | AllowEmpty<EmbeddingModel, "provider" | "id">
        | AllowEmpty<TranscriptionModel, "provider" | "id">),
  );

  function handleSubmit(e: Event) {
    e.preventDefault();
    save($state.snapshot(model as ChatModel | EmbeddingModel | TranscriptionModel));
  }

  function updateModelType(type: "chat" | "embedding" | "transcription") {
    if (type === "chat") {
      model = {
        id: model.id,
        provider: model.provider,
        type: "chat",
        inputTokenLimit: (model as ChatModel).inputTokenLimit || 0,
        outputTokenLimit: (model as ChatModel).outputTokenLimit || 0,
      };
    } else if (type === "embedding") {
      model = {
        id: model.id,
        provider: model.provider,
        type: "embedding",
        dimensions: (model as EmbeddingModel).dimensions || 0,
      };
    } else {
      model = {
        id: model.id,
        provider: model.provider,
        type: "transcription",
      };
    }
  }
</script>

<button aria-label="escape" onclick={close} class="modal-close-button"></button>
<div class="modal-header">
  <div class="modal-title">Model Configuration</div>
</div>
<form onsubmit={handleSubmit}>
  <div class="modal-content">
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Model Type</div>
        <div class="setting-item-description">Select model type.</div>
      </div>
      <div class="setting-item-control">
        <select
          value={model.type}
          onchange={(e) => {
            // @ts-expect-error value not inferred
            updateModelType(e.currentTarget.value);
          }}
          required
          class="dropdown"
        >
          <option value="chat">Chat</option>
          <option value="embedding">Embedding</option>
          <option value="transcription">Transcription</option>
        </select>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Model ID</div>
        <div class="setting-item-description">
          The identifier for this model.
        </div>
      </div>
      <div class="setting-item-control">
        <input required type="text" bind:value={model.id} />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Provider</div>
        <div class="setting-item-description">Select model provider.</div>
      </div>
      <div class="setting-item-control">
        <select bind:value={model.provider} required class="dropdown">
          <option value="">Select provider</option>
          {#each Object.entries(AIProvider) as [key, provider]}
            <option value={key}>{provider.name}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if model.type === "chat"}
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Input Token Limit</div>
          <div class="setting-item-description">
            Maximum number of input tokens the model can process.
          </div>
        </div>
        <div class="setting-item-control">
          <input
            required
            type="number"
            min="0"
            bind:value={model.inputTokenLimit}
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Output Token Limit</div>
          <div class="setting-item-description">
            Maximum number of output tokens the model can generate.
          </div>
        </div>
        <div class="setting-item-control">
          <input
            required
            type="number"
            min="0"
            bind:value={model.outputTokenLimit}
          />
        </div>
      </div>
    {:else if model.type === "embedding"}
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Dimensions</div>
          <div class="setting-item-description">
            Number of dimensions for the embedding model.
          </div>
        </div>
        <div class="setting-item-control">
          <input required type="number" min="0" bind:value={model.dimensions} />
        </div>
      </div>
    {/if}
  </div>

  <div class="modal-button-container">
    <button type="button" class="mod-cancel" onclick={close}>Cancel</button>
    <button type="submit" class="mod-cta">Save</button>
  </div>
</form>
