<template>
  <el-scrollbar ref="scrollbarRef" class="message-list" @scroll="handleScroll">
    <div ref="innerRef" class="message-inner">
      <div v-for="msg in messages" :key="msg.id" class="message-row" :class="msg.role">

        <!-- 用户消息 -->
        <template v-if="msg.role === 'user'">
          <div class="msg-bubble user-bubble">
            <div v-if="extractUserFiles(msg).length" class="msg-files">
              <div v-for="(file, i) in extractUserFiles(msg)" :key="i" class="msg-file-chip">
                <el-icon><Document /></el-icon>
                <span class="msg-file-name" :title="file.filename">{{ file.filename }}</span>
              </div>
            </div>
            <div v-if="extractUserText(msg)" class="msg-text">{{ extractUserText(msg) }}</div>
          </div>
        </template>

        <!-- AI 消息 -->
        <template v-else>
          <div class="ai-area">
            <div class="ai-avatar">
              <el-icon :size="14" color="#fff"><ChatDotRound /></el-icon>
            </div>
            <div class="ai-content">
              <div class="msg-bubble ai-bubble">

                <!-- 加载中（无内容时显示三点） -->
                <div v-if="isMessageLoading(msg)" class="msg-loading">
                  <span class="dot" /><span class="dot" /><span class="dot" />
                </div>

                <template v-for="(part, pi) in msg.parts" :key="pi">

                  <!-- 推理思考块 -->
                  <div v-if="part.type === 'reasoning'" class="think-block">
                    <div class="think-header" @click="toggleThink(msg.id + pi)">
                      <el-icon><View /></el-icon>
                      <span>思考过程</span>
                      <el-icon class="think-toggle">
                        <component :is="expandedThinks.has(msg.id + pi) ? ArrowUp : ArrowDown" />
                      </el-icon>
                    </div>
                    <div v-if="expandedThinks.has(msg.id + pi)" class="think-content">
                      {{ (part as any).text }}
                      <span v-if="(part as any).state === 'streaming'" class="typing-cursor">|</span>
                    </div>
                  </div>

                  <!-- 进度块（tool process） -->
                  <div v-else-if="part.type === 'data-process'" class="process-block" :class="(part as any).data?.status">
                    <span class="process-icon">
                      <el-icon v-if="(part as any).data?.status === 'running'" class="spinning"><Loading /></el-icon>
                      <el-icon v-else-if="(part as any).data?.status === 'done'" color="#52c41a"><SuccessFilled /></el-icon>
                      <el-icon v-else-if="(part as any).data?.status === 'error'" color="#f5222d"><CircleCloseFilled /></el-icon>
                    </span>
                    <span class="process-text">{{ (part as any).data?.content }}</span>
                  </div>

                  <!-- 分镜脚本卡片（后端 bi 块） -->
                  <div v-else-if="part.type === 'data-bi'" class="bi-block">
                    <StoryboardCard :data="(part as any).data" @open-storyboard="(id) => $emit('open-storyboard', id)" />
                  </div>

                  <!-- 普通文本块 -->
                  <div v-else-if="part.type === 'text' && (part as any).text" class="text-block">
                    {{ (part as any).text }}
                    <span
                      v-if="isStreaming && pi === msg.parts.length - 1 && (part as any).state === 'streaming'"
                      class="typing-cursor"
                    >|</span>
                  </div>

                </template>
              </div>

              <!-- 消息操作 -->
              <div v-if="!isMessageLoading(msg) && msg.parts.length" class="msg-actions">
                <button class="action-btn" :class="{ active: (msg as any).feedback === 'like' }" title="喜欢"
                  @click="$emit('feedback', msg.id, (msg as any).feedback === 'like' ? null : 'like')">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                </button>
                <button class="action-btn" :class="{ active: (msg as any).feedback === 'dislike' }" title="不喜欢"
                  @click="$emit('feedback', msg.id, (msg as any).feedback === 'dislike' ? null : 'dislike')">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                </button>
              </div>
            </div>
          </div>
        </template>

      </div>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import {
  View, ChatDotRound, Loading, SuccessFilled, CircleCloseFilled, ArrowDown, ArrowUp, Document,
} from '@element-plus/icons-vue'
import type { ChatMessage } from './types'
import StoryboardCard from './StoryboardCard.vue'

const props = defineProps<{
  messages: ChatMessage[]
  isStreaming?: boolean
}>()

defineEmits<{
  feedback: [messageId: string, feedback: 'like' | 'dislike' | null]
  'open-storyboard': [projectId: string]
}>()

// ─── 思考块展开状态 ────────────────────────────────────────
const expandedThinks = ref(new Set<string>())
const streamingThinks = new Set<string>()

const toggleThink = (key: string) => {
  if (expandedThinks.value.has(key)) {
    expandedThinks.value.delete(key)
  } else {
    expandedThinks.value.add(key)
  }
  expandedThinks.value = new Set(expandedThinks.value)
}

watch(
  () => props.messages,
  (messages) => {
    const active = new Set<string>()
    for (const message of messages) {
      message.parts?.forEach((part: any, index: number) => {
        if (part.type !== 'reasoning' || part.state !== 'streaming') return
        const key = message.id + index
        active.add(key)
        if (!streamingThinks.has(key)) expandedThinks.value.add(key)
      })
    }
    for (const key of streamingThinks) {
      if (!active.has(key)) expandedThinks.value.delete(key)
    }
    streamingThinks.clear()
    active.forEach((key) => streamingThinks.add(key))
    expandedThinks.value = new Set(expandedThinks.value)
  },
  { deep: true, immediate: true },
)

