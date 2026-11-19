<template>
  <main class="page">
    <section v-if="loading" class="sheet state">正在打开作品…</section>
    <section v-else-if="errorText" class="sheet state">
      <h1>{{ errorText }}</h1>
      <p>请让对方确认发布码还在使用。</p>
    </section>
    <section v-else-if="landing" class="sheet">
      <p v-if="inWechat" class="banner">微信里打不开抖音和小红书。请点右上角，选择「在浏览器中打开」。</p>
      <p v-else-if="!onMobile" class="banner">请用手机浏览器打开这个页面，再发布到抖音或小红书。</p>
      <p v-if="!landing.videoReachable" class="banner">当前视频地址外网访问不到，抖音和小红书可能拉不下来。</p>

      <header class="who">
        <img v-if="landing.avatar" :src="landing.avatar" alt="" />
        <span v-else class="avatar">{{ landing.displayName.slice(0, 1) }}</span>
        <div>
          <h1>{{ landing.displayName }}</h1>
          <p>选一条成片，发到你自己的账号</p>
        </div>
      </header>

      <template v-if="current">
        <div class="stage">
          <video
            :key="currentKey"
            :src="current.videoUrl"
            controls
            playsinline
            preload="metadata"
          />
        </div>

        <div class="switcher">
          <button type="button" :disabled="landing.works.length < 2" @click="shuffle">换一条</button>
          <span>{{ landing.truncated ? `最近 ${landing.works.length} 条` : `${landing.works.length} 条作品` }}</span>
        </div>
        <div v-if="landing.works.length > 1" class="strip">
          <button
            v-for="work in landing.works"
            :key="workKey(work)"
            type="button"
            :class="{ 'is-active': workKey(work) === currentKey }"
            @click="select(work)"
          >
            {{ label(work) }}
          </button>
        </div>

        <label class="caption">
          <span>描述</span>
          <textarea v-model="caption" maxlength="1000" rows="4" placeholder="这条会带进发布页，可以改" />
        </label>
        <p v-if="landing.hashtags.length" class="tags">
          <span v-for="tag in landing.hashtags" :key="tag">#{{ tag }}</span>
        </p>
        <p v-if="landing.poiName" class="loc">
          地点 · {{ landing.poiName }}
          <em v-if="!landing.poiReady">抖音里需要再搜一次这个地点</em>
        </p>
        <p v-if="landing.xhsTitle" class="loc">小红书标题 · {{ landing.xhsTitle }}</p>

        <div class="actions">
          <button type="button" class="go douyin" :disabled="!!sharing || !landing.platforms.douyin" @click="publishDouyin">
            {{ sharing === 'douyin' ? '正在打开抖音…' : '发到抖音' }}
          </button>
          <p v-if="!landing.platforms.douyin" class="hint">创作者还未开通抖音发布</p>
          <button type="button" class="go xhs" :disabled="!!sharing || !landing.platforms.xhs" @click="publishXhs">
            {{ sharing === 'xhs' ? '正在打开小红书…' : '发到小红书' }}
          </button>
          <p v-if="!landing.platforms.xhs" class="hint">创作者还未开通小红书发布</p>
          <button type="button" class="copy" @click="copyCaption">复制描述</button>
          <button v-if="retry && failHint" type="button" class="copy" @click="retry()">继续打开</button>
        </div>
        <p class="fine">
          抖音会带上视频、描述、话题和已绑定的地点。小红书会带上视频，可复制描述后在 App 里粘贴，地点需手动添加。请在 App 内确认发布。
        </p>
        <p v-if="failHint" class="fail">{{ failHint }}</p>
      </template>
      <div v-else class="state inner">
        <h2>还没有可发布的成片</h2>
        <p>等创作者生成成功后，再打开这个页面。</p>
      </div>
    </section>

    <div v-if="wechatSheet" class="mask" @click.self="wechatSheet = false">
      <div class="mask-card" role="dialog" aria-labelledby="wechat-title">
        <h2 id="wechat-title">请用浏览器打开</h2>
        <ol>
          <li>点右上角的 ···</li>
          <li>选择「在浏览器中打开」</li>
          <li>回到这个页面，再点发布</li>
        </ol>
        <button type="button" @click="copyLink">复制链接</button>
        <button type="button" class="ghost" @click="wechatSheet = false">我知道了</button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  createDouyinShare,
  createXhsShare,
  getPublishLanding,
  type PublishLanding,
  type PublishWork,
} from '@/api/publish-code'
import { shareError, useVideoShare } from '@/composables/useVideoShare'

