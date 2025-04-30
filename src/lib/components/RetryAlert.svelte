<script lang="ts">
  import { RefreshCwIcon } from "lucide-svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { onDestroy, onMount } from "svelte";

  type Props = {
    retryState: {
      type: "retrying";
      attempt: number;
      maxAttempts: number;
      delay: number;
    };
  };
  let { retryState }: Props = $props();

  // Local state
  let countdown = $state(Math.ceil(retryState.delay / 1000));
  let countdownInterval: number | undefined = $state(undefined);

  // Watch for changes in retry state and delay
  onMount(() => {
    if (retryState && retryState.delay > 0) {
      startCountdown(retryState.delay);
    } else if (!retryState && countdownInterval) {
      clearCountdownInterval();
    }
  });

  function startCountdown(delay: number) {
    // Clear any existing interval
    clearCountdownInterval();

    // Set initial countdown value in seconds
    countdown = Math.ceil(delay / 1000);

    // Start countdown timer
    countdownInterval = window.setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearCountdownInterval();
      }
    }, 1000);
  }

  function clearCountdownInterval() {
    if (countdownInterval) {
      window.clearInterval(countdownInterval);
      countdownInterval = undefined;
    }
  }

  onDestroy(() => {
    clearCountdownInterval();
  });
</script>

{#if retryState}
  <Alert class="mb-4 bg-amber-50 border-amber-200">
    <div class="flex items-center gap-2">
      <RefreshCwIcon class="size-4 text-amber-500 animate-spin" />
      <AlertDescription>
        Retrying in {countdown} seconds... (Attempt {retryState.attempt} of {retryState.maxAttempts})
      </AlertDescription>
    </div>
  </Alert>
{/if}
