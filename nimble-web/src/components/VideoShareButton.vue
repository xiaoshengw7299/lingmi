<template>
  <span class="video-share" @pointerdown.stop @click.stop>
    <el-button :icon="Share" size="small" :circle="compact" :loading="opening" aria-label="一键发布" @click="open">
      <template v-if="!compact">一键发布</template>
    </el-button>
    <el-dialog v-if="opened" v-model="opened" title="一键发布" width="min(420px, calc(100vw - 24px))" append-to-body @close="resetShare">
      <p v-if="inWechat">请点微信右上角的「在浏览器中打开」，再回到这条视频发布。</p>
      <template v-else>
        <p v-if="title" class="video-title">{{ title }}</p>
        <p class="note">视频会带入 App，请在 App 内确认发布。</p>
        <div v-loading="loadingPlatforms" class="platforms">
          <el-button type="primary" :loading="sharing === 'douyin'" :disabled="!!sharing || !platforms?.douyin" @click="publish('douyin')">发到抖音</el-button>
          <el-button type="danger" :loading="sharing === 'xhs'" :disabled="!!sharing || !platforms?.xhs" @click="publish('xhs')">发到小红书</el-button>
        </div>
        <p v-if="platforms && (!platforms.douyin || !platforms.xhs)" class="note">
          {{ !platforms.douyin && !platforms.xhs ? '抖音和小红书暂未开通' : !platforms.douyin ? '抖音暂未开通' : '小红书暂未开通' }}
        </p>
        <p v-if="failHint || platformError" class="error" role="status">{{ failHint || platformError }}</p>
        <el-button v-if="retry && failHint" text type="primary" @click="retry()">继续打开</el-button>
      </template>
      <template #footer>
        <el-button v-if="inWechat" @click="copyLink">复制链接</el-button>
        <el-button v-else-if="title" @click="copyText(title, '文案已复制')">复制文案</el-button>
        <a v-if="downloadUrl" class="download" :href="downloadUrl" target="_blank" rel="noopener" download>下载视频</a>
      </template>
    </el-dialog>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Share } from '@element-plus/icons-vue'
import { getVideoSharePlatforms, prepareDouyinVideo, prepareXhsVideo, type VideoSharePlatform, type VideoShareSource } from '@/api/publish-code'
import { loadXhsSdk, shareError, useVideoShare } from '@/composables/useVideoShare'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{
  source: VideoShareSource
  id: string
  video?: string | null
  title?: string
  compact?: boolean
  beforeOpen?: () => Promise<boolean>
}>()

const { inWechat, sharing, failHint, retry, resetShare, shareDouyin, shareXhs } = useVideoShare()
const opened = ref(false)
const opening = ref(false)
const loadingPlatforms = ref(false)
const platforms = ref<Record<VideoSharePlatform, boolean>>()
const platformError = ref('')
const downloadUrl = computed(() => {
  const url = props.video
  return url && (/^https?:\/\//i.test(url) || url.startsWith('/')) ? url : undefined
})

const copyLink = () => copyText(window.location.href, '页面链接已复制')

watch(() => [props.source, props.id, props.video], () => {
  opened.value = false
  resetShare()
})

async function open() {
  if (opening.value) return
  if (props.beforeOpen) {
    opening.value = true
    try {
      if (!await props.beforeOpen()) return
    } finally {
      opening.value = false
    }
  }
  resetShare()
  opened.value = true
  if (inWechat) return
  loadingPlatforms.value = true
  platformError.value = ''
  try {
    platforms.value = await getVideoSharePlatforms()
    if (platforms.value.xhs) void loadXhsSdk().catch(() => undefined)
  } catch (error) {
    platformError.value = shareError(error, '暂时无法获取发布平台，请关闭后重试')
  } finally {
    loadingPlatforms.value = false
  }
}

function publish(platform: VideoSharePlatform) {
  const target = { source: props.source, id: props.id, video: props.video || undefined, caption: props.title?.slice(0, 1000) }
  if (platform === 'douyin') void shareDouyin(() => prepareDouyinVideo(target))
  else void shareXhs(() => prepareXhsVideo(target), target.caption)
}
</script>

<style scoped>
.video-share { display: none; }
.platforms { display: flex; gap: 8px; margin: 14px 0 8px; }
.platforms .el-button { flex: 1; margin: 0; min-height: 44px; }
.video-title { margin-bottom: 6px; font-weight: 600; overflow-wrap: anywhere; }
.note { color: var(--color-text-tertiary); }
.error { margin-top: 10px; color: var(--color-error); }
.download { margin-left: 12px; color: var(--color-primary); }
@media (max-width: 1100px), (hover: none) and (pointer: coarse) {
  .video-share { display: inline-flex; align-items: center; }
  .video-share > .el-button { min-width: 36px; min-height: 36px; }
}
</style>
