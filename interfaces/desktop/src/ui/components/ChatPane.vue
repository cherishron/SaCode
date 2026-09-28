<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChatSender, isAIMessage, type ChatMessagesData, type TdAttachmentItem } from '@tdesign-vue-next/chat';
import { Attachments } from '@tdesign-vue-next/chat';
import { AddIcon, FileIcon, SettingIcon, TerminalIcon, FolderOpenIcon } from 'tdesign-icons-vue-next';
import BotIcon from './BotIcon.vue';
import MicIcon from './MicIcon.vue';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { useDesktopApp } from '../composables/useDesktopApp';

type Mode = 'plan' | 'build' | 'yolo';

const props = defineProps<{
  conversationId: string | null;
}>();

const emit = defineEmits<{
  sent: [payload: { conversationId: string; taskId: string }];
  openTerminal: [];
}>();

const {
  chatItems,
  sendMessage,
  sending,
  sendError,
  contextUsage,
  attachments,
  uploadAttachment,
  removeAttachment,
  selectedId,
  workspace,
  enhancePromptText,
  app,
} = useDesktopApp();

const inputValue = ref('');
const mode = ref<Mode>('build');
const modelName = ref('');
const skill = ref('');
const enhancing = ref(false);
const listening = ref(false);
const senderRef = ref<{ selectFile?: () => void } | null>(null);
const files = ref<TdAttachmentItem[]>([]);
const plusOpen = ref(false);
const skillOpen = ref(false);
const menuPos = ref({ x: 0, y: 0 });
const modelOpen = ref(false);

const modelMenuStyle = computed(() => ({
  left: `${menuPos.value.x + 48}px`,
  top: `${menuPos.value.y}px`,
  transform: 'translateY(-100%)',
}));

function toggleModel(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menuPos.value = { x: rect.left, y: rect.top - 8 };
  plusOpen.value = false;
  skillOpen.value = false;
  modelOpen.value = !modelOpen.value;
}

function pickModel(id: string) {
  modelName.value = id;
  modelOpen.value = false;
}

function togglePlus(e?: MouseEvent) {
  if (plusOpen.value) {
    plusOpen.value = false;
    skillOpen.value = false;
    modelOpen.value = false;
    return;
  }
  const btn = (e?.currentTarget as HTMLElement) || (e?.target as HTMLElement);
  const rect = btn?.getBoundingClientRect();
  if (rect) {
    menuPos.value = { x: rect.left, y: rect.top - 8 };
  }
  plusOpen.value = true;
}

function placeSkillPanel(from?: HTMLElement | EventTarget | null) {
  const el = (from as HTMLElement) || document.querySelector('.plus-menu--teleport');
  const r = el?.getBoundingClientRect?.();
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  const panelW = 260;
  const panelH = Math.min(360, h - 24);
  let left: number;
  let top: number;
  if (r && r.width > 0) {
    // 优先右侧；不够就放到左侧
    left = r.right + 8;
    if (left + panelW > w - 8) left = Math.max(8, r.left - panelW - 8);
    top = r.top;
    if (top + panelH > h - 8) top = Math.max(8, h - panelH - 8);
  } else {
    left = Math.min(menuPos.value.x + 230, w - panelW - 8);
    top = Math.max(8, menuPos.value.y - panelH);
  }
  skillPos.value = { left, top, height: panelH };
}

function onSkillClick(e: MouseEvent) {
  skillOpen.value = true;
  plusOpen.value = true;
  modelOpen.value = false;
  placeSkillPanel(e.currentTarget);
}

function onSkillHover(e: MouseEvent) {
  if (plusOpen.value) {
    skillOpen.value = true;
    modelOpen.value = false;
    placeSkillPanel(e.currentTarget);
  }
}

const skillPos = ref({ left: 0, top: 0, height: 360 });

const skillMenuStyle = computed(() => ({
  left: `${skillPos.value.left}px`,
  top: `${skillPos.value.top}px`,
  maxHeight: `${skillPos.value.height}px`,
  position: 'fixed' as const,
  transform: 'none',
  zIndex: 200,
}));

const skillFilter = ref('');

const skillList = computed(() =>
  (app.workspaceCapabilities.skills ?? []).map((s) => ({
    name: s.name,
    description: s.description || s.source,
  })),
);

const filteredSkills = computed(() => {
  const q = skillFilter.value.trim().toLowerCase();
  if (!q) return skillList.value;
  return skillList.value.filter((s) => s.name.toLowerCase().includes(q));
});
const footerEl = ref<HTMLElement | null>(null);
const shellEl = ref<HTMLElement | null>(null);
/** 0=全量；变窄时依次隐藏：增强→语音→用量→模型 */
const compactLevel = ref(0);