const route = useRoute()
const loading = ref(true)
const errorText = ref('')
const landing = ref<PublishLanding | null>(null)
const current = ref<PublishWork | null>(null)
const caption = ref('')
const wechatSheet = ref(false)
const { inWechat, sharing, failHint, retry, resetShare, shareDouyin, shareXhs } = useVideoShare()
const onMobile = /Android|iPhone|iPad|iPod|Mobile|Harmony/i.test(navigator.userAgent) ||
  window.matchMedia('(hover: none) and (pointer: coarse)').matches

const code = computed(() => {
  const raw = route.params.code
  return typeof raw === 'string' ? raw : raw?.[0] ?? ''
})
const currentKey = computed(() => (current.value ? workKey(current.value) : ''))

function workKey(work: PublishWork) {
  return `${work.taskId}:${work.index}`
}

function label(work: PublishWork) {
  const name = work.subject || '未命名作品'
  const siblings = landing.value?.works.filter((item) => item.taskId === work.taskId) ?? []
  return siblings.length > 1 ? `${name} · ${work.index + 1}` : name
}

function pick(except?: string) {
  const works = landing.value?.works ?? []
  if (!works.length) return null
  const pool = except ? works.filter((work) => workKey(work) !== except) : works
  const source = pool.length ? pool : works
  return source[Math.floor(Math.random() * source.length)]
}

function select(work: PublishWork) {
  current.value = work
  resetShare()
}

function shuffle() {
  const next = pick(currentKey.value)
  if (next) select(next)
}

function publishCaption() {
  const page = landing.value
  const work = current.value
  if (!page || !work) return ''
  return caption.value.trim() || page.caption.trim() || work.subject.trim()
}

function publishBody() {
  const page = landing.value
  if (!page) return ''
  const tags = page.hashtags.map((tag) => `#${tag}`).join(' ')
  const poi = page.poiName ? `地点：${page.poiName}` : ''
  return [publishCaption(), tags, poi].filter(Boolean).join('\n')
}

function blockEnvironment() {
  if (inWechat) {
    wechatSheet.value = true
    return true
  }
  if (!onMobile) {
    failHint.value = '请用手机浏览器打开这个页面后再发布。'
    return true
  }
  return false
}

function publishDouyin() {
  const work = current.value
  if (!work || blockEnvironment()) return
  const body = { taskId: work.taskId, index: work.index, caption: publishCaption() }
  void shareDouyin(() => createDouyinShare(code.value, body))
}

function publishXhs() {
  const work = current.value
  const page = landing.value
  if (!work || !page || blockEnvironment()) return
  const body = { taskId: work.taskId, index: work.index, caption: publishCaption() }
  const title = (page.xhsTitle || body.caption).slice(0, 20)
  void shareXhs(() => createXhsShare(code.value, body), `标题：${title}\n\n${publishBody()}`)
}

async function copyCaption() {
  try {
    await navigator.clipboard.writeText(publishBody())
    ElMessage.success('描述已复制')
  } catch {
    ElMessage.warning('复制失败，请长按描述手动复制')
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href)
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.warning('复制失败，请手动复制地址栏')
  }
}

async function load() {
  loading.value = true
  errorText.value = ''
  landing.value = null
  current.value = null
  resetShare()
  try {
    const page = await getPublishLanding(code.value)
    landing.value = page
    current.value = pick()
    caption.value = page.caption
    document.title = `${page.displayName}的作品 · 灵米`
  } catch (error) {
    errorText.value = shareError(error, '页面打不开')
  } finally {
    loading.value = false
  }
}

