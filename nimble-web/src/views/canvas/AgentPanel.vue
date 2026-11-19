<template>
  <aside class="agent" @pointerdown.stop @wheel.stop>
    <header class="head">
      <el-icon><ChatDotRound /></el-icon>
      <span>画布助手</span>
      <el-button :icon="Close" text size="small" aria-label="关闭画布助手" @click="$emit('close')" />
    </header>

    <el-scrollbar ref="scrollRef" class="list">
      <div v-if="!messages.length" class="hint">
        <p>告诉我你想做什么，我来帮你在画布上搭好节点和连线，例如：</p>
        <button v-for="q in EXAMPLES" :key="q" type="button" @click="send(q)">{{ q }}</button>
      </div>
      <div v-for="msg in messages" :key="msg.id" class="msg" :class="`is-${msg.role}`">
        <p v-if="textOf(msg)" class="bubble">{{ textOf(msg) }}</p>
      </div>
      <p v-if="busy" class="thinking"><el-icon class="is-loading"><Loading /></el-icon>思考中…</p>
      <p v-if="error" class="error">{{ error.message }}</p>
    </el-scrollbar>

    <footer class="foot">
      <el-input v-model="input" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="描述你想在画布上做的事…" @keydown.enter.exact="onEnter" />
      <el-button v-if="busy" :icon="VideoPause" circle aria-label="停止生成" @click="stop" />
      <el-button v-else type="primary" :icon="Promotion" circle aria-label="发送指令" :disabled="!input.trim()" @click="send()" />
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useChat } from '@ai-sdk/vue'
import { ChatDotRound, Close, Loading, Promotion, VideoPause } from '@element-plus/icons-vue'
import { createAgentTransport, type AppMessage } from '@/api/agent'
import { useAuthStore } from '@/stores/auth'
import { applyCanvasOps, describeCanvas, type CanvasOp } from './agent-ops'
import { useNodeGeneration } from './generate'
import { useCanvasStore } from './store'

const EXAMPLES = ['帮我搭一个产品宣传片的分镜：3 张场景图 + 1 个视频', '把选中的图片做成 5 秒的视频', '写一段 30 秒的口播文案并配音']

defineEmits<{ close: [] }>()

const store = useCanvasStore()
const auth = useAuthStore()
const { generate } = useNodeGeneration()

const input = ref('')
const scrollRef = ref<{ setScrollTop: (v: number) => void; wrapRef?: HTMLElement }>()
const appliedParts = new Set<string>()
const sessionId = `canvas_${store.projectId}_${Date.now().toString(36)}`

const transport = createAgentTransport({ agentId: 'canvas', toolGroups: ['canvas'], skills: [] })
const { messages, status, error, sendMessage, stop } = useChat(() => ({ id: sessionId, messages: [] as AppMessage[], transport }))
const busy = computed(() => status.value === 'submitted' || status.value === 'streaming')

const textOf = (msg: AppMessage) =>
  msg.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')

function onEnter(event: Event) {
  if (!(event instanceof KeyboardEvent) || event.isComposing || event.key === 'Process') return
  event.preventDefault()
  void send()
}

async function send(text = input.value) {
  const content = text.trim()
  if (!content || busy.value || !auth.ensureLoggedIn()) return
  input.value = ''
  // 画布每次都可能被用户改过，所以每条消息都带最新快照
  await sendMessage({ text: content }, { body: { input: content, extraPrompt: describeCanvas(store) } })
}

/** Agent 下发的操作在这里落到本地画布；每个 part 只执行一次，生成类操作走统一的生成流程 */
watch(
  messages,
  (list) => {
    for (const msg of list) {
      if (msg.role !== 'assistant') continue
      msg.parts.forEach((part, i) => {
        const bi = part as { type: string; data?: { tag?: string; data?: { ops?: CanvasOp[] } } }
        const key = `${msg.id}:${i}`
        if (bi.type !== 'data-bi' || bi.data?.tag !== 'canvas-ops' || appliedParts.has(key)) return
        appliedParts.add(key)
        applyCanvasOps(store, bi.data.data?.ops ?? []).forEach((node) => void generate(node))
      })
    }
    nextTick(() => scrollRef.value?.wrapRef && scrollRef.value.setScrollTop(scrollRef.value.wrapRef.scrollHeight))
  },
  { deep: true },
)
</script>

<style scoped>
.agent { position: absolute; right: 0; top: 0; bottom: 0; width: 340px; display: flex; flex-direction: column; border-left: 1px solid var(--color-border); background: var(--color-card); box-shadow: var(--shadow-lg); z-index: 30; }
.head { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--color-divider); font-weight: 700; }
.head span { flex: 1; }
.list { flex: 1; min-height: 0; padding: 12px; }
.hint { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--color-text-secondary); }
.hint button { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-secondary); color: var(--color-text-primary); text-align: left; font-size: 12.5px; cursor: pointer; }
.hint button:hover { border-color: var(--color-primary-line); }
.msg { display: flex; margin-bottom: 10px; }
.msg.is-user { justify-content: flex-end; }
.bubble { max-width: 88%; padding: 8px 12px; border-radius: var(--radius-md); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; line-height: 1.65; background: var(--color-bg-secondary); color: var(--color-text-primary); }
.is-user .bubble { background: var(--color-primary); color: #fff; }
.thinking { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-text-tertiary); }
.error { font-size: 12.5px; color: var(--color-error); }
.foot { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--color-divider); }
@media (max-width: 960px) {
  .agent { width: 100%; border: 0; box-shadow: none; }
  .head { flex-shrink: 0; }
  .head .el-button, .foot .el-button { min-width: 40px; min-height: 40px; }
  .foot { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  .foot :deep(textarea) { font-size: 16px; }
}
</style>
