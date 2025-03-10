<script lang="ts">
  import { nanoid } from "nanoid";
  import { type AIAccount, AIProvider, ModelConfigField } from "../plugin/ai";

  type Props = {
    current?: AIAccount;
    close: () => void;
    save: (profile: AIAccount) => void;
  };
  let { current, close, save }: Props = $props();

  let account: AllowEmpty<AIAccount, "provider"> = $state(
    current ?? {
      id: nanoid(),
      name: "",
      provider: "",
      config: {},
    },
  );

  function handleSubmit(e: Event) {
    e.preventDefault();
    Object.entries(account.config).forEach(([key, value]) => {
      if (value === "") {
        //@ts-expect-error key type not inferred
        account.config[key] = undefined;
      }
    });
    save($state.snapshot(account as AIAccount));
  }
</script>

<button aria-label="escape" onclick={close} class="modal-close-button"></button>
<div class="modal-header">
  <div class="modal-title">AI Account</div>
</div>
<form onsubmit={handleSubmit}>
  <div class="modal-content">
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Provider</div>
        <div class="setting-item-description">Select AI provider.</div>
      </div>
      <div class="setting-item-control">
        <select bind:value={account.provider} required class="dropdown">
          <option value="">Select provider</option>
          {#each Object.entries(AIProvider) as [key, provider]}
            <option value={key}>{provider.name}</option>
          {/each}
        </select>
      </div>
    </div>
    {#if account.provider}
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Account name</div>
          <div class="setting-item-description">Name of your account.</div>
        </div>
        <div class="setting-item-control">
          <input required type="text" bind:value={account.name} />
        </div>
      </div>
      {#each AIProvider[account.provider].requiredFields as fieldKey}
        {@const field = ModelConfigField[fieldKey]}
        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">{field.name}</div>
            <div class="setting-item-description">{field.description}</div>
          </div>
          <div class="setting-item-control">
            <input
              required
              type="text"
              placeholder={field.placeholder}
              bind:value={account.config[fieldKey]}
            />
          </div>
        </div>
      {/each}
      {#each AIProvider[account.provider].optionalFields as fieldKey}
        {@const field = ModelConfigField[fieldKey]}
        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">{field.name}</div>
            <div class="setting-item-description">
              (Optional) {field.description}
            </div>
          </div>
          <div class="setting-item-control">
            <input
              type="text"
              placeholder={field.placeholder}
              bind:value={account.config[fieldKey]}
            />
          </div>
        </div>
      {/each}
    {/if}
  </div>
  <div class="modal-button-container">
    <button type="submit" class="mod-cta">Save</button>
    <button onclick={close} class="mod-cancel">Cancel</button>
  </div>
</form>
