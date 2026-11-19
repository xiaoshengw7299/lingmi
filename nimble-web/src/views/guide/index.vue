<template>
  <div ref="pageRef" class="lm-page guide">
    <div class="wrap">
      <aside class="toc">
        <p class="toc-label">目录</p>
        <nav>
          <div v-for="chapter in GUIDE" :key="chapter.id" class="toc-group">
            <a :href="`#${chapter.id}`" :class="{ 'is-active': activeId === chapter.id }" @click.prevent="go(chapter.id)">
              {{ chapter.title }}
            </a>
            <a
              v-for="section in chapter.sections"
              :key="section.id"
              :href="`#${section.id}`"
              class="toc-sub"
              :class="{ 'is-active': activeId === section.id }"
              @click.prevent="go(section.id)"
            >
              {{ section.title }}
            </a>
          </div>
          <div v-for="group in groups" :key="group.id" class="toc-group">
            <a :href="`#${group.id}`" :class="{ 'is-active': activeId === group.id }" @click.prevent="go(group.id)">
              {{ group.title }}
            </a>
            <a
              v-for="tool in group.tools"
              v-show="group.tools.length > 1"
              :key="tool.id"
              :href="`#${tool.id}`"
              class="toc-sub"
              :class="{ 'is-active': activeId === tool.id }"
              @click.prevent="go(tool.id)"
            >
              {{ tool.name }}
            </a>
          </div>
        </nav>
      </aside>

      <article>
        <header class="hero">
          <span class="lm-eyebrow">GUIDE</span>
          <h1>产品介绍</h1>
          <p>{{ GUIDE_INTRO }}</p>
          <div class="jumps">
            <a v-for="item in jumps" :key="item.id" :href="`#${item.id}`" @click.prevent="go(item.id)">
              <strong>{{ item.title }}</strong>
              <span>{{ item.lead }}</span>
            </a>
          </div>
        </header>

        <section v-for="(chapter, chapterIndex) in GUIDE" :id="chapter.id" :key="chapter.id" class="chapter">
          <header class="chapter-head">
            <span class="index">{{ no(chapterIndex + 1) }}</span>
            <div>
              <h2>{{ chapter.title }}</h2>
              <p>{{ chapter.lead }}</p>
            </div>
            <router-link :to="chapter.to" class="open">{{ chapter.toLabel }}</router-link>
          </header>

          <div v-for="section in chapter.sections" :id="section.id" :key="section.id" class="block">
            <div class="block-head">
              <h3>{{ section.title }}</h3>
              <router-link v-if="section.to" :to="section.to">{{ section.toLabel }}</router-link>
            </div>
            <div v-for="(step, stepIndex) in section.blocks" :key="step.title" class="step">
              <span class="step-no">{{ stepIndex + 1 }}</span>
              <div class="step-body">
                <h4>{{ step.title }}</h4>
                <p v-for="text in step.paragraphs" :key="text">{{ text }}</p>
                <ul v-if="step.points">
                  <li v-for="point in step.points" :key="point">{{ point }}</li>
                </ul>
              </div>
            </div>
            <div v-if="section.tips" class="tips">
              <strong>使用时注意</strong>
              <p v-for="tip in section.tips" :key="tip">{{ tip }}</p>
            </div>
          </div>
        </section>

        <section v-for="(group, groupIndex) in groups" :id="group.id" :key="group.id" class="chapter">
          <header class="chapter-head">
            <span class="index">{{ no(GUIDE.length + groupIndex + 1) }}</span>
            <div>
              <h2>{{ group.title }}</h2>
              <p>{{ group.lead }}</p>
            </div>
            <router-link v-if="group.tools.length === 1" :to="group.tools[0].to" class="open">打开{{ group.title }}</router-link>
          </header>

          <div v-for="tool in group.tools" :id="tool.id" :key="tool.id" class="block">
            <div v-if="group.tools.length > 1" class="block-head">
              <h3>{{ tool.name }}</h3>
              <router-link :to="tool.to">打开{{ tool.name }}</router-link>
            </div>
            <div class="step-body">
              <p>{{ tool.intro }}</p>
              <ul v-if="tool.highlights.length">
                <li v-for="point in tool.highlights" :key="point">{{ point }}</li>
              </ul>
              <ul v-if="tool.scenarios.length">
                <li v-for="scene in tool.scenarios" :key="scene.title"><b>{{ scene.title }}</b>：{{ scene.desc }}</li>
              </ul>
              <div v-if="tool.showcase.length" class="example">
                <GuideExample :tool-id="tool.id" :showcase="tool.showcase" />
              </div>
            </div>
            <div v-if="tool.tips.length" class="tips">
              <strong>使用时注意</strong>
              <p v-for="tip in tool.tips" :key="tip">{{ tip }}</p>
            </div>
          </div>
        </section>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getToolCatalog, type Showcase } from '@/api/media-tools'
import { GUIDE_CHAPTERS, GUIDE_INTRO } from '@/seo/site'
import { GENERAL_TOOL_MENU, VIDEO_TOOL_MENU, VIRAL_CLONE, toolPath } from '@/views/tools/menu'
import GuideExample from './GuideExample.vue'
import { GUIDE } from './content'

interface GuideTool {
  id: string
  group: 'video' | 'general'
  name: string
  intro: string
  highlights: string[]
  scenarios: Array<{ title: string; desc: string }>
  tips: string[]
  showcase: Showcase[]
  to: string
}

function fallback(): GuideTool[] {
  const video = [VIRAL_CLONE, ...VIDEO_TOOL_MENU]
  return [
    ...video.map((item) => toTool(item.id, 'video', item.title, item.summary)),
    ...GENERAL_TOOL_MENU.map((item) => toTool(item.id, 'general', item.title, item.summary)),
  ]
}

