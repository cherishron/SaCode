<template>
  <div class="wb desktop-workbench" :class="{ 'sidebar-hidden': !sidebarOpen }">
    <aside class="workspace-nav" aria-label="工作区与会话">
      <div class="sidebar-heading">
        <span>工作空间</span>
        <button type="button" class="icon-button" aria-label="收起侧栏" @click="sidebarOpen = false">
          <UiIcon name="panel" />
        </button>
      </div>
      <button
        type="button"
        class="home-button"
        :class="{ selected: !store.selectedSessionId }"
        data-home
        @click="goHome"
      >
        <UiIcon name="home" /><span>首页</span><span class="key-hint">⌂</span>
      </button>
      <label class="session-search">
        <UiIcon name="search" />
        <input v-model="query" type="search" aria-label="搜索会话" placeholder="搜索会话" />
      </label>
      <div class="nav-scroll">
        <section class="target-section" data-targets>
          <h2>
            服务目标 <span>{{ store.targets.length }}</span>
          </h2>
          <button
            v-for="t in store.targets"
            :key="t.id"
            type="button"
            class="target-row link"
            :class="{ active: t.id === store.selectedTargetId }"
            :aria-pressed="t.id === store.selectedTargetId"
            @click="pickTarget(t.id)"
          >
            <UiIcon name="server" /><span>{{ t.label }}</span
            ><span
              class="target-indicator"
              :class="{ selected: t.id === store.selectedTargetId }"
              aria-hidden="true"
            />
          </button>
          <p v-if="loadingTargets" class="nav-empty" role="status">正在读取目标…</p>
          <p v-else-if="!store.targets.length" class="nav-empty">尚无可用目标</p>
        </section>
        <section class="session-section" data-sessions>
          <h2>
            会话记录 <span>{{ store.sessions.length }}</span>
          </h2>
          <button
            v-for="s in filteredSessions"
            :key="s.id"
            type="button"
            class="session-row link"
            :class="{ active: s.id === store.selectedSessionId }"
            :aria-current="s.id === store.selectedSessionId ? 'page' : undefined"
            :title="s.title"
            @click="pickSession(s.id)"
          >
            <UiIcon name="chat" />
            <span class="session-copy"
              ><span class="title">{{ s.title || '未命名会话' }}</span
              ><span class="session-meta"
                ><span class="status">{{ statusLabel(s.status) }}</span
                ><span>{{ formatDate(s.updatedAt) }}</span></span
              ></span
            >
          </button>
          <p v-if="loadingSessions" class="nav-empty" role="status">正在读取会话…</p>
          <p v-else-if="!filteredSessions.length" class="nav-empty">
            {{ query ? '没有匹配的会话' : '该目标暂无会话' }}
          </p>
        </section>
      </div>
      <footer class="sidebar-footer">
        <div class="read-mode"><UiIcon name="shield" /><span>只读工作台</span></div>
        <p>查看记录与实时事件，不执行文件修改。</p>
      </footer>
    </aside>

    <section class="conversation-center" aria-label="会话工作台">
      <header class="conversation-header">
        <button
          v-if="!sidebarOpen"
          type="button"
          class="icon-button"
          aria-label="展开侧栏"
          @click="sidebarOpen = true"
        >
          <UiIcon name="panel" />
        </button>
        <span class="breadcrumb">{{ selectedTarget?.label || '工作台' }}</span
        ><span class="breadcrumb-separator">/</span>
        <span class="current-title">{{
          store.selectedSessionId ? store.detail?.title || '会话记录' : '首页'
        }}</span>
        <span class="readonly-badge"><UiIcon name="shield" />只读</span>
      </header>
      <p v-if="store.error" class="err workbench-error" role="alert">{{ store.error }}</p>

      <div v-if="!store.selectedSessionId" class="welcome-space" data-workbench-home>
        <div class="welcome-content">
          <div class="hero-heading">
            <img src="/sacode-logo.png" width="40" height="40" alt="" />
            <h1>让灵感，有迹可循。</h1>
          </div>
          <p class="welcome-subtitle">从一段会话开始，接续你的工作。</p>
          <div class="workspace-chip">
            <UiIcon name="folder" /><span>{{ selectedTarget?.label || '尚未选择服务' }}</span
            ><span class="workspace-chip-label">{{ store.workspaceId ? '已绑定工作区' : '等待连接' }}</span>
          </div>
          <div class="composer-preview" aria-describedby="composer-limitation">
            <label for="web-composer" class="sr-only">任务输入（尚未接入）</label>
            <textarea id="web-composer" rows="2" disabled placeholder="描述你的任务或补充信息…" />
            <div class="composer-toolbar">
              <span class="composer-plus" aria-hidden="true">＋</span><span>任务能力待接入</span
              ><span class="composer-spacer" /><span class="composer-mode"
                ><UiIcon name="shield" />只读模式</span
              ><button type="button" class="send-preview" disabled aria-label="发送消息（尚未接入）">
                <UiIcon name="arrow" />
              </button>
            </div>
          </div>
          <p id="composer-limitation" class="composer-limitation">
            当前可浏览会话与事件；创建任务、模型调用及审批尚未开放。
          </p>
          <section v-if="recentSessions.length" class="recent-sessions" aria-label="继续最近会话">
            <div class="recent-heading">
              <h2>继续最近会话</h2>
              <span>{{ store.sessions.length }} 段记录</span>
            </div>
            <button
              v-for="s in recentSessions"
              :key="s.id"
              type="button"
              class="recent-row"
              @click="pickSession(s.id)"
            >
              <UiIcon name="chat" /><span>{{ s.title }}</span
              ><time :datetime="s.updatedAt">{{ formatDate(s.updatedAt) }}</time
              ><UiIcon name="chevron" />
            </button>
          </section>
        </div>
        <p class="welcome-footnote">SaCode Web <span>·</span> 你的工作，始终有迹可循</p>
      </div>

      <div v-else class="history-space">
        <div class="history-toolbar">
          <div>
            <h1>{{ store.detail?.title || '会话记录' }}</h1>
            <p>会话历史与上游事件的只读视图</p>
          </div>
          <span class="stream-state muted" data-stream-status role="status" aria-live="polite"
            ><span class="stream-dot" :class="{ connected: store.streamStatus === 'open' }" /><template
              v-if="store.refilling"
              >补读中…</template
            ><template v-else-if="store.streamStatus === 'open'">实时已连接</template
            ><template v-else-if="store.streamStatus === 'connecting'">连接中…</template
            ><template v-else-if="store.streamStatus === 'closed'">连接断开，正在重连…</template
            ><template v-else>未连接</template></span
          >
        </div>
        <details v-if="store.detail" class="session-details">
          <summary>
            会话信息<span>{{ store.workspaceId }}</span>
          </summary>
          <dl class="detail">
            <div>
              <dt>标题</dt>
              <dd>{{ store.detail.title }}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{{ statusLabel(store.detail.status) }}</dd>
            </div>
            <div>
              <dt>工作区</dt>
              <dd>{{ store.detail.workspaceId }}</dd>
            </div>
            <div>
              <dt>创建</dt>
              <dd>{{ store.detail.createdAt }}</dd>
            </div>
            <div>
              <dt>更新</dt>
              <dd>{{ store.detail.updatedAt }}</dd>
            </div>
          </dl>
        </details>
        <div class="timeline-heading">
          <span>事件记录</span><span>{{ store.events.length }} 条</span>
        </div>
        <ul
          v-if="store.loadingEvents && !store.events.length"
          class="events skeleton"
          aria-label="正在加载历史"
        >
          <li v-for="n in 5" :key="n" class="event"><span class="sk sk-summary" /></li>
        </ul>
        <p v-if="!store.loadingEvents && !store.events.length" class="nav-empty">此会话暂无事件。</p>
        <ol class="events event-timeline" data-events>
          <li v-for="f in store.events" :key="f.id" class="event">
            <div class="event-icon"><UiIcon :name="f.kind === 'tool' ? 'tool' : 'chat'" /></div>
            <div class="event-body">
              <div class="event-meta">
                <span class="kind">{{ eventLabel(f.kind) }}</span
                ><time class="at" :datetime="f.at">{{ formatTime(f.at) }}</time>
              </div>
              <p class="summary">{{ f.summary }}</p>
            </div>
          </li>
        </ol>
        <button
          v-if="store.cursor"
          type="button"
          class="btn load-more"
          data-load-more
          :disabled="store.loadingMore || !store.hasMore"
          @click="store.loadMoreEvents()"
        >
          {{ store.loadingMore ? '加载中…' : store.hasMore ? '加载更多历史' : '已显示全部历史' }}
        </button>
        <div class="history-readonly">
          <UiIcon name="shield" /><span>当前为只读会话，无法发送消息或执行操作。</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useSessionsStore } from '../stores/sessions';
