<template>
  <div class="contact">
    <div class="pop">
      <img v-if="!missing" :src="qr" alt="微信二维码" width="168" height="168" @error="missing = true" />
      <p v-else class="missing">二维码暂不可用</p>
      <a v-if="email" class="mail" :href="`mailto:${email}`">邮箱：{{ email }}</a>
    </div>
    <button type="button" class="btn" aria-label="联系我们">
      <el-icon :size="18"><Service /></el-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Service } from '@element-plus/icons-vue'

/** 微信二维码放在 public/wechat-qr.png，或用 VITE_WECHAT_QR 指定地址 */
const qr = import.meta.env.VITE_WECHAT_QR || '/wechat-qr.png'
const email = import.meta.env.VITE_CONTACT_EMAIL
const missing = ref(false)
</script>

<style scoped>
.contact { position: fixed; right: 22px; bottom: 22px; z-index: 20; }

.btn {
  display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; cursor: pointer;
  border: 1px solid rgba(23, 35, 29, 0.08); background: rgba(255, 255, 255, 0.72);
  color: var(--color-text-tertiary); opacity: 0.55; box-shadow: none; transition: var(--transition);
}
.contact:hover .btn,
.contact:focus-within .btn {
  opacity: 1; color: var(--color-primary-dark); background: var(--color-card); border-color: var(--color-primary-line); box-shadow: var(--shadow-md);
}

/* 卡片和按钮略微重叠，鼠标从按钮移到二维码时不会中途消失 */
.pop {
  position: absolute; right: 0; bottom: 36px; display: grid; justify-items: center; gap: 10px;
  width: 196px; padding: 14px 14px 12px; border-radius: var(--radius-lg);
  background: var(--color-card); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg);
  opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(6px);
  transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s;
}
.contact:hover .pop,
.contact:focus-within .pop {
  opacity: 1; visibility: visible; pointer-events: auto; transform: none;
}
.pop img { display: block; width: 168px; height: 168px; border-radius: var(--radius-sm); }
.missing { width: 168px; height: 168px; display: grid; place-items: center; margin: 0; border-radius: var(--radius-sm); background: var(--color-bg-secondary); font-size: 13px; color: var(--color-text-tertiary); }
.mail { font-size: 12px; line-height: 1.5; color: var(--color-text-secondary); word-break: break-all; text-align: center; }
.mail:hover { color: var(--color-primary); }
</style>
