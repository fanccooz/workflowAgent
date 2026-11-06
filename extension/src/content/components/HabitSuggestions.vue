<script setup lang="ts">
defineProps<{
  items: string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  apply: [text: string];
  dismiss: [text: string];
  clear: [];
}>();
</script>

<template>
  <div v-if="items.length" class="wf-suggest">
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
    <div class="wf-suggest-list">
      <button
        v-for="item in items"
        :key="item"
        type="button"
        class="wf-suggest-item"
        :disabled="disabled"
        :title="item"
        @click="emit('apply', item)"
      >
        <span class="wf-suggest-text">{{ item }}</span>
        <span
          class="wf-suggest-dismiss"
          role="button"
          aria-label="移除建议"
          @click.stop="emit('dismiss', item)"
        >
          ×
        </span>
      </button>
    </div>
  </div>
</template>
