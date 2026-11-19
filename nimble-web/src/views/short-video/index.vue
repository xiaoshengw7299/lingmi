<template>
  <div class="page-container media-workspace-page short-video-page">
    <div class="page-header hero">
      <div>
        <h2 class="page-title">一键成片</h2>
        <p v-if="deadline" class="page-offer"><strong>本次生成 ¥0</strong><span>{{ deadline }}</span></p>
        <p v-else class="page-desc">填写主题，选择素材，生成带配音和字幕的竖屏短视频。</p>
      </div>
      <el-button plain @click="openPublish">发布码</el-button>
    </div>
    <PublishCodeDialog v-model="publishOpen" />

    <div class="workspace">
      <div v-if="narrow" class="mobile-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="mobilePane === 'compose'" :class="{ 'is-active': mobilePane === 'compose' }" @click="mobilePane = 'compose'">创建</button>
        <button type="button" role="tab" :aria-selected="mobilePane === 'works'" :class="{ 'is-active': mobilePane === 'works' }" @click="mobilePane = 'works'">
          我的作品
          <em v-if="busy">{{ activeTask?.progress ?? 0 }}%</em>
        </button>
      </div>
      <section v-show="!narrow || mobilePane === 'compose'" class="panel compose">
        <div class="panel-head">
          <h3>创建视频</h3>
          <span v-if="busy" class="busy-hint">正在生成，完成后可继续</span>
        </div>

        <el-form class="compose-form" label-position="top" :disabled="busy" @submit.prevent>
          <div class="section-title">1. 填写主题</div>
          <el-form-item label="视频主题" required>
            <el-input
              v-model="form.subject"
              id="short-video-subject"
              maxlength="200"
              show-word-limit
              placeholder="例如：旅行的意义、晨跑时的城市、30 秒讲清一个生活小知识"
            />
          </el-form-item>
          <el-form-item>
            <template #label>
              <div class="script-label-row">
                <span class="label-with-help">视频文案<HelpTip :tip="tips.script" /></span>
                <el-button
                  link
                  type="primary"
                  native-type="button"
                  size="small"
                  :loading="generatingScript"
                  :disabled="busy || !form.subject.trim()"
                  @click="generateScript"
                >
                  AI 生成文案
                </el-button>
              </div>
            </template>
            <el-input
              v-model="form.script"
              type="textarea"
              :rows="8"
              maxlength="8000"
              show-word-limit
              placeholder="选填。可点「AI 生成文案」填入后编辑；留空则获取素材或生成视频时自动写旁白"
            />
          </el-form-item>
          <button type="button" class="text-toggle" :aria-expanded="showScriptExtra" @click="showScriptExtra = !showScriptExtra">
            <span>更多文案选项</span>
            <el-icon class="toggle-arrow" :class="{ 'is-open': showScriptExtra }"><ArrowDown /></el-icon>
          </button>
          <div v-if="showScriptExtra" class="text-toggle-body">
            <el-form-item>
              <template #label>
                <span class="label-with-help">素材关键词<HelpTip :tip="tips.terms" /></span>
              </template>
              <el-input
                v-model="form.terms"
                type="textarea"
                :rows="2"
                maxlength="2000"
                placeholder="选填，中文逗号、英文逗号或顿号分隔。不填则根据文案自动提取"
              />
            </el-form-item>
            <el-form-item>
              <template #label>
                <span class="label-with-help">文案段落数<HelpTip :tip="tips.paragraphNumber" /></span>
              </template>
              <el-input-number v-model="form.paragraphNumber" :min="1" :max="10" :step="1" controls-position="right" style="width: 160px" />
            </el-form-item>
            <el-form-item>
              <template #label>
                <span class="label-with-help">自定义文案要求<HelpTip :tip="tips.scriptPrompt" /></span>
              </template>
              <el-input
                v-model="form.scriptPrompt"
                type="textarea"
                :rows="2"
                maxlength="2000"
                placeholder="选填，例如：语气轻松、适合 30 秒口播"
              />
            </el-form-item>
          </div>

          <div class="source-block">
            <div class="section-title">2. 素材来源</div>
            <div class="mode-chip-row">
              <button
                v-for="item in options.sources"
                :key="item.value"
                type="button"
                class="mode-chip"
                :class="{ 'is-active': form.videoSource === item.value }"
                :disabled="busy"
                @click="form.videoSource = item.value"
              >
                <strong>{{ item.label }}</strong>
                <span>{{ item.hint }}</span>
              </button>
            </div>
          <el-form-item v-if="form.videoSource === 'ai'" label="画面模型">
            <ModelPicker
              layout="block"
              :model-id="form.imageModelId || null"
              :lora="form.imageLora"
              :models="options.imageModels || []"
              @update:model-id="form.imageModelId = $event"
              @update:lora="form.imageLora = $event"
            />
          </el-form-item>
          <el-form-item v-if="isStockSource">
            <template #label>
              <span class="label-with-help">素材库<HelpTip tip="可多选。Wikimedia / Openverse 免 Key 即可用；Pexels / Pixabay / Coverr 需配置免费 Key，未配置的会灰掉。" /></span>
            </template>
            <div class="stock-source-block">
              <el-checkbox-group v-model="form.stockSources">
                <el-checkbox v-for="item in stockSourceOptions" :key="item.value" :label="item.value" :disabled="item.configured === false">
                  {{ item.label }}
                </el-checkbox>
              </el-checkbox-group>
              <div class="stock-rules">
                <div class="check-with-help">
                  <el-checkbox v-model="form.semanticMatch">语义选片</el-checkbox>
                  <HelpTip :tip="tips.semanticMatch" />
                </div>
                <div class="check-with-help">
                  <el-checkbox v-model="form.stockDedupe">跨镜去重</el-checkbox>
                  <HelpTip :tip="tips.stockDedupe" />
                </div>
              </div>
            </div>
          </el-form-item>
          <div v-if="isStockSource" class="stock-board">
            <div class="stock-board-bar">
              <el-button :loading="fetchingStock" :disabled="busy || !form.subject.trim() || !form.stockSources.length" @click="fetchStock">
                {{ stockPicks.length ? '重新获取' : '获取素材' }}
              </el-button>
              <span v-if="stockStale" class="stock-note is-warn">文案或检索条件已变，请重新获取</span>
              <span v-else-if="stockPicks.length" class="stock-note">已选 {{ stockPicks.length }} 条，可删除不需要的</span>
              <span v-else class="stock-note">获取后在这里确认，再点生成视频</span>
            </div>
            <p v-if="!stockPicks.length && !fetchingStock" class="stock-empty">还没有素材。获取时如果文案是空的，会先按提示词写好并填进文案框。</p>
            <ul v-else class="stock-grid">
              <li v-for="item in stockPicks" :key="item.id" class="stock-card">
                <button type="button" class="stock-thumb" @click="stockViewing = item">
                  <img v-if="stockThumb(item)" :src="stockThumb(item)" :alt="item.title || '素材'" referrerpolicy="no-referrer" @error="markThumbBroken(item.id)" />
                  <span v-else class="stock-fallback"><el-icon :size="22"><VideoPlay /></el-icon></span>
                  <span class="stock-play">查看</span>
                </button>
                <button type="button" class="stock-remove" :disabled="busy || fetchingStock" @click="removeStock(item.id)">移除</button>
                <span class="stock-meta">
                  <em>{{ stockSourceLabel(item.source) }}</em>
                  <em v-if="item.mediaType !== 'image' && item.durationSec">{{ Math.round(item.durationSec) }}s</em>
                </span>
                <span v-if="item.title" class="stock-title" :title="item.title">{{ item.title }}</span>
              </li>
            </ul>
          </div>
          <div v-if="form.videoSource === 'local'" class="upload-block">
            <button type="button" class="dropzone" :class="{ 'is-disabled': busy }" :disabled="busy || uploading" @click="triggerUpload" @dragover.prevent @drop.prevent="onDrop">
              <el-icon :size="20"><Upload /></el-icon>
              <span>
                <strong>{{ auth.isLoggedIn ? '选择照片或视频' : '登录后上传素材' }}</strong>
                <small>支持 MP4、MOV、AVI、MKV、JPG、PNG。单个视频最大 200 MB。</small>
              </span>
            </button>
            <input
              ref="fileInputRef"
              type="file"
              multiple
              class="hidden-input"
              :accept="fileAccept"
              :disabled="busy"
              @change="onFileChange"
            />
            <ul v-if="form.materials.length" class="stock-grid">
              <li v-for="(item, index) in form.materials" :key="item.file" class="stock-card">
                <div
                  class="stock-thumb"
                  role="button"
                  tabindex="0"
                  :aria-label="`预览 ${item.name}`"
                  @click="openMaterial(item)"
                  @keydown.enter.prevent="openMaterial(item)"
                  @keydown.space.prevent="openMaterial(item)"
                >
                  <img
                    v-if="materialPreviews[item.file]?.kind === 'image' && !unplayable.has(item.file)"
                    :src="materialPreviews[item.file]?.url"
                    :alt="item.name"
                    @error="markUnplayable(item.file)"
                  />
                  <video
                    v-else-if="materialPreviews[item.file] && !unplayable.has(item.file)"
                    :src="materialPreviews[item.file]?.url"
                    muted
                    playsinline
                    preload="metadata"
                    tabindex="-1"
                    @error="markUnplayable(item.file)"
                  />
                  <span v-else class="stock-fallback"><el-icon :size="22"><VideoPlay /></el-icon></span>
                  <span class="stock-play">预览</span>
                </div>
                <button type="button" class="stock-remove" :disabled="busy || uploading" @click="removeMaterial(index)">移除</button>
                <span class="stock-title" :title="item.name">{{ item.name }}</span>
                <span class="stock-meta"><em>{{ formatSize(item.size) }}</em></span>
              </li>
            </ul>
            <div v-if="uploading" class="upload-progress">正在上传素材…</div>
          </div>
          </div>

          <div class="param-summary">
            <button type="button" class="param-chips" :disabled="busy" @click="showSettings = !showSettings">
              <span v-for="chip in paramSummaryChips" :key="chip" class="param-chip">{{ chip }}</span>
            </button>
            <button type="button" class="text-toggle param-toggle" :disabled="busy" @click="showSettings = !showSettings">
              <span>调整参数</span>
              <el-icon class="toggle-arrow" :class="{ 'is-open': showSettings }"><ArrowDown /></el-icon>
            </button>
          </div>
          <div v-if="showSettings" class="text-toggle-body settings-inline">
          <div class="section-title">生成偏好</div>
          <div class="count-field">
            <span class="label-with-help">生成数量<HelpTip :tip="tips.generateCount" /></span>
            <el-input-number v-model="generateCount" :min="1" :max="10" :step="1" :disabled="busy" controls-position="right" />
          </div>
          <div class="pref-grid">
            <div class="pref-card">
              <div class="pref-card-head">
                <span class="card-icon icon-video"><el-icon><PictureFilled /></el-icon></span>
                <h4>画面</h4>
              </div>
              <el-form-item label="画面比例">
                <el-select v-model="form.aspect" style="width: 100%">
                  <el-option v-for="item in options.aspects" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <p class="pref-card-desc">默认生成 1080×1920 的竖屏视频</p>
            </div>

            <div class="pref-card">
              <div class="pref-card-head">
                <span class="card-icon icon-voice"><el-icon><Microphone /></el-icon></span>
                <h4>配音</h4>
              </div>
              <el-form-item label="配音方式">
                <el-select v-model="voiceMode" style="width: 100%">
                  <el-option label="配音（Azure TTS）" value="tts" />
                  <el-option label="不配音" value="none" />
                </el-select>
              </el-form-item>
              <template v-if="voiceMode === 'tts'">
                <el-form-item>
                  <template #label>
                    <span class="label-with-help">音色语种<HelpTip :tip="tips.voiceName" /></span>
                  </template>
                  <el-select v-model="form.voiceName" filterable style="width: 100%">
                    <el-option v-for="item in flatVoiceOptions" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
                <div class="inline-actions">
                  <el-button size="small" :loading="previewing === 'sample'" :disabled="!!previewing" @click="previewVoice('sample')">
                    试听
                  </el-button>
                  <el-button
                    size="small"
                    :loading="previewing === 'script'"
                    :disabled="!!previewing || !form.script.trim()"
                    @click="previewVoice('script')"
                  >
                    试听文案
                  </el-button>
                </div>
              </template>
              <template v-else>
                <p class="pref-card-desc">生成的视频不包含配音旁白，画面 + 字幕（可选）+ 背景音乐（可选）</p>
                <el-form-item>
                  <template #label>
                    <span class="label-with-help">视频总时长 {{ form.noVoiceDurationSec }}s<HelpTip :tip="tips.noVoiceDurationSec" /></span>
                  </template>
                  <el-slider v-model="form.noVoiceDurationSec" :min="5" :max="120" :step="5" show-stops />
                </el-form-item>
              </template>
            </div>

            <div class="pref-card">
              <div class="pref-card-head">
                <span class="card-icon icon-bgm"><el-icon><Headset /></el-icon></span>
                <h4>配乐</h4>
              </div>
              <el-form-item label="背景音乐">
                <el-select v-model="form.bgmType" style="width: 100%">
                  <el-option v-for="item in options.bgmTypes" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>

              <div v-if="form.bgmType === 'custom'" class="upload-block is-nested">
                <div class="dropzone" :class="{ 'is-disabled': busy }" @click="triggerBgmUpload">
                  <el-icon :size="20"><Headset /></el-icon>
                  <div>
                    <strong>{{ form.bgmName || '上传自定义配乐' }}</strong>
                    <p>mp3/m4a/wav/flac/ogg，最大 30MB</p>
                  </div>
                </div>
                <input
                  ref="bgmInputRef"
                  type="file"
                  class="hidden-input"
                  accept=".mp3,.m4a,.aac,.wav,.flac,.ogg"
                  :disabled="busy"
                  @change="onBgmChange"
                />
                <div v-if="uploadingBgm" class="upload-progress">正在上传配乐…</div>
              </div>
              <p v-else-if="form.bgmType === 'random'" class="pref-card-desc">按主题自动匹配一段版权配乐</p>
              <p v-else class="pref-card-desc">生成的视频不包含背景音乐</p>
            </div>
          </div>

          <div class="section-title">高级设置</div>
          <el-collapse v-model="advancedPanels" class="settings-collapse">
            <el-collapse-item name="video" class="acc-video">
              <template #title>
                <span class="collapse-header">
                  <span class="collapse-icon icon-video"><el-icon><VideoCamera /></el-icon></span>
                  <span class="collapse-title">视频设置</span>
                  <span class="collapse-summary">{{ videoSettingsSummary }}</span>
                </span>
              </template>
              <el-form-item v-if="isStockSource">
                <div class="check-with-help">
                  <el-checkbox v-model="form.matchMaterials" @change="onMatchChange">按文案顺序匹配画面</el-checkbox>
                  <HelpTip :tip="tips.matchMaterials" />
                </div>
              </el-form-item>
              <div class="split-row">
                <el-form-item>
                  <template #label>
                    <span class="label-with-help">拼接方式<HelpTip :tip="tips.concatMode" /></span>
                  </template>
                  <el-select v-model="form.concatMode" :disabled="isStockSource && form.matchMaterials" style="width: 100%">
                    <el-option v-for="item in options.concatModes" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="转场效果">
                  <el-select v-model="form.transitionMode" style="width: 100%">
                    <el-option v-for="item in options.transitions" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
              </div>
              <el-form-item>
                <template #label>
                  <span class="label-with-help">画面适配<HelpTip :tip="tips.fitMode" /></span>
                </template>
                <el-select v-model="form.fitMode" style="width: 100%">
                  <el-option v-for="item in options.fitModes" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <div class="split-row">
                <el-form-item v-if="form.videoSource === 'ai'">
                  <template #label>
                    <span class="label-with-help">单片段最长（秒）<HelpTip :tip="tips.clipDuration" /></span>
                  </template>
                  <el-slider v-model="form.clipDuration" :min="2" :max="10" :step="1" show-stops />
                </el-form-item>
                <el-form-item>
                  <template #label>
                    <span class="label-with-help">片段速度 {{ form.clipSpeed.toFixed(2) }}x<HelpTip :tip="tips.clipSpeed" /></span>
                  </template>
                  <el-slider v-model="form.clipSpeed" :min="0.5" :max="2" :step="0.05" />
                </el-form-item>
              </div>
            </el-collapse-item>

            <el-collapse-item name="audio" class="acc-audio">
              <template #title>
                <span class="collapse-header">
                  <span class="collapse-icon icon-voice"><el-icon><Microphone /></el-icon></span>
                  <span class="collapse-title">音频设置</span>
                  <span class="collapse-summary">{{ audioSettingsSummary }}</span>
                </span>
              </template>
              <div v-if="voiceMode === 'tts'" class="split-row">
                <el-form-item>
                  <template #label>
                    <span class="label-with-help">语速 {{ form.voiceRate.toFixed(1) }}x<HelpTip :tip="tips.voiceRate" /></span>
                  </template>
                  <el-slider v-model="form.voiceRate" :min="0.8" :max="2" :step="0.1" />
                </el-form-item>
                <el-form-item>
                  <template #label>
                    <span class="label-with-help">配音音量 {{ Math.round(form.voiceVolume * 100) }}%<HelpTip :tip="tips.voiceVolume" /></span>
                  </template>
                  <el-slider v-model="form.voiceVolume" :min="0.6" :max="5" :step="0.1" />
                </el-form-item>
              </div>
              <p v-else class="disabled-hint">当前未开启配音，无需设置语速与音量</p>

              <el-form-item v-if="form.bgmType !== 'none'">
                <template #label>
                  <span class="label-with-help">配乐音量 {{ Math.round(form.bgmVolume * 100) }}%<HelpTip :tip="tips.bgmVolume" /></span>
                </template>
                <el-slider v-model="form.bgmVolume" :min="0" :max="1" :step="0.1" />
              </el-form-item>
              <p v-else class="disabled-hint">当前未使用配乐</p>
            </el-collapse-item>

            <el-collapse-item name="subtitle" class="acc-subtitle">
              <template #title>
                <span class="collapse-header">
                  <span class="collapse-icon icon-subtitle"><el-icon><ChatLineSquare /></el-icon></span>
                  <span class="collapse-title">字幕设置</span>
                  <span class="collapse-summary">{{ subtitleSettingsSummary }}</span>
                </span>
              </template>
              <el-form-item label="字幕开关">
                <el-switch v-model="form.subtitleEnabled" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <template v-if="form.subtitleEnabled">
                <div class="split-row">
                  <el-form-item>
                    <template #label>
                      <span class="label-with-help">字幕位置<HelpTip :tip="tips.subtitlePosition" /></span>
                    </template>
                    <el-select v-model="form.subtitlePosition" style="width: 100%">
                      <el-option v-for="item in options.subtitlePositions" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="字幕字体">
                    <el-select v-model="form.fontName" style="width: 100%">
                      <el-option v-for="item in options.fonts" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                  </el-form-item>
                </div>
                <el-form-item v-if="form.subtitlePosition === 'custom'">
                  <template #label>
                    <span class="label-with-help">自定义位置 {{ form.customPosition }}%<HelpTip :tip="tips.customPosition" /></span>
                  </template>
                  <el-slider v-model="form.customPosition" :min="0" :max="100" :step="1" />
                </el-form-item>
                <el-form-item :label="`字号 ${form.fontSize}`">
                  <el-slider v-model="form.fontSize" :min="20" :max="120" :step="2" />
                </el-form-item>
                <div class="split-row">
                  <el-form-item label="文字颜色">
                    <el-color-picker v-model="form.textForeColor" />
                  </el-form-item>
                  <el-form-item label="描边颜色">
                    <el-color-picker v-model="form.strokeColor" />
                  </el-form-item>
                </div>
                <el-form-item :label="`描边宽度 ${form.strokeWidth.toFixed(1)}`">
                  <el-slider v-model="form.strokeWidth" :min="0" :max="4" :step="0.5" />
                </el-form-item>
                <el-form-item>
                  <el-checkbox v-model="form.textBackgroundEnabled">字幕背景</el-checkbox>
                </el-form-item>
                <el-form-item v-if="form.textBackgroundEnabled" label="背景颜色">
                  <el-color-picker v-model="form.textBackgroundColor" />
                </el-form-item>
              </template>
              <p v-else class="disabled-hint">当前已关闭字幕，开启后可在此调整样式</p>
            </el-collapse-item>
          </el-collapse>
          </div>
        </el-form>

        <div class="generate-bar">
          <div v-if="!busy" class="generate-price" aria-live="polite">
            <strong class="section-title">3. 生成视频</strong>
            <p v-if="deadline" class="page-offer"><strong>本次生成 ¥0</strong><span>{{ deadline }}</span></p>
            <p v-else-if="quote?.mode === 'metered'" class="normal-price">{{ meteredPrice(quote) }} <router-link to="/pricing" target="_blank">查看单价</router-link></p>
            <p v-else class="normal-price">{{ quote ? '本次生成 ¥0' : '正在获取生成价格…' }}</p>
          </div>
          <el-button
            :type="busy ? 'danger' : 'primary'"
            class="generate-btn"
            :class="{ 'is-stop': busy }"
            :loading="submitting || cancelling"
            :disabled="busy ? cancelling : !canSubmit"
            @click="busy ? cancelActive() : handleGenerate()"
          >
            {{ busy ? `停止生成 · ${activeTask?.stage || '生成中'} ${activeTask?.progress ?? 0}%` : generateCount > 1 ? `${deadline ? '免费生成' : '生成'} ${generateCount} 条视频` : deadline ? '免费生成' : '生成视频' }}
          </el-button>
          <p v-if="!busy && submitHint" class="submit-hint">{{ submitHint }}</p>
        </div>
      </section>

      <div v-show="!narrow || mobilePane === 'works'" class="side-col">
      <section class="panel works-panel">
        <div class="panel-head">
          <h3>我的作品</h3>
        </div>

        <div v-if="!tasks.length && !historyLoading" class="empty-history">还没有作品，生成第一条短视频吧</div>

        <div v-else class="works-scroll">
          <div class="works-grid">
            <article v-for="item in tasks" :key="item.id" class="work-card">
              <div class="work-cover">
                <video
                  v-if="videoSrc(item)"
                  :key="`${item.id}-${videoSrc(item)}`"
                  :src="videoSrc(item)"
                  controls
                  playsinline
                  preload="metadata"
                />
                <div v-else-if="isShortVideoBusy(item.status)" class="work-state">
                  <el-progress type="circle" :percentage="item.progress" :width="64" :stroke-width="5" color="#0B8F5F" />
                  <span>{{ item.stage || '生成中' }}</span>
                  <button type="button" class="work-stop" :disabled="cancelling" @click="stopTask(item)">停止</button>
                </div>
                <div v-else-if="item.status === 'failed'" class="work-state is-failed">
                  <el-icon :size="22"><WarningFilled /></el-icon>
                  <span>生成失败</span>
                  <span v-if="item.billing?.mode === 'promotion'">本次未扣费</span>
                  <span v-if="item.error">{{ item.error }}</span>
                </div>
                <div v-else class="work-state">
                  <el-icon :size="22"><VideoCamera /></el-icon>
                  <span>等待成片</span>
                </div>
                <div v-if="videosOf(item).length > 1" class="work-versions" @click.stop>
                  <button
                    v-for="(_, index) in videosOf(item)"
                    :key="index"
                    type="button"
                    :class="{ 'is-active': (versionPick[item.id] ?? 0) === index }"
                    @click="versionPick[item.id] = index"
                  >
                    {{ index + 1 }}
                  </button>
                </div>
              </div>
              <span class="work-name" :title="item.subject">{{ item.subject }}</span>
              <span class="work-time">{{ formatTime(item.createdAt) }}<template v-if="item.billing?.mode === 'promotion'"> · ¥0</template></span>
              <div v-if="videoSrc(item)" class="work-download">
                <el-button type="primary" :icon="Download" @click="handleDownload(item, versionPick[item.id] ?? 0)">下载视频</el-button>
              </div>
              <div class="work-ops">
                <VideoShareButton v-if="videoSrc(item)" source="short-video" :id="item.id" :video="videoSrc(item)" :title="item.subject" compact />
                <button type="button" title="删除" :disabled="isShortVideoBusy(item.status)" @click="handleDelete(item)">
                  <el-icon :size="13"><Delete /></el-icon>
                </button>
              </div>
            </article>
          </div>
        </div>

        <div v-if="total > pageSize" class="pagination-wrap">
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="page"
            :page-size="pageSize"
            :total="total"
            @current-change="changePage"
          />
        </div>
      </section>
      </div>
    </div>

    <el-dialog
      v-model="stockPreviewVisible"
      :title="stockViewing?.title || '素材预览'"
      width="min(860px, 94vw)"
      append-to-body
      destroy-on-close
      align-center
    >
      <div v-if="stockViewing" class="stock-dialog">
        <img v-if="stockViewing.mediaType === 'image'" :src="stockPlay(stockViewing)" :alt="stockViewing.title || '素材'" />
        <video v-else :src="stockPlay(stockViewing)" controls autoplay playsinline />
        <p class="stock-dialog-meta">{{ stockSourceLabel(stockViewing.source) }}<template v-if="stockViewing.durationSec"> · {{ Math.round(stockViewing.durationSec) }} 秒</template></p>
        <VideoShareButton v-if="stockViewing.shareRef && stockViewing.mediaType !== 'image'" source="stock" :id="stockViewing.shareRef" :video="stockPlay(stockViewing)" :title="stockViewing.title" />
      </div>
    </el-dialog>

    <el-dialog
      v-model="materialPreviewVisible"
      :title="materialViewing?.name || '素材预览'"
      width="min(860px, 94vw)"
      append-to-body
      destroy-on-close
      align-center
    >
      <div v-if="materialViewing" class="stock-dialog">
        <img
          v-if="materialViewing.kind === 'image' && !unplayable.has(materialViewing.file)"
          :src="materialViewing.url"
          :alt="materialViewing.name"
          @error="markUnplayable(materialViewing.file)"
        />
        <video
          v-else-if="materialViewing.kind === 'video' && !unplayable.has(materialViewing.file)"
          :src="materialViewing.url"
          controls
          autoplay
          playsinline
          @error="markUnplayable(materialViewing.file)"
        />
        <p v-else class="stock-dialog-meta">这个格式浏览器无法直接预览，生成时仍会使用这份素材。</p>
        <p class="stock-dialog-meta">{{ formatSize(materialViewing.size) }}</p>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import VideoShareButton from '@/components/VideoShareButton.vue'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown, ChatLineSquare, Delete, Download, Headset, Microphone, PictureFilled, Upload, VideoCamera, VideoPlay, WarningFilled,
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import HelpTip from '@/components/HelpTip/index.vue'
import PublishCodeDialog from './PublishCodeDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useShortVideoPricing } from '@/composables/useShortVideoPricing'
import { yuan } from '@/utils/format'
import ModelPicker from '@/views/video-producer/components/ModelPicker.vue'
import {
  cancelShortVideoTask,
  createShortVideoTask,
  deleteShortVideoTask,
  getShortVideoDownloadUrl,
  getShortVideoOptions,
  getShortVideoTask,
  isShortVideoBusy,
  listShortVideoTasks,
  previewShortVideoStock,
  previewShortVideoVoice,
  generateShortVideoScript,
  shortVideoPriceChange,
  uploadShortVideoBgm,
  uploadShortVideoMaterial,
  type ShortVideoMaterial,
  type ShortVideoOption,
  type ShortVideoOptions,
  type ShortVideoStockPick,
  type ShortVideoTask,
  type ShortVideoQuote,
  type ShortVideoPriceMode,
} from '@/api/short-video'
import type { LoraSelection } from '@/api/video'

