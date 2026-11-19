<template>
  <div class="lm-page">
    <article class="doc">
      <header>
        <span class="lm-eyebrow">LEGAL</span>
        <h1>{{ doc.title }}</h1>
        <p class="updated">更新日期：{{ doc.updatedAt }}</p>
        <p class="intro">{{ doc.intro }}</p>
      </header>

      <section v-for="(section, index) in doc.sections" :key="section.heading">
        <h2><span>{{ index + 1 }}</span>{{ section.heading }}</h2>
        <p v-for="text in section.paragraphs" :key="text">{{ text }}</p>
        <ul v-if="section.items">
          <li v-for="item in section.items" :key="item">{{ item }}</li>
        </ul>
      </section>

      <footer>
        <router-link :to="other.to">{{ other.label }}</router-link>
        <router-link to="/">返回首页</router-link>
      </footer>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { createLegal } from './content'

const docs = createLegal(import.meta.env.VITE_COMPANY_NAME, import.meta.env.VITE_CONTACT_EMAIL)
const route = useRoute()
const isPrivacy = computed(() => route.name === 'privacy')
const doc = computed(() => (isPrivacy.value ? docs.privacy : docs.terms))
const other = computed(() => (isPrivacy.value ? { to: '/terms', label: '查看用户协议' } : { to: '/privacy', label: '查看隐私政策' }))
</script>

<style scoped>
.doc { max-width: 780px; margin: 0 auto; padding: 44px 28px 80px; }
h1 { margin: 10px 0 6px; font-size: 32px; font-weight: 800; }
.updated { font-size: 13px; color: var(--color-text-tertiary); }
.intro { margin: 18px 0 8px; font-size: 15px; line-height: 1.9; color: var(--color-text-secondary); }
section { margin-top: 30px; }
h2 { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 18px; font-weight: 700; }
h2 span { width: 26px; height: 26px; display: inline-grid; place-items: center; border-radius: 8px; background: var(--color-primary-soft); color: var(--color-primary-dark); font-size: 13px; }
section p, li { font-size: 14.5px; line-height: 1.95; color: var(--color-text-secondary); }
section p + p, section p + ul { margin-top: 6px; }
ul { padding-left: 22px; }
li + li { margin-top: 4px; }
footer { display: flex; gap: 22px; margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--color-border); font-size: 14px; font-weight: 600; color: var(--color-primary); }
</style>
