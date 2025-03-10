<script lang="ts">
  import { ModelConfigField, ModelProvider } from "$lib/models";
  import type { ModelProviderProfile } from "../plugin/settings";

  type Props = {
    current?: ModelProviderProfile;
    close: () => void;
    save: (profile: ModelProviderProfile) => void;
  };
  let { current, close, save }: Props = $props();

  let profile = $state(
    current ?? {
      name: "",
      provider: "",
      config: {},
    },
  );

  function handleSubmit(e: Event) {
    e.preventDefault();
    Object.entries(profile.config).forEach(([key, value]) => {
      if (value === "") {
        //@ts-expect-error key type not inferred
        profile.config[key] = undefined;
      }
    });
    save($state.snapshot(profile));
  }
</script>

<button aria-label="escape" onclick={close} class="modal-close-button"></button>
<div class="modal-header">
  <div class="modal-title">Model Provider</div>
</div>
<form onsubmit={handleSubmit}>
  <div class="modal-content">
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Name</div>
        <div class="setting-item-description">Name of your account.</div>
      </div>
      <div class="setting-item-control">
        <input required type="text" bind:value={profile.name} />
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Provider</div>
        <div class="setting-item-description">Select model provider.</div>
      </div>
      <div class="setting-item-control">
        <select
          value={profile.provider}
          onchange={(e) => {
            console.log(e.currentTarget.value);
            profile.provider = e.currentTarget.value;
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
    {#if profile.provider}
      {#each ModelProvider[profile.provider].requiredFields as fieldKey}
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
              bind:value={profile.config[fieldKey]}
            />
          </div>
        </div>
      {/each}
      {#each ModelProvider[profile.provider].optionalFields as fieldKey}
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
              bind:value={profile.config[fieldKey]}
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
