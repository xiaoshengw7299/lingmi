<template>
  <div class="workbench" :class="{ 'is-readonly': readonly }">
    <!-- 顶部信息条：标题 + 状态 + 整体进度 -->
    <header class="wb-header">
      <button v-if="!readonly" type="button" class="close-x" title="关闭工作台，回到首页" @click="$emit('close')">
        <el-icon :size="15"><Close /></el-icon>
      </button>

      <div class="wb-title-block">
        <div class="wb-title-row">
          <h3
            v-if="readonly || !editingTitle"
            class="wb-title"
            :class="{ 'is-editable': !readonly }"
            :title="readonly ? undefined : '点击修改标题'"
            @click="!readonly && startEditTitle()"
          >{{ project?.title || '视频制作' }}</h3>
          <el-input
            v-else
            ref="titleInputRef"
            v-model="titleDraft"
            class="wb-title-input"
            maxlength="255"
            @keyup.enter="commitTitle"
            @keyup.esc="cancelEditTitle"
            @blur="commitTitle"
          />
          <StatusTag :status="project?.status ?? 'draft'" :label="projectStatusLabel" />
        </div>
        <p class="wb-requirement" :title="project?.requirement">{{ project?.requirement }}</p>
        <p v-if="!readonly" class="share-reward" :title="SHARE_REWARD_RULE">{{ shareRewardLine(shareReward) }}</p>
      </div>

      <div v-if="totalShots" class="wb-progress">
        <div class="progress-numbers">
          <strong>{{ overallProgress }}%</strong>
          <span class="progress-detail">视频 {{ videosDone }}/{{ totalShots }}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" :style="{ width: overallProgress + '%' }" /></div>
      </div>

      <div v-if="!readonly" class="wb-header-actions">
        <el-button
          v-if="!chatOpen"
          size="small" :icon="ChatDotRound"
          @click="$emit('open-chat')"
        >对话<span v-if="chatBusy" class="chat-dot" /></el-button>
        <el-button
          size="small" :icon="Star" :disabled="!progressComplete" :loading="exampleLoading"
          :title="progressComplete ? SHARE_REWARD_RULE : '全部分镜视频生成完成后可用'"
          @click="handleGenerateExample"
        >{{ project?.exampleId ? '重新生成示例' : '生成示例' }}</el-button>
        <el-button
          size="small" :icon="MagicStick" :disabled="!progressComplete" :loading="experienceLoading"
          :title="progressComplete ? 'AI 总结本次制作过程为经验文档并下载' : '全部分镜视频生成完成后可用'"
          @click="handleGenerateExperience"
        >生成经验</el-button>
      </div>
    </header>

    <!-- 分段锚点导航：素材库 / 分镜脚本 / 成片合成，点击或滚动均可切换 -->
    <nav class="wb-tabs">
      <button
        v-for="tab in tabs" :key="tab.key" type="button" class="tab-btn" :class="{ active: activeTab === tab.key }"
        @click="scrollToSection(tab.key)"
      >
        <el-icon :size="15"><component :is="tab.icon" /></el-icon>
        {{ tab.label }}
        <span v-if="tab.count !== undefined" class="tab-count">{{ tab.count }}</span>
      </button>
    </nav>

    <el-scrollbar ref="scrollbarRef" class="wb-body" @scroll="handleScroll">
      <div class="wb-inner" v-loading="loading">
        <!-- 素材库：图片 / 视频 / 音频 -->
        <section ref="assetsSectionRef" class="wb-section">
          <div class="section-head">
            <div class="section-head-main">
              <span class="section-icon icon-assets"><el-icon :size="16"><Collection /></el-icon></span>
              <div>
                <h4 class="section-title">素材库</h4>
                <p class="section-desc">{{ assetSummary }} · 文本可在分镜里 @ 引用 · 参考视频与参考音频单段 {{ REFERENCE_CLIP_MIN_SEC }}–{{ REFERENCE_CLIP_MAX_SEC }} 秒</p>
              </div>
            </div>
            <div v-if="!readonly" class="section-actions">
              <template v-if="selectingAssets">
                <span class="batch-select-count">已选 <strong>{{ selectedAssetIds.length }}</strong> / {{ batchImageCandidates.length }}</span>
                <el-button size="small" text @click="toggleSelectAllAssets">
                  {{ allAssetsSelected ? '取消全选' : '全选' }}
                </el-button>
                <el-button
                  size="small" type="primary"
                  :disabled="!selectedAssetIds.length"
                  :loading="batchBoardLoading"
                  @click="confirmBatchImages"
                >开始生成</el-button>
                <el-button size="small" @click="exitAssetSelect">取消</el-button>
              </template>
              <template v-else>
                <el-button size="small" :icon="Plus" :disabled="workbenchLocked" @click="handleAddAsset">新建图片素材</el-button>
                <el-button size="small" :icon="Document" :disabled="workbenchLocked" @click="handleAddTextAsset">新建文本</el-button>
                <el-button size="small" :disabled="workbenchLocked || assetUploading" @click="assetFileInput?.click()">
                  {{ assetUploadLabel }}
                </el-button>
                <el-button size="small" :icon="FolderOpened" :disabled="workbenchLocked || assetUploading" @click="assetPickerVisible = true">
                  我的资产
                </el-button>
                <el-button
                  v-if="hasPendingBoardImages"
                  size="small"
                  type="danger"
                  :loading="cancelBoardLoading"
                  title="停止排队和正在生成的任务，费用会退回"
                  @click="handleCancelBoardImages"
                >中断</el-button>
                <el-button
                  v-else-if="hasGeneratedAssets"
                  size="small"
                  type="primary"
                  :disabled="workbenchLocked"
                  @click="enterAssetSelect"
                >批量生成</el-button>
              </template>
            </div>
          </div>

          <div class="section-body">
            <MediaBoard
              name-placeholder="唯一素材名称"
              prompt-placeholder="只描述稳定视觉特征；场景必须为空场。可用 @ 引用其它已生成图片素材"
              prompt-dialog-title="编辑素材生成提示词"
              empty-text="暂无素材。可新建图片素材生成参考图，或上传本地参考图、参考视频、背景音乐。"
              :items="project?.assets ?? []"
              :share-project-id="project?.id"
              :models="imageModels"
              :options-for="(self) => mentionOptions(self, undefined, false)"
              :upload-fn="handleUploadLocalRef"
              :replace-fn="handleReplaceAssetFile"
              :locked="!readonly && (workbenchLocked || selectingAssets)"
              :readonly="readonly"
              :selectable="selectingAssets"
              :selected-ids="selectedAssetIds"
              @dirty="markBoardDirty"
              @update="handleUpdateAsset"
              @delete="handleDeleteAsset"
              @generate="handleGenerateAssetImage"
              @reorder="handleReorderAssets"
              @toggle-select="toggleAssetSelect"
            />
            <input ref="assetFileInput" type="file" :accept="ASSET_UPLOAD_ACCEPT" multiple hidden @change="handleAssetFileChange" />
            <AssetPickerDialog v-model="assetPickerVisible" :kinds="['image', 'video', 'audio']" @confirm="handleImportAssets" />
          </div>
        </section>

        <!-- 分镜脚本 -->
        <section ref="storyboardSectionRef" class="wb-section">
          <div class="section-head">
            <div class="section-head-main">
              <span class="section-icon icon-storyboard"><el-icon :size="16"><Film /></el-icon></span>
              <div>
                <h4 class="section-title">分镜脚本</h4>
                <p class="section-desc">已生成 {{ videosDone }}/{{ totalShots }} 个分镜视频</p>
              </div>
            </div>
            <div v-if="!readonly" class="section-actions">
              <template v-if="selectingShots">
                <span class="batch-select-count">已选 <strong>{{ selectedShotIds.length }}</strong> / {{ totalShots }}</span>
                <el-button size="small" text @click="toggleSelectAllShots">
                  {{ allShotsSelected ? '取消全选' : '全选' }}
                </el-button>
                <el-dropdown
                  trigger="click"
                  :disabled="!selectedShotIds.length || batchVideoLoading"
                  @command="confirmBatchVideos"
                >
                  <el-button size="small" type="primary" :disabled="!selectedShotIds.length" :loading="batchVideoLoading">
                    开始生成
                    <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="continuous">
                        顺序生成
                        <span v-if="generationMode === 'continuous'" class="mode-current">当前</span>
                      </el-dropdown-item>
                      <el-dropdown-item command="parallel">
                        并行生成
                        <span v-if="generationMode === 'parallel'" class="mode-current">当前</span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-button size="small" @click="exitShotSelect">取消</el-button>
              </template>
              <template v-else>
                <el-button size="small" :icon="Plus" :disabled="workbenchLocked" @click="handleAddShot">增加分镜</el-button>
                <el-button
                  v-if="hasPendingShots"
                  size="small"
                  type="danger"
                  :loading="cancelVideoLoading"
                  title="停止排队和正在生成的任务，费用会退回"
                  @click="handleCancelShotVideos"
                >中断</el-button>
                <el-button
                  v-else
                  size="small"
                  type="primary"
                  :disabled="workbenchLocked || !totalShots"
                  @click="enterShotSelect"
                >批量生成</el-button>
              </template>
            </div>
          </div>

          <div class="section-body">
            <div
              v-if="totalShots"
              ref="shotGridRef"
              class="shot-grid"
              :class="{ 'is-sortable': canSortShots }"
            >
              <div
                v-for="shot in project?.shots" :key="shot.id"
                class="shot-sort-item"
                :data-id="shot.id"
              >
                <ShotCard
                  :shot="shot" :options="mentionOptions(undefined, shot)" :upload-fn="handleUploadLocalRef"
                  :share-project-id="project?.id"
                  :models="videoModels"
                  :continuous="generationMode === 'continuous'"
                  :locked="!readonly && (isComposing || selectingShots)"
                  :readonly="readonly"
                  :sortable="canSortShots"
                  :selectable="selectingShots"
                  :selected="selectedShotIds.includes(shot.id)"
                  @dirty="dirtyShotIds.add(shot.id)"
                  @save="saveShot(shot)"
                  @generate-video="handleGenerateShotVideo(shot.id)"
                  @select-take="(takeId) => handleSelectTake(shot.id, takeId)"
                  @delete="handleDeleteShot(shot)"
                  @toggle-select="toggleShotSelect(shot.id)"
                />
              </div>
            </div>
            <el-empty v-else description="暂无分镜脚本，请先在对话中生成故事板" :image-size="70" />
          </div>
        </section>

        <!-- 成片合成：成片预览 + 历次合成记录 -->
        <section ref="resultSectionRef" class="wb-section">
          <div class="section-head">
            <div class="section-head-main">
              <span class="section-icon icon-result"><el-icon :size="16"><VideoCamera /></el-icon></span>
              <div>
                <h4 class="section-title">成片合成</h4>
                <p class="section-desc">
                  {{ project?.composeHistory?.length ? `已合成 ${project.composeHistory.length} 个版本，可回看任意历史成片` : '全部分镜视频生成成功后即可合成完整视频' }}
                </p>
              </div>
            </div>
          </div>

          <div class="section-body">
            <div class="export-layout">
              <div class="export-stage">
                <video v-if="selectedHistory?.videoUrl" :key="selectedHistory.id" :src="selectedHistory.videoUrl" :poster="selectedHistory.coverUrl ?? undefined" controls playsinline preload="none" class="final-video" />
                <div v-else class="export-placeholder">
                  <el-icon :size="30"><VideoCamera /></el-icon>
                  <p v-if="project?.finalVideoStatus === 'queued'">合成任务排队中，请稍候…</p>
                  <p v-else-if="project?.finalVideoStatus === 'generating'">正在合成中，请稍候…</p>
                  <p v-else-if="project?.finalVideoStatus === 'failed'" class="export-error" :title="project.finalVideoError || ''">
                    {{ project.finalVideoError || '合成失败，请重试' }}
                  </p>
                  <p v-else>全部分镜视频生成成功后即可合成完整视频</p>
                </div>
                <StatusTag v-if="project?.finalVideoStatus && project.finalVideoStatus !== 'idle'" class="export-status" :status="project.finalVideoStatus" :error="project?.finalVideoError" />
              </div>

              <div class="export-side">
                <ol class="pipeline-list">
                  <li v-for="step in pipelineSteps" :key="step.label" class="pipeline-item" :class="{ done: step.done }">
                    <span class="pipeline-dot"><el-icon v-if="step.done" :size="12"><Check /></el-icon></span>
                    <span class="pipeline-label">{{ step.label }}</span>
                    <span class="pipeline-hint">{{ step.hint }}</span>
                  </li>
                </ol>

                <p v-if="selectedHistory" class="export-meta">时长约 {{ selectedHistory.durationSec ?? totalDurationSec }} 秒 · {{ selectedHistory.shotCount || totalShots }} 个分镜</p>

                <el-button
                  v-if="!readonly"
                  type="primary" class="cta-gradient export-cta"
                  :disabled="workbenchLocked || !allVideosReady"
                  :loading="project?.finalVideoStatus === 'generating'"
                  :title="!allVideosReady ? '请先完成全部分镜视频生成' : ''"
                  @click="handleCompose"
                >{{ project?.finalVideoUrl || project?.finalVideoStatus === 'failed' ? '重新合成完整视频' : '合成完整视频' }}</el-button>

                <a v-if="selectedHistory?.videoUrl" :href="selectedHistory.videoUrl" download class="download-link">
                  <el-icon :size="13"><Download /></el-icon>下载此版本
                </a>
                <VideoShareButton v-if="project && selectedHistory?.videoUrl" :source="readonly ? 'video-example' : 'project'" :id="project.id" :video="selectedHistory.videoUrl" :title="project.title" />
                <SaveToAssetButton
                  v-if="selectedHistory?.videoUrl && !readonly"
                  kind="video"
                  :name="project?.title ?? '成片'"
                  :url="selectedHistory.videoUrl"
                  :meta="{ from: 'workbench' }"
                />
              </div>
            </div>

            <div v-if="project?.composeHistory?.length" class="history-block">
              <div class="history-title">历史合成记录 <span class="muted">共 {{ project.composeHistory.length }} 次，可按需回看任意版本</span></div>
              <div class="history-grid">
                <button
                  v-for="item in project.composeHistory" :key="item.id" type="button"
                  class="history-card" :class="{ active: item.id === selectedHistory?.id }"
                  @click="selectedHistoryId = item.id"
                >
                  <div class="history-thumb">
                    <img v-if="item.coverUrl" :src="item.coverUrl" alt="" />
                    <el-icon v-else :size="18"><VideoCamera /></el-icon>
                    <el-icon v-if="item.id === selectedHistory?.id" class="history-playing" :size="16"><VideoPlay /></el-icon>
                  </div>
                  <span class="history-date">{{ formatHistoryDate(item.createdAt) }}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import VideoShareButton from '@/components/VideoShareButton.vue'
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Close, VideoCamera, Film, Collection, Check, Download, Plus, ArrowDown, Star, MagicStick, VideoPlay, FolderOpened,
  Document, ChatDotRound,
} from '@element-plus/icons-vue'
import StatusTag from './StatusTag.vue'
import MediaBoard from './MediaBoard.vue'
import ShotCard from './ShotCard.vue'
import AssetPickerDialog from '@/components/AssetPickerDialog.vue'
import SaveToAssetButton from '@/components/SaveToAssetButton.vue'
import type { UserAsset } from '@/api/asset'
import { type MentionOption } from './MentionInput.vue'
import {
  getVideoProject, importAsset, updateShot, addAsset, updateAsset, deleteAsset, generateAssetImage, generateAssetText,
  generateAllAssetImages, cancelQueuedAssetImages,
  generateShotVideo, generateAllShotVideos, cancelQueuedShotVideos,
  composeProject, uploadLocalRef, replaceAssetFile, addShot, deleteShot, reorderShots, reorderAssets, selectShotTake,
  generateExperience, createExample, getShareReward, getMediaModels, clampMediaDuration, clampMediaRatio, clampMediaResolution,
  isProjectBusy,
  resolveMediaModel,
  mediaDurationRange,
  updateVideoProjectTitle,
  ASSET_KIND_META, ASSET_UPLOAD_ACCEPT, REFERENCE_CLIP_MIN_SEC, REFERENCE_CLIP_MAX_SEC, REFERENCE_TOTAL_SEC,
  type VideoProject, type MediaAsset, type Shot, type GenerationMode,
  type LoraSelection, type MediaModelOption, type AssetKind, type ShareRewardStatus,
} from '@/api/video'
import { SHARE_REWARD_BRIEF, SHARE_REWARD_RULE, shareRewardLine } from '../share-reward'
import { isVideoSocketConnected, subscribeVideoProject } from '@/utils/video-socket'
import { downloadTextFile } from '@/utils/download'
import { mergeServerProject, mergeServerShot } from '../merge-project'
import { useSortableList } from '../use-sortable-list'

