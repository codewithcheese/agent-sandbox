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
</script>

<div class="flex flex-col gap-4 p-2">
  <div class="font-semibold text-lg">Request Info</div>

  {#if usage}
    <div class="grid grid-cols-2 gap-2 text-sm">
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

      <!-- Usage Information -->
      <div class="font-medium">Input Tokens:</div>
      <div>{usage.inputTokens ?? 0}</div>

      <div class="font-medium">Output Tokens:</div>
      <div>{usage.outputTokens ?? 0}</div>

      {#if usage.cachedInputTokens !== undefined && usage.cachedInputTokens > 0}
        <div class="font-medium">Cached Input Tokens:</div>
        <div class="text-green-600">{usage.cachedInputTokens}</div>
      {/if}

      {#if usage.reasoningTokens !== undefined && usage.reasoningTokens > 0}
        <div class="font-medium">Reasoning Tokens:</div>
        <div>{usage.reasoningTokens}</div>
      {/if}

      <!--      <div class="font-medium">Total Tokens:</div>-->
      <!--      <div class="">{usage.totalTokens ?? 0}</div>-->

      {#if finishReason}
        <div class="font-medium">Finish Reason:</div>
        <div class="capitalize">{finishReason}</div>
      {/if}
    </div>
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
