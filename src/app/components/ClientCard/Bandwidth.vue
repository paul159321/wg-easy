<template>
  <div
    v-if="limited"
    class="inline-flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
    :title="details"
  >
    <IconsArrowDown v-if="client.downloadLimitMbps > 0" class="size-3" />
    <span v-if="client.downloadLimitMbps > 0">{{
      format(client.downloadLimitMbps) + ' Mbps'
    }}</span>
    <IconsArrowUp v-if="client.uploadLimitMbps > 0" class="size-3" />
    <span v-if="client.uploadLimitMbps > 0">{{
      format(client.uploadLimitMbps) + ' Mbps'
    }}</span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ client: LocalClient }>();
const limited = computed(
  () => props.client.uploadLimitMbps > 0 || props.client.downloadLimitMbps > 0
);
const format = (value: number) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const details = computed(() => {
  const down =
    props.client.downloadLimitMbps > 0
      ? '↓ ' + format(props.client.downloadLimitMbps) + ' Mbps'
      : '';
  const up =
    props.client.uploadLimitMbps > 0
      ? '↑ ' + format(props.client.uploadLimitMbps) + ' Mbps'
      : '';
  return [down, up].filter(Boolean).join('  ');
});
</script>
