<svelte:options customElement={{}} />

<script lang="ts">
  import { Chat } from "./chat.svelte.ts";
  import ChatPage from "./ChatPage.svelte";
  import { onDestroy, onMount } from "svelte";
  const chat = new Chat();

  onMount(() => {
    console.log("onMount");
  });

  onDestroy(() => {
    console.log("onDestroy");
  });
</script>

<ChatPage {chat} />
