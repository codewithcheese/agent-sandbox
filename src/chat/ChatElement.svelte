<svelte:options customElement={{}} />

<script lang="ts">
  import { Chat } from "./chat.svelte.ts";
  import ChatPage from "./ChatPage.svelte";
  const chat = new Chat();
</script>

<ChatPage {chat} />
