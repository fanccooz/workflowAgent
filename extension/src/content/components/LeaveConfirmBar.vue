<script setup lang="ts">
defineProps<{
  awaiting: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
}>();
</script>

<template>
  <div>
    <div v-if="awaiting" class="wf-actions">
      <button type="button" class="confirm" :disabled="disabled" @click="emit('confirm')">
        {{ label }}
      </button>
    </div>
    <p v-if="hint" class="wf-hint">{{ hint }}</p>
  </div>
</template>
