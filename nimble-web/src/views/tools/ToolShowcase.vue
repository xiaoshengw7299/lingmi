<template>
  <div v-if="showcase.length" class="showcase">
    <header class="sc-head">
      <div class="sc-title">
        <h3>效果示例</h3>
        <p>{{ active.desc || (showcase.length > 1 ? '官方效果示例，可切换查看' : active.title) }}</p>
      </div>
      <div class="sc-actions">
        <div v-if="showcase.length > 1" class="sc-tabs" role="tablist">
          <button
            v-for="(item, i) in showcase"
            :key="item.title"
            type="button"
            role="tab"
            :aria-selected="i === index"
            :class="{ 'is-active': i === index }"
            @click="index = i"
          >
            {{ item.title }}
          </button>
        </div>
        <el-button v-if="videoCount > 1" size="small" round :icon="VideoPlay" @click="playAll">同步播放对比</el-button>
      </div>
    </header>

    <div :key="index" class="sc-row">
      <template v-for="(item, i) in active.items" :key="`${index}-${i}`">
        <span v-if="i > 0" class="sc-arrow" aria-hidden="true"><el-icon><Right /></el-icon></span>
        <figure class="sc-item" :class="[`is-${item.kind}`, { 'is-wide': active.items.length === 1 }]">
          <div class="sc-media">
            <video
              v-if="item.kind === 'video'"
              :ref="(el) => collect(el as HTMLVideoElement | null, i)"
              :src="item.loop ? item.url : `${item.url}#t=0.1`"
              :autoplay="item.loop"
              :loop="item.loop"
              :muted="item.loop || i !== firstVideo"
              :controls="!item.loop"
              playsinline
              preload="metadata"
              @timeupdate="i === firstVideo && (time = ($event.target as HTMLVideoElement).currentTime)"
            />
            <el-image v-else-if="item.kind === 'image'" :src="item.url" :preview-src-list="[item.url!]" fit="contain" preview-teleported hide-on-click-modal />
            <div v-else-if="item.kind === 'audio'" class="sc-audio">
              <span class="sc-wave"><i v-for="n in 18" :key="n" :style="{ height: `${20 + ((n * 37) % 70)}%` }" /></span>
              <audio :src="item.url" controls preload="none" />
            </div>
            <ol v-else-if="item.kind === 'subtitles'" ref="subtitleBox" class="sc-subs">
              <li v-for="(line, n) in subtitles" :key="n" :class="{ 'is-active': time >= line.start && time < line.end }">
                <time>{{ clock(line.start) }}</time>{{ line.text }}
              </li>
            </ol>
            <pre v-else class="sc-text">{{ item.text }}</pre>
          </div>
          <figcaption><b v-if="active.items.length > 1">{{ i + 1 }}</b>{{ item.label }}</figcaption>
          <VideoShareButton v-if="item.kind === 'video' && item.url" source="tool-example" :id="toolId" :video="item.url" :title="item.label" />
        </figure>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Right, VideoPlay } from '@element-plus/icons-vue'
import VideoShareButton from '@/components/VideoShareButton.vue'
import { clock, type Showcase } from '@/api/media-tools'

const props = defineProps<{ toolId: string; showcase: Showcase[] }>()

const index = ref(0)
const time = ref(0)
const subtitles = ref<Array<{ text: string; start: number; end: number }>>([])
const subtitleBox = ref<HTMLOListElement[]>()
const videos = new Map<number, HTMLVideoElement>()

const active = computed(() => props.showcase[index.value] ?? props.showcase[0])
const playable = computed(() => active.value.items.map((item, i) => (item.kind === 'video' && !item.loop ? i : -1)).filter((i) => i >= 0))
const videoCount = computed(() => playable.value.length)
/** 只有第一个视频出声，其余静音，同步播放时不会互相干扰 */
const firstVideo = computed(() => playable.value[0] ?? -1)

function collect(el: HTMLVideoElement | null, i: number) {
  if (el) videos.set(i, el)
  else videos.delete(i)
}

function playAll() {
  for (const i of playable.value) {
    const el = videos.get(i)
    if (!el) continue
    el.currentTime = 0
    void el.play().catch(() => undefined)
  }
}

/** 字幕示例跟着视频走：当前句高亮并滚到可见位置 */
watch(time, async () => {
  await nextTick()
  const box = subtitleBox.value?.[0]
  const current = box?.querySelector<HTMLElement>('.is-active')
  if (box && current) box.scrollTo({ top: current.offsetTop - box.clientHeight / 2, behavior: 'smooth' })
})