function measureFooter() {
  const el = shellEl.value || footerEl.value;
  if (!el) return;
  const w = el.getBoundingClientRect().width || el.clientWidth;
  // 用格子实际宽度分档（不是 footer 自身宽度，它可能被撑满）
  if (w < 220) compactLevel.value = 4;
  else if (w < 320) compactLevel.value = 3;
  else if (w < 420) compactLevel.value = 2;
  else if (w < 520) compactLevel.value = 1;
  else compactLevel.value = 0;
}

/** 映射为官方 ChatMessagesData（placement 由 role 决定） */
const messages = computed<ChatMessagesData[]>(() => {
  const id = props.conversationId;
  return chatItems.value
    .filter((item) => !id || item.taskId === id || !item.taskId)
    .map((item, index) => {
      const isUser = item.kind === 'user';
      const role = isUser ? 'user' : item.kind === 'system' ? 'system' : 'assistant';
      const text = item.kind === 'error' ? `⚠ ${item.text}` : item.text;
      return {
        id: item.id || `m-${index}`,
        role,
        avatar: isUser
          ? 'https://tdesign.gtimg.com/site/avatar.jpg'
          : 'https://tdesign.gtimg.com/site/chat-avatar.png',
        name: isUser ? '你' : item.kind === 'tool' ? '工具' : 'SaCode',
        status: item.kind === 'error' ? 'error' : 'complete',
        content: [{ type: 'text', status: 'complete', data: text }],
      } as unknown as ChatMessagesData;
    });
});

const modeMeta: Record<Mode, { label: string; title: string }> = {
  plan: { label: 'Plan', title: '审批/只规划 · 点击切到 Build' },
  build: { label: 'Build', title: '标准构建 · 点击切到 Yolo' },
  yolo: { label: 'Yolo', title: '放开限制 · 点击切到 Plan' },
};

function cycleMode() {
  const order: Mode[] = ['plan', 'build', 'yolo'];
  const i = order.indexOf(mode.value);
  mode.value = order[(i + 1) % order.length]!;
}

const usagePercent = computed(() =>
  contextUsage.value == null ? 0 : Math.round(Math.min(100, Math.max(0, contextUsage.value))),
);

const usageDetail = computed(() => {
  if (contextUsage.value == null) return '上下文 —';
  return `上下文 ${usagePercent.value}%`;
});

const models = computed(() => {
  const list = app.workspaceCapabilities.models ?? [];
  return list.map((m) => ({
    value: m.id,
    label: m.model ? `${m.provider}/${m.model}` : m.id,
  }));
});

const modelLabel = computed(() => {
  if (!modelName.value) return '模型';
  const found = models.value.find((m) => m.value === modelName.value);
  return found?.label || '模型';
});

/** 思考深度：关闭 / 低 / 中 / 高 */
type ThinkLevel = 'off' | 'low' | 'medium' | 'high';
const thinkLevel = ref<ThinkLevel>('medium');
const thinkOptions: Array<{ value: ThinkLevel; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

watch(
  () => props.conversationId,
  () => {
    inputValue.value = '';
    files.value = [];
  },
);

function onDocPointer(e: PointerEvent) {
  const target = e.target as Node;
  const inFooter = !!footerEl.value?.contains(target);
  const inAnyMenu = !!(
    target instanceof Element &&
    target.closest('.plus-menu, .plus-sub-panel, .model-menu, .plus-menu--teleport')
  );
  if (!inFooter && !inAnyMenu) {
    plusOpen.value = false;
    skillOpen.value = false;
    modelOpen.value = false;
  }
}

let ro: ResizeObserver | null = null;

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer);
  measureFooter();
  ro = new ResizeObserver(() => measureFooter());
  if (shellEl.value) ro.observe(shellEl.value);
  // 父 pane 尺寸变化也要跟
  const pane = shellEl.value?.closest('.pane-body, .split-leaf, .work-area');
  if (pane) ro.observe(pane);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  document.removeEventListener('pointerdown', onDocPointer);
});

function isAIMessageComplete(message: ChatMessagesData) {
  return isAIMessage(message) && message.status === 'complete';
}

async function handleSend(text: string) {
  const prompt = text.trim();
  if (!prompt || sending.value) return;
  const result = await sendMessage({
    prompt,
    mode: mode.value as ExecutionModeInput,
    conversationId: props.conversationId ?? selectedId.value,
    modelName: modelName.value || undefined,
    skill: skill.value || undefined,
    contextPaths: attachments.value.map((a) => a.path),
  });
  if (result) {
    inputValue.value = '';
    files.value = [];
    emit('sent', result);
  }
}

