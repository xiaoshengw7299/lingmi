<template>
  <el-dialog
    v-model="open"
    title="发布码"
    width="min(820px, 94vw)"
    append-to-body
    destroy-on-close
    @open="load"
  >
    <div v-loading="loading" class="layout">
      <el-form label-position="top" class="form" @submit.prevent>
        <p class="lead">
          扫码的人会看到你已完成的一键成片，默认随机一条，也可以换。描述可以改，话题和地点按这里的设置带上。视频发到对方自己的抖音或小红书，最后仍要点发布。
        </p>

        <p v-if="platformTip" class="note">{{ platformTip }}</p>
        <p v-if="settings && !settings.videoReachable" class="note">
          当前视频地址不是公网 https，手机上的抖音和小红书拉不到视频。请把存储的公网地址改成 https。
        </p>
        <p v-if="localHost" class="note">你正在本机打开。这个二维码手机扫不开，请用线上地址打开后再下载。</p>
        <p v-if="settings && settings.workCount === 0" class="note">还没有已完成的成片。扫码后页面是空的，生成成功后再给别人扫。</p>

        <el-form-item label="落地页名称">
          <el-input v-model="form.displayName" maxlength="40" show-word-limit placeholder="不填则用你的昵称" />
        </el-form-item>
        <el-form-item label="默认描述">
          <el-input
            v-model="form.caption"
            type="textarea"
            :rows="4"
            maxlength="1000"
            show-word-limit
            placeholder="扫码后会填进发布页，对方可以再改"
          />
        </el-form-item>
        <el-form-item label="话题">
          <div class="tags">
            <el-tag v-for="tag in form.hashtags" :key="tag" closable round @close="removeTag(tag)">{{ tag }}</el-tag>
            <el-input
              v-model="tagDraft"
              class="tag-input"
              maxlength="20"
              placeholder="回车添加，最多 5 个"
              :disabled="form.hashtags.length >= 5"
              @keydown.enter.prevent="addTag"
            />
          </div>
        </el-form-item>
        <el-form-item label="小红书标题">
          <el-input v-model="form.xhsTitle" maxlength="20" show-word-limit placeholder="不填则用描述前 20 字。小红书不一定会自动填入" />
        </el-form-item>
        <el-form-item label="地点">
          <div class="poi-fields">
            <el-input v-model="form.poiName" maxlength="80" placeholder="地点名称，展示在落地页" />
            <el-input v-model="form.poiId" maxlength="32" placeholder="抖音地点 ID，一串数字" />
          </div>
          <ol class="poi-help">
            <li>抖音搜索店名，进入地点主页，点右上角分享，复制链接。</li>
            <li>复制内容里有一条 v.douyin.com 短链。用浏览器打开它，等页面跳转完。</li>
            <li>看地址栏里的 poi_id=。等号后面、&amp; 前面的那串数字就是地点 ID，例如 poi_id=6601…&amp;。</li>
            <li>只填这串数字。地点名称另填店名。</li>
          </ol>
          <p class="field-hint">没有地点 ID 时，抖音里需要再搜一次同名地点。小红书不能自动带定位，只会把地点名称放进可复制的文案。</p>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" active-text="扫码可打开" inactive-text="已停用" />
        </el-form-item>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </el-form>

      <aside class="qr-side">
        <img v-if="posterUrl" class="poster" :src="posterUrl" alt="发布码海报" />
        <p v-else class="qr-wait">二维码生成中</p>
        <label class="qr-caption">
          <span>海报底部文字</span>
          <el-input v-model="form.qrCaption" maxlength="40" show-word-limit placeholder="扫一扫，浏览器打开，一键发布" />
        </label>
        <p class="link">{{ link }}</p>
        <p v-if="settings" class="stats">
          打开 {{ settings.viewCount }} · 抖音 {{ settings.douyinCount }} · 小红书 {{ settings.xhsCount }}
        </p>
        <p v-if="settings" class="stats">
          已完成 {{ settings.workCount }} 条，发布页展示最近 30 条
        </p>
        <div class="qr-ops">
          <el-button :disabled="!settings" @click="copy(link, '链接已复制')">复制链接</el-button>
          <el-button :disabled="!posterUrl" @click="downloadPoster">下载二维码</el-button>
          <el-button :disabled="!settings" @click="preview">预览落地页</el-button>
        </div>
      </aside>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { toDataURL } from 'qrcode'
