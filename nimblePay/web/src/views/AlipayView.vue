<template>
  <div v-if="form" class="alipay-page">
    <div class="page-head">
      <div>
        <h1>支付宝</h1>
        <p>电脑网站支付渠道。回调地址要配到支付宝开放平台；私钥和证书只显示掩码，不改动就保持原样。</p>
      </div>
      <div class="head-status">
        <el-tag :type="form.enabled ? 'success' : 'info'" effect="light" round>{{ form.enabled ? '已启用' : '未启用' }}</el-tag>
        <el-tag :type="form.sandbox ? 'warning' : 'danger'" effect="light" round>{{ form.sandbox ? '沙箱环境' : '正式环境' }}</el-tag>
        <span class="updated">更新于 {{ time(form.updatedAt) }}</span>
      </div>
    </div>

    <div class="top-grid">
      <section class="panel card">
        <header class="card-head">
          <span class="card-icon"><el-icon><Setting /></el-icon></span>
          <div><h2>基础配置</h2><p>应用身份与运行环境</p></div>
        </header>

        <div class="switch-row">
          <div>
            <div class="sw-title">启用支付宝支付</div>
            <div class="sw-desc">关闭后无法发起新的收款，已创建的订单不受影响。</div>
          </div>
          <el-switch v-model="form.enabled" size="large" :disabled="!canEdit" />
        </div>
        <div class="switch-row">
          <div>
            <div class="sw-title">沙箱环境</div>
            <div class="sw-desc">走支付宝沙箱网关，只用于联调。正式收款前请关闭。</div>
          </div>
          <el-switch v-model="form.sandbox" size="large" :disabled="!canEdit" />
        </div>
        <div class="switch-row">
          <div>
            <div class="sw-title">证书模式</div>
            <div class="sw-desc">用应用公钥证书、支付宝公钥证书和根证书签名验签；关闭则使用支付宝公钥。</div>
          </div>
          <el-switch v-model="form.useCert" size="large" :disabled="!canEdit" />
        </div>

        <el-form label-position="top" size="large" class="fields">
          <el-form-item label="APPID" class="span-2">
            <el-input v-model="form.appId" placeholder="开放平台应用的 APPID" :disabled="!canEdit" />
          </el-form-item>
          <el-form-item label="私钥格式">
            <el-select v-model="form.keyType" :disabled="!canEdit" style="width: 100%">
              <el-option label="PKCS1（RSA 私钥）" value="PKCS1" />
              <el-option label="PKCS8" value="PKCS8" />
            </el-select>
          </el-form-item>
        </el-form>
      </section>

      <section class="panel card">
        <header class="card-head">
          <span class="card-icon"><el-icon><Link /></el-icon></span>
          <div><h2>回调地址</h2><p>把下面的地址配置到开放平台应用</p></div>
        </header>
        <div v-for="u in urls" :key="u.label" class="url-item">
          <div class="url-label">{{ u.label }}<span>{{ u.tip }}</span></div>
          <div class="url-box">
            <code>{{ u.value || '—' }}</code>
            <el-button v-if="u.value" text type="primary" :icon="CopyDocument" @click="copy(u.value)">复制</el-button>
          </div>
        </div>
        <el-alert type="info" :closable="false" show-icon title="退款、转账的通知地址随请求下发，不需要在开放平台单独配置。" />
      </section>
    </div>

    <section class="panel card">
      <header class="card-head">
        <span class="card-icon"><el-icon><Key /></el-icon></span>
        <div><h2>密钥与证书</h2><p>{{ form.useCert ? '证书模式：需要应用私钥和三份证书' : '公钥模式：需要应用私钥和支付宝公钥' }}。内容加密存储，页面上只回显掩码。</p></div>
      </header>
      <el-form label-position="top" class="key-grid">
        <el-form-item v-for="f in keyFields" :key="f.field" :class="{ 'span-2': f.wide }">
          <template #label>
            <span>{{ f.label }}</span>
            <el-tag v-if="f.configured" type="success" size="small" effect="plain" round class="configured">已配置</el-tag>
          </template>
          <el-input
            v-model="form[f.field]"
            type="textarea"
            :rows="f.wide ? 7 : 6"
            class="mono"
            :disabled="!canEdit"
            :placeholder="f.configured && !f.masked ? '已上传（内容不回显），粘贴新内容可替换' : f.placeholder"
          />
        </el-form-item>
      </el-form>
    </section>

    <section v-if="groups.length" class="panel card">
      <header class="card-head">
        <span class="card-icon"><el-icon><Tickets /></el-icon></span>
        <div><h2>业务参数</h2><p>每项单独保存，保存后立即生效</p></div>
      </header>
      <div v-for="g in groups" :key="g.key" class="setting-group">
        <h3>{{ g.label }}</h3>
        <div class="setting-grid">
          <div v-for="s in g.items" :key="s.key" class="setting-item">
            <div class="setting-name">{{ s.name }}</div>
            <div class="setting-input">
              <el-select v-if="optionsOf(s.key)" v-model="s.value" size="large" :disabled="!canEdit" style="width: 100%">
                <el-option v-for="o in optionsOf(s.key)" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
              <el-input v-else v-model="s.value" size="large" :disabled="!canEdit">
                <template v-if="s.unit" #append>{{ s.unit }}</template>
              </el-input>
              <el-button v-if="canEdit" type="primary" size="large" :disabled="s.value === s.origin" @click="saveOne(s)">保存</el-button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="action-bar">
      <span class="bar-tip" :class="{ dirty }">{{ dirty ? '有未保存的修改' : '配置已是最新' }}</span>
      <div class="bar-actions">
        <el-button size="large" @click="ping">检测连通性</el-button>
        <el-button v-if="canEdit" size="large" @click="testPay">测试付款 0.01 元</el-button>
        <el-button v-if="canEdit" type="primary" size="large" :disabled="!dirty" @click="save">保存配置</el-button>
      </div>
    </div>

    <el-dialog v-model="payOpen" title="测试付款" width="min(520px, 92vw)">
      <p class="dialog-text">测试单金额 0.01 元，不会给真实用户加余额。支付页会在新窗口打开。</p>
      <template #footer>
        <el-button @click="payOpen = false">取消</el-button>
        <el-button type="primary" @click="openPay">打开收银台</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { CopyDocument, Key, Link, Setting, Tickets } from '@element-plus/icons-vue';
