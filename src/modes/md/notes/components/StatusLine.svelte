<script lang="ts">
  import { status } from '../store.svelte';
</script>

{#if status.text}
  <div class="status" role="status"><span class="spinner" aria-hidden="true"></span>{status.text}</div>
{/if}
