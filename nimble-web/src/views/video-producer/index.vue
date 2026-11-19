<template>
  <div class="agent-page">
    <WorkspaceSidebar v-slot="{ close }" title="历史对话">
      <ChatSidebar
        :sessions="sessions"
        :current-session-id="currentSessionId"
        delete-confirm="确定删除？该对话及其中的视频项目、素材和生成内容将一并删除，无法恢复。"
        @new-chat="close(); handleNewChat()"
        @select-session="(id) => { close(); handleSelectSession(id) }"
        @delete-session="handleDeleteSession"
      />
    </WorkspaceSidebar>

    <div class="agent-content">
      <VideoWorkbenchPanel
        v-if="activeVideoProjectId"
        :project-id="activeVideoProjectId"
        :chat-open="chatOpen"
        :chat-busy="isStreaming"
        class="workbench-pane"
        :class="{ 'is-behind-chat': chatOpen }"
        @close="handleNewChat"
        @open-chat="chatOpen = true"
        @project-updated="handleProjectUpdated"
      />

      <div
        class="agent-main"
        :class="{
          'agent-main--drawer': !!activeVideoProjectId,
          'is-collapsed': !!activeVideoProjectId && !chatOpen,
        }"
      >
        <div v-if="activeVideoProjectId" class="drawer-head">
          <span>对话</span>
          <button type="button" class="close-x" aria-label="返回工作台" @click="chatOpen = false">
            <el-icon :size="14"><Close /></el-icon>
          </button>
        </div>
        <div v-if="models.length > 1" class="agent-toolbar">
          <el-select
            v-model="selectedModel"
            size="small"
            class="toolbar-select"
            placeholder="选择模型"
            @change="handleModelChange"
          >
            <el-option
              v-for="m in models"
              :key="m.id"
              :label="formatAvailableModelLabel(m)"
              :value="m.id"
            />
          </el-select>
        </div>

        <!-- 新会话首页：标题+推荐问题 → 输入框 → 示例模板（独立滚动，模板多了也不挤压上方布局） -->
        <template v-if="showWelcome">
          <VideoWelcomeView :questions="recommendedQuestions" @select-question="handleSendFromQuestion" />
          <ChatInput
            ref="chatInputRef"
            :disabled="!currentSessionId || status === 'submitted'"
            :streaming="isStreaming"
            class="welcome-input"
            @send="handleSend"
            @stop="handleStop"
            @media-uploaded="handleChatMediaUploaded"
          />
          <WorksGallery
            mode="studio"
            :using-example-id="usingExampleId"
            :creating-blank="creatingBlank"
            @use-example="handleUseExample"
            @create-blank="handleCreateBlank"
            @use-canvas-example="handleUseCanvasExample"
          />
        </template>

        <!-- 已进入对话或已打开工作台：常规聊天布局，输入框固定在底部 -->
        <template v-else>
          <MessageList
            v-if="messages.length"
            ref="messageListRef"
            :messages="messages"
            :is-streaming="isStreaming"
            @feedback="handleFeedback"
            @open-storyboard="openStoryboard"
          />
          <div v-else class="workbench-chat-hint">
            <el-icon :size="26"><ChatDotRound /></el-icon>
            <p v-if="activeVideoProjectId">工作台已就绪，可在下方直接发送指令继续完善（补充素材、调整分镜等）</p>
            <p v-else>可从历史对话重新打开工作台，或选择「新建工作台」开始制作</p>
          </div>

          <div v-if="chatError" class="chat-error">
            <el-icon><WarningFilled /></el-icon>
            <span>{{ chatError.message }}</span>
            <el-button size="small" text @click="clearError">忽略</el-button>
          </div>

          <ChatInput
            ref="chatInputRef"
            :disabled="!currentSessionId || status === 'submitted'"
            :streaming="isStreaming"
            @send="handleSend"
            @stop="handleStop"
            @media-uploaded="handleChatMediaUploaded"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChat } from '@ai-sdk/vue'