import { getAlipay, pingAlipay, saveAlipay, saveSetting, settings, testAlipayPay } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { copyText } from '@/utils/clipboard';
import { time } from '@/utils/format';

const auth = useAuthStore();
const canEdit = computed(() => auth.can('alipay:edit'));
const form = ref<any>(null);
const origin = ref('');
const rows = ref<any[]>([]);
const payOpen = ref(false);
const pay = ref<any>(null);

const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== origin.value);

const urls = computed(() => [
  { label: '支付通知', tip: '异步通知，决定订单是否入账', value: form.value?.notifyUrl },
  { label: '同步回跳', tip: '用户付完款后跳回的页面', value: form.value?.returnUrl },
]);

/** 密钥与证书输入框：公钥模式 2 个，证书模式 4 个 */
const keyFields = computed(() => {
  const f = form.value;
  if (!f) return [];
  const privateKey = { field: 'privateKey', label: '应用私钥', configured: !!f.privateKey, masked: true, wide: false, placeholder: '粘贴应用私钥（PEM 或单行 Base64）' };
  if (!f.useCert) {
    return [
      privateKey,
      { field: 'alipayPublicKey', label: '支付宝公钥', configured: !!f.alipayPublicKey, masked: true, wide: false, placeholder: '粘贴开放平台里的支付宝公钥' },
    ];
  }
  return [
    privateKey,
    { field: 'appCert', label: '应用公钥证书', configured: f.hasAppCert, masked: false, wide: false, placeholder: '粘贴 appCertPublicKey 证书内容' },
    { field: 'alipayPublicCert', label: '支付宝公钥证书', configured: f.hasAlipayPublicCert, masked: false, wide: false, placeholder: '粘贴 alipayCertPublicKey_RSA2 证书内容' },
    { field: 'alipayRootCert', label: '支付宝根证书', configured: f.hasRootCert, masked: false, wide: false, placeholder: '粘贴 alipayRootCert 证书内容' },
  ];
});

const GROUP_LABELS: Record<string, string> = { pay: '支付', reward: '奖励', site: '站点' };
const OPTIONS: Record<string, { label: string; value: string }[]> = {
  'division.defaultMode': [
    { label: '自动分账', value: 'AUTO' },
    { label: '手工分账', value: 'MANUAL' },
    { label: '不分账', value: 'FORBID' },
  ],
};
const optionsOf = (key: string) => OPTIONS[key];