// ─── 工具函数 ──────────────────────────────────────────────

/** 提取用户消息文本 */
const extractUserText = (msg: ChatMessage): string => {
  if (msg.role !== 'user') return ''
  const parts = msg.parts ?? []
  const text = parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text ?? '').join('')
  return text || (msg as any).content || ''
}

/** 提取用户消息附件（AI SDK FileUIPart） */
const extractUserFiles = (msg: ChatMessage): Array<{ filename?: string; mediaType?: string; url?: string }> => {
  if (msg.role !== 'user') return []
  return (msg.parts ?? []).filter((p: any) => p?.type === 'file') as Array<{
    filename?: string
    mediaType?: string
    url?: string
  }>
}

/** 判断 AI 消息是否加载中（无任何 part 且正在流式） */
const isMessageLoading = (msg: ChatMessage): boolean => {
  if (msg.role !== 'assistant') return false
  const hasParts = msg.parts?.some((p: any) => {
    if (p.type === 'text') return !!(p as any).text
    return true
  })
  return props.isStreaming && !hasParts
}

// ─── 滚动控制 ──────────────────────────────────────────────
const scrollbarRef = ref()
const innerRef = ref<HTMLDivElement>()
const isUserScrolledUp = ref(false)

const scrollToBottom = () => {
  nextTick(() => {
    const wrap = scrollbarRef.value?.wrapRef as HTMLElement | undefined
    if (wrap) wrap.scrollTop = wrap.scrollHeight
  })
}

const handleScroll = () => {
  const wrap = scrollbarRef.value?.wrapRef as HTMLElement | undefined
  if (!wrap) return
  isUserScrolledUp.value = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight > 80
}

watch(() => props.messages, () => { if (!isUserScrolledUp.value) scrollToBottom() }, { deep: true })

defineExpose({ scrollToBottom })
</script>

<style scoped>
.message-list { flex: 1; overflow: hidden; }
.message-inner { max-width: 800px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 20px; }
.message-row { display: flex; }
.message-row.user { justify-content: flex-end; }
.message-row.assistant { justify-content: flex-start; }
.msg-bubble { max-width: 85%; border-radius: 14px; padding: 12px 16px; line-height: 1.6; font-size: 14px; word-break: break-word; }
.user-bubble { background: #1a1a1a; color: #fff; border-bottom-right-radius: 4px; }
.msg-files { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.msg-files:last-child { margin-bottom: 0; }
.msg-file-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 10px; border-radius: 8px; background: rgba(255,255,255,.12); font-size: 12px; line-height: 1.4; }
.msg-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.ai-area { display: flex; gap: 10px; align-items: flex-start; max-width: 90%; }
.ai-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; margin-top: 2px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light)); display: flex; align-items: center; justify-content: center; }
.ai-content { flex: 1; min-width: 0; }
.ai-bubble { background: var(--color-bg-secondary); color: var(--color-text-primary); border-bottom-left-radius: 4px; min-height: 32px; max-width: none; display: flex; flex-direction: column; gap: 8px; }
.msg-actions { display: flex; gap: 2px; margin-top: 4px; opacity: 0; transition: opacity .15s; }
.ai-area:hover .msg-actions { opacity: 1; }
.action-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent; color: var(--color-text-tertiary); cursor: pointer; transition: all .15s; padding: 0; }
.action-btn:hover { background: var(--color-bg-secondary); color: var(--color-text-secondary); }
.action-btn.active { color: var(--color-primary-light); }
.msg-loading { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 4px 0; }
.msg-loading .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-border); animation: dot-pulse 1.4s infinite ease-in-out both; }
.msg-loading .dot:nth-child(2) { animation-delay: .16s; }
.msg-loading .dot:nth-child(3) { animation-delay: .32s; }
@keyframes dot-pulse { 0%,80%,100% { opacity: .3; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
.typing-cursor { display: inline-block; color: var(--color-primary-light); font-weight: 300; animation: blink .8s step-end infinite; }
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
/* 思考块 */
.think-block { background: rgba(0,0,0,.03); border-left: 3px solid var(--color-border); border-radius: 4px; padding: 8px 12px; }
.think-header { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; user-select: none; }
.think-header:hover { color: var(--color-text-secondary); }
.think-toggle { margin-left: auto; font-size: 10px; }
.think-content { margin-top: 6px; font-size: 13px; color: var(--color-text-tertiary); white-space: pre-wrap; line-height: 1.6; }
/* 进度块 */
.process-block { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--color-info-soft); border-radius: 6px; font-size: 13px; color: var(--color-text-secondary); }
.process-block.error { background: var(--color-error-soft); }
.process-block.done { background: var(--color-success-soft); }
.process-icon { flex-shrink: 0; display: flex; }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
/* BI 块 */
.bi-block { border-radius: 8px; overflow: hidden; }
/* 文本块 */
.text-block { line-height: 1.7; white-space: pre-wrap; }
@media (max-width: 960px) {
  .message-list { min-height: 0; }
  .message-inner { padding: 10px 8px; gap: 12px; }
  .ai-area { max-width: 100%; gap: 6px; }
  .ai-avatar { width: 26px; height: 26px; }
  .msg-bubble { padding: 9px 10px; overflow-wrap: anywhere; }
  .msg-actions { opacity: 1; }
  .action-btn { width: 36px; height: 36px; }
}
</style>