defineOptions({ name: 'ShortVideoPage' })

const auth = useAuthStore()
const { quote, deadline, setQuote } = useShortVideoPricing()
const publishOpen = ref(false)
const narrow = ref(false)
const mobilePane = ref<'compose' | 'works'>('compose')
let narrowMedia: MediaQueryList | null = null

function syncNarrow() {
  narrow.value = narrowMedia?.matches ?? false
}
function openPublish() {
  if (!auth.ensureLoggedIn()) return
  publishOpen.value = true
}

/** 易误解选项的说明，对齐 MoneyPrinterTurbo 的问号帮助 */
const tips = {
  script: '可点「AI 生成文案」填入后直接编辑。留空则获取免费素材或生成视频时自动写旁白，并回填到这里。合理使用标点断句，有助于字幕更自然。',
  terms: '可留空，由 AI 根据文案提取。多个关键词用中文逗号、英文逗号或顿号分隔，用于检索在线画面。',
  paragraphNumber: '控制 AI 生成旁白的段落数量。段落越多，成片通常越长。',
  scriptPrompt: '给 AI 的额外写作要求，例如语气、时长或受众。留空则按默认风格生成。',
  videoSource: '免费素材和本地上传都会按配音时长从视频中切 2–15 秒窗口；AI 生成则逐段出图。',
  voiceName: '请与文案语言保持一致，否则发音会不自然。可先点试听确认。',
  matchMaterials: '仅对免费素材生效：按文案提炼的关键词顺序检索画面，并固定为顺序拼接。不是「第 1 句旁白对应你上传的第 1 个文件」。检索到的每条视频仍会在文件内部切 2–15 秒窗口。',
  semanticMatch: '用 AI 按文案语义挑选素材，而不只匹配关键词字面。关闭则只按关键词检索。',
  stockDedupe: '同一条素材不会在多个镜头里重复出现，画面更有变化。',
  concatMode: '随机拼接每次成片的画面顺序不同，便于出多版本；顺序拼接按素材列表依次使用。免费素材和本地视频都会在文件内部另切 2–15 秒窗口。',
  fitMode: '填满裁剪会铺满画面并裁掉多余边缘；完整显示会保留全部素材，必要时加黑边。',
  generateCount: '默认 1 条。大于 1 时，做完一条再做下一条：第一条用当前文案和已确认的素材，后面每条重新写文案。免费素材从第 2 条起重新检索；本地素材仍用你上传的文件，但切点和顺序会变。某一条失败不影响后面继续。',
  clipDuration: '每个 AI 生图画面的时长。总时长由旁白长度决定。免费素材和本地视频不使用此项，固定按 2–15 秒窗口取片。',
  noVoiceDurationSec: '不配音时没有旁白可依据时长，用这个值直接决定成片总时长与素材/字幕的时间分配。',
  clipSpeed: '只加快或放慢画面素材，不影响配音、字幕，也不改变单片段的最长输出时长。',
  voiceRate: '仅对自动配音生效，1.0x 为正常语速。',
  voiceVolume: '自动配音音量。成片前会先按 -16 LUFS 做响度归一，滑杆是额外增益。',
  bgmVolume: '背景音乐音量。配乐会先按 -25 LUFS 归一，滑杆是相对增益；100% 即工厂默认旁白/配乐平衡。',
  subtitlePosition: '底部最常见。自定义位置按距画面顶部的百分比放置。',
  customPosition: '0% 贴顶，100% 贴底。常用约 70%，即略偏下方。',
}