import { WarningFilled, ChatDotRound, Close } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import ChatSidebar from './chat/ChatSidebar.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'
import ChatInput from './chat/ChatInput.vue'
import MessageList from './chat/MessageList.vue'
import VideoWorkbenchPanel from './components/VideoWorkbenchPanel.vue'
import VideoWelcomeView from './components/VideoWelcomeView.vue'
import WorksGallery from '@/components/WorksGallery.vue'
import type { UploadResult } from './chat/types'
import { useCanvasExample } from '@/api/canvas'
import {
  createAgentTransport,
  getSessions,
  getSessionMessages,
  deleteSession,
  getAvailableModels,
  getRecommendQuestions,
  convertHistoryToUiMessages,
  toFileUIParts,
  formatAvailableModelLabel,
  type AgentSession,
  type AvailableModel,
  type AppMessage,
} from '@/api/agent'
import { uploadLocalRef, useExample, createBlankProject, getVideoProjects, ASSET_KIND_META, type VideoProject } from '@/api/video'
import { MEDIA_STATUS_LABEL } from './constants'
import { useAuthStore } from '@/stores/auth'

function queryStr(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function storyboardProjectIds(msgs: AppMessage[]): string[] {
  const ids: string[] = []
  for (const msg of msgs) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts as Array<{ type: string; data?: { tag?: string; data?: { projectId?: string } } }>) {
      const projectId = part.type === 'data-bi' && part.data?.tag === 'video-storyboard'
        ? part.data.data?.projectId
        : undefined
      if (projectId) ids.push(projectId)
    }
  }
  return ids
}

/** 固定为视频制作智能体，与 AI 助理完全隔离 */
const AGENT_ID = 'video-producer'

const selectedModel = ref<string | undefined>(undefined)
const models = ref<AvailableModel[]>([])
const recommendedQuestions = ref<string[]>([])

const sessions = ref<AgentSession[]>([])
const currentSessionId = ref('')
const initialMessages = ref<AppMessage[]>([])

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const activeVideoProjectId = ref<string>()
/** 工作台打开后对话默认收起，工作台铺满剩余区域；需要时再从头部展开 */
const chatOpen = ref(false)
const autoOpenedProjectIds = new Set<string>()
/** 首屏从 URL 还原完成前不同步，避免空 session 把 ?session=&project= 冲掉 */
let urlSyncReady = false

const transport = computed(() =>
  createAgentTransport({
    agentId: AGENT_ID,
    model: selectedModel.value,
    toolGroups: ['video_gen'],
    skills: ['video-storyboard'],
  }),
)

const {
  messages,
  status,
  error: chatError,
  sendMessage,
  stop,
  clearError,
} = useChat(() => ({
  id: currentSessionId.value,
  messages: initialMessages.value,
  transport: transport.value,
  onError: (err: Error) => {
    ElMessage.error(err.message || '对话发生错误')
  },
}))

const isStreaming = computed(() => status.value === 'streaming' || status.value === 'submitted')
/** 仅「尚未写入历史的新对话」才展示案例墙。已有历史的会话收起工作台后不回到案例墙，避免点案例把上一条覆盖掉 */
const showWelcome = computed(() =>
  !messages.value.length
  && !activeVideoProjectId.value
  && !sessions.value.some((item) => item.id === currentSessionId.value),
)

const messageListRef = ref<InstanceType<typeof MessageList>>()
const chatInputRef = ref<InstanceType<typeof ChatInput>>()

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  await Promise.all([loadInitialData(), loadSessions()])
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})

async function loadInitialData() {
  try {
    const modelsRes = await getAvailableModels()
    models.value = modelsRes.models ?? []
    selectedModel.value = modelsRes.default
  } catch { /* 模型列表非关键路径，静默失败 */ }

  await loadRecommendQuestions()
}

async function loadRecommendQuestions() {
  try {
    const questions = await getRecommendQuestions()
    recommendedQuestions.value = Array.isArray(questions) && questions.length
      ? questions
      : ['帮我做一个产品宣传视频', '根据参考图设计分镜脚本']
  } catch {
    recommendedQuestions.value = ['帮我做一个产品宣传视频', '根据参考图设计分镜脚本']
  }
}

