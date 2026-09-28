<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChatSender, type TdAttachmentItem } from '@tdesign-vue-next/chat';
import { FileIcon, FolderIcon } from 'tdesign-icons-vue-next';
import BotIcon from './BotIcon.vue';
import MicIcon from './MicIcon.vue';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { useDesktopApp } from '../composables/useDesktopApp';

type Mode = 'plan' | 'build' | 'yolo';

const props = withDefaults(
  defineProps<{
    conversationId?: string | null;
    placeholder?: string;
  }>(),
  { conversationId: null, placeholder: '描述你要构建或修复的内容，Enter 发送' },
);

const emit = defineEmits<{
  sent: [payload: { conversationId: string; taskId: string }];
  openTerminal: [];
}>();

const {
  sendMessage,
  sending,
  sendError,
  contextUsage,
  attachments,
  uploadAttachment,
  removeAttachment,
  enhancePromptText,
  workspace,
  app,
} = useDesktopApp();

const inputValue = ref('');
const mode = ref<Mode>('build');
const modelName = ref('');
const skill = ref('');
const thinkLevel = ref<'off' | 'low' | 'medium' | 'high'>('medium');
const enhancing = ref(false);
const listening = ref(false);
const files = ref<TdAttachmentItem[]>([]);
const compactLevel = ref(0);
const shellEl = ref<HTMLElement | null>(null);
const footerEl = ref<HTMLElement | null>(null);

const modeMeta: Record<Mode, { label: string; title: string }> = {
  plan: { label: 'Plan', title: '审批/只规划 · 点击切到 Build' },
  build: { label: 'Build', title: '标准构建 · 点击切到 Yolo' },
  yolo: { label: 'Yolo', title: '放开限制 · 点击切到 Plan' },
};

function cycleMode() {
  const order: Mode[] = ['plan', 'build', 'yolo'];
  mode.value = order[(order.indexOf(mode.value) + 1) % 3]!;
}

const models = computed(() =>
  (app.workspaceCapabilities.models ?? []).map((m) => ({
    value: m.id,
    label: m.model ? `${m.provider}/${m.model}` : m.id,
  })),
);

const modelLabel = computed(() => {
  if (!modelName.value) return '模型';
  return models.value.find((m) => m.value === modelName.value)?.label || '模型';
});

const usagePercent = computed(() =>
  contextUsage.value == null ? 0 : Math.round(Math.min(100, Math.max(0, contextUsage.value))),
);

const usageDetail = computed(() =>
  contextUsage.value == null ? '上下文 —' : `上下文 ${usagePercent.value}%`,
);

const thinkOptions = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
] as const;

const skillList = computed(() =>
  (app.workspaceCapabilities.skills ?? []).map((s) => ({ name: s.name })),
);

/** 项目文件引用（@ 进 context_paths / 输入框） */
const projectFiles = ref<string[]>([]);
const pickerOpen = ref(false);
const pickerFilter = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const workspaceFiles = computed(() => {
  const q = pickerFilter.value.trim().toLowerCase();
  return (app.workspaceCapabilities.files ?? [])
    .map((f) => f.path)
    .filter((p) => !q || p.toLowerCase().includes(q))
    .slice(0, 80);
});

function handleAttachClick() {
  fileInput.value?.click();
}

async function onPickFiles(event: Event) {
  const el = event.target as HTMLInputElement;
  for (const file of Array.from(el.files ?? [])) {
    void uploadAttachment(file);
  }
  el.value = '';
}

function openProjectPicker() {
  pickerOpen.value = true;
  pickerFilter.value = '';
  void app.refreshWorkspaceCapabilities();
}

function addProjectFile(path: string) {
  if (!projectFiles.value.includes(path)) {
    projectFiles.value = [...projectFiles.value, path];
  }
  inputValue.value = (inputValue.value ? inputValue.value + ' ' : '') + `@${path}`;
  pickerOpen.value = false;
}

function removeProjectFile(path: string) {
  projectFiles.value = projectFiles.value.filter((p) => p !== path);
}

function enhance() {
  const raw = inputValue.value.trim();
  if (!raw || enhancing.value) return;
  enhancing.value = true;
  try {
    inputValue.value = enhancePromptText(raw, workspace.value);
  } finally {
    enhancing.value = false;
  }
}

function toggleVoice() {
  const W = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!Ctor) {
    inputValue.value = (inputValue.value ? inputValue.value + ' ' : '') + '（语音需浏览器支持）';
    return;
  }
  const recognition = new Ctor();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    const text = e.results[0]?.[0]?.transcript ?? '';
    if (text) inputValue.value = (inputValue.value ? inputValue.value + ' ' : '') + text;
  };
  recognition.onend = () => {
    listening.value = false;
  };
  listening.value = true;
  recognition.start();
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
};

async function handleSend(text: string) {
  const prompt = text.trim();
  if (!prompt || sending.value) return;
  const result = await sendMessage({
    prompt,
    mode: mode.value as ExecutionModeInput,
    conversationId: props.conversationId,
    modelName: modelName.value || undefined,
    skill: skill.value || undefined,
    contextPaths: [
      ...attachments.value.map((a) => a.path),
      ...projectFiles.value,
    ],
  });
  if (result) {
    inputValue.value = '';
    files.value = [];
    projectFiles.value = [];
    emit('sent', result);
  }
}

async function handleFileSelect(e: { detail: File[] }) {
  for (const file of e.detail) {
    void uploadAttachment(file);
  }
}

function handleFileRemove(e: { detail: File[] }) {
  for (const f of e.detail) {
    const match = attachments.value.find((a) => a.name === f.name);
    if (match) removeAttachment(match.path);
  }
  files.value = e.detail;
}

