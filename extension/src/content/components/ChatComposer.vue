<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{
  modelValue: string;
  running?: boolean;
  habitLoading?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  send: [];
  habit: [];
  settings: [];
}>();

const inputRef = ref<HTMLTextAreaElement | null>(null);

watch(
  () => props.modelValue,
  () => {
    // keep focus helpers available via expose
  },
);

function clearInput() {
  emit('update:modelValue', '');
  nextTick(() => inputRef.value?.focus());
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    emit('send');
  }
}

defineExpose({
  focus: () => inputRef.value?.focus(),
});
</script>

<template>
  <div>
    <div class="wf-input-wrap">
      <textarea
        ref="inputRef"
        :value="modelValue"
        rows="3"
        placeholder="打开请假流程"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        @keydown="onKeydown"
      />
      <button
        v-show="modelValue.trim()"
        type="button"
        class="wf-input-clear"
        aria-label="清空输入"
        title="清空"
        @click="clearInput"
      >
        ×
      </button>
    </div>

    <div class="wf-actions">
      <button
        type="button"
        class="ghost"
        :disabled="habitLoading || running"
        @click="emit('habit')"
      >
        {{ habitLoading ? '拉取中…' : '习惯建议' }}
      </button>
      <button type="button" class="ghost" @click="emit('settings')">设置</button>
      <button type="button" class="primary" :disabled="running" @click="emit('send')">
        {{ running ? '处理中…' : '发送' }}
      </button>
    </div>
  </div>
</template>
