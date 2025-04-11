<script lang="ts">
  import { Chat } from "./chat.svelte.ts";
  import ChatPage from "./ChatPage.svelte";
  import { onDestroy, onMount } from "svelte";

  type Props = {
    data: string | null;
    onSave: (data: string) => void;
  };

  const { data, onSave }: Props = $props();

  const chat = new Chat(data, onSave);

  onMount(() => {
    console.log("onMount");
  });

  onDestroy(() => {
    console.log("onDestroy");
  });
</script>

<ChatPage {chat} />