async function loadSessions() {
  const [sessionItems, projects] = await Promise.all([
    getSessions({ agentId: AGENT_ID, pageSize: 50 }).then((res) => res.items ?? []).catch(() => [] as AgentSession[]),
    getVideoProjects().then((rows) => rows ?? []).catch(() => [] as VideoProject[]),
  ])

  const byId = new Map<string, AgentSession>()
  for (const session of sessionItems) byId.set(session.id, session)
  for (const project of projects) {
    if (!project.sessionId || byId.has(project.sessionId)) continue
    byId.set(project.sessionId, {
      id: project.sessionId,
      title: project.title,
      agentId: AGENT_ID,
      lastActiveAt: project.updatedAt,
      createdAt: project.createdAt,
    })
  }
  sessions.value = [...byId.values()].sort((a, b) => sessionTime(b) - sessionTime(a))

  const sessionFromUrl = queryStr(route.query.session)
  const projectFromUrl = queryStr(route.query.project)
  if (sessionFromUrl) {
    await loadSessionChat(sessionFromUrl, true)
    currentSessionId.value = sessionFromUrl
    if (projectFromUrl) {
      autoOpenedProjectIds.add(projectFromUrl)
      activeVideoProjectId.value = projectFromUrl
    }
  } else {
    handleNewChat()
  }
  urlSyncReady = true
  syncWorkbenchUrl()
}

const handleGlobalKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    handleNewChat()
    chatInputRef.value?.focus()
  }
}

function sessionTime(session: AgentSession) {
  const value = session.lastActiveAt || session.createdAt
  return value ? new Date(value).getTime() : 0
}

function handleNewChat() {
  stop()
  initialMessages.value = []
  currentSessionId.value = `s_${Date.now()}`
  activeVideoProjectId.value = undefined
  chatOpen.value = false
  if (window.matchMedia('(min-width: 961px) and (hover: hover)').matches) chatInputRef.value?.focus()
}

function openStoryboard(id: string) {
  activeVideoProjectId.value = id
  if (window.matchMedia('(max-width: 960px)').matches) chatOpen.value = false
}

function syncWorkbenchUrl() {
  const session = currentSessionId.value || undefined
  const project = activeVideoProjectId.value || undefined
  if (queryStr(route.query.session) === (session ?? '') && queryStr(route.query.project) === (project ?? '')) return
  router.replace({ query: { ...(session ? { session } : {}), ...(project ? { project } : {}) } })
}

function seedAutoOpenedFromMessages(msgs: AppMessage[]) {
  for (const id of storyboardProjectIds(msgs)) autoOpenedProjectIds.add(id)
}

async function loadSessionChat(sessionId: string, silent = false) {
  stop()
  try {
    const history = await getSessionMessages(sessionId, 100)
    initialMessages.value = convertHistoryToUiMessages(history)
  } catch {
    if (!silent) ElMessage.warning('加载历史消息失败')
    initialMessages.value = []
  }
  seedAutoOpenedFromMessages(initialMessages.value)
}

/** 点击历史：该会话对应的视频项目（一条会话一个项目） */
async function handleSelectSession(sessionId: string) {
  if (sessionId !== currentSessionId.value) {
    chatOpen.value = false
    await loadSessionChat(sessionId)
    currentSessionId.value = sessionId
  }
  const projects = await getVideoProjects({ sessionId })
  const project = projects[0]
  if (project) {
    autoOpenedProjectIds.add(project.id)
    activeVideoProjectId.value = project.id
  } else {
    activeVideoProjectId.value = undefined
  }
}

async function handleDeleteSession(sessionId: string) {
  try {
    await deleteSession(sessionId)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
    if (currentSessionId.value === sessionId) {
      if (sessions.value.length) {
        handleSelectSession(sessions.value[0].id)
      } else {
        handleNewChat()
      }
    }
  } catch {
    ElMessage.error('删除会话失败')
  }
}

function handleModelChange() {
  // transport 是 computed，会自动重建；新对话下一次发送时生效
}

function handleSendFromQuestion(question: string) {
  handleSend(question, [])
}

const usingExampleId = ref<string>()
const creatingBlank = ref(false)

// ─── 工作台上下文感知：让聊天中的 AI 知道当前打开的工作台内容 ──────
/** 由 VideoWorkbenchPanel 通过 Socket 实时同步过来的最新项目快照，仅用于拼装上下文摘要 */
const workbenchSnapshot = ref<VideoProject>()
/** 每个会话只在第一条消息里注入一次工作台摘要，避免每次请求都重复携带、白白增加 token 消耗 */
const contextInjectedSessions = new Set<string>()
watch(activeVideoProjectId, () => { workbenchSnapshot.value = undefined })
watch([currentSessionId, activeVideoProjectId], () => {
  if (!urlSyncReady) return
  syncWorkbenchUrl()
})

function handleProjectUpdated(project: VideoProject) {
  workbenchSnapshot.value = project
  const session = sessions.value.find((item) => item.id === project.sessionId)
  if (session && session.title !== project.title) session.title = project.title
}