import {
  getPublishCode,
  savePublishCode,
  type PublishCodeSettings,
} from '@/api/publish-code'
import { useAuthStore } from '@/stores/auth'
import { copyText as copy } from '@/utils/clipboard'

const DEFAULT_QR_CAPTION = '扫一扫，浏览器打开，一键发布'
const POSTER_W = 1080
const POSTER_H = 1440

const open = defineModel<boolean>({ required: true })
const auth = useAuthStore()
const loading = ref(false)
const saving = ref(false)
const settings = ref<PublishCodeSettings | null>(null)
const qrUrl = ref('')
const posterUrl = ref('')
const tagDraft = ref('')
const form = reactive({
  enabled: true,
  displayName: '',
  caption: '',
  hashtags: [] as string[],
  poiId: '',
  poiName: '',
  xhsTitle: '',
  qrCaption: DEFAULT_QR_CAPTION,
})

const localHost = computed(() => ['localhost', '127.0.0.1'].includes(location.hostname))
const link = computed(() => (settings.value ? `${location.origin}/s/${settings.value.code}` : ''))
const posterTitle = computed(() => form.displayName.trim() || auth.displayName || '一键发布')
const posterCaption = computed(() => form.qrCaption.trim() || DEFAULT_QR_CAPTION)
const platformTip = computed(() => {
  const platforms = settings.value?.platforms
  if (!platforms) return ''
  const missing = [
    platforms.douyin ? '' : '抖音（DOUYIN_CLIENT_KEY / DOUYIN_CLIENT_SECRET）',
    platforms.xhs ? '' : '小红书（XHS_APP_KEY / XHS_APP_SECRET）',
  ].filter(Boolean)
  return missing.length ? `还没配置${missing.join('、')}。配置并重启后端后，扫码才能打开对应 App。` : ''
})

let paintToken = 0

function apply(data: PublishCodeSettings) {
  settings.value = data
  form.enabled = data.enabled
  form.displayName = data.displayName
  form.caption = data.caption
  form.hashtags = [...data.hashtags]
  form.poiId = data.poiId
  form.poiName = data.poiName
  form.xhsTitle = data.xhsTitle
  form.qrCaption = data.qrCaption?.trim() || DEFAULT_QR_CAPTION
}