const fallbackOptions: ShortVideoOptions = {
  aspects: [
    { value: '9:16', label: '竖屏 9:16', hint: '适合短视频' },
    { value: '16:9', label: '横屏 16:9', hint: '适合横版播放' },
    { value: '1:1', label: '方形 1:1', hint: '适合信息流封面' },
  ],
  voiceGroups: [{ value: 'zh', label: '中文', voices: [{ value: 'zh-CN-XiaoxiaoNeural-Female', label: '晓晓（女）' }] }],
  voices: [{ value: 'zh-CN-XiaoxiaoNeural-Female', label: '晓晓（女）' }],
  sources: [
    { value: 'local', label: '本地素材', hint: '按配音时长从你的视频中切 2–15 秒窗口拼接，不是从开头固定切 3 秒' },
    { value: 'stock', label: '免费素材', hint: '先按文案检索并确认素材，再按配音时长从素材中切 2–15 秒窗口' },
    { value: 'ai', label: 'AI 生成', hint: '逐段生图 + 缓慢推镜，无需素材库' },
  ],
  stockSources: [
    { value: 'wikimedia', label: 'Wikimedia' },
    { value: 'openverse', label: 'Openverse' },
    { value: 'pexels', label: 'Pexels' },
    { value: 'pixabay', label: 'Pixabay' },
    { value: 'coverr', label: 'Coverr' },
  ],
  imageModels: [],
  bgmTypes: [
    { value: 'random', label: '随机配乐' },
    { value: 'custom', label: '自定义配乐' },
    { value: 'none', label: '无配乐' },
  ],
  concatModes: [
    { value: 'random', label: '随机拼接' },
    { value: 'sequential', label: '顺序拼接' },
  ],
  fitModes: [
    { value: 'cover', label: '填满裁剪' },
    { value: 'contain', label: '完整显示' },
  ],
  transitions: [{ value: 'none', label: '无转场' }],
  subtitlePositions: [
    { value: 'bottom', label: '底部' },
    { value: 'center', label: '居中' },
    { value: 'top', label: '顶部' },
    { value: 'custom', label: '自定义位置' },
  ],
  fonts: [
    { value: 'regular', label: '思源黑体 · 常规' },
    { value: 'bold', label: '思源黑体 · 加粗' },
  ],
  defaults: {
    aspect: '9:16',
    voiceName: 'zh-CN-XiaoxiaoNeural-Female',
    voiceGroup: 'zh',
    bgmType: 'random',
    videoSource: 'local',
    terms: '',
    scriptPrompt: '',
    paragraphNumber: 1,
    fitMode: 'cover',
    concatMode: 'sequential',
    transitionMode: 'none',
    clipDuration: 3,
    clipSpeed: 1,
    videoCount: 1,
    matchMaterials: true,
    semanticMatch: true,
    stockDedupe: true,
    stockSources: ['pexels', 'wikimedia'],
    imageModelId: '',
    noVoiceDurationSec: 20,
    voiceVolume: 1,
    voiceRate: 1,
    bgmVolume: 1,
    bgmFile: '',
    subtitleEnabled: true,
    subtitlePosition: 'bottom',
    customPosition: 70,
    fontName: 'regular',
    fontSize: 66,
    textForeColor: '#FFFFFF',
    textBackgroundEnabled: false,
    textBackgroundColor: '#000000',
    strokeColor: '#000000',
    strokeWidth: 1.5,
  },
  material: { maxVideoBytes: 200 * 1024 * 1024, maxImageBytes: 20 * 1024 * 1024, accept: '.mp4,.mov,.avi,.flv,.mkv,.jpg,.jpeg,.png' },
  bgm: { maxBytes: 30 * 1024 * 1024, accept: '.mp3,.m4a,.aac,.wav,.flac,.ogg' },
}

