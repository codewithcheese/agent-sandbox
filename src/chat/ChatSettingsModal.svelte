<script lang="ts">
  import { XIcon } from "lucide-svelte";

  const defaultSettings = {
    temperature: 0.7,
    thinkingEnabled: false,
    maxTokens: 4000,
    thinkingTokensBudget: 1200,
    maxSteps: 50,
  };

  let { onClose, onSave, settings = $bindable(defaultSettings) } = $props();

  function handleSave() {
    if (onSave) {
      onSave(settings);
    } else {
      onClose();
    }
  }

  function handleCancel() {
    onClose();
  }

  function restoreDefault(setting: string) {
    switch (setting) {
      case "temperature":
        settings.temperature = defaultSettings.temperature;
        break;
      case "maxTokens":
        settings.maxTokens = defaultSettings.maxTokens;
        break;
      case "thinkingTokensBudget":
        settings.thinkingTokensBudget = defaultSettings.thinkingTokensBudget;
        break;
      case "maxSteps":
        settings.maxSteps = defaultSettings.maxSteps;
        break;
    }
  }

  $inspect("Chat Settings", settings);
</script>

<div class="modal-header">
  <h2 class="modal-title">Chat Settings</h2>
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
  <!-- Model Configuration Section -->
  <div class="setting-item setting-item-heading">
    <div class="setting-item-info">
      <div class="setting-item-name">Model Configuration</div>
    </div>
  </div>

  <!-- Temperature Setting -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Temperature</div>
      <div class="setting-item-description">
        Controls randomness in responses. Lower values make output more focused
        and deterministic.
      </div>
    </div>
    <div class="setting-item-control">
      <button
        type="button"
        class="clickable-icon extra-setting-button"
        aria-label="Restore default temperature"
        style="visibility: {settings.temperature !== 0.7
          ? 'visible'
          : 'hidden'};"
        onclick={() => restoreDefault("temperature")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="svg-icon lucide-rotate-ccw"
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      </button>
      <input
        class="slider"
        type="range"
        min="0"
        max="2"
        step="0.1"
        bind:value={settings.temperature}
      />
      <span class="slider-value">{settings.temperature}</span>
    </div>
  </div>

  <!-- Max Tokens Setting -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Max Tokens</div>
      <div class="setting-item-description">
        Maximum number of tokens in the response.
      </div>
    </div>
    <div class="setting-item-control">
      <button
        type="button"
        class="clickable-icon extra-setting-button"
        aria-label="Restore default max tokens"
        style="visibility: {settings.maxTokens !== 4000
          ? 'visible'
          : 'hidden'};"
        onclick={() => restoreDefault("maxTokens")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="svg-icon lucide-rotate-ccw"
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      </button>
      <input
        class="slider"
        type="range"
        min="100"
        max="8000"
        step="100"
        bind:value={settings.maxTokens}
      />
      <span class="slider-value">{settings.maxTokens}</span>
    </div>
  </div>

  <!-- Max Steps Setting -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Max Steps</div>
      <div class="setting-item-description">
        Maximum number of conversation steps before stopping.
      </div>
    </div>
    <div class="setting-item-control">
      <button
        type="button"
        class="clickable-icon extra-setting-button"
        aria-label="Restore default max steps"
        style="visibility: {settings.maxSteps !== 10 ? 'visible' : 'hidden'};"
        onclick={() => restoreDefault("maxSteps")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="svg-icon lucide-rotate-ccw"
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      </button>
      <input
        class="slider"
        type="range"
        min="1"
        max="50"
        step="1"
        bind:value={settings.maxSteps}
      />
      <span class="slider-value">{settings.maxSteps}</span>
    </div>
  </div>

  <!-- Thinking Mode Section -->
  <div class="setting-item setting-item-heading">
    <div class="setting-item-info">
      <div class="setting-item-name">Thinking Mode</div>
    </div>
  </div>

  <!-- Thinking Toggle Setting -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Enable Thinking</div>
      <div class="setting-item-description">
        Allow the AI to generate thinking tokens before answering directly.
      </div>
    </div>
    <div class="setting-item-control">
      <div
        onclick={() => (settings.thinkingEnabled = !settings.thinkingEnabled)}
        aria-label="Toggle thinking"
        class="checkbox-container"
        class:is-enabled={settings.thinkingEnabled}
      >
        <input type="checkbox" tabindex="0" />
      </div>
    </div>
  </div>

  <!-- Thinking Tokens Budget Setting -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Thinking Tokens Budget</div>
      <div class="setting-item-description">
        Maximum tokens allocated for thinking process when enabled.
      </div>
    </div>
    <div class="setting-item-control">
      <button
        type="button"
        class="clickable-icon extra-setting-button"
        aria-label="Restore default thinking tokens budget"
        style="visibility: {settings.thinkingTokensBudget !== 1000
          ? 'visible'
          : 'hidden'};"
        onclick={() => restoreDefault("thinkingTokensBudget")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="svg-icon lucide-rotate-ccw"
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      </button>
      <input
        class="slider"
        type="range"
        min="100"
        max="4000"
        step="100"
        bind:value={settings.thinkingTokensBudget}
      />
      <span class="slider-value">{settings.thinkingTokensBudget}</span>
    </div>
  </div>
</div>

<div class="modal-button-container">
  <button type="button" onclick={handleCancel}>Cancel</button>
  <button type="button" onclick={handleSave}>Save Settings</button>
</div>