function onPaste(event: ClipboardEvent) {
  let handled = false;
  for (const item of Array.from(event.clipboardData?.items ?? [])) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        void uploadAttachment(file);
        handled = true;
      }
    }
  }
  if (handled) event.preventDefault();
}
</script>

<template>
  <div ref="shellEl" class="td-chat-shell">
    <t-attachments
      v-if="attachments.length"
      class="td-chat-attachments"
      :items="attachments.map((a) => ({ name: a.name, size: a.size }) as TdAttachmentItem)"
      overflow="scrollY"
      @remove="handleFileRemove"
    />
    <input ref="fileInput" type="file" multiple hidden @change="onPickFiles" />

    <div v-if="projectFiles.length" class="project-file-chips">
      <span v-for="p in projectFiles" :key="p" class="attachment-chip">
        <span class="attachment-name" :title="p">@{{ p.split(/[\\/]/).pop() }}</span>
        <button type="button" class="attachment-remove" @click="removeProjectFile(p)">×</button>
      </span>
    </div>

    <t-chat-sender
      v-model="inputValue"
      class="td-chat-sender"
      :placeholder="placeholder"
      :loading="sending"
      :upload-props="{ multiple: true }"
      :attachments-props="{ items: files }"
      @send="handleSend"
      @file-select="handleFileSelect"
      @file-remove="handleFileRemove"
      @paste="onPaste"
    >
      <template #footer-prefix>
        <div ref="footerEl" class="composer-bar composer-bar--official">
          <t-popup trigger="click" placement="top-start" :overlay-style="{ zIndex: 300, padding: '6px' }">
            <button class="ghost-btn" type="button" title="添加">+</button>
            <template #content>
              <div class="plus-menu plus-menu--static">
                <button type="button" class="plus-item" @click="handleAttachClick">
                  <FileIcon size="14" />
                  <span>添加照片和文件</span>
                </button>
                <button type="button" class="plus-item" @click="openProjectPicker">
                  <FolderIcon size="14" />
                  <span>@ 项目文件<span class="plus-desc">引用工作区文件到任务</span></span>
                </button>
                <button type="button" class="plus-item" @click="mode = 'plan'">
                  <BotIcon size="14" />
                  <span>编排模式<span class="plus-desc">澄清需求、规格、实现与评审</span></span>
                </button>
                <div class="plus-sep" />
                <button
                  v-for="s in skillList"
                  :key="s.name"
                  type="button"
                  class="plus-sub-item"
                  @click="skill = s.name"
                >
                  <span class="plus-sub-name">技能 · {{ s.name }}</span>
                </button>
                <div v-if="!skillList.length" class="plus-sub-empty">暂无技能</div>
              </div>
            </template>
          </t-popup>

          <button type="button" class="mode-cycle" :class="`mode-${mode}`" :title="modeMeta[mode].title" @click="cycleMode">
            {{ modeMeta[mode].label }}
          </button>

          <t-popup trigger="click" placement="top" :overlay-style="{ zIndex: 300, padding: '6px' }">
            <button class="model-btn" type="button" title="选择模型">{{ modelLabel }}</button>
            <template #content>
              <div class="model-menu plus-menu--static">
                <div class="think-depth">
                  <div class="think-label">思考深度</div>
                  <div class="think-group">
                    <button
                      v-for="opt in thinkOptions"
                      :key="opt.value"
                      type="button"
                      class="think-btn"
                      :class="{ on: thinkLevel === opt.value }"
                      @click="thinkLevel = opt.value"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>
                <div class="plus-sep" />
                <button type="button" class="plus-sub-item" :class="{ on: !modelName }" @click="modelName = ''">
                  默认模型
                </button>
                <button
                  v-for="m in models"
                  :key="m.value"
                  type="button"
                  class="plus-sub-item"
                  :class="{ on: modelName === m.value }"
                  @click="modelName = m.value"
                >
                  <span class="plus-sub-name">{{ m.label }}</span>
                </button>
              </div>
            </template>
          </t-popup>

          <t-tooltip :content="usageDetail" placement="top">
            <div class="usage-ring" role="button" :aria-label="usageDetail">
              <t-progress :percentage="usagePercent" size="small" theme="circle" :label="false" />
            </div>
          </t-tooltip>

          <button class="ghost-btn" type="button" title="语音输入" @click="toggleVoice">
            <MicIcon size="16" />
          </button>
          <button class="ghost-btn" type="button" title="提示词增强" :disabled="enhancing || !inputValue.trim()" @click="enhance">
            <BotIcon size="16" />
          </button>
        </div>
      </template>
    </t-chat-sender>

    <!-- @ 项目文件：固定浮层，不随 popup 自动关 -->
    <div
      v-if="pickerOpen"
      class="file-pick-overlay"
      @click.self="pickerOpen = false"
    >
      <div class="file-pick-menu" @click.stop>
        <input v-model="pickerFilter" class="plus-search" placeholder="搜索项目文件" autofocus />
        <div class="file-pick-list">
          <button
            v-for="p in workspaceFiles"
            :key="p"
            type="button"
            class="plus-sub-item"
            @click="addProjectFile(p)"
          >
            <FileIcon size="12" />
            <span class="plus-sub-name">{{ p }}</span>
          </button>
          <div v-if="!workspaceFiles.length" class="plus-sub-empty">无匹配文件</div>
        </div>
        <button type="button" class="plus-item" @click="pickerOpen = false">关闭</button>
      </div>
    </div>

    <div v-if="sendError" class="composer-error">{{ sendError }}</div>
  </div>
</template>