const props = withDefaults(defineProps<{
  projectId?: string
  previewProject?: VideoProject
  readonly?: boolean
  /** 右侧对话是否已经展开。收起时头部显示「对话」按钮 */
  chatOpen?: boolean
  chatBusy?: boolean
}>(), { readonly: false, chatOpen: false, chatBusy: false })

/** 编辑类操作只在有真实项目时才可达（预览模式是只读的），这里兜底，避免把 undefined 传给接口 */
function requireProjectId(): string {
  if (!props.projectId) throw new Error('当前是预览模式，没有可操作的项目')
  return props.projectId
}
const emit = defineEmits<{ close: []; 'open-chat': []; 'project-updated': [VideoProject] }>()

const project = ref<VideoProject | undefined>(props.previewProject)
const loading = ref(true)
const batchBoardLoading = ref(false)
const batchVideoLoading = ref(false)
const cancelBoardLoading = ref(false)
const cancelVideoLoading = ref(false)
const selectingAssets = ref(false)
const selectingShots = ref(false)
const selectedAssetIds = ref<string[]>([])
const selectedShotIds = ref<string[]>([])
const assetUploading = ref(false)
const assetUploadIndex = ref(0)
const assetUploadTotal = ref(0)
const assetFileInput = ref<HTMLInputElement>()
const shotGridRef = ref<HTMLElement>()
const assetUploadLabel = computed(() => {
  if (!assetUploading.value) return '上传本地素材'
  if (assetUploadTotal.value > 1) return `上传中 ${assetUploadIndex.value}/${assetUploadTotal.value}…`
  return '上传中…'
})
const experienceLoading = ref(false)
const exampleLoading = ref(false)
const shareReward = ref<ShareRewardStatus | null>(null)
const editingTitle = ref(false)
const titleDraft = ref('')
const titleInputRef = ref<{ focus?: () => void; input?: HTMLInputElement } | null>(null)
let titleIgnoreBlur = false
const imageModels = ref<MediaModelOption[]>([])
const videoModels = ref<MediaModelOption[]>([])
let unsubscribe: (() => void) | undefined
/** 超过这么久没收到服务端快照，就补拉一次。推送正常时这个计时会被不断重置 */
const PUSH_STALE_MS = 8000
let lastServerAt = 0
let staleTimer: number | undefined
let stalePulling = false
const textGenerating = new Set<string>()

