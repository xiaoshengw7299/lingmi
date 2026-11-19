<template>
  <div class="prompt-field" :class="{ 'is-readonly': readonly }">
    <MentionInput
      :model-value="modelValue"
      :options="options"
      :upload-fn="readonly ? undefined : uploadFn"
      :placeholder="placeholder"
      :rows="rows ?? 3"
      :readonly="readonly"
      @update:model-value="!readonly && $emit('update:modelValue', $event)"
      @blur="$emit('blur')"
    />
    <el-button text circle class="expand-btn" :icon="FullScreen" :title="readonly ? '查看提示词' : '放大编辑'" @click="dialogVisible = true" />

    <el-dialog v-model="dialogVisible" :title="dialogTitle ?? (readonly ? '查看提示词' : '编辑提示词')" width="min(640px, calc(100vw - 20px))" top="max(8px, 6dvh)" append-to-body @closed="$emit('blur')">
      <div class="prompt-dialog-tip">{{ dialogTip ?? '用 @ 引用已生成的角色/场景参考图或本地上传图片' }}</div>
      <MentionInput
        :model-value="modelValue"
        :options="options"
        :upload-fn="readonly ? undefined : uploadFn"
        :placeholder="placeholder"
        :rows="12"
        :readonly="readonly"
        @update:model-value="!readonly && $emit('update:modelValue', $event)"
      />
      <template #footer>
        <el-button type="primary" @click="dialogVisible = false">{{ readonly ? '关闭' : '完成' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FullScreen } from '@element-plus/icons-vue'
import MentionInput, { type MentionOption } from './MentionInput.vue'

withDefaults(defineProps<{
  modelValue?: string
  options: MentionOption[]
  placeholder?: string
  rows?: number
  dialogTitle?: string
  dialogTip?: string
  uploadFn?: (file: File) => Promise<{ name: string }>
  readonly?: boolean
}>(), {
  modelValue: '',
  rows: 3,
  readonly: false,
})
defineEmits<{ 'update:modelValue': [value: string]; blur: [] }>()

const dialogVisible = ref(false)
</script>

<style scoped>
.prompt-field { position: relative; }
.prompt-field.is-readonly :deep(textarea) { pointer-events: none; }
.expand-btn {
  position: absolute; top: 6px; right: 6px; z-index: 5; width: 24px; height: 24px;
  color: var(--color-text-tertiary); background: rgba(255, 255, 255, .7); border-radius: 4px;
}
.expand-btn:hover { color: var(--color-primary-light); background: var(--color-card); }
.prompt-dialog-tip { font-size: 12px; color: var(--color-text-tertiary); margin-bottom: 10px; }
</style>