watch(code, () => { void load() })
onMounted(load)
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
  background:
    radial-gradient(1200px 480px at 50% -180px, var(--color-primary-soft), transparent 70%),
    var(--color-background);
}
.sheet { width: min(440px, 100%); margin: 0 auto; padding: 20px 16px calc(28px + env(safe-area-inset-bottom)); }
.state { padding-top: 18vh; text-align: center; color: var(--color-text-secondary); }
.state h1, .state h2 { margin-bottom: 8px; color: var(--color-text-primary); font-size: 22px; }
.inner { padding-top: 28px; }
.banner {
  margin: 0 0 14px; padding: 10px 12px; border-radius: var(--radius-md);
  background: var(--color-warning-soft); color: var(--color-text-primary); font-size: 13px; line-height: 1.6;
}
.who { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.who img, .avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
.avatar { display: grid; place-items: center; background: var(--color-primary); color: #fff; font-weight: 800; }
.who h1 { font-size: 18px; line-height: 1.3; }
.who p { color: var(--color-text-tertiary); font-size: 13px; }
.stage { display: flex; justify-content: center; }
.stage video {
  width: 100%; max-height: 68vh; min-height: 220px; object-fit: contain;
  border-radius: var(--radius-lg); background: #111; box-shadow: var(--shadow-md);
}
.switcher { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 8px; }
.switcher button, .strip button, .copy, .mask-card button {
  border: 1px solid var(--color-border); background: var(--color-card); color: var(--color-text-primary);
  border-radius: 999px; padding: 6px 12px; font-weight: 700; cursor: pointer;
}
.switcher button:disabled { opacity: 0.45; cursor: default; }
.switcher span { color: var(--color-text-tertiary); font-size: 12px; }
.strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.strip button {
  flex: 0 0 auto; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-radius: var(--radius-sm); font-weight: 600; font-size: 13px;
}
.strip button.is-active { border-color: var(--color-primary); color: var(--color-primary-dark); background: var(--color-primary-soft); }
.caption { display: grid; gap: 6px; margin-top: 14px; }
.caption span, .loc, .hint, .fine { color: var(--color-text-secondary); font-size: 13px; }
.caption textarea {
  width: 100%; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md);
  background: var(--color-card); color: var(--color-text-primary); font: inherit; font-size: 16px; line-height: 1.6; resize: vertical;
}
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tags span { padding: 2px 8px; border-radius: 999px; background: var(--color-primary-soft); color: var(--color-primary-dark); font-size: 12px; font-weight: 700; }
.loc { margin-top: 8px; }
.loc em { margin-left: 6px; font-style: normal; color: var(--color-text-tertiary); }
.actions { display: grid; gap: 8px; margin-top: 16px; }
.go {
  display: grid; place-items: center; height: 46px; border: 0; border-radius: 999px;
  color: #fff; font-size: 16px; font-weight: 800; cursor: pointer; text-decoration: none;
}
.go:disabled { opacity: 0.45; cursor: default; }
.douyin { background: #161823; }
.xhs { background: #ff2442; }
.copy { height: 40px; }
.hint { margin: -2px 0 0; }
.fine, .fail { margin-top: 12px; line-height: 1.7; }
.fail { color: var(--color-error); font-size: 13px; }
.mask { position: fixed; inset: 0; display: grid; place-items: end center; padding: 16px; background: var(--color-overlay); }
.mask-card {
  width: min(420px, 100%); padding: 18px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: var(--radius-lg); background: var(--color-card);
}
.mask-card h2 { font-size: 18px; }
.mask-card ol { margin: 10px 0 14px 18px; color: var(--color-text-secondary); line-height: 1.8; }
.mask-card button { width: 100%; height: 42px; margin-top: 8px; background: var(--color-primary); color: #fff; border-color: transparent; }
.mask-card .ghost { background: var(--color-card); color: var(--color-text-primary); border-color: var(--color-border); }
</style>