function toTool(id: string, group: 'video' | 'general', name: string, intro: string, extra: Partial<GuideTool> = {}): GuideTool {
  return {
    id,
    group,
    name,
    intro,
    highlights: [],
    scenarios: [],
    tips: [],
    showcase: [],
    to: toolPath(id, group),
    ...extra,
  }
}

const pageRef = ref<HTMLElement>()
const activeId = ref(GUIDE[0].id)
const loaded = ref<GuideTool[] | null>(null)
const tools = computed(() => loaded.value ?? fallback())
const groups = computed(() => [
  { ...GUIDE_CHAPTERS.clone, tools: tools.value.filter((tool) => tool.id === 'viral-clone') },
  { ...GUIDE_CHAPTERS.video, tools: tools.value.filter((tool) => tool.group === 'video' && tool.id !== 'viral-clone') },
  { ...GUIDE_CHAPTERS.general, tools: tools.value.filter((tool) => tool.group === 'general') },
])
const jumps = computed(() => [
  ...GUIDE.map((chapter) => ({ id: chapter.id, title: chapter.title, lead: chapter.lead })),
  ...groups.value.map((group) => ({ id: group.id, title: group.title, lead: group.lead })),
])

function no(n: number) {
  return String(n).padStart(2, '0')
}

function syncActive() {
  const root = pageRef.value
  if (!root) return
  const top = root.getBoundingClientRect().top
  let current = GUIDE[0].id
  root.querySelectorAll<HTMLElement>('.chapter, .block').forEach((el) => {
    if (el.id && el.getBoundingClientRect().top - top < 88) current = el.id
  })
  activeId.value = current
}

function go(id: string) {
  activeId.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(() => {
  pageRef.value?.addEventListener('scroll', syncActive, { passive: true })
  syncActive()
  getToolCatalog()
    .then((catalog) => {
      loaded.value = catalog.map((tool) =>
        toTool(tool.id, tool.group, tool.name, tool.intro || tool.summary, {
          highlights: tool.highlights,
          scenarios: tool.scenarios,
          tips: tool.tips,
          showcase: tool.showcase ?? [],
        }),
      )
    })
    .catch(() => undefined)
})

onBeforeUnmount(() => pageRef.value?.removeEventListener('scroll', syncActive))
</script>

<style scoped>
.wrap {
  display: grid;
  grid-template-columns: 196px minmax(0, 760px);
  gap: 36px;
  justify-content: center;
  padding: 28px 28px 80px;
}
.toc {
  position: sticky;
  top: 18px;
  align-self: start;
  max-height: calc(100vh - var(--header-height) - 36px);
  overflow: auto;
}
.toc-label {
  margin: 0 12px 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-text-tertiary);
}
.toc a {
  display: block;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.toc a.toc-sub { padding-left: 22px; font-size: 13px; font-weight: 600; }
.toc a:hover { background: var(--color-bg-secondary); color: var(--color-text-primary); }
.toc a.is-active { background: var(--color-primary-soft); color: var(--color-primary-dark); }
.toc-group + .toc-group { margin-top: 6px; }

.hero h1 { margin: 8px 0 8px; font-size: 32px; font-weight: 800; letter-spacing: -0.02em; }
.hero > p { max-width: 640px; font-size: 15px; line-height: 1.8; color: var(--color-text-secondary); }
.jumps { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 22px; }
.jumps a {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 112px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
  box-shadow: var(--shadow-sm);
  transition: var(--transition);
}
.jumps a:hover { border-color: var(--color-primary-line); transform: translateY(-1px); }
.jumps strong { font-size: 15px; }
.jumps span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-tertiary);
}

.chapter { margin-top: 42px; scroll-margin-top: 16px; }
.chapter-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-divider);
}
.index { font-size: 13px; font-weight: 800; letter-spacing: 0.08em; color: var(--color-primary); }
.chapter-head h2 { font-size: 24px; font-weight: 800; }
.chapter-head p { margin-top: 6px; font-size: 14.5px; line-height: 1.75; color: var(--color-text-secondary); }
.open, .block-head a {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-primary-dark);
  white-space: nowrap;
}
.open {
  height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-primary-soft);
}

.block { margin-top: 26px; scroll-margin-top: 16px; }
.block-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.block-head h3 { font-size: 18px; font-weight: 700; }
.step { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; margin-top: 16px; }
.step-no {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: 13px;
  font-weight: 800;
}
.step-body h4 { margin-bottom: 6px; font-size: 15.5px; }
.step-body p, .step-body li, .tips p { font-size: 14.5px; line-height: 1.85; color: var(--color-text-secondary); }
.step-body p + p, .step-body p + ul, .step-body ul + ul { margin-top: 8px; }
.step-body ul { padding-left: 18px; }
.step-body li + li { margin-top: 6px; }
.example {
  margin-top: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
  overflow: hidden;
}
.tips {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
}
.tips strong { display: block; margin-bottom: 4px; font-size: 13px; color: var(--color-primary-dark); }
.tips p { color: var(--color-text-secondary); }
.tips p + p { margin-top: 4px; }

@media (max-width: 860px) {
  .wrap { grid-template-columns: 1fr; gap: 18px; padding: 18px 16px 64px; }
  .toc { position: static; max-height: none; }
  .toc nav { display: flex; gap: 6px; overflow-x: auto; }
  .toc-group { display: flex; gap: 6px; }
  .toc a { white-space: nowrap; background: var(--color-card); border: 1px solid var(--color-border); }
  .chapter-head { grid-template-columns: 1fr; }
  .hero h1 { font-size: 26px; }
}
</style>
