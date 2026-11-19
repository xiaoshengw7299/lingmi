<template>
  <el-dialog v-model="visible" title="从我的资产选择" width="min(780px, calc(100vw - 20px))" top="max(8px, 6dvh)" append-to-body destroy-on-close @open="reload">
    <div class="bar">
      <el-radio-group v-if="kinds.length > 1" v-model="kind" size="small" @change="reload">
        <el-radio-button v-for="k in kinds" :key="k" :value="k">{{ ASSET_KIND_LABEL[k] }}</el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" size="small" clearable placeholder="搜索名称" class="search" @input="debouncedReload" />
    </div>

    <div v-loading="loading" class="grid">
      <AssetCard
        v-for="asset in items"
        :key="asset.id"
        :asset="asset"
        :selected="chosen.has(asset.id)"
        @click="toggle(asset)"
      />
      <el-empty v-if="!loading && !items.length" description="暂无资产，可在「我的资产」里上传或从创作结果加入" class="empty" />
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!chosen.size" @click="confirm">确定（{{ chosen.size }}）</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AssetCard from '@/components/AssetCard.vue'
import { ASSET_KIND_LABEL, listAssets, type UserAsset, type UserAssetKind } from '@/api/asset'

const props = withDefaults(defineProps<{ kinds?: UserAssetKind[]; multiple?: boolean }>(), {
  kinds: () => ['image', 'video', 'audio', 'prompt'],
  multiple: true,
})
const emit = defineEmits<{ confirm: [assets: UserAsset[]] }>()
const visible = defineModel<boolean>({ default: false })

const PAGE_SIZE = 60
const kind = ref<UserAssetKind>(props.kinds[0])
const keyword = ref('')
const items = ref<UserAsset[]>([])
const loading = ref(false)
const chosen = ref(new Map<string, UserAsset>())

async function reload() {
  loading.value = true
  try {
    items.value = (await listAssets({ kind: kind.value, keyword: keyword.value, pageSize: PAGE_SIZE })).items
  } finally {
    loading.value = false
  }
}

let timer: number | undefined
function debouncedReload() {
  window.clearTimeout(timer)
  timer = window.setTimeout(reload, 300)
}

function toggle(asset: UserAsset) {
  const next = new Map(props.multiple ? chosen.value : [])
  if (chosen.value.has(asset.id)) next.delete(asset.id)
  else next.set(asset.id, asset)
  chosen.value = next
}

function confirm() {
  emit('confirm', [...chosen.value.values()])
  chosen.value = new Map()
  visible.value = false
}
</script>

<style scoped>
.bar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.search { width: 220px; margin-left: auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; min-height: 240px; max-height: 56vh; overflow-y: auto; padding: 2px; }
.empty { grid-column: 1 / -1; }
@media (max-width: 640px) {
  .bar { flex-wrap: wrap; gap: 8px; }
  .search { width: 100%; }
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-height: 0; max-height: 48dvh; }
}
</style>