function handleStop() {
  /* 停止由 daemon cancel 接入后补充 */
}

async function handleFileSelect(e: { detail: File[] }) {
  for (const file of e.detail) {
    const item: TdAttachmentItem = {
      name: file.name,
      status: 'progress',
      description: '上传中',
    } as TdAttachmentItem;
    files.value = [item, ...files.value];
    const uploaded = await uploadAttachment(file);
    files.value = files.value.map((f) =>
      f.name === file.name
        ? ({ ...f, status: 'success', description: '已上传', url: uploaded?.path } as TdAttachmentItem)
        : f,
    );
  }
}

function handleFileRemove(e: { detail: File[] }) {
  files.value = e.detail;
  for (const f of e.detail) {
    const match = attachments.value.find((a) => a.name === f.name);
    if (match) removeAttachment(match.path);
  }
}

function handleAttachClick() {
  plusOpen.value = false;
  senderRef.value?.selectFile?.();
}

function pickSkill(name: string) {
  skill.value = name;
  skillOpen.value = false;
  plusOpen.value = false;
}

function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;
  let handled = false;
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        void handleFileSelect({ detail: [file] });
        handled = true;
      }
    }
  }
  // 文本走默认粘贴；图片已处理时阻止默认避免塞进 textarea
  if (handled) event.preventDefault();
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
  stop: () => void;
};
</script>