const options = ref<ShortVideoOptions>(fallbackOptions)
const form = reactive({
  subject: '',
  script: '',
  terms: '',
  scriptPrompt: '',
  paragraphNumber: 1,
  aspect: fallbackOptions.defaults.aspect,
  voiceName: fallbackOptions.defaults.voiceName,
  voiceVolume: 1,
  voiceRate: 1,
  bgmType: fallbackOptions.defaults.bgmType,
  bgmVolume: 1,
  bgmFile: '',
  bgmName: '',
  videoSource: fallbackOptions.defaults.videoSource,
  stockSources: [...(fallbackOptions.defaults.stockSources ?? ['pexels', 'wikimedia'])],
  semanticMatch: true,
  stockDedupe: true,
  imageModelId: '',
  imageLora: null as LoraSelection | null,
  fitMode: 'cover',
  concatMode: 'random',
  transitionMode: 'none',
  clipDuration: 3,
  clipSpeed: 1,
  videoCount: 1,
  matchMaterials: false,
  noVoiceDurationSec: 20,
  subtitleEnabled: true,
  subtitlePosition: 'bottom',
  customPosition: 70,
  fontName: 'regular',
  fontSize: 66,
  textForeColor: '#FFFFFF',
  textBackgroundEnabled: false,
  textBackgroundColor: '#000000',
  strokeColor: '#000000',
  strokeWidth: 1.5,
  materials: [] as ShortVideoMaterial[],
})

