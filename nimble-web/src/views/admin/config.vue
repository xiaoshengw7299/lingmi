<template>
  <div class="lm-page account-page account-dashboard">
    <div class="lm-container wrap">
      <header class="head">
        <h1>系统配置</h1>
      </header>

      <section v-loading="loading" class="lm-card settings" aria-labelledby="promotion-title">
        <h2 id="promotion-title">一键成片限时免费</h2>
        <p class="description">活动时段内受理的一键成片任务免单。所有时间均为北京时间。</p>

        <el-form v-if="loaded" label-position="top" :disabled="saving" @submit.prevent="save">
          <el-form-item label="活动开关" for="promotion-enabled">
            <el-switch id="promotion-enabled" v-model="form.enabled" active-text="开启" inactive-text="关闭" />
          </el-form-item>
          <div class="time-fields">
            <el-form-item label="开始时间" for="promotion-start" :required="form.enabled">
              <input id="promotion-start" v-model="form.startsAt" type="datetime-local" step="1" :required="form.enabled" :disabled="saving" />
            </el-form-item>
            <el-form-item label="结束时间" for="promotion-end" :required="form.enabled">
              <input id="promotion-end" v-model="form.endsAt" type="datetime-local" step="1" :required="form.enabled" :disabled="saving" />
            </el-form-item>
          </div>
          <el-button type="primary" native-type="submit" :loading="saving">保存配置</el-button>
        </el-form>
        <el-button v-else-if="!loading" @click="load">重新加载</el-button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getShortVideoPromotion, saveShortVideoPromotion, type ShortVideoPromotion } from '@/api/admin'

const form = reactive({ enabled: false, startsAt: '', endsAt: '' })
const loaded = ref(false)
const loading = ref(true)
const saving = ref(false)
const beijing = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function toInput(value: string | null) {
  if (!value) return ''
  const { year, month, day, hour, minute, second } = Object.fromEntries(
    beijing.formatToParts(new Date(value)).map(({ type, value }) => [type, value]),
  )
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

function applyPromotion(promotion: ShortVideoPromotion) {
  form.enabled = promotion.enabled
  form.startsAt = toInput(promotion.startsAt)
  form.endsAt = toInput(promotion.endsAt)
}

async function load() {
  loading.value = true
  try {
    applyPromotion(await getShortVideoPromotion())
    loaded.value = true
  } catch {
    // 请求拦截器已提示。
  } finally {
    loading.value = false
  }
}

async function save() {
  if (saving.value) return
  const startsAt = form.startsAt ? `${form.startsAt}+08:00` : null
  const endsAt = form.endsAt ? `${form.endsAt}+08:00` : null
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    ElMessage.warning('结束时间须晚于开始时间')
    return
  }
  saving.value = true
  try {
    applyPromotion(await saveShortVideoPromotion({ enabled: form.enabled, startsAt, endsAt }))
    ElMessage.success('配置已保存')
  } catch {
    // 请求拦截器已提示。
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.wrap { padding-block: 24px; }
.head { margin-bottom: 16px; }
.head h1 { font-size: 24px; }
.settings { max-width: 840px; padding: 20px; }
.settings h2 { font-size: 18px; }
.description { margin: 6px 0 18px; font-size: 14px; color: var(--color-text-secondary); }
.time-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 0 16px; }
.time-fields input {
  width: 100%; min-height: 40px; padding: 0 10px; font: inherit;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: var(--color-bg-secondary); color: var(--color-text-primary);
}
</style>