watch(
  active,
  async (showcase) => {
    time.value = 0
    subtitles.value = []
    const item = showcase?.items.find((entry) => entry.kind === 'subtitles')
    if (item?.url) subtitles.value = await fetch(item.url).then((res) => res.json()).catch(() => [])
  },
  { immediate: true },
)
</script>

<style scoped>
.showcase { padding: 18px 20px 20px; }
.sc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.sc-title h3 { font-size: 16px; font-weight: 750; }
.sc-title p { margin-top: 2px; font-size: 12.5px; color: var(--color-text-tertiary); }
.sc-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.sc-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px; border-radius: 999px; background: var(--color-bg-secondary); }
.sc-tabs button {
  height: 28px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary); transition: var(--transition);
}
.sc-tabs button.is-active { background: var(--color-card); color: var(--color-primary-dark); box-shadow: var(--shadow-sm); }

.sc-row { display: flex; align-items: stretch; gap: 10px; overflow-x: auto; padding-bottom: 2px; }
.sc-arrow { flex-shrink: 0; align-self: center; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: var(--color-primary-soft); color: var(--color-primary); }
.sc-item { flex: 1 1 0; min-width: 170px; display: flex; flex-direction: column; gap: 8px; }
.sc-item.is-wide { flex-basis: 100%; }
.sc-item.is-audio, .sc-item.is-subtitles, .sc-item.is-text { min-width: 220px; }
.sc-media {
  flex: none; min-height: 160px; height: 360px; display: flex; align-items: center; justify-content: center; overflow: hidden;
  border-radius: 14px; background: #0f1512;
}
.sc-item.is-wide:not(.is-image) .sc-media { height: auto; max-height: 460px; }
.sc-media video { width: 100%; height: 100%; object-fit: contain; }
.sc-media :deep(.el-image) { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.sc-media :deep(.el-image__inner) { width: 100%; height: 100%; object-fit: contain; }
/* 单张对比图按容器宽度等比缩小，完整显示，不再被固定高度从中间裁掉 */
.sc-item.is-wide.is-image .sc-media { height: auto; max-height: none; overflow: visible; }
.sc-item.is-wide.is-image :deep(.el-image) { height: auto; max-height: none; overflow: visible; display: block; }
.sc-item.is-wide.is-image :deep(.el-image__inner) { width: 100%; height: auto; max-height: none; object-fit: contain; }
.sc-item.is-image .sc-media { background: repeating-conic-gradient(var(--color-bg-secondary) 0 25%, var(--color-card) 0 50%) 0 / 16px 16px; }

.sc-audio { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 18px; padding: 18px; background: linear-gradient(160deg, #183326, #0f1512); }
.sc-wave { display: flex; align-items: center; justify-content: center; gap: 4px; height: 90px; }
.sc-wave i { width: 5px; border-radius: 3px; background: linear-gradient(var(--color-primary-light), var(--color-primary)); opacity: 0.85; }
.sc-audio audio { width: 100%; height: 36px; }

.sc-subs { list-style: none; width: 100%; height: 100%; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 4px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: 14px; }
.sc-subs li { display: flex; gap: 10px; padding: 6px 10px; border-radius: 8px; font-size: 13px; color: var(--color-text-secondary); transition: background 0.2s ease; }
.sc-subs li.is-active { background: var(--color-primary-soft); color: var(--color-primary-dark); font-weight: 600; }
.sc-subs time { flex-shrink: 0; font-variant-numeric: tabular-nums; color: var(--color-text-tertiary); }
.sc-text {
  width: 100%; height: 100%; margin: 0; padding: 14px 16px; overflow: auto; white-space: pre-wrap; font-family: inherit;
  font-size: 13px; line-height: 1.85; color: var(--color-text-secondary); background: var(--color-card); border: 1px solid var(--color-border); border-radius: 14px;
}

figcaption { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--color-text-secondary); text-align: center; }
figcaption b { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; background: var(--color-primary); color: #fff; font-size: 11px; }

@media (max-width: 760px) {
  .showcase { padding: 12px 0; }
  .sc-row { scroll-snap-type: x proximity; }
  .sc-item { min-width: min(220px, 100%); scroll-snap-align: start; }
  .sc-media { height: 260px; }
  .sc-arrow { display: none; }
}
</style>