function buildWorkbenchContextPrompt(project: VideoProject): string {
  const assetsText = project.assets.length
    ? project.assets.map((a) => `- ${a.name}（${ASSET_KIND_META[a.kind].label} · ${a.source === 'uploaded' ? '本地上传' : 'AI生成'} · ${MEDIA_STATUS_LABEL[a.status] ?? a.status}）：${a.prompt || '（无提示词）'}`).join('\n')
    : '（暂无）'
  const shotsText = project.shots.length
    ? project.shots.map((s, i) => `${i + 1}. ${s.name}（${s.durationSec}s · ${MEDIA_STATUS_LABEL[s.videoStatus] ?? s.videoStatus}）：${s.videoPrompt}`).join('\n')
    : '（暂无）'
  return [
    '用户当前已打开一个视频制作工作台，后续指令默认针对这个项目，请结合以下最新状态回答：',
    `项目标题：${project.title}`,
    project.requirement ? `原始需求：${project.requirement}` : '',
    `\n【素材库】\n${assetsText}`,
    `\n【分镜脚本】\n${shotsText}`,
    `\n【成片合成】状态：${MEDIA_STATUS_LABEL[project.finalVideoStatus] ?? project.finalVideoStatus}`,
    '\n你目前没有直接修改该工作台的工具，只能基于以上信息回答问题、给出建议，或在用户明确要求"重新设计/生成一个新脚本"时调用 generate_storyboard 另建项目；不要凭空杜撰未列出的素材或分镜名称。',
  ].filter(Boolean).join('\n')
}

/** 当前工作台已打开且本会话尚未注入过上下文时，返回摘要供本次请求携带；否则返回 undefined */
function consumeWorkbenchContextPrompt(): string | undefined {
  if (!activeVideoProjectId.value || !workbenchSnapshot.value) return undefined
  if (contextInjectedSessions.has(currentSessionId.value)) return undefined
  contextInjectedSessions.add(currentSessionId.value)
  return buildWorkbenchContextPrompt(workbenchSnapshot.value)
}

function newWorkbenchSessionId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 空白工作台 / 使用案例：永远开一条新历史，绝不挂到当前会话上 */
function openFreshSession(project: VideoProject) {
  stop()
  initialMessages.value = []
  currentSessionId.value = project.sessionId
  sessions.value = [
    { id: project.sessionId, title: project.title, agentId: AGENT_ID, lastActiveAt: project.updatedAt },
    ...sessions.value.filter((item) => item.id !== project.sessionId),
  ]
  autoOpenedProjectIds.add(project.id)
  activeVideoProjectId.value = project.id
}

/** 首页点击"空白工作台"：不经过对话生成分镜，直接创建空项目供用户手动搭建 */
async function handleCreateBlank() {
  if (creatingBlank.value) return
  creatingBlank.value = true
  try {
    const project = await createBlankProject({ sessionId: newWorkbenchSessionId() })
    openFreshSession(project)
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    creatingBlank.value = false
  }
}

/** 首页的分享作品里混着画布作品：复制成自己的画布，然后跳到无限画布打开 */
async function handleUseCanvasExample(exampleId: string) {
  if (!authStore.ensureLoggedIn() || usingExampleId.value) return
  usingExampleId.value = exampleId
  try {
    const canvas = await useCanvasExample(exampleId)
    await router.push({ path: '/video-producer/canvas', query: { id: canvas.id } })
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    usingExampleId.value = undefined
  }
}

/** 新会话首页点击"复制项目"：克隆该案例的完整工作台，作为一条全新历史打开 */
async function handleUseExample(exampleId: string) {
  if (usingExampleId.value) return
  usingExampleId.value = exampleId
  try {
    const project = await useExample(exampleId, { sessionId: newWorkbenchSessionId() })
    openFreshSession(project)
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    usingExampleId.value = undefined
  }
}

/** 聊天中上传图片/视频/音频：已打开工作台时同步进项目素材库，等同于在工作台本地上传一次 */
async function handleChatMediaUploaded(file: File) {
  if (!activeVideoProjectId.value) return
  try {
    await uploadLocalRef(activeVideoProjectId.value, file)
  } catch {
    // 不影响正常聊天；格式/大小/时长超限的原因已由 request 拦截器提示
  }
}