import UiIcon from '../components/UiIcon.vue';

const store = useSessionsStore();
const query = ref('');
const sidebarOpen = ref(true);
const loadingTargets = ref(true);
const loadingSessions = ref(false);
const selectedTarget = computed(() => store.targets.find((t) => t.id === store.selectedTargetId));
const filteredSessions = computed(() =>
  store.sessions.filter((s) => s.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())),
);
const recentSessions = computed(() =>
  [...store.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
);
function statusLabel(status: string): string {
  return ({ active: '活跃', idle: '空闲' } as Record<string, string>)[status] || status;
}
function eventLabel(kind: string): string {
  return ({ message: '消息', tool: '工具事件' } as Record<string, string>)[kind] || kind;
}
function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString('zh-CN', { hour12: false });
}
function goHome(): void {
  store.returnHome();
}
async function pickTarget(id: string): Promise<void> {
  loadingSessions.value = true;
  try {
    await store.selectTarget(id);
  } finally {
    loadingSessions.value = false;
  }
}
async function pickSession(id: string): Promise<void> {
  await store.selectSession(id);
}
onMounted(async () => {
  try {
    await store.loadTargets();
    if (store.targets[0]) await pickTarget(store.targets[0].id);
  } finally {
    loadingTargets.value = false;
  }
});
onUnmounted(() => store.disconnectStream());
</script>
