<script setup lang="ts">
defineProps<{
  items: Array<{ id: number; content: string }>;
  error?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  apply: [text: string];
  dismiss: [id: number];
  clear: [];
}>();
</script>

<template>
  <div v-if="items.length || error" class="wf-suggest">
    <div class="wf-suggest-head">
      <span>快捷建议</span>
      <button
        type="button"
        class="wf-suggest-clear"
        :disabled="disabled"
        @click="emit('clear')"
      >
        清空
      </button>
    </div>
    <p v-if="error" class="wf-suggest-error">{{ error }}</p>
    <div v-if="items.length" class="wf-suggest-list">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="wf-suggest-item"
        :disabled="disabled"
        :title="item.content"
        @click="emit('apply', item.content)"
      >
        <span class="wf-suggest-text">{{ item.content }}</span>
        <span
          class="wf-suggest-dismiss"
          role="button"
          aria-label="移除建议"
          @click.stop="emit('dismiss', item.id)"
        >
          ×
        </span>
      </button>
    </div>
  </div>
</template>
