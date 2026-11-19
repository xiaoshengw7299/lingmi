<template>
  <div class="chat-input-wrapper">
    <div v-if="uploadedFiles.length" class="file-list">
      <div v-for="(file, i) in uploadedFiles" :key="i" class="file-tag">
        <el-icon><Document /></el-icon>
        <span class="file-name">{{ file.filename }}</span>
        <el-icon class="file-remove" @click="removeFile(i)"><Close /></el-icon>
      </div>
    </div>

    <div class="input-area">
      <button type="button" class="input-action" :disabled="uploading || disabled || streaming" aria-label="上传文件" :title="uploading ? '上传中…' : '上传文件'" @click="triggerUpload">
        <el-icon :size="20"><Plus /></el-icon>
      </button>
      <input ref="fileInputRef" type="file" class="file-input-hidden" @change="handleFileSelect" />

      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="text-input"
        placeholder="发消息或语音输入"
        rows="1"
        :disabled="disabled"
        @keydown="handleKeydown"
        @input="autoResize"
      />

      <button type="button" class="input-action voice-btn" :class="{ recording: isRecording }" aria-label="语音输入" title="语音输入" @click="toggleVoice">
        <el-icon :size="20"><Microphone /></el-icon>
      </button>

      <button v-if="canSend" type="button" class="send-btn" aria-label="发送消息" @click="handleSend">
        <el-icon :size="18" color="#fff"><Position /></el-icon>
      </button>

      <button v-if="streaming" type="button" class="stop-btn" aria-label="停止生成" title="停止生成" @click="$emit('stop')">
        <el-icon :size="16"><VideoPause /></el-icon>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { Document, Close, Plus, Microphone, Position, VideoPause } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { UploadResult } from './types'
import { uploadAgentFile } from '@/api/agent'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  disabled?: boolean
  streaming?: boolean
}>()
const emit = defineEmits<{
  send: [text: string, files: UploadResult[]]
  stop: []
  /** 上传的是图片/视频/音频时额外触发一次，供视频制作等场景把素材同步进工作台素材库 */
  mediaUploaded: [file: File]
}>()

const authStore = useAuthStore()

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement>()
const fileInputRef = ref<HTMLInputElement>()
const uploadedFiles = ref<UploadResult[]>([])
const uploading = ref(false)
const isRecording = ref(false)
let recognition: any = null

const canSend = computed(() =>
  (inputText.value.trim() || uploadedFiles.value.length)
  && !props.disabled
  && !props.streaming
  && !uploading.value,
)

const autoResize = () => {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 150) + 'px'
}

const handleSend = () => {
  const text = inputText.value.trim()
  if ((!text && !uploadedFiles.value.length) || uploading.value) return
  if (!authStore.ensureLoggedIn()) return
  emit('send', text, [...uploadedFiles.value])
  inputText.value = ''
  uploadedFiles.value = []
  nextTick(autoResize)
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.isComposing || e.key === 'Process') return
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend.value) handleSend() }
}

const triggerUpload = () => {
  if (uploading.value || props.disabled || props.streaming) return
  fileInputRef.value?.click()
}

const handleFileSelect = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  if (file.size > 100 * 1024 * 1024) {
    ElMessage.warning('文件大小不能超过 100MB')
    return
  }

  uploading.value = true
  try {
    const result = await uploadAgentFile(file)
    uploadedFiles.value.push(result)
    ElMessage.success(`${result.filename} 上传成功`)
    if (/^(image|video|audio)\//.test(file.type)) emit('mediaUploaded', file)
  } catch {
    // 错误已由 request 拦截器提示
  } finally {
    uploading.value = false
  }
}

const removeFile = (index: number) => uploadedFiles.value.splice(index, 1)

const toggleVoice = () => isRecording.value ? stopVoice() : startVoice()

const startVoice = () => {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognition) { ElMessage.warning('当前浏览器不支持语音输入'); return }
  recognition = new SpeechRecognition()
  recognition.lang = 'zh-CN'; recognition.interimResults = true; recognition.continuous = true
  recognition.onresult = (event: any) => {
    let transcript = ''
    for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript
    if (event.results[event.results.length - 1].isFinal) { inputText.value += transcript; nextTick(autoResize) }
  }
  recognition.onerror = () => { isRecording.value = false; ElMessage.warning('语音识别出错，请重试') }
  recognition.onend = () => { isRecording.value = false }
  recognition.start(); isRecording.value = true
}

const stopVoice = () => { recognition?.stop(); isRecording.value = false }

const focus = () => textareaRef.value?.focus()
defineExpose({ focus })

onMounted(() => {
  if (window.matchMedia('(min-width: 961px) and (hover: hover)').matches) nextTick(focus)
})
onUnmounted(() => { if (recognition) recognition.stop() })
</script>

<style scoped>
.chat-input-wrapper { padding: 0 16px 28px; max-width: 800px; width: 100%; margin: 0 auto; }
.file-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.file-tag { display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: var(--color-bg-secondary); border-radius: 6px; font-size: 12px; color: var(--color-text-secondary); }
.file-name { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-remove { cursor: pointer; color: var(--color-text-tertiary); transition: color .2s; }
.file-remove:hover { color: var(--color-error); }
.input-area { display: flex; align-items: flex-end; gap: 10px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: 20px; padding: 12px 16px; box-shadow: 0 2px 12px rgba(0,0,0,.06); transition: border-color .2s, box-shadow .2s; }
.input-area:focus-within { border-color: var(--color-border); box-shadow: 0 2px 16px rgba(0,0,0,.1); }
.input-action { flex-shrink: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 10px; background: transparent; cursor: pointer; color: var(--color-text-tertiary); transition: all .2s; }
.input-action:hover { color: var(--color-text-secondary); background: var(--color-bg-secondary); }
.input-action:disabled { opacity: .5; cursor: not-allowed; pointer-events: none; }
.voice-btn.recording { color: var(--color-error); background: var(--color-error-soft); animation: pulse 1.5s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }
.text-input { flex: 1; min-width: 0; border: none; outline: none; resize: none; font-size: 15px; line-height: 1.6; color: var(--color-text-primary); background: transparent; min-height: 28px; max-height: 160px; padding: 4px 0; font-family: inherit; }
.text-input::placeholder { color: var(--color-text-tertiary); }
.text-input:disabled { cursor: not-allowed; opacity: .6; }
.send-btn { flex-shrink: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: #1a1a1a; border-radius: 50%; cursor: pointer; transition: background .2s; }
.send-btn:hover { background: #333; }
.stop-btn { flex-shrink: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: var(--color-error); border-radius: 50%; cursor: pointer; color: #fff; transition: background .2s; }
.stop-btn:hover { background: var(--color-error); }
.file-input-hidden { display: none; }
.send-btn, .stop-btn { border: 0; padding: 0; }
@media (max-width: 960px) {
  .chat-input-wrapper { padding: 0 8px max(8px, env(safe-area-inset-bottom)); flex-shrink: 0; }
  .input-area { padding: 6px 8px; gap: 5px; border-radius: 14px; }
  .input-action, .send-btn, .stop-btn { width: 40px; height: 40px; }
  .text-input { font-size: 16px; max-height: min(120px, 25dvh); }
}
</style>
