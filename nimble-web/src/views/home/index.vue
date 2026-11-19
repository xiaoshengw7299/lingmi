<template>
  <div class="lm-page home">
    <!-- 首屏 -->
    <section class="hero">
      <div class="lm-container hero-grid">
        <div class="hero-copy">
          <h1>{{ HOME_COPY.h1 }}</h1>
          <p class="lead">{{ HOME_COPY.lead }}</p>
          <div class="cta">
            <router-link class="hero-button" to="/short-video">
              {{ deadline ? '免费做一条' : '开始一键成片' }}
              <el-icon class="el-icon--right"><Right /></el-icon>
            </router-link>
          </div>
          <p v-if="deadline" class="hero-offer"><strong>一键成片限时免费</strong><span>{{ deadline }}</span></p>
        </div>

        <div class="stage" aria-hidden="true">
          <div class="player">
            <span class="portrait"><el-icon :size="46"><VideoCamera /></el-icon><i /><i /></span>
            <div class="timeline">
              <span v-for="n in 6" :key="n" class="clip" :style="{ '--i': n }" />
              <span class="playhead" />
            </div>
          </div>
          <div class="float float-a"><el-icon><DocumentChecked /></el-icon>脚本已生成</div>
          <div class="float float-b"><el-icon><Microphone /></el-icon>配音完成</div>
        </div>
      </div>
    </section>

    <!-- 活动横幅：规则来自支付后台，改了立即生效 -->
    <section v-if="promoText" class="lm-container">
      <div class="promo" @click="router.push(authStore.isLoggedIn ? '/user/referral' : '/login')">
        <el-icon :size="22"><Present /></el-icon>
        <p>{{ promoText }}</p>
        <span>{{ authStore.isLoggedIn ? '去邀请' : '去登录' }}<el-icon><Right /></el-icon></span>
      </div>
    </section>

    <!-- 功能介绍 -->
    <section class="section">
      <div class="lm-container">
        <header class="section-head">
          <span class="lm-eyebrow">FEATURES</span>
          <h2>{{ HOME_COPY.featuresTitle }}</h2>
          <p>{{ HOME_COPY.featuresLead }}</p>
        </header>
        <div class="features">
          <article v-for="f in HOME_FEATURES" :key="f.path" class="feature lm-card" @click="go(f.path)">
            <span class="f-icon" :style="{ '--tone': f.tone }"><el-icon :size="22"><component :is="f.icon" /></el-icon></span>
            <h3>{{ f.title }}</h3>
            <p>{{ f.desc }}</p>
            <ul>
              <li v-for="point in f.points" :key="point">{{ point }}</li>
            </ul>
            <p v-if="f.links" class="more-links">
              <router-link v-for="link in f.links" :key="link.path" :to="link.path" @click.stop>{{ link.label }}</router-link>
            </p>
            <span class="enter">{{ f.path.startsWith('#') ? '按场景查看' : `进入${f.title}` }}<el-icon><Right /></el-icon></span>
          </article>
        </div>
      </div>
    </section>

    <section id="scenarios" class="section">
      <div class="lm-container">
        <header class="section-head">
          <span class="lm-eyebrow">TOOLS</span>
          <h2>{{ HOME_COPY.scenariosTitle }}</h2>
          <p>{{ HOME_COPY.scenariosLead }}</p>
        </header>
        <div class="scenarios">
          <article v-for="group in HOME_SCENARIOS" :key="group.title" class="scenario">
            <h3>{{ group.title }}</h3>
            <p>{{ group.desc }}</p>
            <ul>
              <li v-for="tool in group.tools" :key="tool.path">
                <router-link :to="tool.path">{{ tool.title }}</router-link>
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <!-- 流程 -->
    <section class="section tint">
      <div class="lm-container">
        <header class="section-head">
          <span class="lm-eyebrow">HOW IT WORKS</span>
          <h2>{{ HOME_COPY.stepsTitle }}</h2>
        </header>
        <ol class="steps">
          <li v-for="(s, i) in HOME_STEPS" :key="s.title">
            <span class="no">{{ i + 1 }}</span>
            <h3>{{ s.title }}</h3>
            <p>{{ s.desc }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- 价格透明 -->
    <section class="section">
      <div class="lm-container">
        <header class="section-head">
          <span class="lm-eyebrow">TRANSPARENT PRICING</span>
          <h2>{{ HOME_COPY.pricingTitle }}</h2>
          <p>{{ HOME_COPY.pricingLead }}</p>
        </header>
        <PriceStatement />
        <PriceTable :rows="pricing.rows" :loading="pricing.loading" :limit="5" />
        <div class="more">
          <el-button round @click="router.push('/pricing')">查看全部模型价格<el-icon class="el-icon--right"><Right /></el-icon></el-button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="lm-container faq-wrap">
        <header class="section-head">
          <span class="lm-eyebrow">FAQ</span>
          <h2>{{ HOME_COPY.faqTitle }}</h2>
        </header>
        <PriceFaq :show-title="false" />
      </div>
    </section>

    <footer class="foot">
      <div class="lm-container foot-row">
        <BrandLogo :size="28" />
        <nav>
          <router-link v-for="item in FOOTER_LINKS" :key="item.to" :to="item.to">{{ item.label }}</router-link>
          <router-link v-if="!authStore.isLoggedIn" to="/login">登录</router-link>
          <router-link v-else to="/user/profile">用户中心</router-link>
        </nav>
        <p>
          © {{ new Date().getFullYear() }} 灵米 LingMI
          <span v-if="company"> · {{ company }}</span>
          <a v-if="icp" class="icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">{{ icp }}</a>
          <a class="icp" href="https://beian.mps.gov.cn/#/query/webSearch?code=44011502001905" rel="noreferrer" target="_blank">
            <img src="/gongan.png" alt="" />
            粤公网安备44011502001905号
          </a>
        </p>
      </div>
    </footer>

    <ContactFloat />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DocumentChecked,
  Microphone,
  Present,
  Right,
  VideoCamera,
} from '@element-plus/icons-vue'
import { getPromo } from '@/api/wallet'
import BrandLogo from '@/components/BrandLogo.vue'
import ContactFloat from '@/components/ContactFloat.vue'
import PriceFaq from '@/components/PriceFaq.vue'
import PriceStatement from '@/components/PriceStatement.vue'
import PriceTable from '@/components/PriceTable.vue'
import { COMPANY_NAME, FOOTER_LINKS, HOME_COPY, HOME_FEATURES, HOME_SCENARIOS, HOME_STEPS } from '@/seo/site'
import { useAuthStore } from '@/stores/auth'
import { usePricingStore } from '@/stores/pricing'
import { yuan } from '@/utils/format'
import { useShortVideoPricing } from '@/composables/useShortVideoPricing'

