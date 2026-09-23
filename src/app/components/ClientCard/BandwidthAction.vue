<template>
  <BaseDialog v-model:open="open" trigger-as-child @update:open="onOpen">
    <template #trigger>
      <button
        type="button"
        class="rounded p-2 align-middle transition hover:bg-red-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800 focus-visible:ring-offset-2 dark:hover:bg-red-800 dark:hover:text-white"
        :class="
          hasLimit
            ? 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300'
            : 'bg-gray-100 text-gray-400 dark:bg-neutral-600 dark:text-neutral-300'
        "
        :aria-label="$t('client.bandwidth')"
        :title="description"
      >
        <svg
          class="h-5 w-5"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4.5 18a9 9 0 1115 0M12 5v2M5.6 8.6L7 10m11.4-1.4L17 10M3 14h2m14 0h2m-9 1l3-4"
          />
          <circle cx="12" cy="16" r="1.5" />
          <path stroke-linecap="round" d="M7 20h10" />
        </svg>
      </button>
    </template>
    <template #title>{{ $t('client.bandwidth') }} · {{ client.name }}</template>
    <template #description>
      <div class="grid gap-4">
        <p>{{ $t('client.bandwidthDesc') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="min-w-0 space-y-2">
            <FormNumberField
              id="quickDownloadLimitMbps"
              v-model="download"
              :label="$t('client.downloadLimitMbps')"
              suffix="Mbps"
              :min="0"
              :max="10000"
              :step="0.01"
            />
          </div>
          <div class="min-w-0 space-y-2">
            <FormNumberField
              id="quickUploadLimitMbps"
              v-model="upload"
              :label="$t('client.uploadLimitMbps')"
              suffix="Mbps"
              :min="0"
              :max="10000"
              :step="0.01"
            />
          </div>
        </div>
        <p v-if="error" class="text-sm text-red-700 dark:text-red-300">
          {{ error }}
        </p>
      </div>
    </template>
    <template #actions>
      <DialogClose as-child>
        <BaseSecondaryButton>{{ $t('dialog.cancel') }}</BaseSecondaryButton>
      </DialogClose>
      <BasePrimaryButton :disabled="saving" @click="save">
        {{ $t('form.save') }}
      </BasePrimaryButton>
    </template>
  </BaseDialog>
</template>

<script lang="ts" setup>
import { FetchError } from 'ofetch';
const props = defineProps<{ client: LocalClient }>();
const clientsStore = useClientsStore();
const toast = useToast();

const open = ref(false);
const upload = ref<number | ''>(0);
const download = ref<number | ''>(0);
const saving = ref(false);
const error = ref('');

const hasLimit = computed(
  () => props.client.uploadLimitMbps > 0 || props.client.downloadLimitMbps > 0
);
const format = (value: number) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const description = computed(() => {
  const down =
    props.client.downloadLimitMbps > 0
      ? '↓ ' + format(props.client.downloadLimitMbps) + ' Mbps'
      : '';
  const up =
    props.client.uploadLimitMbps > 0
      ? '↑ ' + format(props.client.uploadLimitMbps) + ' Mbps'
      : '';
  return [down, up].filter(Boolean).join('  ') || $t('client.bandwidth');
});

function onOpen(value: boolean) {
  if (value) {
    upload.value = props.client.uploadLimitMbps || 0;
    download.value = props.client.downloadLimitMbps || 0;
    error.value = '';
  }
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await $fetch('/api/client/' + props.client.id + '/bandwidth', {
      method: 'post',
      body: {
        uploadLimitMbps: upload.value === '' ? 0 : Number(upload.value),
        downloadLimitMbps: download.value === '' ? 0 : Number(download.value),
      },
    });
    await clientsStore.refresh();
    toast.showToast({ type: 'success', message: $t('toast.saved') });
    open.value = false;
  } catch (err) {
    error.value =
      err instanceof FetchError
        ? (err.data?.statusMessage ?? err.message)
        : $t('toast.unknown');
  } finally {
    saving.value = false;
  }
}
</script>
