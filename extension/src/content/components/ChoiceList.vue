<script setup lang="ts">
type ChoiceItem = {
  id?: string;
  title: string;
  subtitle?: string;
  type?: string;
};

defineProps<{
  groups: Array<{ type: string; label: string; items: ChoiceItem[] }>;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  pick: [item: ChoiceItem];
}>();
</script>

<template>
  <div v-if="groups.length" class="wf-choices">
    <div v-for="group in groups" :key="group.type" class="wf-choice-group">
      <h4>{{ group.label }}</h4>
      <button
        v-for="item in group.items"
        :key="item.id || item.title"
        type="button"
        class="wf-choice"
        :disabled="disabled"
        @click="emit('pick', item)"
      >
        {{ item.subtitle ? `${item.title}（${item.subtitle}）` : item.title }}
      </button>
    </div>
  </div>
</template>