const router = useRouter()
const authStore = useAuthStore()
const pricing = usePricingStore()
const { deadline } = useShortVideoPricing()
const promo = ref<Awaited<ReturnType<typeof getPromo>>>(null)
const icp = import.meta.env.VITE_ICP
const company = import.meta.env.VITE_COMPANY_NAME || COMPANY_NAME

const promoText = computed(() => {
  const rule = promo.value
  if (!rule) return ''
  const parts: string[] = []
  if (rule.signupGiftCents > 0) parts.push(`新用户登录即送 ¥${yuan(rule.signupGiftCents)}`)
  if (rule.rewardCents > 0) parts.push(`邀请好友完成首次充值，你得 ¥${yuan(rule.rewardCents)}`)
  return parts.join('　·　')
})

function go(path: string) {
  if (path.startsWith('#')) {
    document.getElementById(path.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  router.push(path)
}

onMounted(() => {
  void pricing.load().catch(() => undefined)
  getPromo().then((rule) => (promo.value = rule)).catch(() => undefined)
})
</script>

<style scoped>
.home { background: var(--color-background); }

/* ===== 首屏 ===== */
.hero { position: relative; padding: 56px 0 40px; overflow: hidden; }
.hero::before {
  content: ''; position: absolute; inset: -20% -10% auto auto; width: 620px; height: 620px; border-radius: 50%; z-index: 0;
  background: radial-gradient(circle, rgba(52, 178, 127, 0.22), transparent 68%);
}
.hero::after {
  content: ''; position: absolute; inset: auto auto -30% -8%; width: 460px; height: 460px; border-radius: 50%; z-index: 0;
  background: radial-gradient(circle, rgba(227, 155, 18, 0.16), transparent 70%);
}
.hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 48px; align-items: center; }
.hero-copy h1 { margin: 14px 0 18px; font-size: clamp(30px, 3.4vw, 44px); line-height: 1.22; font-weight: 800; letter-spacing: 0.01em; }
.lead { max-width: 520px; font-size: 17px; line-height: 1.85; color: var(--color-text-secondary); }
.cta { display: flex; margin: 24px 0 12px; }
.hero-button { display: inline-flex; align-items: center; min-height: 48px; padding: 0 22px; border-radius: 999px; background: var(--color-primary); color: #fff; font-size: 16px; font-weight: 700; }
.hero-button:hover { background: var(--color-primary-dark); color: #fff; }
.hero-offer { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px; font-size: 13px; color: var(--color-text-secondary); }
.hero-offer strong { color: var(--color-primary-dark); }

/* 首屏右侧：纯 CSS 的"创作台"示意图 */
.stage { position: relative; padding: 28px 18px 36px; }
.player {
  position: relative; aspect-ratio: 16 / 10; border-radius: var(--radius-xl); overflow: hidden; box-shadow: var(--shadow-lg);
  background: linear-gradient(135deg, #0f3d2c 0%, #0b8f5f 48%, #e9c46a 120%);
}
.player::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 70% 25%, rgba(255, 255, 255, 0.28), transparent 45%); }
.portrait { position: absolute; top: 9%; left: 50%; transform: translateX(-50%); height: 70%; aspect-ratio: 9 / 16; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border-radius: 12px; border: 1px solid #ffffff80; background: #093c2a66; color: #fff; }
.portrait i { width: 58%; height: 4px; border-radius: 3px; background: #ffffffc9; }
.portrait i:last-child { width: 40%; }
.timeline { position: absolute; left: 14px; right: 14px; bottom: 14px; display: flex; gap: 6px; padding: 8px; border-radius: 12px; background: rgba(0, 0, 0, 0.28); }
.clip { flex: 1; height: 30px; border-radius: 6px; background: hsl(calc(150 - var(--i) * 12) 55% calc(70% - var(--i) * 2%)); opacity: 0.92; }
.playhead { position: absolute; top: 4px; bottom: 4px; left: 38%; width: 2px; border-radius: 2px; background: var(--color-card); box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.25); }
.float {
  position: absolute; display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--radius-md);
  background: var(--color-card); box-shadow: var(--shadow-md); font-size: 13px; font-weight: 600; animation: bob 5s ease-in-out infinite;
}
.float .el-icon { color: var(--color-primary); }
.float-a { top: 0; right: 0; }
.float-b { left: 0; bottom: 6px; animation-delay: -1.6s; }
@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }

/* ===== 活动横幅 ===== */
.promo {
  display: flex; align-items: center; gap: 14px; padding: 16px 22px; border-radius: var(--radius-lg); cursor: pointer;
  background: linear-gradient(100deg, var(--color-accent-soft), var(--color-warning-soft) 60%, var(--color-primary-soft)); border: 1px solid var(--color-border);
  color: var(--color-warning); transition: var(--transition);
}
.promo:hover { box-shadow: var(--shadow-md); }
.promo p { flex: 1; font-size: 15px; font-weight: 700; }
.promo span { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; white-space: nowrap; }

/* ===== 通用分区 ===== */
.section { padding: 72px 0 8px; }
.section.tint { margin-top: 56px; padding: 64px 0; background: var(--color-bg-secondary); }
.section-head { max-width: 640px; margin: 0 auto 36px; text-align: center; }
.section-head h2 { margin: 10px 0 10px; font-size: 32px; font-weight: 800; }
.section-head p { font-size: 15px; line-height: 1.8; color: var(--color-text-secondary); }

/* ===== 功能卡片 ===== */
.features { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
.feature { display: flex; flex-direction: column; padding: 24px; cursor: pointer; transition: var(--transition); }
.feature:hover { transform: translateY(-4px); box-shadow: var(--shadow-md); border-color: var(--color-primary-line); }
.f-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 14px; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, white); }
.feature h3 { margin: 16px 0 8px; font-size: 18px; }
.feature p { font-size: 14px; line-height: 1.75; color: var(--color-text-secondary); }
.feature ul { list-style: none; margin: 14px 0 18px; display: grid; gap: 7px; font-size: 13px; color: var(--color-text-secondary); }
.feature li::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: 50%; background: var(--color-primary-light); vertical-align: middle; }
.enter { margin-top: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; color: var(--color-primary); }
.more-links { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 0 0 12px; }
.more-links a { font-size: 13px; font-weight: 700; color: var(--color-primary-dark); }
.scenarios { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.scenario { padding: 18px 18px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-card); }
.scenario h3 { font-size: 16px; }
.scenario p { margin-top: 4px; font-size: 13px; color: var(--color-text-tertiary); }
.scenario ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.scenario a { display: inline-block; padding: 4px 10px; border-radius: 999px; background: var(--color-primary-soft); color: var(--color-primary-dark); font-size: 13px; font-weight: 650; }
.scenario a:hover { background: var(--color-primary); color: #fff; }
#scenarios { scroll-margin-top: 12px; }

/* ===== 步骤 ===== */
.steps { list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.steps li { position: relative; padding: 26px 24px; border-radius: var(--radius-lg); background: var(--color-card); border: 1px solid var(--color-border); }
.no { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--color-primary); color: #fff; font-weight: 800; }
.steps h3 { margin: 14px 0 6px; font-size: 18px; }
.steps p { font-size: 14px; line-height: 1.75; color: var(--color-text-secondary); }

/* ===== 价格 ===== */
.more { display: flex; justify-content: center; margin-top: 22px; }
.faq-wrap { max-width: 860px; }
.faq-wrap :deep(.el-collapse) { border: none; }
.faq-wrap :deep(.el-collapse-item) { margin-bottom: 10px; overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); }
.faq-wrap :deep(.el-collapse-item__header) { height: auto; min-height: 52px; padding: 12px 18px; border: none; font-size: 15px; font-weight: 700; line-height: 1.5; background: transparent; }
.faq-wrap :deep(.el-collapse-item__wrap) { border: none; background: transparent; }
.faq-wrap :deep(.el-collapse-item__content) { padding: 0 18px 16px; }

/* ===== 页脚 ===== */
.foot { margin-top: 64px; padding: 28px 0 36px; border-top: 1px solid var(--color-border); }
.foot-row { display: flex; align-items: center; flex-wrap: wrap; gap: 14px 28px; }
.foot nav { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 14px; color: var(--color-text-secondary); }
.foot nav a:hover { color: var(--color-primary); }
.foot p { margin-left: auto; font-size: 13px; color: var(--color-text-tertiary); }
.foot .icp { margin-left: 12px; color: inherit; display: inline-flex; align-items: center; gap: 4px; }
.foot .icp img { height: 14px; width: auto; }
.foot .icp:hover { color: var(--color-primary); }

@media (max-width: 900px) { .features, .scenarios { grid-template-columns: 1fr 1fr; } }
@media (max-width: 860px) {
  .hero { padding-top: 32px; }
  .hero-grid { grid-template-columns: 1fr; gap: 28px; }
  .steps { grid-template-columns: 1fr; }
  .section { padding-top: 52px; }
  .section-head h2 { font-size: 26px; }
  .foot p { margin-left: 0; }
}
@media (max-width: 560px) { .features, .scenarios { grid-template-columns: 1fr; } .lm-container { padding: 0 18px; } }
</style>
