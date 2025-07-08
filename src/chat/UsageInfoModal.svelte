<script lang="ts">
  import type { UIMessageWithMetadata } from "./chat.svelte.ts";

  type Props = {
    message: UIMessageWithMetadata;
    close: () => void;
  };
  let { message, close }: Props = $props();

  // Extract usage data from assistant message metadata
  const usage = $derived(
    message.role === "assistant" ? message.metadata?.usage : undefined,
  );
  const finishReason = $derived(
    message.role === "assistant" ? message.metadata?.finishReason : undefined,
  );

  // Extract account and model information
  const modelInfo = $derived(
    message.role === "assistant" ? message.metadata?.modelId : undefined,
  );

  const accountInfo = $derived(
    message.role === "assistant" ? message.metadata?.accountName : undefined,
  );

  const providerInfo = $derived(
    message.role === "assistant" ? message.metadata?.provider : undefined,
  );
  
  // Extract step information
  const steps = $derived(
    message.role === "assistant" ? message.metadata?.steps : undefined,
  );
</script>

<div class="flex flex-col gap-4 p-2">
  <div class="font-semibold text-lg">Request Info</div>

  {#if usage}
    <!-- Account/Model Information -->
    <div class="grid grid-cols-2 gap-2 text-sm mb-4">
      {#if accountInfo}
        <div class="font-medium">Account:</div>
        <div>{accountInfo}</div>
      {/if}

      {#if modelInfo}
        <div class="font-medium">Model:</div>
        <div>{modelInfo}</div>
      {/if}

      {#if providerInfo}
        <div class="font-medium">Provider:</div>
        <div>{providerInfo}</div>
      {/if}

      {#if finishReason}
        <div class="font-medium">Finish Reason:</div>
        <div class="capitalize">{finishReason}</div>
      {/if}
    </div>

    <!-- Token Usage -->
    <div class="border border-(--background-modifier-border) rounded-md overflow-hidden">
      <div class="bg-(--background-secondary) px-3 py-2 font-medium text-sm border-b border-(--background-modifier-border)">
        Token Usage
      </div>
      <div class="bg-(--background-primary) p-3">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div class="text-center">
            <div class="font-medium text-xs text-(--text-muted) mb-1">Input</div>
            <div class="text-lg font-semibold">{usage.inputTokens ?? 0}</div>
          </div>
          <div class="text-center">
            <div class="font-medium text-xs text-(--text-muted) mb-1">Output</div>
            <div class="text-lg font-semibold">{usage.outputTokens ?? 0}</div>
          </div>
          {#if usage.cachedInputTokens !== undefined && usage.cachedInputTokens > 0}
            <div class="text-center">
              <div class="font-medium text-xs text-(--text-muted) mb-1">Cached Input</div>
              <div class="text-lg font-semibold text-green-600">{usage.cachedInputTokens}</div>
            </div>
          {/if}
          {#if usage.reasoningTokens !== undefined && usage.reasoningTokens > 0}
            <div class="text-center">
              <div class="font-medium text-xs text-(--text-muted) mb-1">Reasoning</div>
              <div class="text-lg font-semibold">{usage.reasoningTokens}</div>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Steps Table -->
    {#if steps && steps.length > 0}
      <div class="border border-(--background-modifier-border) rounded-md overflow-hidden">
        <div class="bg-(--background-secondary) px-3 py-2 font-medium text-sm border-b border-(--background-modifier-border)">
          Steps ({steps.length})
        </div>
        <div class="bg-(--background-primary)">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-(--background-modifier-border)">
                <th class="px-3 py-2 text-left font-medium">Step</th>
                <th class="px-3 py-2 text-right font-medium">Input</th>
                <th class="px-3 py-2 text-right font-medium">Output</th>
                <th class="px-3 py-2 text-right font-medium">Cached</th>
                <th class="px-3 py-2 text-right font-medium">Reasoning</th>
                <th class="px-3 py-2 text-center font-medium">Finish</th>
              </tr>
            </thead>
            <tbody>
              {#each steps as step}
                <tr class="border-b border-(--background-modifier-border) last:border-b-0">
                  <td class="px-3 py-2">{step.stepIndex + 1}</td>
                  <td class="px-3 py-2 text-right">{step.usage.inputTokens ?? 0}</td>
                  <td class="px-3 py-2 text-right">{step.usage.outputTokens ?? 0}</td>
                  <td class="px-3 py-2 text-right {step.usage.cachedInputTokens ? 'text-green-600' : 'text-(--text-muted)'}">
                    {step.usage.cachedInputTokens ?? 0}
                  </td>
                  <td class="px-3 py-2 text-right">{step.usage.reasoningTokens ?? 0}</td>
                  <td class="px-3 py-2 text-center text-xs capitalize">{step.finishReason}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {:else}
    <div class="text-sm text-(--text-muted)">
      No usage information available
    </div>
  {/if}

  <button
    class="mt-2 px-3 py-1 bg-(--interactive-normal) text-(--text-normal) rounded hover:bg-(--interactive-hover)"
    onclick={close}
  >
    Close
  </button>
</div>