const groups = computed(() => {
  const map = new Map<string, any[]>();
  for (const s of rows.value) {
    if (!map.has(s.group)) map.set(s.group, []);
    map.get(s.group)!.push(s);
  }
  return Array.from(map, ([key, items]) => ({ key, label: GROUP_LABELS[key] || key, items }));
});

async function load() {
  form.value = await getAlipay();
  origin.value = JSON.stringify(form.value);
  rows.value = ((await settings()) as unknown as any[]).map((s) => ({ ...s, origin: s.value }));
}
async function save() {
  form.value = await saveAlipay(form.value);
  origin.value = JSON.stringify(form.value);
  ElMessage.success('已保存');
}
function warnUnsaved() {
  if (dirty.value) ElMessage.warning('有未保存的修改，检测和测试用的是已保存的配置');
}
async function ping() {
  warnUnsaved();
  const r = (await pingAlipay()) as any;
  ElMessage.info(r.message);
}
async function testPay() {
  warnUnsaved();
  pay.value = await testAlipayPay();
  payOpen.value = true;
}
function openPay() {
  if (pay.value?.payUrl) window.open(pay.value.payUrl, '_blank');
}
async function saveOne(s: any) {
  // 金额类参数按元填写，服务端换算；返回的是规整后的值（如 14 → 14.00）
  const saved = (await saveSetting(s.key, s.value.trim())) as unknown as { value: string };
  s.value = saved.value;
  s.origin = saved.value;
  ElMessage.success('已保存');
}
async function copy(text: string) {
  if (await copyText(text)) ElMessage.success('已复制');
  else ElMessage.error('复制失败，请手动选中后复制');
}
onMounted(load);
</script>

<style scoped>
.alipay-page { max-width: 1280px; padding-bottom: 8px; }
.head-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.updated { color: #94a3b8; font-size: 13px; margin-left: 4px; }

.top-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 20px; margin-bottom: 20px; align-items: start; }
.card { padding: 24px 28px; margin-bottom: 20px; border-radius: 14px; }
.top-grid .card { margin-bottom: 0; }

.card-head { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.card-head h2 { margin: 0; font-size: 17px; line-height: 1.3; }
.card-head p { margin: 2px 0 0; color: #64748b; font-size: 13px; line-height: 1.5; }
.card-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: #ecfdf5; color: #0f766e; font-size: 20px; flex: none; }

.switch-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px 0; border-bottom: 1px solid #f1f5f9; }
.sw-title { font-weight: 600; font-size: 15px; }
.sw-desc { margin-top: 2px; color: #64748b; font-size: 13px; line-height: 1.5; }

.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin-top: 18px; }
.fields .span-2 { grid-column: 1 / -1; }

.url-item { margin-bottom: 18px; }
.url-label { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
.url-label span { margin-left: 8px; color: #94a3b8; font-weight: 400; font-size: 12.5px; }
.url-box { display: flex; align-items: center; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 6px 6px 6px 14px; min-height: 40px; }
.url-box code { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: #0f172a; word-break: break-all; }

.key-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
.key-grid .span-2 { grid-column: 1 / -1; }
.configured { margin-left: 8px; }
.mono :deep(.el-textarea__inner) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.65; padding: 12px 14px; }

.setting-group + .setting-group { margin-top: 24px; }
.setting-group h3 { margin: 0 0 12px; font-size: 14px; color: #475569; }
.setting-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px 24px; }
.setting-item { background: #f8fafc; border: 1px solid #eef2f7; border-radius: 12px; padding: 14px 16px; }
.setting-name { font-weight: 600; font-size: 14px; margin-bottom: 10px; }
.setting-input { display: flex; gap: 10px; }

.action-bar {
  position: sticky; bottom: 0; z-index: 5;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-top: 4px; padding: 14px 24px;
  background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(6px);
  border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.06);
}
.bar-tip { color: #64748b; font-size: 13px; }
.bar-tip.dirty { color: #d97706; font-weight: 600; }
.bar-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.bar-actions .el-button { margin: 0; }
.dialog-text { margin: 0; line-height: 1.7; color: #475569; }

@media (max-width: 1000px) {
  .top-grid { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .card { padding: 18px 16px; }
  .fields, .key-grid { grid-template-columns: 1fr; }
  .setting-grid { grid-template-columns: 1fr; }
  .action-bar { padding: 12px 14px; }
  .bar-actions { width: 100%; }
  .bar-actions .el-button { flex: 1; }
}
</style>
