# Page Design - Dashboard

> Dashboard page design specification

---

## 1. Page Overview

| Attribute | Value |
|-----------|-------|
| Route | `/dashboard` |
| Layout | Sidebar + Content |
| Auth Required | Yes |
| Mobile Responsive | Yes |

---

## 2. Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        Top Navigation                            │
│  [Logo]  SaClaw              [Search...]      [User Avatar ▼]   │
├────────────────┬────────────────────────────────────────────────┤
│                │                                                │
│   Navigation   │                  Content Area                  │
│   ──────────   │                                                │
│   ┌─────────┐  │   ┌─────────────────────────────────────────┐ │
│   │Overview │  │   │              Welcome Card                │ │
│   ├─────────┤  │   │  Hello, User! Your AI assistant is ready.│ │
│   │  Chat   │  │   └─────────────────────────────────────────┘ │
│   ├─────────┤  │                                                │
│   │   IM    │  │   ┌───────────┐ ┌───────────┐ ┌───────────┐  │
│   ├─────────┤  │   │   Stats   │ │   Stats   │ │   Stats   │  │
│   │Settings │  │   │   Card    │ │   Card    │ │   Card    │  │
│   └─────────┘  │   └───────────┘ └───────────┘ └───────────┘  │
│                │                                                │
│                │   ┌─────────────────────────────────────────┐ │
│                │   │           Recent Activity               │ │
│                │   │  • Chat session started 2h ago          │ │
│                │   │  • New IM connection: Telegram          │ │
│                │   │  • Task completed: Data analysis        │ │
│                │   └─────────────────────────────────────────┘ │
│                │                                                │
└────────────────┴────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Dashboard Layout

```vue
<template>
  <div class="dashboard-layout">
    <!-- Top Navigation -->
    <header class="top-nav">
      <div class="nav-left">
        <img src="@/assets/logo.svg" alt="SaClaw" class="logo" />
        <span class="brand-name">SaClaw</span>
      </div>
      <div class="nav-center">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search..."
          class="search-input"
        />
      </div>
      <div class="nav-right">
        <button class="notification-btn">
          <BellIcon />
          <span v-if="notifications > 0" class="badge">{{ notifications }}</span>
        </button>
        <DropdownMenu>
          <template #trigger>
            <img :src="userAvatar" alt="User" class="avatar" />
          </template>
          <template #content>
            <DropdownItem @click="goToSettings">Settings</DropdownItem>
            <DropdownItem @click="logout">Logout</DropdownItem>
          </template>
        </DropdownMenu>
      </div>
    </header>

    <!-- Sidebar -->
    <aside class="sidebar">
      <nav class="nav-menu">
        <NavItem
          v-for="item in menuItems"
          :key="item.path"
          :item="item"
          :active="isActive(item.path)"
          @click="navigate(item.path)"
        />
      </nav>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>
```

### 3.2 Stats Card

```vue
<template>
  <div class="stats-card">
    <div class="stats-icon" :style="{ background: iconBg }">
      <component :is="icon" />
    </div>
    <div class="stats-content">
      <span class="stats-label">{{ label }}</span>
      <span class="stats-value">{{ formattedValue }}</span>
      <span v-if="trend" :class="['stats-trend', trendDirection]">
        {{ trend > 0 ? '↑' : '↓' }} {{ Math.abs(trend) }}%
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon: Component;
  iconBg: string;
  label: string;
  value: number;
  trend?: number;
}>();

const formattedValue = computed(() => {
  if (props.value >= 1000000) {
    return (props.value / 1000000).toFixed(1) + 'M';
  }
  if (props.value >= 1000) {
    return (props.value / 1000).toFixed(1) + 'K';
  }
  return props.value.toString();
});

const trendDirection = computed(() => {
  return props.trend && props.trend > 0 ? 'up' : 'down';
});
</script>
```

### 3.3 Activity List

```vue
<template>
  <div class="activity-list">
    <div class="activity-header">
      <h3>Recent Activity</h3>
      <button class="btn-link">View All</button>
    </div>
    <ul class="activity-items">
      <li
        v-for="activity in activities"
        :key="activity.id"
        class="activity-item"
      >
        <div class="activity-icon" :style="{ background: activity.color }">
          <component :is="activity.icon" />
        </div>
        <div class="activity-content">
          <p class="activity-text">{{ activity.text }}</p>
          <span class="activity-time">{{ formatTimeAgo(activity.timestamp) }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>
```

---

## 4. Styling

```css
/* Dashboard Layout */
.dashboard-layout {
  display: grid;
  grid-template-rows: 60px 1fr;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}

/* Top Navigation */
.top-nav {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo {
  width: 32px;
  height: 32px;
}

.brand-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.search-input {
  width: 300px;
  padding: 0.5rem 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.search-input:focus {
  outline: none;
  border-color: #3b82f6;
  background: white;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.notification-btn {
  position: relative;
  padding: 0.5rem;
  border: none;
  background: none;
  cursor: pointer;
}

.badge {
  position: absolute;
  top: 0;
  right: 0;
  background: #ef4444;
  color: white;
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
  border-radius: 999px;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
}

/* Sidebar */
.sidebar {
  background: white;
  border-right: 1px solid #e5e7eb;
  padding: 1rem;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-item:hover {
  background: #f3f4f6;
  color: #1f2937;
}

.nav-item.active {
  background: #eff6ff;
  color: #3b82f6;
}

/* Main Content */
.main-content {
  padding: 1.5rem;
  background: #f9fafb;
  overflow-y: auto;
}

/* Stats Card */
.stats-card {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.stats-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.stats-content {
  display: flex;
  flex-direction: column;
}

.stats-label {
  font-size: 0.875rem;
  color: #6b7280;
}

.stats-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: #1f2937;
}

.stats-trend {
  font-size: 0.75rem;
}

.stats-trend.up {
  color: #10b981;
}

.stats-trend.down {
  color: #ef4444;
}

/* Activity List */
.activity-list {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.activity-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.activity-items {
  list-style: none;
  padding: 0;
  margin: 0;
}

.activity-item {
  display: flex;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f3f4f6;
}

.activity-item:last-child {
  border-bottom: none;
}

.activity-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.activity-text {
  font-size: 0.875rem;
  color: #1f2937;
  margin: 0;
}

.activity-time {
  font-size: 0.75rem;
  color: #9ca3af;
}
```

---

## 5. Menu Items

```typescript
const menuItems = [
  {
    path: '/dashboard',
    label: 'Overview',
    icon: HomeIcon,
  },
  {
    path: '/dashboard/chat',
    label: 'Chat',
    icon: ChatIcon,
  },
  {
    path: '/dashboard/im',
    label: 'IM Platforms',
    icon: MessageIcon,
  },
  {
    path: '/dashboard/tasks',
    label: 'Tasks',
    icon: TaskIcon,
  },
  {
    path: '/dashboard/plugins',
    label: 'Plugins',
    icon: PluginIcon,
  },
  {
    path: '/dashboard/settings',
    label: 'Settings',
    icon: SettingsIcon,
  },
];
```

---

## 6. Stats Overview

| Stat | Description | Icon Color |
|------|-------------|------------|
| Total Messages | Total chat messages sent | Blue (#3b82f6) |
| Active Sessions | Current active chat sessions | Green (#10b981) |
| IM Connections | Connected IM platforms | Purple (#8b5cf6) |
| Tasks Completed | Completed long-running tasks | Orange (#f59e0b) |

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
