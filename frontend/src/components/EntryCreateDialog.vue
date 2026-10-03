<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <form class="modal-card" @submit.prevent="submit">
      <header class="modal-head">
        <h3>登记{{ meta.entity }}</h3>
        <button class="btn ghost" type="button" @click="close">关闭</button>
      </header>
      <div class="modal-body">
        <label v-for="field in meta.fields" :key="field" class="form-item">
          <span>{{ field }}</span>
          <input
            v-model="form[field]"
            :placeholder="`请填写${field}`"
            :class="{ invalid: errorField === field }"
          />
        </label>
      </div>
      <footer class="modal-foot">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span class="form-hint">字段超长或不合规时整单退回，修正后重新提交即可。</span>
        <button class="btn primary" type="submit">提交登记</button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import { createEntry, moduleMeta } from '@/api/local-service'

const props = defineProps<{ open: boolean; moduleKey: string }>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'saved'): void
}>()

const meta = moduleMeta(props.moduleKey)
const form = reactive<Record<string, string>>({})
const errorMessage = ref('')
const errorField = ref('')

function resetForm() {
  for (const field of meta.fields) {
    form[field] = ''
  }
  errorMessage.value = ''
  errorField.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetForm()
    }
  },
)

function close() {
  emit('update:open', false)
}

function submit() {
  errorMessage.value = ''
  errorField.value = ''
  const result = createEntry(meta.key, { ...form })
  if (!result.ok) {
    // 服务层校验未过：不落库，整单退回，提示第一个非法字段。
    errorMessage.value = result.message
    const matched = result.message.match(/^「(.+?)」/)
    errorField.value = matched ? matched[1] : ''
    return
  }
  emit('saved')
}
</script>
