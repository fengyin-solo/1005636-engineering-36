<template>
  <section v-if="issues.length" class="pending-panel">
    <header class="pending-head">
      <strong>迁移待处理清单（{{ issues.length }} 项）</strong>
      <span>下列记录由旧版本地数据迁移而来，已按当前结构回填，请逐条核对补登。</span>
    </header>
    <ul class="pending-list">
      <li v-for="(item, index) in issues" :key="`${item.rowId}-${item.field ?? ''}-${index}`" class="pending-item">
        <span class="pending-row">记录 #{{ item.rowId }}</span>
        <span v-if="item.field" class="pending-field">{{ item.field }}</span>
        <span class="pending-msg">{{ item.message }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { RowIssue } from '@/data/storage-schema'

defineProps<{ moduleKey: string; issues: RowIssue[] }>()
</script>
