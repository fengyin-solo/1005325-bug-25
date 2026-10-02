<template>
  <section class="page" data-module="photo-detail">
    <header class="page-head">
      <div>
        <h2>影像详情</h2>
        <p class="page-desc">清单页与详情页读取同一份已落盘记录，影像编号保持一致。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/photo">返回影像清单</RouterLink>
      </div>
    </header>

    <article v-if="entry" class="detail-card">
      <h3 class="detail-title">{{ entry['影像编号'] }} · {{ entry.status }}</h3>
      <dl class="detail-grid">
        <template v-for="field in meta.fields" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ entry[field] === '' || entry[field] == null ? '—' : entry[field] }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ entry.status }}</dd>
      </dl>

      <div class="detail-actions">
        <button
          v-for="action in availableActions"
          :key="action"
          class="btn"
          :class="{ primary: action === '确认归档' }"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>
      <p v-if="message" :class="['detail-message', { 'error-text': !lastOk }]">{{ message }}</p>
    </article>

    <p v-else class="empty-state">没有找到这条影像，可能已作废清理。<RouterLink class="link" to="/photo">回到清单</RouterLink></p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getEntry, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const meta = moduleMeta('photo')

const entryId = Number(route.params.id)
const entry = ref<EntryRow | undefined>(getEntry('photo', entryId))
const message = ref('')
const lastOk = ref(true)

// 详情页同样按当前状态收窄动作，归档端不能退回待整理。
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  待整理: ['提交整理'],
  已整理: ['确认归档', '标记重拍'],
  已归档: ['标记重拍'],
  待重拍: ['提交整理'],
}
const availableActions = computed(() =>
  entry.value ? ACTIONS_BY_STATUS[String(entry.value.status)] ?? [] : [],
)

function runAction(action: string) {
  message.value = ''
  let reason = ''
  if (action === '标记重拍') {
    const input = window.prompt(
      `请填写影像 ${String(entry.value?.['影像编号'] ?? '')} 的重拍原因：`,
    )
    if (input === null) {
      return
    }
    reason = input
  }
  const result = applyAction('photo', entryId, action, { reason })
  lastOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    entry.value = getEntry('photo', entryId)
  }
}
</script>
