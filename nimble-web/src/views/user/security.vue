<template>
  <section class="lm-card panel">
    <h2>{{ hasPassword ? '修改密码' : '设置密码' }}</h2>
    <p class="desc">
      {{ hasPassword ? '修改后其他设备会退出登录，当前设备保持登录。' : '设置密码后，可以用登录账号和密码直接登录，不必每次扫码。' }}
    </p>

    <div class="account">
      <span>登录账号</span>
      <b>{{ authStore.user?.loginName || '—' }}</b>
      <div class="account-actions">
        <el-button link type="primary" :disabled="!authStore.user?.loginName" @click="copyAccount">复制</el-button>
        <el-button v-if="authStore.user?.canChangeLoginName && !editingAccount" link type="primary" :disabled="saving" @click="editAccount">修改</el-button>
      </div>
    </div>

    <el-form v-if="editingAccount" label-position="top" class="form account-form" @submit.prevent="saveAccount">
      <el-form-item label="新登录账号" :error="accountError">
        <el-input v-model="newAccount" maxlength="32" placeholder="4～32 位字母或数字" autocapitalize="off" :disabled="savingAccount" @input="accountError = ''" />
      </el-form-item>
      <div class="edit-actions">
        <el-button type="primary" :loading="savingAccount" native-type="submit">保存账号</el-button>
        <el-button :disabled="savingAccount" @click="editingAccount = false">取消</el-button>
      </div>
    </el-form>

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="form" @submit.prevent="submit">
      <el-form-item v-if="hasPassword" label="当前密码" prop="oldPassword">
        <el-input v-model="form.oldPassword" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input v-model="form.newPassword" type="password" show-password autocomplete="new-password" placeholder="8～64 位" />
      </el-form-item>
      <el-form-item label="确认新密码" prop="confirm">
        <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-button type="primary" round class="save-password" :disabled="savingAccount" :loading="saving" native-type="submit">{{ hasPassword ? '修改密码' : '设置密码' }}</el-button>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { changeLoginName, changePassword } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const formRef = ref<FormInstance>()
const saving = ref(false)
const editingAccount = ref(false)
const savingAccount = ref(false)
const newAccount = ref('')
const accountError = ref('')
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const hasPassword = computed(() => !!authStore.user?.hasPassword)

const rules = computed<FormRules>(() => ({
  oldPassword: [{ required: hasPassword.value, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码长度 8～64 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再输入一次新密码', trigger: 'blur' },
    { validator: (_r, value, cb) => cb(value === form.newPassword ? undefined : new Error('两次输入的密码不一致')), trigger: 'blur' },
  ],
}))

async function submit() {
  if (saving.value || savingAccount.value) return
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    const updating = hasPassword.value
    const tokens = await changePassword(form.newPassword, updating ? form.oldPassword : undefined)
    authStore.setTokens(tokens.accessToken, tokens.refreshToken)
    authStore.setUser({ ...authStore.user!, hasPassword: true })
    formRef.value?.resetFields()
    ElMessage.success(updating ? '密码已更新' : '密码已设置，之后可以用账号登录')
  } finally {
    saving.value = false
  }
}

function editAccount() {
  newAccount.value = authStore.user?.loginName ?? ''
  accountError.value = ''
  editingAccount.value = true
}

async function saveAccount() {
  if (saving.value || savingAccount.value) return
  const account = newAccount.value.trim().toLowerCase()
  if (!/^[a-z0-9]{4,32}$/.test(account)) {
    accountError.value = '请输入 4～32 位字母或数字'
    return
  }
  savingAccount.value = true
  try {
    const { user } = await changeLoginName(account)
    authStore.setUser(user)
    editingAccount.value = false
    ElMessage.success('登录账号已更新')
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 409) {
      accountError.value = '该登录账号已被使用'
    }
  } finally {
    savingAccount.value = false
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
</script>

<style scoped>
.panel { padding: 26px 28px 30px; }
h2 { font-size: 18px; font-weight: 800; }
.desc { margin: 6px 0 18px; font-size: 13px; color: var(--color-text-tertiary); }
.account {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px; width: fit-content; max-width: 100%;
  margin-bottom: 22px; padding: 12px 14px; border-radius: var(--radius-md); background: var(--color-primary-soft);
}
.account span { font-size: 13px; color: var(--color-text-secondary); }
.account b { min-width: 0; overflow-wrap: anywhere; font-size: 18px; letter-spacing: 0.04em; }
.account-actions { display: flex; gap: 10px; }
.account-actions .el-button + .el-button { margin-left: 0; }
.form { max-width: 380px; }
.account-form { margin-bottom: 22px; }
@media (max-width: 860px) {
  .panel { padding: 16px; }
  .form { max-width: none; }
  .account { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; width: 100%; padding: 12px; }
  .account b { font-size: 16px; letter-spacing: .02em; }
  .account-actions { justify-content: flex-end; gap: 8px; }
  .account-actions .el-button { min-height: 36px; min-width: 48px; border-radius: var(--radius-sm); background: var(--color-card); }
  .edit-actions { display: flex; gap: 8px; }
  .edit-actions .el-button { flex: 1; margin: 0; }
  .save-password { width: 100%; }
  .form .el-button { min-height: 42px; }
}
</style>
