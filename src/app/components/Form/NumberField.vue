<template>
  <div class="flex items-center">
    <FormLabel :for="id">
      {{ label }}
    </FormLabel>
    <BaseTooltip v-if="description" :text="description">
      <IconsInfo class="size-4" />
    </BaseTooltip>
  </div>
  <div class="flex items-center gap-2">
    <BaseInput
      :id="id"
      v-model.number="data"
      :name="id"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      class="min-w-0 flex-1"
    />
    <span
      v-if="suffix"
      class="shrink-0 text-sm text-gray-500 dark:text-neutral-300"
    >
      {{ suffix }}
    </span>
  </div>
</template>

<script lang="ts" setup>
defineProps<{
  id: string;
  label: string;
  description?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}>();

const data = defineModel<number | ''>();
</script>