const generateCount = ref(1)
const stockPicks = ref<ShortVideoStockPick[]>([])
const stockViewing = ref<ShortVideoStockPick>()
const stockPreviewVisible = computed({
  get: () => !!stockViewing.value,
  set: (open) => { if (!open) stockViewing.value = undefined },
})
const materialPreviews = reactive<Record<string, { url: string; kind: 'image' | 'video' }>>({})
const materialViewing = ref<{ file: string; name: string; url: string; kind: 'image' | 'video'; size: number }>()
const materialPreviewVisible = computed({
  get: () => !!materialViewing.value,
  set: (open) => { if (!open) materialViewing.value = undefined },
})
const unplayable = ref(new Set<string>())
const brokenThumbs = ref(new Set<string>())
const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
function stockSrc(path?: string) {
  if (!path) return ''
  if (/^https?:/i.test(path)) return path
  return `${apiBase}/${path.replace(/^\//, '')}`
}
function stockThumb(item: ShortVideoStockPick) {
  if (brokenThumbs.value.has(item.id)) return ''
  return stockSrc(item.posterUrl || (item.mediaType === 'image' ? item.previewUrl || item.url : item.poster))
}
function stockPlay(item: ShortVideoStockPick) {
  return stockSrc(item.previewUrl || item.url)
}
function markThumbBroken(id: string) {
  const next = new Set(brokenThumbs.value)
  next.add(id)
  brokenThumbs.value = next
}

/** 预览地址是本服务的临时签名链接，只在页面上打开，不能交给生成接口 */
function toStockPickPayload(item: ShortVideoStockPick) {
  return {
    id: item.id,
    source: item.source,
    url: item.url,
    poster: item.poster,
    title: item.title,
    durationSec: item.durationSec,
    width: item.width,
    height: item.height,
    mediaType: item.mediaType,
  }
}
const stockExcluded = ref<string[]>([])
const stockFetchedKey = ref('')
const fetchingStock = ref(false)

const voiceMode = ref<'tts' | 'none'>('tts')
const fileInputRef = ref<HTMLInputElement>()
const bgmInputRef = ref<HTMLInputElement>()
const uploading = ref(false)
const uploadingBgm = ref(false)
const submitting = ref(false)
const cancelling = ref(false)
const generatingScript = ref(false)
const previewing = ref<'sample' | 'script' | ''>('')
const historyLoading = ref(false)
const tasks = ref<ShortVideoTask[]>([])
const activeTask = ref<ShortVideoTask | null>(null)
const versionPick = reactive<Record<string, number>>({})
const page = ref(1)
const pageSize = 12
const total = ref(0)
// 关键词、生成参数和高级设置默认收起；主题、文案和素材来源始终展开
const showScriptExtra = ref(false)
const advancedPanels = ref<string[]>([])
const showSettings = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let previewAudio: HTMLAudioElement | null = null
let previewObjectUrl = ''
let pending: { id: string; payload: string } | undefined
/** 只有这次打开页面里提交的任务，才把生成出的文案回填到输入框。刷新后不再带回。 */
let acceptGeneratedScript = false
let pageAlive = true

/** 旧版本会把创建区写进 sessionStorage，刷新后还能回来。现在不再读取，并清掉残留。 */
function clearStoredDraft() {
  try {
    sessionStorage.removeItem('lingmi-short-video-draft')
    if (auth.user?.id !== undefined) sessionStorage.removeItem(`lingmi-short-video-draft:${auth.user.id}`)
  } catch {
    /* 浏览器禁用存储时忽略 */
  }
}
clearStoredDraft()
watch(() => auth.user?.id, clearStoredDraft)

function meteredPrice(current: ShortVideoQuote) {
  return `按文案和所选配音、素材模型的实际用量计费，提交需至少 ¥${yuan(current.minBalanceCents)} 余额。`
}

async function withConfirmedPrice<T>(submit: (mode: ShortVideoPriceMode) => Promise<T>, generating = false) {
  const current = quote.value
  if (!current) {
    ElMessage.info('正在获取价格，请稍后重试')
    return
  }
  try {
    return await submit(current.mode)
  } catch (error) {
    const updated = shortVideoPriceChange(error)
    if (!updated) throw error
    setQuote(updated)
    try {
      await ElMessageBox.confirm(
        updated.mode === 'disabled'
          ? '限时活动已结束。当前费用为 ¥0，确认后继续。'
          : generating ? meteredPrice(updated) : '活动已结束，继续操作将按所用模型的实际用量计费。',
        '价格已更新',
        { confirmButtonText: generating ? '确认并生成' : '确认并继续', cancelButtonText: '取消', type: 'warning' },
      )
    } catch {
      return
    }
    return submit(updated.mode)
  }
}