function loraEquals(a?: LoraSelection | null, b?: LoraSelection | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.name === b.name && a.weight === b.weight
}

async function loadMediaModels() {
  try {
    const { image, video } = await getMediaModels()
    imageModels.value = image
    videoModels.value = video
  } catch {
    ElMessage.error('加载可选模型失败')
  }
}
let loadSequence = 0
const dirtyShotIds = new Set<string>()
const dirtyBoardRefIds = new Set<string>()
const shotSaveRevisions = new Map<string, number>()
const shotSavePromises = new Map<string, Promise<boolean>>()
const boardSaveRevisions = new Map<string, number>()
const boardSavePromises = new Map<string, Promise<boolean>>()
let boardSaveQueue: Promise<unknown> = Promise.resolve()

type TabKey = 'assets' | 'storyboard' | 'export'
const activeTab = ref<TabKey>('assets')

// ─── 锚点导航：三个分区同屏渲染，点击导航滚动定位，滚动时反向高亮 ──
/** el-scrollbar 由 unplugin-vue-components 自动导入，此处仅需其暴露的 wrapRef/scrollTo 等实例方法 */
const scrollbarRef = ref<{ wrapRef?: HTMLElement } | null>(null)
const assetsSectionRef = ref<HTMLElement>()
const storyboardSectionRef = ref<HTMLElement>()
const resultSectionRef = ref<HTMLElement>()
const sectionRefs: Record<TabKey, typeof assetsSectionRef> = {
  assets: assetsSectionRef,
  storyboard: storyboardSectionRef,
  export: resultSectionRef,
}
let suppressScrollSpy = false

/** 用 getBoundingClientRect 计算区块相对滚动容器的位置，不依赖 CSS 定位上下文的 offsetTop */
function sectionTopWithin(el: HTMLElement, wrap: HTMLElement): number {
  return el.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop
}

function scrollToSection(key: TabKey) {
  const el = sectionRefs[key].value
  const wrap = (scrollbarRef.value as any)?.wrapRef as HTMLElement | undefined
  if (!el || !wrap) return
  suppressScrollSpy = true
  activeTab.value = key
  wrap.scrollTo({ top: sectionTopWithin(el, wrap), behavior: 'smooth' })
  window.setTimeout(() => { suppressScrollSpy = false }, 600)
}

function handleScroll({ scrollTop }: { scrollTop: number; scrollLeft: number }) {
  if (suppressScrollSpy) return
  const wrap = (scrollbarRef.value as any)?.wrapRef as HTMLElement | undefined
  if (!wrap) return
  const threshold = scrollTop + 48
  let current: TabKey = 'assets'
  ;(Object.keys(sectionRefs) as TabKey[]).forEach((key) => {
    const el = sectionRefs[key].value
    if (el && sectionTopWithin(el, wrap) <= threshold) current = key
  })
  activeTab.value = current
}

// ─── 生成结果：多次合成历史 ─────────────────────────────────
const selectedHistoryId = ref<string>()
const selectedHistory = computed(() => {
  const history = project.value?.composeHistory ?? []
  if (history.length) {
    return history.find((item) => item.id === selectedHistoryId.value) ?? history[0]
  }
  if (project.value?.finalVideoUrl) {
    return {
      id: 'current',
      videoUrl: project.value.finalVideoUrl,
      coverUrl: project.value.finalVideoCoverUrl,
      status: project.value.finalVideoStatus,
      durationSec: totalDurationSec.value,
      shotCount: totalShots.value,
      createdAt: project.value.updatedAt,
    }
  }
  return undefined
})
watch(() => project.value?.composeHistory, (history) => {
  if (!history?.some((item) => item.id === selectedHistoryId.value)) selectedHistoryId.value = history?.[0]?.id
})
function formatHistoryDate(date: string): string {
  return dayjs(date).format('MM-DD HH:mm')
}

const projectStatusLabel = computed(() => {
  const map: Record<string, string> = { draft: '编辑中', composing: '合成中', done: '已完成', failed: '合成失败' }
  return project.value ? map[project.value.status] ?? project.value.status : ''
})

// ─── 分镜维度统计：驱动头部进度条 / 分段导航角标 / 成片流程清单 ──
const totalShots = computed(() => project.value?.shots.length ?? 0)
const assetCount = computed(() => project.value?.assets.length ?? 0)
const hasGeneratedAssets = computed(() =>
  project.value?.assets.some((asset) => asset.kind === 'image' && asset.source === 'generated') ?? false,
)
const batchImageCandidates = computed(() =>
  (project.value?.assets ?? []).filter(
    (asset) => asset.kind === 'image' && asset.source === 'generated' && !!asset.prompt.trim(),
  ),
)
const allAssetsSelected = computed(() =>
  batchImageCandidates.value.length > 0
  && batchImageCandidates.value.every((asset) => selectedAssetIds.value.includes(asset.id)),
)
const allShotsSelected = computed(() =>
  totalShots.value > 0 && selectedShotIds.value.length === totalShots.value,
)
/** 按类型汇总，让用户一眼看清素材库里各准备了什么 */
const assetSummary = computed(() => {
  const assets = project.value?.assets ?? []
  if (!assets.length) return '暂无素材'
  const parts = (Object.keys(ASSET_KIND_META) as AssetKind[])
    .map((kind) => ({ label: ASSET_KIND_META[kind].label, count: assets.filter((a) => a.kind === kind).length }))
    .filter((item) => item.count)
    .map((item) => `${item.label} ${item.count}`)
  return `共 ${assets.length} 个素材（${parts.join(' · ')}）`
})
const videosDone = computed(() =>
  project.value?.shots.filter((shot) => shot.videoStatus === 'success' && !!shot.videoUrl).length ?? 0,
)
const allVideosReady = computed(() => totalShots.value > 0 && videosDone.value === totalShots.value)
const totalDurationSec = computed(() => project.value?.shots.reduce((sum, s) => sum + (s.durationSec || 0), 0) ?? 0)
const generationMode = computed<GenerationMode>(() => project.value?.generationMode ?? 'continuous')
const hasPendingShots = computed(() =>
  project.value?.shots.some((s) => s.videoStatus === 'queued' || s.videoStatus === 'generating') ?? false,
)
const hasPendingBoardImages = computed(() =>
  project.value?.assets.some((item) => item.status === 'queued' || item.status === 'generating') ?? false,
)
const isComposing = computed(() =>
  project.value?.status === 'composing'
  || project.value?.finalVideoStatus === 'queued'
  || project.value?.finalVideoStatus === 'generating',
)
const workbenchLocked = computed(() =>
  props.readonly || hasPendingShots.value || hasPendingBoardImages.value || isComposing.value,
)
const canSortShots = computed(() =>
  !props.readonly && !workbenchLocked.value && !selectingShots.value && totalShots.value > 1,
)
const overallProgress = computed(() => {
  if (!totalShots.value) return 0
  const progress = project.value?.shots.reduce((sum, shot) => {
    if (shot.videoStatus === 'success' && shot.videoUrl) return sum + 1
    if (shot.videoStatus === 'generating') {
      return sum + (typeof shot.videoProgress === 'number' ? shot.videoProgress : 0.5)
    }
    if (shot.videoStatus === 'queued') return sum + 0.15
    return sum
  }, 0) ?? 0
  return Math.round((progress / totalShots.value) * 100)
})

const pipelineSteps = computed(() => [
  {
    label: '准备并锁定素材',
    hint: `${project.value?.assets.filter((asset) => asset.status === 'success').length ?? 0}/${assetCount.value}`,
    done: assetCount.value === 0 || project.value?.assets.every((asset) => asset.status === 'success'),
  },
  { label: '生成分镜视频', hint: `${videosDone.value}/${totalShots.value}`, done: totalShots.value > 0 && videosDone.value === totalShots.value },
  { label: '合成完整视频', hint: project.value?.finalVideoStatus === 'success' ? '已完成' : '待合成', done: project.value?.finalVideoStatus === 'success' },
])

const tabs = computed(() => [
  { key: 'assets' as const, label: '素材库', icon: Collection, count: assetCount.value },
  { key: 'storyboard' as const, label: '分镜脚本', icon: Film, count: totalShots.value },
  { key: 'export' as const, label: '成片合成', icon: VideoCamera, count: undefined },
])
/** 进度条完成 = 全部分镜视频生成成功，此时"生成示例""生成经验"按钮才可点击 */
const progressComplete = computed(() => totalShots.value > 0 && overallProgress.value === 100)