async function handleSend(text: string, files: UploadResult[]) {
  if ((!text.trim() && !files.length) || isStreaming.value) return
  // 推荐问题等入口不经过输入框，这里再兜一次
  if (!authStore.ensureLoggedIn()) return

  const userText = text.trim()
  const inputForModel = userText || (files.length ? `请查看附件：${files.map((f) => f.filename).join('、')}` : '')
  const fileParts = toFileUIParts(files)
  const titleSource = userText || files[0]?.filename || inputForModel

  const existingSession = sessions.value.find(s => s.id === currentSessionId.value)
  if (!existingSession) {
    sessions.value.unshift({
      id: currentSessionId.value,
      title: titleSource.slice(0, 30) + (titleSource.length > 30 ? '…' : ''),
      agentId: AGENT_ID,
    })
  }

  try {
    await sendMessage(
      userText
        ? { text: userText, files: fileParts.length ? fileParts : undefined }
        : { files: fileParts },
      { body: { input: inputForModel, files: files.length ? files : undefined, extraPrompt: consumeWorkbenchContextPrompt() } },
    )
  } catch {
    // error 已通过 chatError ref 展示
  }
}

function handleStop() {
  stop()
}

function handleFeedback(_messageId: string, _feedback: 'like' | 'dislike' | null) {
  // TODO: 调用后端反馈接口
}

watch(
  messages,
  (msgs) => {
    for (const projectId of storyboardProjectIds(msgs as AppMessage[])) {
      if (autoOpenedProjectIds.has(projectId)) continue
      autoOpenedProjectIds.add(projectId)
      activeVideoProjectId.value = projectId
    }
  },
  { deep: true },
)

watch(
  messages,
  (msgs) => {
    const last = msgs[msgs.length - 1]
    if (last?.role !== 'assistant' || !last.metadata) return
    const meta = last.metadata as { title?: string; sessionId?: string }
    if (!meta.title) return
    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (session && session.title !== meta.title) {
      session.title = meta.title
    }
  },
  { deep: false },
)
</script>

<style scoped>
.agent-page { display: flex; height: 100%; background: var(--color-card); overflow: hidden; }
.agent-content { flex: 1; display: flex; min-width: 0; overflow: hidden; }
.workbench-pane { flex: 1 1 auto; min-width: 0; }
.agent-main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--color-bg-secondary); }
.agent-main--drawer {
  flex: 0 0 min(420px, 36vw); width: min(420px, 36vw); min-width: 0;
  border-left: 1px solid var(--color-border); overflow: hidden;
  transition: flex-basis .2s ease, width .2s ease, border-color .2s ease;
}
.agent-main--drawer.is-collapsed {
  flex-basis: 0; width: 0; border-left-color: transparent; pointer-events: none;
}
.drawer-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  height: 44px; padding: 0 12px; flex-shrink: 0; border-bottom: 1px solid var(--color-border);
  background: var(--color-card); font-size: 13px; font-weight: 700;
}
.close-x {
  width: 28px; height: 28px; display: grid; place-items: center;
  border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg-secondary);
  color: var(--color-text-secondary); cursor: pointer;
}
.close-x:hover { color: #e44d4d; border-color: #f3c1c1; background: #fff5f5; }
.agent-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--color-border); background: var(--color-card); }
.toolbar-select { width: 220px; }
.chat-error { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--color-error-soft); border-top: 1px solid var(--color-border); font-size: 13px; color: #e44d4d; }

.welcome-input { flex-shrink: 0; padding-bottom: 18px; }
.workbench-chat-hint {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 0 24px; color: var(--color-text-tertiary); text-align: center; font-size: 13px; line-height: 1.6;
}
@media (max-width: 960px) {
  .agent-page { flex-direction: column; }
  .agent-content { position: relative; min-height: 0; }
  .agent-main--drawer { position: absolute; inset: 0; width: 100%; border: 0; transition: none; }
  .agent-main--drawer.is-collapsed, .workbench-pane.is-behind-chat { visibility: hidden; }
  .close-x { width: 40px; height: 36px; }
  .agent-toolbar { padding: 6px 10px; }
  .toolbar-select { max-width: 100%; }
  .welcome-input { padding-bottom: 10px; }
  .agent-main:has(.welcome-input) { display: block; overflow-y: auto; }
  .agent-main :deep(.gallery-scroll) { overflow: visible; }
  .agent-main :deep(.gallery-scroll > .el-scrollbar__wrap) { height: auto; overflow: visible; }
}
</style>