const busy = computed(() => isShortVideoBusy(activeTask.value?.status))
/** 把「语种分组 + 音色」拍平成一个可搜索的下拉列表，标签形如「中文 - 晓晓（女）」 */
const flatVoiceOptions = computed(() => {
  if (options.value.voiceGroups.length) {
    return options.value.voiceGroups.flatMap((group) =>
      group.voices.map((voice) => ({ value: voice.value, label: `${group.label} - ${voice.label}` })),
    )
  }
  return options.value.voices
})
const canSubmit = computed(() => {
  if (!quote.value || busy.value || submitting.value || uploading.value || uploadingBgm.value || fetchingStock.value) return false
  if (form.bgmType === 'custom' && !form.bgmFile) return false
  if (!form.subject.trim()) return false
  if (form.videoSource === 'local' && form.materials.length === 0) return false
  if (isStockSource.value && (stockPicks.value.length === 0 || stockStale.value)) return false
  return true
})
const submitHint = computed(() => {
  if (busy.value || submitting.value) return ''
  if (fetchingStock.value) return '正在获取免费素材'
  if (!form.subject.trim()) return ''
  if (form.videoSource === 'local' && form.materials.length === 0) return '请先上传本地素材'
  if (isStockSource.value && stockPicks.value.length === 0) return '请先获取免费素材，确认后再生成'
  if (isStockSource.value && stockStale.value) return '文案或检索条件已变，请重新获取素材'
  if (form.bgmType === 'custom' && !form.bgmFile) return '请先上传自定义配乐'
  if (generateCount.value > 1) return '第 1 条用当前文案；之后每条重新写文案再生成'
  return ''
})
const fileAccept = computed(() => options.value.material.accept)
const isStockSource = computed(() => form.videoSource === 'stock' || form.videoSource === 'pexels')
const stockSourceOptions = computed(() => {
  if (options.value.stockProviders?.length) return options.value.stockProviders
  return (options.value.stockSources ?? []).map((item) => ({ ...item, configured: true }))
})
function stockQueryKey() {
  return JSON.stringify({
    subject: form.subject.trim(),
    script: form.script.trim(),
    terms: form.terms.trim(),
    scriptPrompt: form.scriptPrompt.trim(),
    paragraphNumber: form.paragraphNumber,
    aspect: form.aspect,
    sources: [...form.stockSources].sort(),
    semanticMatch: form.semanticMatch,
    stockDedupe: form.stockDedupe,
    voiceName: voiceMode.value === 'none' ? '' : form.voiceName,
  })
}
const stockStale = computed(() => isStockSource.value && stockPicks.value.length > 0 && stockFetchedKey.value !== stockQueryKey())
function stockSourceLabel(source: string) {
  return stockSourceOptions.value.find((item) => item.value === source)?.label || source
}
function pickStockSources(defaults?: string[], providers?: Array<{ value: string; configured?: boolean }>) {
  const wanted = defaults?.length ? defaults : ['pexels', 'wikimedia']
  const configured = (providers ?? []).filter((item) => item.configured !== false).map((item) => item.value)
  if (!configured.length) return [...wanted]
  const picked = wanted.filter((value) => configured.includes(value))
  return picked.length ? picked : configured
}
const paramSummaryChips = computed(() => {
  const aspect = options.value.aspects.find((item) => item.value === form.aspect)?.label
  const voice = voiceMode.value === 'none' ? '不配音' : (flatVoiceOptions.value.find((item) => item.value === form.voiceName)?.label || '配音')
  const bgm = options.value.bgmTypes.find((item) => item.value === form.bgmType)?.label
  return [aspect, voice, bgm].filter(Boolean) as string[]
})
function videosOf(item: ShortVideoTask) {
  if (item.videoUrls?.length) return item.videoUrls
  return item.videoUrl ? [item.videoUrl] : []
}
function videoSrc(item: ShortVideoTask) {
  const urls = videosOf(item)
  return urls[versionPick[item.id] ?? 0] || urls[0] || ''
}

/** 折叠面板标题旁的摘要：不展开也能看清当前配置，减少来回点击确认 */
function optionLabel(list: ShortVideoOption[], value: string) {
  return list.find((item) => item.value === value)?.label ?? value
}
const videoSettingsSummary = computed(() => {
  const concat = isStockSource.value && form.matchMaterials
    ? '按文案匹配画面'
    : optionLabel(options.value.concatModes, form.concatMode)
  const fit = optionLabel(options.value.fitModes, form.fitMode)
  const clip = form.videoSource === 'ai' ? `${form.clipDuration}s/片` : '2–15s 窗口'
  return `${concat} · ${fit} · ${clip} · ${form.clipSpeed.toFixed(1)}x`
})
const audioSettingsSummary = computed(() => {
  const voicePart = voiceMode.value === 'tts'
    ? `语速${form.voiceRate.toFixed(1)}x · 音量${Math.round(form.voiceVolume * 100)}%`
    : '无配音'
  const bgmPart = form.bgmType === 'none' ? '无配乐' : `配乐音量${Math.round(form.bgmVolume * 100)}%`
  return `${voicePart} · ${bgmPart}`
})
const subtitleSettingsSummary = computed(() => {
  if (!form.subtitleEnabled) return '已关闭'
  const position = optionLabel(options.value.subtitlePositions, form.subtitlePosition)
  return `${position} · 字号${form.fontSize}${form.textBackgroundEnabled ? ' · 带背景' : ''}`
})

watch(voiceMode, (mode) => {
  if (mode === 'none') {
    form.voiceName = 'no-voice'
    return
  }
  if (form.voiceName === 'no-voice') {
    form.voiceName = flatVoiceOptions.value[0]?.value || options.value.defaults.voiceName
  }
})

function formatSize(size: number) {
  if (!size) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(value: string) {
  return dayjs(value).format('YYYY-MM-DD HH:mm')
}

function applyOptions(data: ShortVideoOptions) {
  options.value = data
  const d = data.defaults
  form.aspect = d.aspect
  form.voiceName = d.voiceName
  form.bgmType = d.bgmType === 'ai' ? 'random' : d.bgmType
  form.stockSources = pickStockSources(d.stockSources, data.stockProviders)
  form.semanticMatch = d.semanticMatch !== false
  form.stockDedupe = d.stockDedupe !== false
  form.imageModelId = d.imageModelId ?? ''
  form.imageLora = d.imageLora ?? null
  form.terms = d.terms
  form.scriptPrompt = d.scriptPrompt
  form.paragraphNumber = d.paragraphNumber
  form.fitMode = d.fitMode
  form.concatMode = d.concatMode
  form.transitionMode = d.transitionMode
  form.clipDuration = d.clipDuration
  form.clipSpeed = d.clipSpeed
  form.videoCount = d.videoCount
  form.matchMaterials = d.matchMaterials
  form.noVoiceDurationSec = d.noVoiceDurationSec
  form.voiceVolume = d.voiceVolume
  form.voiceRate = d.voiceRate
  form.bgmVolume = d.bgmVolume
  form.subtitleEnabled = d.subtitleEnabled
  form.subtitlePosition = d.subtitlePosition
  form.customPosition = d.customPosition
  form.fontName = d.fontName
  form.fontSize = d.fontSize
  form.textForeColor = d.textForeColor
  form.textBackgroundEnabled = d.textBackgroundEnabled
  form.textBackgroundColor = d.textBackgroundColor
  form.strokeColor = d.strokeColor
  form.strokeWidth = d.strokeWidth
  voiceMode.value = 'tts'
}

function onMatchChange(checked: boolean | string | number) {
  if (checked) form.concatMode = 'sequential'
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause()
    previewAudio.src = ''
    previewAudio = null
  }
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = ''
  }
}

function playPreviewAudio(base64: string, mimeType: string) {
  stopPreview()
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  previewObjectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType || 'audio/mpeg' }))
  previewAudio = new Audio(previewObjectUrl)
  previewAudio.onended = () => stopPreview()
  return previewAudio.play()
}

async function previewVoice(kind: 'sample' | 'script') {
  if (previewing.value || voiceMode.value !== 'tts') return
  if (kind === 'script' && !form.script.trim()) return
  previewing.value = kind
  try {
    const data = await withConfirmedPrice((confirmedPricing) => previewShortVideoVoice({
      confirmedPricing,
      voiceName: form.voiceName,
      voiceRate: form.voiceRate,
      voiceVolume: form.voiceVolume,
      text: kind === 'script' ? form.script.trim() : undefined,
    }))
    if (!data) return
    try {
      await playPreviewAudio(data.audio, data.mimeType)
    } catch {
      ElMessage.warning('无法自动播放，请再点一次试听')
    }
  } catch {
    /* handled by request interceptor */
  } finally {
    previewing.value = ''
  }
}