async function loadProject(silent = false) {
  if (!props.projectId) return
  const sequence = ++loadSequence
  const projectId = props.projectId
  try {
    const loaded = await getVideoProject(projectId)
    if (sequence === loadSequence && projectId === props.projectId) ingestServerProject(loaded)
  } catch {
    if (!silent) ElMessage.error('加载视频项目失败')
  }
}

function applyServerProject(updated: VideoProject): VideoProject | undefined {
  const prev = project.value
  const merged = mergeServerProject(prev, updated, {
    shotIds: dirtyShotIds,
    assetIds: dirtyBoardRefIds,
  })
  project.value = merged
  emit('project-updated', merged)
  return prev
}

function ingestServerProject(updated: VideoProject) {
  lastServerAt = Date.now()
  const prev = applyServerProject(updated)
  armStaleCheck()
  if (!prev || prev.id !== updated.id) return
  notifyProjectJobFailures(prev, updated)
  if (updated.finalVideoStatus === 'success' && prev.finalVideoStatus !== 'success') {
    ElMessage.success('视频合成完成')
    selectedHistoryId.value = undefined
    nextTick(() => scrollToSection('export'))
  }
}

function isBusyStatus(status?: string | null) {
  return status === 'queued' || status === 'generating' || status === 'composing'
}

/** 异步任务失败时 HTTP 仍可能是 200，拦截器不会弹；统一在这里提示。 */
function notifyJobError(message: string) {
  ElMessage.error({
    message,
    duration: 8000,
    showClose: true,
    grouping: true,
  })
}

/** 进行中失败，或新一轮任务在本地还没看到 queued 时就已经失败 */
function jobJustFailed(oldStatus?: string | null, newStatus?: string | null, sameJob = true) {
  if (newStatus !== 'failed') return false
  if (isBusyStatus(oldStatus)) return true
  return !sameJob
}

function notifyProjectJobFailures(prev: VideoProject | undefined, updated: VideoProject) {
  if (!prev) return
  for (const shot of updated.shots) {
    const old = prev.shots.find((item) => item.id === shot.id)
    if (!old) continue
    if (jobJustFailed(old.videoStatus, shot.videoStatus, (old.activeTakeId ?? '') === (shot.activeTakeId ?? ''))) {
      notifyJobError(`分镜 ${shot.index + 1} 视频失败：${shot.videoError || '未知错误'}`)
    }
  }
  for (const ref of updated.assets) {
    const old = prev.assets.find((item) => item.id === ref.id)
    if (!old) continue
    if (jobJustFailed(old.status, ref.status, (old.epoch ?? 0) === (ref.epoch ?? 0))) {
      notifyJobError(`${ref.name} 参考图失败：${ref.error || '未知错误'}`)
    }
  }
  if (jobJustFailed(
    prev.finalVideoStatus,
    updated.finalVideoStatus,
    (prev.composeToken ?? '') === (updated.composeToken ?? ''),
  )) {
    notifyJobError(`视频合成失败：${updated.finalVideoError || '未知错误'}`)
  }
}

function applyServerShot(updated: Shot) {
  if (!project.value) return
  const idx = project.value.shots.findIndex((item) => item.id === updated.id)
  if (idx === -1) return
  const shots = project.value.shots.slice()
  shots[idx] = mergeServerShot(shots[idx], updated, dirtyShotIds.has(updated.id))
  project.value = { ...project.value, shots }
  emit('project-updated', project.value)
}

function projectStillBusy() {
  return !props.readonly && !!project.value && isProjectBusy(project.value)
}

/** 任务还在跑时，等到「距上次快照满 8 秒」再看要不要补拉。推送来了会把这次等待取消重排 */
function armStaleCheck() {
  window.clearTimeout(staleTimer)
  staleTimer = undefined
  if (!projectStillBusy()) return
  const elapsed = Date.now() - lastServerAt
  const wait = elapsed >= PUSH_STALE_MS ? PUSH_STALE_MS : PUSH_STALE_MS - elapsed
  staleTimer = window.setTimeout(() => { void pullIfStale() }, wait)
}

async function pullIfStale() {
  if (!projectStillBusy()) return
  const stale = Date.now() - lastServerAt >= PUSH_STALE_MS
  const down = !isVideoSocketConnected()
  if (document.visibilityState === 'visible' && (stale || down)) requestCatchUp()
  else armStaleCheck()
}

/** 页面切回、连接断开，或推送停了太久：补拉一次。已经有一次在飞就不再叠 */
function requestCatchUp() {
  if (document.visibilityState !== 'visible' || stalePulling || !projectStillBusy()) return
  stalePulling = true
  void loadProject(true).finally(() => {
    stalePulling = false
    armStaleCheck()
  })
}

function onWorkbenchVisible() {
  if (document.visibilityState !== 'visible') return
  requestCatchUp()
}

function onSocketDisconnect() {
  requestCatchUp()
}

function connectRealtime() {
  if (!props.projectId) return
  unsubscribe?.()
  unsubscribe = subscribeVideoProject(props.projectId, ingestServerProject, onSocketDisconnect)
}

onMounted(async () => {
  loading.value = true
  if (props.readonly) {
    if (props.previewProject) project.value = props.previewProject
    await loadMediaModels()
    loading.value = false
    return
  }
  await Promise.all([loadProject(), loadMediaModels()])
  await loadShareReward()
  loading.value = false
  connectRealtime()
  armStaleCheck()
  document.addEventListener('visibilitychange', onWorkbenchVisible)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onWorkbenchVisible)
  window.clearTimeout(staleTimer)
  unsubscribe?.()
})

watch(() => (projectStillBusy() ? props.projectId : ''), armStaleCheck)

watch(() => props.previewProject, (next) => {
  if (props.readonly && next) project.value = next
})

watch(() => props.projectId, async (projectId) => {
  if (props.readonly || !projectId) return
  window.clearTimeout(staleTimer)
  staleTimer = undefined
  lastServerAt = 0
  unsubscribe?.()
  unsubscribe = undefined
  dirtyShotIds.clear()
  dirtyBoardRefIds.clear()
  shotSaveRevisions.clear()
  shotSavePromises.clear()
  boardSaveRevisions.clear()
  boardSavePromises.clear()
  activeTab.value = 'assets'
  selectedHistoryId.value = undefined
  editingTitle.value = false
  const wrap = (scrollbarRef.value as any)?.wrapRef as HTMLElement | undefined
  wrap?.scrollTo({ top: 0 })
  loading.value = true
  shareReward.value = null
  await loadProject()
  if (projectId !== props.projectId) return
  await loadShareReward()
  loading.value = false
  if (!unsubscribe) connectRealtime()
})

/**
 * @ 引用选项：素材库三类素材 + 分镜视频；编辑素材时排除自身，避免自引用。
 * 图片素材的提示词只能引用图片素材（includeShots=false 时也只保留图片）。
 */
function mentionOptions(self?: MediaAsset, currentShot?: Shot, includeShots = true): MentionOption[] {
  const assets = (project.value?.assets ?? [])
    .filter((asset) => asset.id !== self?.id && asset.name?.trim())
    .filter((asset) => includeShots || asset.kind === 'image' || asset.kind === 'text')
    .map((asset) => ({
      name: asset.name.trim(),
      type: asset.kind,
      url: asset.kind === 'text' ? undefined : asset.url,
      text: asset.text,
      durationSec: asset.durationSec,
    }))
  // 分镜视频：已成功的可直接引用；未生成的也列出，便于顺序生成时先写好 @
  const shotVideos = includeShots
    ? (project.value?.shots ?? [])
      .filter((shot) => shot.id !== currentShot?.id && shot.name?.trim())
      .map((shot) => ({
        name: shot.name.trim(),
        type: 'shot' as const,
        url: shot.videoStatus === 'success' ? (shot.videoUrl ?? undefined) : undefined,
        durationSec: shot.durationSec,
      }))
    : []
  return [...assets, ...shotVideos]
}


const assetPickerVisible = ref(false)

/** 从「我的资产」引入：与本地上传走同一套校验，逐个引入，单个失败不影响其余 */
async function handleImportAssets(assets: UserAsset[]) {
  let ok = 0
  for (const asset of assets) {
    try {
      applyServerProject(await importAsset(requireProjectId(), { url: asset.url!, name: asset.name }))
      ok += 1
    } catch {
      // 格式/时长不符的原因已由 request 拦截器提示
    }
  }
  if (ok) ElMessage.success(`已引入 ${ok} 个素材`)
}

async function handleUploadLocalRef(file: File): Promise<{ name: string }> {
  const before = new Set(project.value?.assets.map((asset) => asset.id) ?? [])
  const updated = await uploadLocalRef(requireProjectId(), file)
  applyServerProject(updated)
  const uploaded = updated.assets.find((asset) => !before.has(asset.id))
  if (!uploaded) throw new Error('上传素材创建失败')
  return uploaded
}

async function handleAssetFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  assetUploading.value = true
  assetUploadTotal.value = files.length
  assetUploadIndex.value = 0
  let ok = 0
  let fail = 0
  try {
    for (const file of files) {
      assetUploadIndex.value += 1
      try {
        await handleUploadLocalRef(file)
        ok += 1
      } catch {
        fail += 1
      }
    }
    if (files.length > 1) {
      if (ok && !fail) ElMessage.success(`已上传 ${ok} 个素材`)
      else if (ok && fail) ElMessage.warning(`成功 ${ok} 个，失败 ${fail} 个`)
    }
  } finally {
    assetUploading.value = false
    assetUploadTotal.value = 0
    assetUploadIndex.value = 0
  }
}

