<template>
  <div>
    <div class="page-head">
      <div><h1>审计</h1><p>记录后台写操作。密钥类字段已打码。</p></div>
      <el-input v-model="keyword" clearable placeholder="用户或路径" style="width:220px" @change="load" />
    </div>
    <el-table :data="list">
      <el-table-column prop="username" label="操作人" width="120" />
      <el-table-column prop="method" label="方法" width="80" />
      <el-table-column prop="path" label="路径" min-width="220" />
      <el-table-column prop="status" label="状态" width="80" />
      <el-table-column label="时间" width="160"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
    </el-table>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { auditLogs } from '@/api';
import { time } from '@/utils/format';
const list = ref<any[]>([]); const keyword = ref('');
async function load() { const data = (await auditLogs({ page: 1, pageSize: 50, keyword: keyword.value || undefined })) as any; list.value = data.items; }
onMounted(load);
</script>