async function generateScript() {
  const subject = form.subject.trim()
  if (!subject || generatingScript.value || busy.value) return
  if (form.script.trim()) {
    try {
      await ElMessageBox.confirm('将覆盖当前文案，是否继续？', 'AI 生成文案', {
        confirmButtonText: '覆盖',
        cancelButtonText: '取消',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  generatingScript.value = true
  try {
    const data = await withConfirmedPrice((confirmedPricing) => generateShortVideoScript({
      confirmedPricing,
      subject,
      voiceName: voiceMode.value === 'none' ? undefined : form.voiceName,
      paragraphNumber: form.paragraphNumber,
      scriptPrompt: form.scriptPrompt.trim() || undefined,
    }))
    if (!data) return
    form.script = data.script
    ElMessage.success('文案已填入，可继续编辑')
  } catch {
    /* handled by request interceptor */
  } finally {
    generatingScript.value = false
  }
}

function fillScriptFromTask(task: ShortVideoTask) {
  if (!acceptGeneratedScript || form.script.trim()) return
  const copy = (task.generatedScript || task.script || '').trim()
  if (copy) form.script = copy
}

function triggerUpload() {
  if (busy.value || uploading.value) return
  if (!auth.ensureLoggedIn()) return
  fileInputRef.value?.click()
}

function triggerBgmUpload() {
  if (busy.value || uploadingBgm.value) return
  bgmInputRef.value?.click()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  void uploadFiles(input.files)
  input.value = ''
}

function onBgmChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  void uploadBgm(file)
}

function onDrop(event: DragEvent) {
  if (busy.value) return
  void uploadFiles(event.dataTransfer?.files)
}

async function uploadFiles(fileList?: FileList | null) {
  if (!fileList?.length || uploading.value || !auth.ensureLoggedIn()) return
  uploading.value = true
  try {
    for (const file of Array.from(fileList)) {
      const item = await uploadShortVideoMaterial(file)
      if (!pageAlive) return
      rememberPreview(item.file, file)
      form.materials.push(item)
    }
    if (!pageAlive) return
    ElMessage.success('素材已上传')
  } catch {
    /* handled by request interceptor */
  } finally {
    uploading.value = false
  }
}

function rememberPreview(fileKey: string, file: File) {
  const previous = materialPreviews[fileKey]
  if (previous) URL.revokeObjectURL(previous.url)
  materialPreviews[fileKey] = {
    url: URL.createObjectURL(file),
    kind: /\.(jpe?g|png)$/i.test(file.name) ? 'image' : 'video',
  }
}

function openMaterial(item: ShortVideoMaterial) {
  const preview = materialPreviews[item.file]
  if (!preview) return
  materialViewing.value = { file: item.file, name: item.name, url: preview.url, kind: preview.kind, size: item.size }
}

function markUnplayable(file?: string) {
  if (!file || unplayable.value.has(file)) return
  const next = new Set(unplayable.value)
  next.add(file)
  unplayable.value = next
}

function releasePreview(fileKey: string) {
  const preview = materialPreviews[fileKey]
  if (!preview) return
  if (materialViewing.value?.file === fileKey) materialViewing.value = undefined
  URL.revokeObjectURL(preview.url)
  delete materialPreviews[fileKey]
  if (!unplayable.value.has(fileKey)) return
  const next = new Set(unplayable.value)
  next.delete(fileKey)
  unplayable.value = next
}

function releaseAllPreviews() {
  for (const fileKey of Object.keys(materialPreviews)) releasePreview(fileKey)
}

async function uploadBgm(file: File) {
  uploadingBgm.value = true
  try {
    const item = await uploadShortVideoBgm(file)
    form.bgmFile = item.file
    form.bgmName = item.name
    ElMessage.success('配乐已上传')
  } catch {
    /* handled by request interceptor */
  } finally {
    uploadingBgm.value = false
  }
}

function removeMaterial(index: number) {
  const [item] = form.materials.splice(index, 1)
  if (item) releasePreview(item.file)
}

function removeStock(id: string) {
  stockPicks.value = stockPicks.value.filter((item) => item.id !== id)
  if (!stockExcluded.value.includes(id)) stockExcluded.value = [...stockExcluded.value, id].slice(-80)
}

async function fetchStock() {
  if (!form.subject.trim() || fetchingStock.value || busy.value) return
  if (!form.stockSources.length) {
    ElMessage.warning('请至少选择一个素材库')
    return
  }
  const replacing = stockPicks.value.length > 0 || stockExcluded.value.length > 0
  fetchingStock.value = true
  try {
    const excludeIds = replacing
      ? [...new Set([...stockExcluded.value, ...stockPicks.value.map((item) => item.id)])].slice(-80)
      : undefined
    const res = await withConfirmedPrice((confirmedPricing) => previewShortVideoStock({
      confirmedPricing,
      subject: form.subject.trim(),
      script: form.script.trim() || undefined,
      terms: form.terms.trim() || undefined,
      scriptPrompt: form.scriptPrompt.trim() || undefined,
      paragraphNumber: form.paragraphNumber,
      voiceName: voiceMode.value === 'none' ? undefined : form.voiceName,
      aspect: form.aspect,
      stockSources: form.stockSources,
      semanticMatch: form.semanticMatch,
      stockDedupe: form.stockDedupe,
      excludeIds,
    }))
    if (!res) return
    form.script = res.script
    stockPicks.value = res.items
    if (excludeIds?.length) stockExcluded.value = excludeIds
    stockFetchedKey.value = stockQueryKey()
  } catch {
    /* handled by request interceptor */
  } finally {
    fetchingStock.value = false
  }
}

function buildSharedGeneratePayload() {
  return {
    scriptPrompt: form.scriptPrompt.trim() || undefined,
    paragraphNumber: form.paragraphNumber,
    aspect: form.aspect,
    voiceName: voiceMode.value === 'none' ? 'no-voice' : form.voiceName,
    voiceVolume: form.voiceVolume,
    voiceRate: form.voiceRate,
    bgmType: form.bgmType,
    bgmVolume: form.bgmVolume,
    bgmFile: form.bgmType === 'custom' ? form.bgmFile : undefined,
    videoSource: form.videoSource,
    stockSources: isStockSource.value ? form.stockSources : undefined,
    semanticMatch: form.semanticMatch,
    stockDedupe: form.stockDedupe,
    imageModelId: form.imageModelId || undefined,
    imageLora: form.imageLora || undefined,
    fitMode: form.fitMode,
    concatMode: form.concatMode,
    transitionMode: form.transitionMode,
    clipDuration: form.clipDuration,
    clipSpeed: form.clipSpeed,
    videoCount: 1,
    matchMaterials: isStockSource.value ? form.matchMaterials : false,
    noVoiceDurationSec: voiceMode.value === 'none' ? form.noVoiceDurationSec : undefined,
    subtitleEnabled: form.subtitleEnabled,
    subtitlePosition: form.subtitlePosition,
    customPosition: form.customPosition,
    fontName: form.fontName,
    fontSize: form.fontSize,
    textForeColor: form.textForeColor || '#FFFFFF',
    textBackgroundEnabled: form.textBackgroundEnabled,
    textBackgroundColor: form.textBackgroundColor || '#000000',
    strokeColor: form.strokeColor || '#000000',
    strokeWidth: form.strokeWidth,
    materials: form.videoSource === 'local' ? form.materials : undefined,
    stockPicks: isStockSource.value ? stockPicks.value.map(toStockPickPayload) : undefined,
    count: generateCount.value,
  }
}

async function stopTask(task: ShortVideoTask) {
  if (cancelling.value) return
  cancelling.value = true
  try {
    const latest = await cancelShortVideoTask(task.id)
    tasks.value = tasks.value.map((item) => (item.id === latest.id ? latest : item))
    if (activeTask.value?.id === latest.id) activeTask.value = null
    stopPolling()
    await loadHistory()
  } catch {
    /* handled by request interceptor */
  } finally {
    cancelling.value = false
  }
}

function cancelActive() {
  if (activeTask.value) void stopTask(activeTask.value)
}

async function handleGenerate() {
  if (!canSubmit.value || !auth.ensureLoggedIn()) return
  submitting.value = true
  try {
    const payload = {
      ...buildSharedGeneratePayload(),
      subject: form.subject.trim(),
      script: form.script.trim() || undefined,
      terms: form.terms.trim() || undefined,
    }
    const snapshot = JSON.stringify(payload)
    if (pending?.payload !== snapshot) pending = { id: crypto.randomUUID(), payload: snapshot }
    const requestId = pending.id
    const task = await withConfirmedPrice((confirmedPricing) => createShortVideoTask({ ...payload, requestId, confirmedPricing }), true)
    if (!task) return
    pending = undefined
    acceptGeneratedScript = true
    activeTask.value = task
    tasks.value = [task, ...tasks.value.filter((item) => item.id !== task.id)]
    page.value = 1
    if (narrow.value) mobilePane.value = 'works'
    await loadHistory()
    if (isShortVideoBusy(task.status)) {
      if (!pollTimer) startPolling(task.id)
      ElMessage.success(generateCount.value > 1 ? `已开始生成，共 ${generateCount.value} 条，完成一条后自动继续` : '已开始生成')
    }
  } catch {
    /* handled by request interceptor */
  } finally {
    submitting.value = false
  }
}

async function handleDownload(task: ShortVideoTask, index = 0) {
  try {
    const { url, fileName } = await getShortVideoDownloadUrl(task.id, index)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch {
    /* handled by request interceptor */
  }
}

async function handleDelete(task: ShortVideoTask) {
  await ElMessageBox.confirm(`确定删除「${task.subject}」吗？`, '删除作品', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
  try {
    await deleteShortVideoTask(task.id)
    await loadHistory()
    ElMessage.success('已删除')
  } catch {
    /* handled by request interceptor */
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const data = await listShortVideoTasks(page.value, pageSize)
    tasks.value = data.list
    total.value = data.total
    activeTask.value = data.active
    if (data.active) startPolling(data.active.id)
  } catch {
    /* handled by request interceptor */
  } finally {
    historyLoading.value = false
  }
}

function changePage(next: number) {
  page.value = next
  void loadHistory()
}

function startPolling(taskId: string) {
  stopPolling()
  pollTimer = setInterval(() => {
    void pollTask(taskId)
  }, 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollTask(taskId: string) {
  try {
    const latest = await getShortVideoTask(taskId)
    tasks.value = tasks.value.map((item) => (item.id === latest.id ? latest : item))
    if (activeTask.value?.id === latest.id) activeTask.value = latest
    fillScriptFromTask(latest)
    if (!isShortVideoBusy(latest.status)) {
      stopPolling()
      if (latest.status === 'success') ElMessage.success('视频已生成')
      // 数量大于 1 时，这条结束后下一条已经在排队，刷新后接着看它
      void loadHistory()
    }
  } catch {
    /* 瞬时失败继续轮询，超时由后端兜底 */
  }
}

onMounted(async () => {
  narrowMedia = window.matchMedia('(max-width: 1100px)')
  syncNarrow()
  narrowMedia.addEventListener('change', syncNarrow)
  try {
    applyOptions(await getShortVideoOptions())
  } catch {
    /* 使用本地兜底选项 */
  }
  if (auth.isLoggedIn) await loadHistory()
})

onUnmounted(() => {
  pageAlive = false
  narrowMedia?.removeEventListener('change', syncNarrow)
  stopPolling()
  stopPreview()
  releaseAllPreviews()
})
</script>

<style scoped>
/*
 * 通用的"表单 + 预览 + 历史"双栏工作台布局（.workspace/.panel/.compose/.pref-card/
 * .settings-collapse/.history-row 等）已提取到全局样式表 src/styles/media-workspace.css，
 * 这里只保留一键成片专属的样式（批量选题、素材上传等）。
 */

/* ─── 批量主题模式：主题方向 → AI 选题 → 可编辑列表 ─────────────── */
.compose-form { display: flex; flex-direction: column; }
.upload-block .dropzone { width: 100%; min-height: 64px; text-align: left; }
.upload-block .stock-grid { margin-top: 10px; }
.stock-thumb video { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; background: #14151d; }
.dropzone small { display: block; margin-top: 3px; font-size: 12px; }
.page-offer { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 4px 0 0; color: var(--color-text-secondary); font-size: 12px; }
.page-offer strong { color: var(--color-primary-dark); font-size: 15px; }
.generate-bar { flex-shrink: 0; margin-top: 12px; }
.generate-price { margin-bottom: 8px; }
.normal-price { margin: 4px 0 0; font-size: 12px; color: var(--color-text-secondary); }
.normal-price a { color: var(--color-primary-dark); text-decoration: underline; }
.count-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; font-size: 13px; color: var(--color-text-secondary); }
.generate-bar .generate-btn { margin-top: 0; }
.submit-hint { margin: 8px 0 0; font-size: 12px; color: var(--color-text-tertiary); }
.stock-board { margin-bottom: 8px; }
.stock-board-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.stock-note { font-size: 12px; color: var(--color-text-tertiary); }
.stock-note.is-warn { color: var(--color-warning); }
.stock-empty {
  margin: 0; padding: 14px; border-radius: 12px; text-align: center; font-size: 12.5px; line-height: 1.6;
  color: var(--color-text-tertiary); background: var(--color-bg-secondary);
  border: 1px dashed color-mix(in srgb, var(--color-text-tertiary) 35%, transparent);
}
.stock-grid { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; }
.stock-card { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.stock-thumb {
  position: relative; width: 100%; aspect-ratio: 16 / 10; padding: 0; border: none; border-radius: 10px; overflow: hidden;
  background: #14151d; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.stock-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.stock-fallback { color: rgba(255, 255, 255, .75); }
.stock-play {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(20, 21, 29, .28); color: #fff; font-size: 13px; font-weight: 700; opacity: 0; transition: opacity .15s;
}
.stock-thumb:hover .stock-play { opacity: 1; }
.stock-dialog { display: flex; flex-direction: column; gap: 8px; }
.stock-dialog img, .stock-dialog video { width: 100%; max-height: 70vh; object-fit: contain; background: #14151d; border-radius: 12px; }
.stock-dialog-meta { margin: 0; font-size: 12.5px; color: var(--color-text-tertiary); }
.generate-btn.is-stop { background: var(--color-error); box-shadow: none; }
.work-stop {
  border: none; border-radius: 999px; padding: 4px 12px; background: rgba(255, 255, 255, .16); color: #fff;
  font-size: 12px; cursor: pointer;
}
.work-stop:disabled { opacity: .5; cursor: not-allowed; }
.stock-remove {
  position: absolute; top: 6px; right: 6px; border: none; border-radius: 999px; padding: 2px 8px;
  background: rgba(15, 23, 42, 0.62); color: #fff; font-size: 12px; cursor: pointer;
}
.stock-remove:disabled { opacity: 0.5; cursor: not-allowed; }
.stock-meta { display: flex; gap: 6px; font-size: 11px; color: var(--color-text-tertiary); font-style: normal; }
.stock-meta em { font-style: normal; }
.stock-title { font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.script-label-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
}
.compose-form :deep(.model-picker) { width: 100%; }
.compose-form :deep(.picker-caption) { display: none; }

.works-panel { flex: 1; min-height: 0; height: 100%; display: flex; flex-direction: column; }
.works-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; }
.works-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 14px; }
.work-card {
  position: relative; display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-card); overflow: hidden;
  transition: box-shadow .18s, transform .15s;
}
.work-card:hover { box-shadow: 0 10px 24px rgba(31, 35, 60, .12); transform: translateY(-2px); }
.work-cover {
  position: relative; width: 100%; aspect-ratio: 9 / 16; overflow: hidden; background: #14151d;
  display: flex; align-items: center; justify-content: center;
}
.work-cover video { width: 100%; height: 100%; object-fit: contain; background: #14151d; display: block; }
.work-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  padding: 12px; text-align: center; color: rgba(255, 255, 255, .72); font-size: 12px; line-height: 1.5;
}
.work-state span { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.work-state.is-failed { color: #f5a3a3; }
.work-versions { position: absolute; left: 8px; top: 8px; display: flex; gap: 4px; z-index: 1; }
.work-versions button {
  width: 22px; height: 22px; border: none; border-radius: 999px; background: rgba(0, 0, 0, .55); color: #fff;
  font-size: 11px; cursor: pointer;
}
.work-versions button.is-active { background: var(--color-primary); }
.work-name {
  padding: 0 12px; font-size: 13.5px; font-weight: 600; color: var(--color-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.work-time { padding: 0 12px 12px; font-size: 11.5px; color: var(--color-text-tertiary); }
.work-download { padding: 0 10px 10px; margin-top: auto; }
.work-download .el-button { width: 100%; min-height: 44px; }
.work-ops { position: absolute; right: 8px; top: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity .15s; z-index: 2; }
.work-card:hover .work-ops { opacity: 1; }
.work-ops button {
  width: 24px; height: 24px; border: none; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.work-ops button:hover { background: var(--color-primary); }
.work-ops button:disabled { opacity: .45; cursor: not-allowed; }
.works-panel .pagination-wrap { flex-shrink: 0; justify-content: center; }

.mobile-tabs {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px;
  border-radius: 999px; background: var(--color-bg-secondary); border: 1px solid var(--color-border);
}
.mobile-tabs button {
  height: 36px; border: none; border-radius: 999px; background: transparent;
  color: var(--color-text-secondary); font-size: 13px; font-weight: 700; cursor: pointer;
}
.mobile-tabs button.is-active {
  background: var(--color-card); color: var(--color-primary-dark);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
}
.mobile-tabs em { margin-left: 6px; font-style: normal; font-size: 12px; color: var(--color-primary); }

@media (max-width: 1100px) {
  .workspace { flex: 1; min-height: 0; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; }
  .compose, .side-col, .works-panel { height: 100%; max-height: none; min-height: 0; }
  .work-ops { opacity: 1; }
}
@media (max-width: 540px) {
  .works-grid { grid-template-columns: 1fr; }
  .work-cover { max-height: 39dvh; }
}
@media (hover: none) {
  .work-ops { opacity: 1; }
}

</style>