/** 本地上传素材点击"替换文件"：保持名称/提示词/@ 引用不变，仅替换素材文件本身 */
async function handleReplaceAssetFile(item: MediaAsset, file: File): Promise<void> {
  try {
    applyServerProject(await replaceAssetFile(requireProjectId(), item.id, file))
    ElMessage.success(`${ASSET_KIND_META[item.kind].label}已替换`)
  } catch {
    // 错误已由 request 拦截器统一提示
  }
}

// ─── 生成示例 / 生成经验（进度条完成后可用） ─────────────────
async function startEditTitle() {
  if (props.readonly || !project.value) return
  titleIgnoreBlur = false
  titleDraft.value = project.value.title
  editingTitle.value = true
  await nextTick()
  titleInputRef.value?.focus?.()
  titleInputRef.value?.input?.select()
}

function cancelEditTitle() {
  titleIgnoreBlur = true
  editingTitle.value = false
}

async function commitTitle() {
  if (titleIgnoreBlur) {
    titleIgnoreBlur = false
    return
  }
  if (!props.projectId || !project.value || !editingTitle.value) return
  const next = titleDraft.value.trim()
  editingTitle.value = false
  if (!next || next === project.value.title) return
  try {
    applyServerProject(await updateVideoProjectTitle(props.projectId, next))
  } catch {
    // 错误已由 request 拦截器统一提示
  }
}

async function loadShareReward() {
  const exampleId = project.value?.exampleId
  if (!exampleId) {
    shareReward.value = null
    return
  }
  try {
    shareReward.value = await getShareReward(exampleId)
  } catch {
    // 进度加载失败时仍显示奖励规则，不打断制作
  }
}

async function handleGenerateExample() {
  if (!props.projectId || !project.value || exampleLoading.value) return
  if (project.value.finalVideoStatus !== 'success') {
    ElMessage.warning('请先合成完整视频后再生成示例')
    return
  }
  const isUpdate = !!project.value.exampleId
  exampleLoading.value = true
  try {
    const example = await createExample(props.projectId)
    project.value.exampleId = example.id
    void loadShareReward()
    ElMessage.success(isUpdate ? `示例已更新。${SHARE_REWARD_BRIEF}` : `已保存为示例。${SHARE_REWARD_BRIEF}`)
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    exampleLoading.value = false
  }
}

async function handleGenerateExperience() {
  if (!project.value) return
  experienceLoading.value = true
  try {
    const { markdown } = await generateExperience(requireProjectId())
    downloadTextFile(`${project.value.title || '视频制作经验'}.md`, markdown)
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    experienceLoading.value = false
  }
}

// ─── 素材库 ────────────────────────────────────────────────
async function handleAddAsset() {
  if (workbenchLocked.value) return
  try {
    applyServerProject(await addAsset(requireProjectId(), {}))
  } catch {
    ElMessage.error('新建图片素材失败')
  }
}

async function handleAddTextAsset() {
  if (workbenchLocked.value) return
  try {
    applyServerProject(await addAsset(requireProjectId(), { kind: 'text' }))
  } catch {
    ElMessage.error('新建文本素材失败')
  }
}

async function handleReorderAssets(assetIds: string[]) {
  if (!project.value || workbenchLocked.value) return
  const prev = project.value.assets
  const byId = new Map(prev.map((asset) => [asset.id, asset]))
  project.value.assets = assetIds.map((id) => byId.get(id)!).filter(Boolean)
  try {
    applyServerProject(await reorderAssets(requireProjectId(), assetIds))
  } catch {
    project.value.assets = prev
  }
}