async function paintQr() {
  if (!link.value) return
  qrUrl.value = await toDataURL(link.value, {
    width: 640,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#17231d', light: '#ffffff' },
  })
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('二维码绘制失败'))
    image.src = src
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const chars = Array.from(text)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < chars.length; i += 1) {
    const next = line + chars[i]
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      if (lines.length === maxLines - 1) {
        let rest = chars.slice(i).join('')
        while (rest && ctx.measureText(`${rest}…`).width > maxWidth) rest = Array.from(rest).slice(0, -1).join('')
        lines.push(rest.length < chars.slice(i).join('').length ? `${rest}…` : rest)
        return lines
      }
      line = chars[i]
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

async function paintPoster() {
  const token = ++paintToken
  const source = qrUrl.value
  if (!source) {
    posterUrl.value = ''
    return
  }
  try {
    const qr = await loadImage(source)
    if (token !== paintToken) return
    const canvas = document.createElement('canvas')
    canvas.width = POSTER_W
    canvas.height = POSTER_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bg = ctx.createLinearGradient(0, 0, POSTER_W, POSTER_H)
    bg.addColorStop(0, '#064e36')
    bg.addColorStop(0.55, '#0b8f5f')
    bg.addColorStop(1, '#12875c')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, POSTER_W, POSTER_H)

    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.arc(960, 140, 220, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(40, 1480, 200, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '700 48px "PingFang SC", "Microsoft YaHei", sans-serif'
    const titleLines = wrapText(ctx, posterTitle.value.slice(0, 40), 900, 2)
    const titleLineH = 64
    let titleY = 78 + titleLineH / 2
    for (const line of titleLines) {
      ctx.fillText(line, POSTER_W / 2, titleY)
      titleY += titleLineH
    }

    ctx.shadowColor = 'rgba(6, 40, 28, 0.22)'
    ctx.shadowBlur = 36
    ctx.shadowOffsetY = 18
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, 140, 250, 800, 800, 48)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.drawImage(qr, 210, 320, 660, 660)

    ctx.fillStyle = '#ffffff'
    ctx.font = '500 40px "PingFang SC", "Microsoft YaHei", sans-serif'
    const captionLines = wrapText(ctx, posterCaption.value.slice(0, 40), 900, 2)
    const captionLineH = 58
    const captionBandTop = 1088
    const captionBandH = 300
    let captionY = captionBandTop + (captionBandH - captionLines.length * captionLineH) / 2 + captionLineH / 2
    for (const line of captionLines) {
      ctx.fillText(line, POSTER_W / 2, captionY)
      captionY += captionLineH
    }

    if (token !== paintToken) return
    posterUrl.value = canvas.toDataURL('image/png')
  } catch {
    if (token === paintToken) posterUrl.value = source
  }
}

let posterTimer = 0
watch([qrUrl, posterTitle, posterCaption], () => {
  window.clearTimeout(posterTimer)
  posterTimer = window.setTimeout(() => {
    void paintPoster()
  }, 60)
})

async function load() {
  loading.value = true
  try {
    apply(await getPublishCode())
    await paintQr()
  } finally {
    loading.value = false
  }
}

function addTag() {
  const parts = tagDraft.value.split(/[,，\s#]+/).map((item) => item.trim()).filter(Boolean)
  for (const part of parts) {
    if (form.hashtags.length >= 5) break
    const tag = part.slice(0, 20)
    if (!form.hashtags.includes(tag)) form.hashtags.push(tag)
  }
  tagDraft.value = ''
}

function removeTag(tag: string) {
  form.hashtags = form.hashtags.filter((item) => item !== tag)
}

async function save() {
  addTag()
  saving.value = true
  try {
    apply(await savePublishCode({
      enabled: form.enabled,
      displayName: form.displayName,
      caption: form.caption,
      hashtags: form.hashtags,
      poiId: form.poiId,
      poiName: form.poiName,
      xhsTitle: form.xhsTitle,
      qrCaption: form.qrCaption.trim() === DEFAULT_QR_CAPTION ? '' : form.qrCaption.trim(),
    }))
    ElMessage.success('发布设置已保存')
  } finally {
    saving.value = false
  }
}

function downloadPoster() {
  if (!posterUrl.value) return
  const a = document.createElement('a')
  a.href = posterUrl.value
  a.download = '发布码.png'
  a.click()
}

function preview() {
  if (!link.value) return
  window.open(link.value, '_blank', 'noopener')
}

onUnmounted(() => {
  window.clearTimeout(posterTimer)
})
</script>

<style scoped>
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 22px; min-height: 240px; }
.lead, .field-hint, .stats, .link { color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }
.lead { margin-bottom: 12px; }
.note {
  margin: 0 0 10px; padding: 8px 10px; border-radius: var(--radius-sm);
  background: var(--color-warning-soft); color: var(--color-text-primary); font-size: 13px; line-height: 1.6;
}
.tags { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
.tag-input { width: 180px; }
.poi-fields, .qr-ops { display: flex; gap: 8px; width: 100%; }
.poi-fields { flex-wrap: wrap; }
.poi-fields .el-input { flex: 1; min-width: 140px; }
.field-hint { margin: 6px 0 0; }
.poi-help {
  margin: 8px 0 0; padding-left: 18px; color: var(--color-text-secondary); font-size: 12.5px; line-height: 1.7;
}
.qr-side { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.poster { width: 220px; height: auto; border-radius: 18px; background: #0b8f5f; box-shadow: 0 14px 32px rgba(11, 143, 95, 0.2); }
.qr-wait {
  width: 220px; height: 293px; display: grid; place-items: center; border-radius: 18px;
  background: var(--color-bg-secondary); color: var(--color-text-tertiary);
}
.qr-caption { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.qr-caption span { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.link { width: 100%; word-break: break-all; text-align: center; }
.stats { margin: 0; text-align: center; }
.qr-ops { flex-direction: column; }
@media (max-width: 720px) {
  .layout { grid-template-columns: 1fr; }
  .qr-side { order: -1; }
}
</style>
