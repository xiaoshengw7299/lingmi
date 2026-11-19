<template>
  <div
    class="node"
    :class="[`is-${node.type}`, { 'is-selected': selected, 'is-busy': node.status === 'generating', 'has-touch-controls': touchControls }]"
    :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.w}px`, height: `${node.h}px` }"
    :data-node-id="node.id"
    @pointerdown="$emit('drag-start', $event)"
  >
    <template v-if="node.type === 'group'">
      <header class="head">
        <el-icon :size="14"><Files /></el-icon>
        <input v-if="editingTitle" v-model="titleDraft" class="title-input" @pointerdown.stop @keydown.enter="commitTitle" @blur="commitTitle" />
        <span v-else class="title" :title="node.title" @dblclick="startEditTitle">{{ node.title }} · {{ node.members?.length ?? 0 }} 项</span>
      </header>
      <span class="handle handle-out" title="把整个组作为参考：拖到另一个节点" @pointerdown.stop="$emit('connect-start', $event)" />
    </template>
    <template v-else>
    <header class="head">
      <el-icon :size="14"><component :is="NODE_META[node.type].icon" /></el-icon>
      <input
        v-if="editingTitle"
        v-model="titleDraft"
        class="title-input"
        @pointerdown.stop
        @keydown.enter="commitTitle"
        @blur="commitTitle"
      />
      <span v-else class="title" :title="node.title" @dblclick="startEditTitle">{{ node.title }}</span>
      <VideoShareButton v-if="canvasId && node.type === 'video' && node.url" source="canvas" :id="canvasId" :video="node.url" :title="node.title" :before-open="beforeShare" compact class="node-share" />
    </header>

    <div class="body">
      <template v-if="node.type === 'image' && node.url">
        <el-image :src="node.thumb || node.url" fit="contain" draggable="false" @dblclick="previewing = true" />
        <el-image-viewer v-if="previewing" :url-list="[node.url]" teleported hide-on-click-modal @close="previewing = false" />
      </template>
      <video v-else-if="node.type === 'video' && node.url" :src="node.url" :poster="node.thumb" controls playsinline preload="none" @pointerdown.stop />
      <audio v-else-if="node.type === 'audio' && node.url" :src="node.url" controls preload="metadata" @pointerdown.stop />
      <textarea
        v-else-if="node.type === 'text'"
        ref="textRef"
        v-model="textDraft"
        class="text-area"
        placeholder="输入文字…"
        @pointerdown.stop
        @blur="commitText"
      />
      <div v-else class="placeholder">
        <el-icon :size="30"><component :is="NODE_META[node.type].icon" /></el-icon>
      </div>

      <div v-if="node.status === 'generating'" class="overlay"><el-icon class="is-loading" :size="26"><Loading /></el-icon><span>生成中…</span></div>
      <div v-else-if="node.status === 'failed'" class="overlay is-error" :title="node.error"><el-icon :size="22"><WarningFilled /></el-icon><span>{{ node.error || '生成失败' }}</span></div>
    </div>

    <span class="handle handle-in" />
    <span class="handle handle-out" title="拖到另一个节点，作为它的参考" @pointerdown.stop="$emit('connect-start', $event)" />
    <span class="resize" @pointerdown.stop="$emit('resize-start', $event)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Files, Loading, WarningFilled } from '@element-plus/icons-vue'
import VideoShareButton from '@/components/VideoShareButton.vue'
import { NODE_META, type CanvasNode } from './types'

const props = defineProps<{ node: CanvasNode; selected: boolean; canvasId?: string; beforeShare?: () => Promise<boolean>; touchControls?: boolean }>()
const emit = defineEmits<{
  'drag-start': [event: PointerEvent]
  'connect-start': [event: PointerEvent]
  'resize-start': [event: PointerEvent]
  update: [patch: Partial<CanvasNode>]
}>()

const editingTitle = ref(false)
const previewing = ref(false)
const textRef = ref<HTMLTextAreaElement>()
const textDraft = ref(props.node.text ?? '')

watch(() => [props.node.id, props.node.text] as const, () => {
  if (textRef.value && document.activeElement === textRef.value) return
  textDraft.value = props.node.text ?? ''
})

function commitText() {
  const next = textDraft.value
  if (next !== (props.node.text ?? '')) emit('update', { text: next })
}
const titleDraft = ref('')

function startEditTitle() {
  titleDraft.value = props.node.title
  editingTitle.value = true
}

function commitTitle() {
  if (!editingTitle.value) return
  editingTitle.value = false
  const next = titleDraft.value.trim()
  if (next && next !== props.node.title) emit('update', { title: next })
}
</script>

<style scoped>
.node { position: absolute; display: flex; flex-direction: column; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); box-shadow: var(--shadow-sm); user-select: none; touch-action: none; }
.node.is-group { border-style: dashed; border-color: var(--color-primary-line); background: color-mix(in srgb, var(--color-primary) 6%, transparent); box-shadow: none; }
.node.is-group .head { color: var(--color-primary-dark); }
.node.is-selected { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-soft), var(--shadow-md); }
.head { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; flex-shrink: 0; font-size: 12px; font-weight: 700; color: var(--color-text-secondary); cursor: grab; }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-share :deep(.el-button) { min-height: 28px; min-width: 28px; }
.title-input { flex: 1; min-width: 0; height: 22px; padding: 0 4px; border: 1px solid var(--color-primary); border-radius: 4px; background: var(--color-card); color: var(--color-text-primary); font: inherit; outline: none; }
.body { position: relative; flex: 1; min-height: 0; margin: 0 6px 6px; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-bg-secondary); display: flex; align-items: center; justify-content: center; }
.body :deep(.el-image), .body video { width: 100%; height: 100%; object-fit: contain; pointer-events: auto; }
.body :deep(.el-image img) { pointer-events: none; }
.body audio { width: 92%; }
.text-area { width: 100%; height: 100%; padding: 8px 10px; resize: none; border: 0; outline: none; background: transparent; color: var(--color-text-primary); font: 13px/1.7 inherit; user-select: text; }
.placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border: 1.5px dashed var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-tertiary); opacity: 0.7; }
.overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 12px; text-align: center; font-size: 12.5px; background: color-mix(in srgb, var(--color-card) 80%, transparent); color: var(--color-primary); }
.overlay.is-error { color: var(--color-error); background: var(--color-error-soft); overflow: hidden; }
.handle { position: absolute; top: 50%; width: 12px; height: 12px; margin-top: -6px; border: 2px solid var(--color-primary); border-radius: 50%; background: var(--color-card); }
.handle-in { left: -7px; }
.handle-out { right: -7px; cursor: crosshair; }
.handle-out:hover { background: var(--color-primary); }
.resize { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; background: linear-gradient(135deg, transparent 55%, var(--color-text-tertiary) 55%, var(--color-text-tertiary) 65%, transparent 65%, transparent 78%, var(--color-text-tertiary) 78%, var(--color-text-tertiary) 88%, transparent 88%); }
.has-touch-controls .resize { width: 30px; height: 30px; }
.has-touch-controls .handle { display: none; }
.has-touch-controls .text-area { font-size: 16px; }
</style>
