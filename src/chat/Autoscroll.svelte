<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { createDebug } from "$lib/debug.ts";

  const debug = createDebug();

  let { messages, container, enabled, sentinel = $bindable() } = $props();

  let autoscroll = $state(true);
  let io: IntersectionObserver;

  // $inspect("autoscroll", autoscroll);

  let previousLength = messages.length;

  $effect(() => {
    if (!container || !sentinel || io) return;
    io = new IntersectionObserver(
      ([entry]) => {
        debug("Autoscroll trigger", entry);
        autoscroll = entry.isIntersecting;
      },
      { root: container, threshold: 0.1 },
    );
    io.observe(sentinel);
  });

  onDestroy(() => {
    if (io) io.disconnect();
  });

  $effect(() => {
    // track when user message added
    messages.length;
    untrack(() => {
      if (
        messages.length > 0 &&
        previousLength < messages.length &&
        messages[messages.length - 1].role === "user"
      ) {
        // console.log("Scroll on new user message added");
        sentinel.scrollIntoView({ behavior: "instant", block: "end" });
      }
      // console.log("messages.length", messages.length);
      previousLength = messages.length;
    });
  });

  $effect(() => {
    $state.snapshot(messages);
    untrack(() => {
      if (enabled && autoscroll && sentinel) {
        // console.log("Scrolling...", autoscroll, sentinel);
        sentinel.scrollIntoView({ behavior: "instant", block: "end" });
      } else {
        // console.log("Skip scrolling...", autoscroll, sentinel);
      }
    });
  });
</script>

<div aria-hidden="true" style="height: 20px" bind:this={sentinel}></div>
