<template>
  <section class="lm-card panel">
    <h2>个人资料</h2>

    <div class="avatar-row">
      <el-upload
        class="uploader"
        accept="image/jpeg,image/png,image/webp"
        :show-file-list="false"
        :auto-upload="false"
        :disabled="uploading"
        @change="onPick"
      >
        <div class="avatar-wrap" :class="{ 'is-busy': uploading }">
          <UserAvatar :size="88" />
          <span class="mask"><el-icon :size="20"><Camera /></el-icon>{{ uploading ? '上传中' : '更换' }}</span>
        </div>
      </el-upload>
      <div class="avatar-tip">
        <b>头像</b>
        <span>支持 JPG / PNG / WebP，不超过 2 MB</span>
      </div>
    </div>

    <el-form label-position="top" class="form" @submit.prevent="save">
      <el-form-item label="昵称">
        <el-input v-model="nickname" maxlength="32" show-word-limit placeholder="怎么称呼你" />
      </el-form-item>
      <el-form-item label="登录账号">
        <el-input :model-value="authStore.user?.loginName || ''" disabled>
          <template #append>
            <el-button :disabled="!authStore.user?.loginName" @click="copyAccount">复制</el-button>
          </template>
        </el-input>
      </el-form-item>
      <div class="meta">
        <span>加入时间 {{ dateTime(authStore.user?.createdAt) }}</span>
        <span>上次登录 {{ dateTime(authStore.user?.lastLoginAt) }}</span>
      </div>
      <el-button type="primary" round class="save-profile" :loading="saving" :disabled="!changed" native-type="submit">保存修改</el-button>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, type UploadFile } from 'element-plus'
import { Camera } from '@element-plus/icons-vue'
import { updateProfile, uploadAvatar } from '@/api/auth'
import UserAvatar from '@/components/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { dateTime } from '@/utils/format'

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const AVATAR_MAX = 2 * 1024 * 1024

const authStore = useAuthStore()
const nickname = ref(authStore.user?.nickname || '')
const saving = ref(false)
const uploading = ref(false)

const changed = computed(() => nickname.value.trim() !== (authStore.user?.nickname || '') && !!nickname.value.trim())

async function save() {
  saving.value = true
  try {
    authStore.setUser((await updateProfile(nickname.value.trim())).user)
    ElMessage.success('已保存')
  } finally {
    saving.value = false
  }
}

async function copyAccount() {
  const name = authStore.user?.loginName
  if (!name) return
  try {
    await navigator.clipboard.writeText(name)
    ElMessage.success('登录账号已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择账号')
  }
}

async function onPick(file: UploadFile) {
  const raw = file.raw
  if (!raw) return
  if (!AVATAR_TYPES.includes(raw.type)) return void ElMessage.warning('请选择 JPG、PNG 或 WebP 图片')
  if (raw.size > AVATAR_MAX) return void ElMessage.warning('头像不能超过 2 MB')
  uploading.value = true
  try {
    authStore.setUser((await uploadAvatar(raw)).user)
    ElMessage.success('头像已更新')
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.panel { padding: 26px 28px 30px; }
h2 { font-size: 18px; font-weight: 800; margin-bottom: 20px; }
.avatar-row { display: flex; align-items: center; gap: 18px; margin-bottom: 26px; }
.avatar-wrap { position: relative; width: 88px; height: 88px; border-radius: 50%; overflow: hidden; cursor: pointer; }
.mask {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 12px;
  color: #fff; background: rgba(23, 35, 29, 0.55); opacity: 0; transition: opacity 0.15s ease;
}
.avatar-wrap:hover .mask, .avatar-wrap.is-busy .mask { opacity: 1; }
.avatar-tip { display: flex; flex-direction: column; gap: 4px; }
.avatar-tip span { font-size: 13px; color: var(--color-text-tertiary); }
.form { max-width: 420px; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: -4px 0 20px; font-size: 13px; color: var(--color-text-tertiary); }
@media (max-width: 860px) {
  .panel { padding: 16px; }
  h2 { margin-bottom: 14px; }
  .avatar-row {
    flex-direction: column; justify-content: center; gap: 8px; margin-bottom: 18px; padding: 16px 10px;
    border: 1px solid var(--color-divider); border-radius: var(--radius-md); background: var(--color-background);
  }
  .avatar-wrap { flex-shrink: 0; }
  .avatar-wrap .mask { inset: auto 0 0; opacity: 1; padding: 4px 0 6px; }
  .avatar-wrap .mask .el-icon { display: none; }
  .avatar-tip { text-align: center; gap: 0; }
  .form { max-width: none; }
  .form .meta { margin-top: 0; }
  .save-profile { width: 100%; min-height: 42px; }
}
</style>
