<svelte:options customElement={{  }} />
<script lang="ts">
    import {Chat} from "$lib/chat.svelte";
    import ChatPage from "./ChatPage.svelte";
    const chat = new Chat()
</script>
<ChatPage chat={chat} />
