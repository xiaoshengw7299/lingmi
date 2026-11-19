<template>
  <div class="asset-card" :class="{ 'is-selected': selected }">
    <div class="preview">
      <el-image v-if="asset.kind === 'image' && asset.url" :src="asset.url" fit="contain" loading="lazy" />
      <video v-else-if="asset.kind === 'video' && asset.url" :src="asset.url" preload="metadata" muted playsinline />
      <div v-else-if="asset.kind === 'audio'" class="audio-box">
        <el-icon :size="26"><Headset /></el-icon>
        <audio v-if="asset.url" :src="asset.url" controls preload="none" @click.stop />
      </div>
      <p v-else class="prompt-text">{{ asset.content }}</p>
      <span class="badge">{{ ASSET_KIND_LABEL[asset.kind] }}</span>
      <div v-if="$slots.actions" class="actions" @click.stop><slot name="actions" /></div>
    </div>
    <span class="name" :title="asset.name">{{ asset.name }}</span>
  </div>
</template>

<script setup lang="ts">
import { Headset } from '@element-plus/icons-vue'
import { ASSET_KIND_LABEL, type UserAsset } from '@/api/asset'

defineProps<{ asset: UserAsset; selected?: boolean }>()
</script>

<style scoped>
.asset-card { display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; transition: var(--transition); }
.asset-card:hover { border-color: var(--color-primary-line); box-shadow: var(--shadow-sm); }
.asset-card.is-selected { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-soft); }
.preview { position: relative; aspect-ratio: 4 / 3; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-bg-secondary); }
.preview :deep(.el-image) { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.preview :deep(.el-image__inner) { width: 100%; height: 100%; object-fit: contain; }
.preview video { width: 100%; height: 100%; object-fit: cover; display: block; }
.audio-box { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--color-text-tertiary); }
.audio-box audio { width: 90%; height: 32px; }
.prompt-text { margin: 0; padding: 10px; height: 100%; overflow: hidden; font-size: 12.5px; line-height: 1.6; color: var(--color-text-secondary); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; }
.badge { position: absolute; left: 6px; top: 6px; padding: 1px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 11px; }
.actions { position: absolute; right: 6px; top: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.asset-card:hover .actions { opacity: 1; }
.name { padding: 0 2px 2px; font-size: 13px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
