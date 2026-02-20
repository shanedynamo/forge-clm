<script lang="ts">
  import { statusColor, statusLabel } from "$lib/format.js";

  export let status: string;
  export let small: boolean = false;
</script>

<span
  class="inline-flex items-center rounded-full font-medium {statusColor(status)} {small ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}"
  data-testid="status-badge"
>
  {statusLabel(status)}
</span>
