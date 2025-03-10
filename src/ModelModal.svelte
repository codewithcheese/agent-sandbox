<script lang="ts">
  import { ModelProvider } from "$lib/models";
  import type { ChatModel, EmbeddingModel } from "../plugin/models";

  type Props = {
    current?: ChatModel | EmbeddingModel;
    close: () => void;
    save: (model: ChatModel | EmbeddingModel) => void;
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
      } as ChatModel | EmbeddingModel),
  );

  let modelType = $state(current?.type || "chat");

  function handleSubmit(e: Event) {
    e.preventDefault();
    save($state.snapshot(model));
  }

  function updateModelType(type: "chat" | "embedding") {
    modelType = type;
    if (type === "chat") {
      model = {
        id: model.id,
        provider: model.provider,
        type: "chat",
        inputTokenLimit: (model as ChatModel).inputTokenLimit || 0,
        outputTokenLimit: (model as ChatModel).outputTokenLimit || 0,
      };
    } else {
      model = {
        id: model.id,
        provider: model.provider,
        type: "embedding",
        dimensions: (model as EmbeddingModel).dimensions || 0,
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
          value={modelType}
          onchange={(e) => {
            // @ts-expect-error value not inferred
            updateModelType(e.currentTarget.value);
          }}
          required
          class="dropdown"
        >
          <option value="chat">Chat</option>
          <option value="embedding">Embedding</option>
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
        <select
          value={model.provider}
          onchange={(e) => {
            model.provider = e.currentTarget.value;
          }}
          required
          class="dropdown"
        >
          <option value="">Select provider</option>
          {#each Object.entries(ModelProvider) as [key, provider]}
            <option value={key}>{provider.name}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if modelType === "chat"}
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
    {:else}
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