async function handleDeleteAsset(item: MediaAsset) {
  if (workbenchLocked.value || item.status === 'queued' || item.status === 'generating') return
  try {
    await ElMessageBox.confirm(
      `确定删除「${item.name}」吗？提示词中对该名称的 @ 引用会一并清除。`,
      `删除${ASSET_KIND_META[item.kind].label}素材`,
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    dirtyBoardRefIds.delete(item.id)
    boardSaveRevisions.delete(item.id)
    boardSavePromises.delete(item.id)
    applyServerProject(await deleteAsset(requireProjectId(), item.id))
  } catch {
    ElMessage.error('删除素材失败')
  }
}

function handleUpdateAsset(item: MediaAsset): Promise<boolean> {
  if (!validateReferenceName(item.name)) return Promise.resolve(false)
  if (textGenerating.has(item.id)) return Promise.resolve(true)
  const snapshot = {
    name: item.name.trim(),
    prompt: item.prompt,
    text: item.text ?? '',
    modelId: item.modelId,
    lora: item.lora,
    ratio: item.ratio,
    resolution: item.resolution,
    outputFormat: item.outputFormat,
    promptOptimizeMode: item.promptOptimizeMode,
  }
  const projectId = requireProjectId()
  const revision = (boardSaveRevisions.get(item.id) ?? 0) + 1
  boardSaveRevisions.set(item.id, revision)
  const save = () => updateAsset(projectId, item.id, snapshot)
    .then((updated) => {
      if (boardSaveRevisions.get(item.id) !== revision) return true
      const current = project.value?.assets.find((ref) => ref.id === item.id)
      if (
        current?.name.trim() === snapshot.name
        && current.prompt === snapshot.prompt
        && (current.text ?? '') === snapshot.text
        && current.modelId === snapshot.modelId
        && loraEquals(current.lora, snapshot.lora)
        && (current.ratio ?? snapshot.ratio) === snapshot.ratio
        && (current.resolution ?? snapshot.resolution) === snapshot.resolution
        && (current.outputFormat ?? snapshot.outputFormat) === snapshot.outputFormat
        && (current.promptOptimizeMode ?? snapshot.promptOptimizeMode) === snapshot.promptOptimizeMode
      ) {
        dirtyBoardRefIds.delete(item.id)
        applyServerProject(updated)
      }
      return true
    })
    .catch(() => {
      if (boardSaveRevisions.get(item.id) === revision) ElMessage.error('保存信息失败')
      return false
    })
    .finally(() => {
      if (boardSavePromises.get(item.id) === promise) boardSavePromises.delete(item.id)
    })
  const promise = boardSaveQueue.then(save, save)
  boardSaveQueue = promise.then(() => undefined)
  boardSavePromises.set(item.id, promise)
  return promise
}

function markBoardDirty(id: string) {
  dirtyBoardRefIds.add(id)
}

async function flushDirtyBoardRefs(): Promise<boolean> {
  const refs = project.value?.assets.filter((item) => dirtyBoardRefIds.has(item.id)) ?? []
  const saves = refs.map(handleUpdateAsset)
  const results = await Promise.all([...saves, ...boardSavePromises.values()])
  return results.every(Boolean) && dirtyBoardRefIds.size === 0
}

async function handleGenerateAssetImage(refId: string) {
  const asset = project.value?.assets.find((item) => item.id === refId)
  if (!asset?.prompt.trim()) {
    ElMessage.warning(asset?.kind === 'text' ? '请先填写生成要求' : '请先填写特征提示词')
    return
  }
  if (!(await flushDirtyBoardRefs())) return
  const generatingText = asset.kind === 'text'
  if (generatingText) textGenerating.add(refId)
  try {
    if (generatingText) asset.status = 'generating'
    const updated = generatingText
      ? await generateAssetText(requireProjectId(), refId)
      : await generateAssetImage(requireProjectId(), refId)
    ingestServerProject(updated)
  } catch {
    if (generatingText) void loadProject(true)
    // HTTP 错误由请求拦截器提示；异步任务失败见 notifyProjectJobFailures
  } finally {
    textGenerating.delete(refId)
  }
}

function isBatchImageAsset(asset: MediaAsset) {
  return asset.kind === 'image' && asset.source === 'generated' && !!asset.prompt.trim()
}

function enterAssetSelect() {
  if (workbenchLocked.value) return
  if (!batchImageCandidates.value.length) {
    ElMessage.warning('请先为图片素材填写特征提示词')
    return
  }
  selectingShots.value = false
  selectedShotIds.value = []
  selectingAssets.value = true
  selectedAssetIds.value = []
}

function exitAssetSelect() {
  selectingAssets.value = false
  selectedAssetIds.value = []
}

function toggleAssetSelect(id: string) {
  const asset = project.value?.assets.find((item) => item.id === id)
  if (!asset || !isBatchImageAsset(asset)) return
  selectedAssetIds.value = selectedAssetIds.value.includes(id)
    ? selectedAssetIds.value.filter((item) => item !== id)
    : [...selectedAssetIds.value, id]
}

function toggleSelectAllAssets() {
  selectedAssetIds.value = allAssetsSelected.value ? [] : batchImageCandidates.value.map((asset) => asset.id)
}

function validateSelectedAssetDeps(ids: string[]): boolean {
  if (!project.value) return false
  const selected = new Set(ids)
  const byName = new Map(project.value.assets.map((asset) => [asset.name, asset]))
  for (const asset of project.value.assets) {
    if (!selected.has(asset.id)) continue
    const names = [...asset.prompt.matchAll(MENTION_PATTERN)].map((match) => match[1])
    for (const name of [...new Set(names)]) {
      const dependency = byName.get(name)
      if (!dependency) continue
      if (selected.has(dependency.id)) continue
      if (dependency.kind === 'text') {
        if (dependency.text?.trim()) continue
        ElMessage.warning(`「${asset.name}」引用的文本「${dependency.name}」还没有内容`)
        return false
      }
      if (dependency.status === 'success' && dependency.url) continue
      ElMessage.warning(`「${asset.name}」引用了未勾选且未就绪的「${dependency.name}」，请一并勾选`)
      return false
    }
  }
  return true
}

async function confirmBatchImages() {
  if (!props.projectId || !selectedAssetIds.value.length) {
    ElMessage.warning('请先勾选要生成的图片素材')
    return
  }
  if (!validateSelectedAssetDeps(selectedAssetIds.value)) return
  if (!(await flushDirtyBoardRefs())) return
  batchBoardLoading.value = true
  try {
    const updated = await generateAllAssetImages(props.projectId, selectedAssetIds.value)
    ingestServerProject(updated)
    exitAssetSelect()
  } catch {
    // HTTP 错误由请求拦截器提示；异步任务失败见 notifyProjectJobFailures
  } finally {
    batchBoardLoading.value = false
  }
}

async function handleCancelBoardImages() {
  if (!props.projectId || cancelBoardLoading.value || !hasPendingBoardImages.value) return
  cancelBoardLoading.value = true
  try {
    const updated = await cancelQueuedAssetImages(props.projectId)
    ingestServerProject(updated)
    ElMessage.success('已中断，费用会退回')
  } catch {
    // HTTP 错误由请求拦截器提示
  } finally {
    cancelBoardLoading.value = false
  }
}

// ─── 分镜文字编辑 ───────────────────────────────────────────
function saveShot(shot: Shot): Promise<boolean> {
  if (isComposing.value || !validateReferenceName(shot.name)) return Promise.resolve(false)
  const snapshot = {
    name: shot.name.trim(),
    videoPrompt: shot.videoPrompt,
    durationSec: clampMediaDuration(shot.durationSec, videoModels.value, shot.modelId),
    ratio: clampMediaRatio(shot.ratio, videoModels.value, shot.modelId),
    resolution: clampMediaResolution(shot.resolution, videoModels.value, shot.modelId),
    modelId: shot.modelId ?? undefined,
    lora: shot.lora,
  }
  const revision = (shotSaveRevisions.get(shot.id) ?? 0) + 1
  shotSaveRevisions.set(shot.id, revision)
  const promise = updateShot(requireProjectId(), shot.id, snapshot)
    .then((updated) => {
      if (shotSaveRevisions.get(shot.id) !== revision) return true
      const local = project.value?.shots.find((item) => item.id === shot.id)
      const unchanged = !!local
        && local.name.trim() === snapshot.name
        && local.videoPrompt === snapshot.videoPrompt
        && Math.round(local.durationSec) === snapshot.durationSec
        && (local.ratio ?? snapshot.ratio) === snapshot.ratio
        && (local.resolution ?? snapshot.resolution) === snapshot.resolution
        && (local.modelId ?? undefined) === snapshot.modelId
        && loraEquals(local.lora, snapshot.lora)
      if (unchanged) {
        dirtyShotIds.delete(shot.id)
        applyServerShot(updated)
      }
      return true
    })
    .catch(() => {
      if (shotSaveRevisions.get(shot.id) === revision) ElMessage.error('保存分镜失败')
      return false
    })
    .finally(() => {
      if (shotSavePromises.get(shot.id) === promise) shotSavePromises.delete(shot.id)
    })
  shotSavePromises.set(shot.id, promise)
  return promise
}

async function flushDirtyShots(): Promise<boolean> {
  const dirtyShots = project.value?.shots.filter((shot) => dirtyShotIds.has(shot.id)) ?? []
  const saves = dirtyShots.map((shot) => saveShot(shot))
  const pending = [...shotSavePromises.values()]
  const results = await Promise.all([...saves, ...pending])
  return results.every(Boolean) && dirtyShotIds.size === 0
}

function validateReferenceName(value: string): boolean {
  const name = value.trim()
  if (name && !/[\s,，。!！?？、@：:；;（）()【】\[\]“”"'‘’]/.test(name)) return true
  ElMessage.warning('名称不能为空，且不能包含空格、@ 或句读标点')
  return false
}

async function handleAddShot() {
  if (workbenchLocked.value) return
  try {
    applyServerProject(await addShot(requireProjectId(), {
      videoPrompt: '',
      durationSec: mediaDurationRange(videoModels.value).max,
    }))
  } catch {
    ElMessage.error('增加分镜失败')
  }
}

async function handleReorderShots(shotIds: string[]) {
  if (!project.value || workbenchLocked.value) return
  const prev = project.value.shots
  const prevIndex = prev.map((shot) => shot.index)
  const byId = new Map(prev.map((shot) => [shot.id, shot]))
  project.value.shots = shotIds.map((id, index) => {
    const shot = byId.get(id)!
    shot.index = index
    return shot
  }).filter(Boolean)
  try {
    applyServerProject(await reorderShots(requireProjectId(), shotIds))
  } catch {
    prev.forEach((shot, index) => { shot.index = prevIndex[index] })
    project.value.shots = prev
  }
}

useSortableList(shotGridRef, {
  disabled: computed(() => !canSortShots.value),
  onReorder: handleReorderShots,
})

async function handleDeleteShot(shot: Shot) {
  if (isComposing.value || shot.videoStatus === 'queued' || shot.videoStatus === 'generating') return
  try {
    await ElMessageBox.confirm(`确定将「${shot.name}」从时间线移除吗？已生成的历史版本仍会保留。`, '移除分镜', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消',
    })
    applyServerProject(await deleteShot(requireProjectId(), shot.id))
  } catch {
    // 用户取消确认时无需提示。
  }
}

async function handleSelectTake(shotId: string, takeId: string) {
  if (props.readonly) {
    const shot = project.value?.shots.find((item) => item.id === shotId)
    const take = shot?.takes.find((item) => item.id === takeId)
    if (!shot || !take) return
    shot.activeTakeId = takeId
    if (take.videoUrl) {
      shot.videoUrl = take.videoUrl
      shot.videoStatus = take.status
    }
    return
  }
  if (!props.projectId) return
  try {
    applyServerShot(await selectShotTake(props.projectId, shotId, takeId))
  } catch {
    ElMessage.error('切换视频版本失败')
  }
}

const MENTION_PATTERN = /@([^\s,，。!！?？、@：:；;（）()【】\[\]“”"'‘’]+)/g

/**
 * 提交前的本地预检，与后端 assertReferenceLimits 保持同一套规则，
 * 目的是在不发请求的情况下给出即时反馈；最终仍以后端校验为准。
 */
function validateShotReferences(
  shot: Shot,
  mode: GenerationMode,
  isBatch = false,
  selectedIds?: Set<string>,
): boolean {
  const names = [...shot.videoPrompt.matchAll(MENTION_PATTERN)].map((match) => match[1])
  if (!project.value) return false
  if (!names.length) return true

  const assetByName = new Map(project.value.assets.map((item) => [item.name, item]))
  const otherShots = project.value.shots.filter((item) => item.id !== shot.id)
  const shotReadyByName = new Map(
    otherShots.map((item) => [item.name, item.videoStatus === 'success' && !!item.videoUrl]),
  )
  const invalid = names.filter((name) => !assetByName.has(name) && !shotReadyByName.has(name))
  if (invalid.length) {
    ElMessage.warning(`「${shot.name}」包含无效引用：${[...new Set(invalid)].map((name) => `@${name}`).join('、')}`)
    return false
  }

  const uniqueNames = [...new Set(names)]
  const shotMentions = uniqueNames.filter((name) => shotReadyByName.has(name))
  // 分镜视频与素材库的视频素材都占用参考视频通道
  const emptyText = uniqueNames.filter((name) => {
    const asset = assetByName.get(name)
    return asset?.kind === 'text' && !asset.text?.trim()
  })
  if (emptyText.length) {
    ElMessage.warning(`「${shot.name}」引用的文本还没有内容：${emptyText.map((name) => `@${name}`).join('、')}`)
    return false
  }
  const refsByKind: Record<'image' | 'video' | 'audio', MediaAsset[]> = { image: [], video: [], audio: [] }
  uniqueNames.forEach((name) => {
    const asset = assetByName.get(name)
    if (!asset || asset.kind === 'text') return
    refsByKind[asset.kind].push(asset)
  })

  const model = resolveMediaModel(videoModels.value, shot.modelId)
  if (model) {
    const counts: Record<'image' | 'video' | 'audio', number> = {
      image: refsByKind.image.length,
      video: refsByKind.video.length + shotMentions.length,
      audio: refsByKind.audio.length,
    }
    const rules: { kind: 'image' | 'video' | 'audio'; unit: string; max: number }[] = [
      { kind: 'image', unit: '张', max: model.maxReferenceImages },
      { kind: 'video', unit: '段', max: model.maxReferenceVideos },
      { kind: 'audio', unit: '段', max: model.maxReferenceAudios },
    ]
    for (const rule of rules) {
      const label = `参考${ASSET_KIND_META[rule.kind].label}`
      if (!counts[rule.kind]) continue
      if (rule.max <= 0) {
        ElMessage.warning(`「${shot.name}」所用模型「${model.name}」不支持${label}，请去掉对应的 @ 引用，或换用支持的模型`)
        return false
      }
      if (counts[rule.kind] > rule.max) {
        ElMessage.warning(`「${shot.name}」所用模型「${model.name}」最多支持 ${rule.max} ${rule.unit}${label}，当前引用了 ${counts[rule.kind]} ${rule.unit}`)
        return false
      }
    }
    const totalFiles = counts.image + counts.video + counts.audio
    if (model.maxReferenceFiles && totalFiles > model.maxReferenceFiles) {
      ElMessage.warning(`「${shot.name}」所用模型「${model.name}」的参考素材合计不能超过 ${model.maxReferenceFiles} 个，当前引用了 ${totalFiles} 个`)
      return false
    }
    // 已知时长的素材先行校验；分镜视频时长以其目标时长估算
    for (const kind of ['video', 'audio'] as const) {
      const maxDurationSec = model.maxReferenceDurationSec ?? REFERENCE_TOTAL_SEC
      const fromAssets = refsByKind[kind].reduce((sum, asset) => sum + (asset.durationSec ?? maxDurationSec), 0)
      const fromShots = kind === 'video'
        ? shotMentions.reduce((sum, name) => sum + (otherShots.find((item) => item.name === name)?.durationSec ?? 0), 0)
        : 0
      const total = fromAssets + fromShots
      if (total > maxDurationSec) {
        ElMessage.warning(`「${shot.name}」所用模型「${model.name}」的参考${ASSET_KIND_META[kind].label}总时长不能超过 ${maxDurationSec} 秒，当前约 ${total.toFixed(1)} 秒`)
        return false
      }
    }
  }

  if (isBatch && mode === 'parallel' && shotMentions.length) {
    ElMessage.warning('提示词中含有 @分镜，请用「顺序生成」；若要并行，请先删掉各镜中的分镜视频引用')
    return false
  }
  if (isBatch && mode === 'continuous') {
    const futureVideos = shotMentions.filter((name) => {
      const referencedShot = otherShots.find((item) => item.name === name)
      return !referencedShot || referencedShot.index >= shot.index
    })
    if (futureVideos.length) {
      ElMessage.warning(`顺序生成只能引用排在当前分镜之前的视频：${futureVideos.map((name) => `@${name}`).join('、')}`)
      return false
    }
  }

  // 文本素材没有文件地址，正文非空即可引用；图片/视频/音频仍要等生成或上传成功
  const pendingAssets = uniqueNames.filter((name) => {
    const asset = assetByName.get(name)
    if (!asset || asset.kind === 'text') return false
    return !(asset.status === 'success' && asset.url)
  })
  if (pendingAssets.length) {
    ElMessage.warning(`「${shot.name}」的素材引用尚未就绪：${pendingAssets.map((name) => `@${name}`).join('、')}`)
    return false
  }

  const pendingVideos = shotMentions.filter((name) => shotReadyByName.get(name) === false)
  if (!pendingVideos.length) return true
  const refs = pendingVideos.map((name) => `@${name}`).join('、')
  if (mode === 'parallel') {
    ElMessage.warning(`并行生成不能使用尚未生成的视频引用：${refs}`)
    return false
  }
  if (isBatch) {
    const sequentialRefs = pendingVideos.every((name) => {
      const referencedShot = otherShots.find((item) => item.name === name)
      return referencedShot !== undefined
        && referencedShot.index < shot.index
        && (!selectedIds || selectedIds.has(referencedShot.id))
    })
    if (sequentialRefs) return true
  }
  ElMessage.warning(`「${shot.name}」的视频引用尚未就绪：${refs}`)
  return false
}

// ─── 视频生成 ───────────────────────────────────────────────
async function handleGenerateShotVideo(shotId: string) {
  if (!(await flushDirtyBoardRefs()) || !(await flushDirtyShots())) return
  const shot = project.value?.shots.find((s) => s.id === shotId)
  if (!shot || !validateShotReferences(shot, generationMode.value)) return
  try {
    const updated = await generateShotVideo(requireProjectId(), shotId)
    const prevShot = project.value?.shots.find((item) => item.id === shotId)
    applyServerShot(updated)
    if (jobJustFailed(prevShot?.videoStatus, updated.videoStatus, (prevShot?.activeTakeId ?? '') === (updated.activeTakeId ?? ''))) {
      notifyJobError(`分镜 ${updated.index + 1} 视频失败：${updated.videoError || '未知错误'}`)
    }
  } catch {
    // HTTP 错误由请求拦截器提示；异步任务失败见 notifyJobError
  }
}

function enterShotSelect() {
  if (workbenchLocked.value || !totalShots.value) return
  selectingAssets.value = false
  selectedAssetIds.value = []
  selectingShots.value = true
  selectedShotIds.value = []
}

function exitShotSelect() {
  selectingShots.value = false
  selectedShotIds.value = []
}

watch(workbenchLocked, (locked) => {
  if (!locked) return
  exitAssetSelect()
  exitShotSelect()
})

function toggleShotSelect(id: string) {
  selectedShotIds.value = selectedShotIds.value.includes(id)
    ? selectedShotIds.value.filter((item) => item !== id)
    : [...selectedShotIds.value, id]
}

function toggleSelectAllShots() {
  selectedShotIds.value = allShotsSelected.value
    ? []
    : (project.value?.shots ?? []).map((shot) => shot.id)
}

async function confirmBatchVideos(command: string | number | object) {
  if (command !== 'continuous' && command !== 'parallel') return
  const mode: GenerationMode = command
  if (!props.projectId || !selectedShotIds.value.length) { ElMessage.warning('请先勾选要生成的分镜'); return }
  if (!(await flushDirtyBoardRefs()) || !(await flushDirtyShots())) return
  const selected = new Set(selectedShotIds.value)
  const shots = (project.value?.shots ?? []).filter((shot) => selected.has(shot.id))
  if (!shots.every((shot) => validateShotReferences(shot, mode, true, selected))) return
  batchVideoLoading.value = true
  if (project.value) project.value.generationMode = mode
  try {
    const prevShots = [...(project.value?.shots ?? [])]
    const updatedShots = await generateAllShotVideos(props.projectId, selectedShotIds.value, mode)
    updatedShots.forEach((shot) => {
      const old = prevShots.find((item) => item.id === shot.id)
      applyServerShot(shot)
      if (jobJustFailed(old?.videoStatus, shot.videoStatus, (old?.activeTakeId ?? '') === (shot.activeTakeId ?? ''))) {
        notifyJobError(`分镜 ${shot.index + 1} 视频失败：${shot.videoError || '未知错误'}`)
      }
    })
    exitShotSelect()
  } catch {
    // HTTP 错误由请求拦截器提示；异步任务失败见 notifyJobError
  } finally {
    batchVideoLoading.value = false
  }
}

async function handleCancelShotVideos() {
  if (!props.projectId || cancelVideoLoading.value || !hasPendingShots.value) return
  cancelVideoLoading.value = true
  try {
    const updated = await cancelQueuedShotVideos(props.projectId)
    ingestServerProject(updated)
    ElMessage.success('已中断，费用会退回')
  } catch {
    // HTTP 错误由请求拦截器提示
  } finally {
    cancelVideoLoading.value = false
  }
}

// ─── 合成 ───────────────────────────────────────────────────
async function handleCompose() {
  if (!(await flushDirtyBoardRefs()) || !(await flushDirtyShots())) return
  if (project.value?.finalVideoStatus === 'queued' || project.value?.finalVideoStatus === 'generating') return
  const notReady = project.value?.shots.filter((s) => s.videoStatus !== 'success') ?? []
  if (notReady.length) {
    ElMessage.warning(`还有 ${notReady.length} 个分镜视频未生成成功，无法合成`)
    return
  }
  try {
    const updated = await composeProject(requireProjectId())
    ingestServerProject(updated)
  } catch {
    // HTTP 错误由请求拦截器提示；异步任务失败见 notifyProjectJobFailures
  }
}
</script>

<style scoped>
.workbench { height: 100%; display: flex; flex-direction: column; background: var(--color-bg-secondary); }

/* ─── 头部 ─────────────────────────────────────────────── */
.wb-header {
  display: flex; align-items: center; gap: 16px; padding: 14px 20px; flex-shrink: 0;
  background: linear-gradient(120deg, var(--color-bg-secondary) 0%, #f5f6ff 55%, #f8fbff 100%);
  border-bottom: 1px solid var(--color-border);
}
.close-x {
  width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0;
  border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-card);
  color: var(--color-text-secondary); cursor: pointer; transition: var(--transition);
}
.close-x:hover { color: #e44d4d; border-color: #f3c1c1; background: #fff5f5; }
.chat-dot {
  display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%;
  background: var(--color-primary); vertical-align: middle;
}
.wb-title-block { flex: 1; min-width: 0; }
.wb-title-row { display: flex; align-items: center; gap: 10px; }
.wb-title { font-size: 16px; font-weight: 800; color: var(--color-text-primary); margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-title.is-editable { cursor: text; border-radius: 6px; padding: 2px 6px; margin: -2px -6px; }
.wb-title.is-editable:hover { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
.wb-title-input { flex: 1; min-width: 120px; max-width: 420px; }
.wb-title-input :deep(.el-input__wrapper) {
  padding: 2px 8px; box-shadow: 0 0 0 1px #c4b5fd inset; background: var(--color-card);
  font-size: 16px; font-weight: 800;
}
.wb-title-input :deep(.el-input__inner) { font-weight: 800; color: var(--color-text-primary); }
.wb-requirement { font-size: 12.5px; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 3px 0 0; }
.share-reward { margin: 2px 0 0; font-size: 12px; line-height: 1.5; color: var(--color-primary-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wb-progress { width: 200px; flex-shrink: 0; }
.progress-numbers { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
.progress-numbers strong { font-size: 14px; color: var(--color-primary); font-weight: 800; }
.progress-detail { font-size: 11px; color: var(--color-text-tertiary); white-space: nowrap; }
.progress-track { height: 5px; border-radius: 4px; background: var(--color-bg-secondary); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--color-primary), var(--color-primary)); transition: width .3s ease; }

.wb-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* ─── 分段导航 ─────────────────────────────────────────── */
.wb-tabs { display: flex; gap: 4px; padding: 10px 20px 0; background: var(--color-card); border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.tab-btn {
  display: flex; align-items: center; gap: 6px; padding: 9px 16px; border: none; background: transparent;
  color: var(--color-text-tertiary); font-size: 13.5px; font-weight: 600; cursor: pointer; border-radius: 10px 10px 0 0;
  position: relative; transition: color .15s, background .15s;
}
.tab-btn:hover { color: var(--color-primary-dark); background: var(--color-bg-secondary); }
.tab-btn.active { color: var(--color-primary-dark); background: var(--color-primary-soft); }
.tab-btn.active::after {
  content: ''; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 2px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary)); border-radius: 2px;
}
.tab-count {
  display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: var(--color-primary-soft); color: var(--color-primary); font-size: 11px; font-weight: 700;
}
.tab-btn:not(.active) .tab-count { background: var(--color-bg-secondary); color: var(--color-text-tertiary); }

/* ─── 主体：三大分区各自独立卡片，滚动时区块边界清晰、互不粘连 ─── */
.wb-body { flex: 1; min-height: 0; }
.wb-inner { container-type: inline-size; padding: 24px 20px 44px; width: 100%; min-height: 200px; display: flex; flex-direction: column; gap: 24px; box-sizing: border-box; }
.muted { color: var(--color-text-tertiary); font-weight: 500; font-size: 13px; margin-left: 4px; }

.wb-section {
  display: flex; flex-direction: column; gap: 20px; background: var(--color-card); border-radius: 20px;
  border: 1px solid var(--color-border); box-shadow: 0 2px 10px rgba(31, 35, 60, .04); padding: 24px 26px;
  scroll-margin-top: 16px;
}

.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.section-head-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.section-icon {
  flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center;
  justify-content: center;
}
.section-icon.icon-assets { background: linear-gradient(135deg, var(--color-primary-soft), var(--color-primary-soft)); color: var(--color-primary); }
.section-icon.icon-storyboard { background: linear-gradient(135deg, var(--color-primary-soft), var(--color-info-soft)); color: var(--color-primary); }
.section-icon.icon-result { background: linear-gradient(135deg, var(--color-warning-soft), #fee2e2); color: var(--color-warning); }
.section-title { font-size: 16px; font-weight: 800; color: var(--color-text-primary); margin: 0 0 2px; }
.section-desc { font-size: 12.5px; color: var(--color-text-tertiary); margin: 0; }
.section-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex-shrink: 0; }
.batch-select-count { font-size: 13px; color: var(--color-text-tertiary); }
.batch-select-count strong { color: var(--color-primary); font-weight: 800; }
.section-body { display: flex; flex-direction: column; gap: 18px; padding-top: 4px; border-top: 1px solid var(--color-border); }

.mode-current { margin-left: 8px; font-size: 11px; color: var(--color-primary); }
.shot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 18px; }
.shot-sort-item { min-width: 0; height: 100%; }
.shot-sort-item :deep(.shot-card) { height: 100%; }
.shot-sort-item.is-sortable-ghost { opacity: .4; }
.shot-sort-item.is-sortable-chosen :deep(.shot-card) { box-shadow: 0 12px 28px color-mix(in srgb, var(--color-primary) 16%, transparent); border-color: var(--color-border); }

/* ─── 成片导出 ─────────────────────────────────────────── */
.export-layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr); gap: 24px; align-items: start; }
@container (max-width: 860px) {
  .export-layout { grid-template-columns: 1fr; }
}
.export-stage {
  position: relative; border-radius: 16px; overflow: hidden; background: #14151d; aspect-ratio: 16 / 9;
  display: flex; align-items: center; justify-content: center;
}
.final-video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.export-placeholder { display: flex; flex-direction: column; align-items: center; gap: 10px; color: rgba(255, 255, 255, .4); text-align: center; padding: 0 30px; font-size: 13px; }
.export-error { color: #f5a3a3; max-width: 90%; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.export-status { position: absolute; top: 12px; right: 12px; }

.export-side { display: flex; flex-direction: column; gap: 16px; background: var(--color-bg-secondary); border-radius: 16px; padding: 20px; border: 1px solid var(--color-border); }
.pipeline-list { display: flex; flex-direction: column; gap: 12px; list-style: none; margin: 0; padding: 0; }
.pipeline-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--color-text-tertiary); font-weight: 500; }
.pipeline-item.done { color: var(--color-text-primary); }
.pipeline-dot {
  width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--color-border); display: flex; align-items: center;
  justify-content: center; flex-shrink: 0; color: #fff; transition: all .15s;
}
.pipeline-item.done .pipeline-dot { background: linear-gradient(135deg, var(--color-primary), var(--color-primary)); border-color: transparent; }
.pipeline-label { flex: 1; }
.pipeline-hint { font-size: 12px; color: var(--color-text-tertiary); }
.pipeline-item.done .pipeline-hint { color: var(--color-primary); }

.export-meta { font-size: 12.5px; color: var(--color-text-tertiary); margin: 0; }

/* ─── 历史合成记录 ─────────────────────────────────────── */
.history-block { padding-top: 18px; border-top: 1px dashed var(--color-border); display: flex; flex-direction: column; gap: 12px; }
.history-title { display: flex; align-items: baseline; gap: 6px; font-size: 13.5px; font-weight: 700; color: var(--color-text-primary); }
.history-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.history-card {
  display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 1.5px solid transparent; border-radius: 12px;
  background: var(--color-card); cursor: pointer; text-align: left; transition: border-color .15s, box-shadow .15s;
}
.history-card:hover { box-shadow: 0 6px 14px rgba(31, 35, 60, .08); }
.history-card.active { border-color: var(--color-primary); box-shadow: 0 6px 14px color-mix(in srgb, var(--color-primary) 18%, transparent); }
.history-thumb {
  position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #14151d;
  display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, .4);
}
.history-thumb img { width: 100%; height: 100%; object-fit: cover; }
.history-playing { position: absolute; inset: 0; margin: auto; color: #fff; filter: drop-shadow(0 1px 3px rgba(0, 0, 0, .5)); }
.history-date { font-size: 11.5px; color: var(--color-text-tertiary); text-align: center; }
.history-card.active .history-date { color: var(--color-primary); font-weight: 600; }
.export-cta { width: 100%; height: 40px; font-weight: 700; }
.download-link { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; color: var(--color-primary); font-weight: 600; text-decoration: none; }
.download-link:hover { color: var(--color-primary-dark); }

/* CTA 渐变按钮：用于关键操作，与整体紫色品牌色呼应 */
.cta-gradient {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary) 55%, var(--color-primary) 100%); border: none;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--color-primary) 32%, transparent); transition: transform .15s, box-shadow .15s, filter .15s;
}
.cta-gradient:hover { filter: brightness(1.06); transform: translateY(-1px); box-shadow: 0 8px 20px color-mix(in srgb, var(--color-primary) 40%, transparent); }
.cta-gradient:disabled, .cta-gradient.is-disabled { background: var(--color-bg-secondary); box-shadow: none; color: var(--color-text-tertiary); }
@media (max-width: 960px) {
  .wb-header { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; padding: 8px 10px; }
  .workbench.is-readonly .wb-header { grid-template-columns: minmax(0, 1fr); }
  .wb-title-input { min-width: 0; }
  .wb-title-row { gap: 6px; }
  .wb-progress, .wb-header-actions { grid-column: 1 / -1; width: 100%; }
  .wb-header-actions { flex-wrap: wrap; gap: 6px; }
  .wb-header-actions .el-button, .section-actions .el-button { min-height: 36px; margin: 0; }
  .wb-tabs { padding: 4px 6px 0; gap: 0; overflow-x: auto; }
  .tab-btn { flex: 1 0 auto; justify-content: center; white-space: nowrap; gap: 4px; padding: 8px 6px; min-height: 40px; }
  .wb-inner { padding: 8px 8px max(18px, env(safe-area-inset-bottom)); gap: 12px; }
  .wb-section { padding: 12px; border-radius: 12px; gap: 12px; }
  .section-head { gap: 10px; }
  .section-actions { min-width: 0; max-width: 100%; flex-shrink: 1; gap: 6px; }
  .export-layout { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .export-side { padding: 12px; }
  .history-grid { grid-template-columns: repeat(auto-fill, minmax(min(110px, 100%), 1fr)); gap: 8px; }
}
</style>