<template>
  <div ref="shellEl" class="td-chat-shell" :class="`compact-${compactLevel}`">
    <!-- 官方形态：t-chat-list + t-chat-message（placement/variant） -->
    <t-chat-list :clear-history="false" class="td-chat-stream" style="flex: 1">
      <t-chat-message
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :placement="message.role === 'user' ? 'right' : 'left'"
        :variant="message.role === 'user' ? 'base' : 'text'"
        :avatar="message.role === 'user' ? 'https://tdesign.gtimg.com/site/avatar.jpg' : 'https://tdesign.gtimg.com/site/chat-avatar.png'"
        allow-content-segment-custom
      >
        <template #actionbar>
          <t-space v-if="isAIMessageComplete(message)" size="small" :style="{ marginTop: '6px' }">
            <t-button shape="square" variant="text" size="small" title="复制">复制</t-button>
          </t-space>
        </template>
      </t-chat-message>
    </t-chat-list>

    <!-- 附件条（文件在上） -->
    <t-attachments
      v-if="files.length"
      class="td-chat-attachments"
      :items="files"
      overflow="scrollY"
      @remove="handleFileRemove"
    />

    <!-- 官方 sender（控制条在 footer-prefix 内） -->
    <t-chat-sender
      ref="senderRef"
      v-model="inputValue"
      class="td-chat-sender"
      placeholder="描述你要构建或修复的内容，Enter 发送"
      :loading="sending"
      :upload-props="{ multiple: true }"
      :attachments-props="{ items: files }"
      @send="handleSend"
      @stop="handleStop"
      @file-select="handleFileSelect"
      @file-remove="handleFileRemove"
      @paste="onPaste"
    >
      <template #footer-prefix>
        <div ref="footerEl" class="composer-bar composer-bar--official">
          <t-popup trigger="click" placement="top-start" :overlay-style="{ zIndex: 300, padding: '6px' }">
            <button class="ghost-btn" type="button" title="添加">+</button>
            <template #content>
              <div class="plus-menu plus-menu--static" @click.stop>
                <button type="button" class="plus-item" @click="handleAttachClick">
                  <FileIcon size="14" />
                  <span>添加照片和文件</span>
                </button>
                <button type="button" class="plus-item" @click="mode = 'plan'">
                  <BotIcon size="14" />
                  <span>
                    编排模式
                    <span class="plus-desc">澄清需求、规格、实现与评审</span>
                  </span>
                </button>
                <div class="plus-sep" />
                <button
                  type="button"
                  class="plus-item plus-skill"
                  :class="{ active: skillOpen }"
                  @click.stop="skillOpen = !skillOpen"
                >
                  <SettingIcon size="14" />
                  <span>技能</span>
                  <span class="plus-arrow">›</span>
                </button>
                <!-- 技能列表：同层内嵌展开 -->
                <div v-if="skillOpen" class="plus-skill-panel">
                  <input v-model="skillFilter" class="plus-search" placeholder="搜索技能" />
                  <button
                    v-for="s in filteredSkills"
                    :key="s.name"
                    type="button"
                    class="plus-sub-item"
                    @click="pickSkill(s.name)"
                  >
                    <SettingIcon size="12" />
                    <span class="plus-sub-name">{{ s.name }}</span>
                  </button>
                  <div v-if="!filteredSkills.length" class="plus-sub-empty">无匹配技能</div>
                </div>
              </div>
            </template>
          </t-popup>
          <button type="button" class="mode-cycle" :class="`mode-${mode}`" :title="modeMeta[mode].title" @click="cycleMode">
            {{ modeMeta[mode].label }}
          </button>
          <t-popup
            v-if="compactLevel < 3"
            trigger="click"
            placement="top"
            :overlay-style="{ zIndex: 300, padding: '6px' }"
          >
            <button class="model-btn" type="button" title="选择模型">
              {{ modelLabel }}
            </button>
            <template #content>
              <div class="model-menu plus-menu--static" @click.stop>
                <div class="think-depth">
                  <div class="think-label">思考深度</div>
                  <div class="think-group" role="group" aria-label="思考深度">
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
                <button type="button" class="plus-sub-item" :class="{ on: !modelName }" @click="pickModel('')">
                  默认模型
                </button>
                <button
                  v-for="m in models"
                  :key="m.value"
                  type="button"
                  class="plus-sub-item"
                  :class="{ on: modelName === m.value }"
                  @click="pickModel(m.value)"
                >
                  <span class="plus-sub-name">{{ m.label }}</span>
                </button>
              </div>
            </template>
          </t-popup>
          <t-tooltip v-if="compactLevel < 2" :content="usageDetail" placement="top">
            <div class="usage-ring" role="button" :aria-label="usageDetail">
              <t-progress :percentage="usagePercent" size="small" theme="circle" :label="false" />
            </div>
          </t-tooltip>
          <button
            v-if="compactLevel < 1"
            class="ghost-btn"
            type="button"
            title="语音输入"
            @click="toggleVoice"
          >
            <MicIcon size="16" />
          </button>
          <button
            v-if="compactLevel < 1"
            class="ghost-btn"
            type="button"
            title="提示词增强"
            :disabled="enhancing || !inputValue.trim()"
            @click="enhance"
          >
            <BotIcon size="16" />
          </button>
        </div>
      </template>
    </t-chat-sender>

    <!-- + 菜单 Teleport，不受 sender 裁切 -->
    <Teleport to="body">
      <div
        v-if="plusOpen"
        class="plus-menu plus-menu--teleport"
        :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
      >
        <button type="button" class="plus-item" @click="handleAttachClick">
          <FileIcon size="14" />
          <span>添加照片和文件</span>
        </button>
        <button type="button" class="plus-item" @click="plusOpen = false; mode = 'plan'">
          <BotIcon size="14" />
          <span>
            编排模式
            <span class="plus-desc">澄清需求、规格、实现与评审</span>
          </span>
        </button>
        <div class="plus-sep" />
        <button
          type="button"
          class="plus-item plus-skill"
          :class="{ active: skillOpen }"
          @mousedown.stop.prevent
          @click.stop="onSkillClick"
          @mouseenter="onSkillHover"
        >
          <SettingIcon size="14" />
          <span>技能</span>
          <span class="plus-arrow">›</span>
        </button>
      </div>

      <!-- 技能右侧浮层（与主菜单同开） -->
      <div
        v-show="skillOpen && plusOpen"
        class="plus-menu plus-sub-panel"
        :style="skillMenuStyle"
        @mousedown.stop
      >
        <div class="plus-sub-head">
          <input v-model="skillFilter" class="plus-search" placeholder="搜索技能" />
        </div>
        <div class="plus-skill-list">
          <button
            v-for="s in filteredSkills"
            :key="s.name"
            type="button"
            class="plus-sub-item"
            @click="pickSkill(s.name)"
          >
            <SettingIcon size="12" />
            <span class="plus-sub-name">{{ s.name }}</span>
          </button>
          <div v-if="!filteredSkills.length" class="plus-sub-empty">无匹配技能</div>
        </div>
      </div>

      <!-- 模型点选弹层 -->
      <div v-if="modelOpen" class="plus-menu model-menu" :style="modelMenuStyle">
        <button type="button" class="plus-sub-item" :class="{ on: !modelName }" @click="pickModel('')">
          默认模型
        </button>
        <button
          v-for="m in models"
          :key="m.value"
          type="button"
          class="plus-sub-item"
          :class="{ on: modelName === m.value }"
          @click="pickModel(m.value)"
        >
          <span class="plus-sub-name">{{ m.label }}</span>
        </button>
      </div>
    </Teleport>

    <div v-if="sendError" class="composer-error">{{ sendError }}</div>
  </div>
</template>
