# Page Design - Login

> Login page design specification

---

## 1. Page Overview

| Attribute | Value |
|-----------|-------|
| Route | `/login` |
| Layout | Centered card |
| Auth Required | No |
| Mobile Responsive | Yes |

---

## 2. Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                     ┌─────────────────────┐                      │
│                     │       SaClaw        │                      │
│                     │      Logo + Title   │                      │
│                     └─────────────────────┘                      │
│                                                                  │
│                     ┌─────────────────────┐                      │
│                     │                     │                      │
│                     │   Username/Email    │                      │
│                     │   [_____________]   │                      │
│                     │                     │                      │
│                     │   Password          │                      │
│                     │   [_____________]   │                      │
│                     │                     │                      │
│                     │   [  Login Button ] │                      │
│                     │                     │                      │
│                     │   ───── or ─────    │                      │
│                     │                     │                      │
│                     │  [GitHub] [Google]  │                      │
│                     │  [WeChat]   [QQ]    │                      │
│                     │                     │                      │
│                     │   No account?       │                      │
│                     │   Register here     │                      │
│                     └─────────────────────┘                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Login Form

```vue
<template>
  <div class="login-container">
    <div class="login-card">
      <!-- Logo Section -->
      <div class="logo-section">
        <img src="@/assets/logo.svg" alt="SaClaw" class="logo" />
        <h1>SaClaw</h1>
        <p class="subtitle">Multi-platform AI Assistant</p>
      </div>

      <!-- Login Form -->
      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="username">Username or Email</label>
          <input
            id="username"
            v-model="form.username"
            type="text"
            placeholder="Enter username or email"
            required
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            placeholder="Enter password"
            required
          />
        </div>

        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? 'Logging in...' : 'Login' }}
        </button>
      </form>

      <!-- OAuth Section -->
      <div class="oauth-section">
        <div class="divider">
          <span>or continue with</span>
        </div>
        <div class="oauth-buttons">
          <button @click="oauthLogin('github')" class="oauth-btn github">
            <GitHubIcon /> GitHub
          </button>
          <button @click="oauthLogin('google')" class="oauth-btn google">
            <GoogleIcon /> Google
          </button>
          <button @click="oauthLogin('wechat')" class="oauth-btn wechat">
            <WeChatIcon /> WeChat
          </button>
          <button @click="oauthLogin('qq')" class="oauth-btn qq">
            <QQIcon /> QQ
          </button>
        </div>
      </div>

      <!-- Register Link -->
      <div class="register-link">
        Don't have an account? <router-link to="/register">Register</router-link>
      </div>
    </div>
  </div>
</template>
```

---

## 4. Styling

### 4.1 CSS Variables

```css
:root {
  --login-bg: #f5f7fa;
  --card-bg: #ffffff;
  --primary-color: #3b82f6;
  --primary-hover: #2563eb;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --border-color: #e5e7eb;
  --error-color: #ef4444;
  --oauth-github: #24292e;
  --oauth-google: #4285f4;
  --oauth-wechat: #07c160;
  --oauth-qq: #12b7f5;
}
```

### 4.2 Component Styles

```css
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: var(--login-bg);
  padding: 1rem;
}

.login-card {
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
  padding: 2rem;
  width: 100%;
  max-width: 400px;
}

.logo-section {
  text-align: center;
  margin-bottom: 2rem;
}

.logo {
  width: 64px;
  height: 64px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.form-group input {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.btn-primary {
  background: var(--primary-color);
  color: white;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.oauth-section {
  margin-top: 1.5rem;
}

.divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-color);
}

.divider span {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.oauth-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

.oauth-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: white;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.oauth-btn:hover {
  background: #f9fafb;
}

.oauth-btn.github:hover { border-color: var(--oauth-github); }
.oauth-btn.google:hover { border-color: var(--oauth-google); }
.oauth-btn.wechat:hover { border-color: var(--oauth-wechat); }
.oauth-btn.qq:hover { border-color: var(--oauth-qq); }
```

---

## 5. Behavior

### 5.1 Form Validation

| Field | Validation |
|-------|------------|
| Username | Required, min 3 characters |
| Password | Required, min 6 characters |

### 5.2 Error Handling

| Error | Message |
|-------|---------|
| Invalid credentials | "Invalid username or password" |
| Network error | "Network error. Please try again." |
| Rate limited | "Too many attempts. Please wait." |

### 5.3 OAuth Flow

```
User clicks OAuth button
        ↓
Redirect to /api/auth/oauth/:provider
        ↓
OAuth provider login page
        ↓
User authorizes
        ↓
Redirect to /api/auth/oauth/:provider/callback
        ↓
Create/update user in database
        ↓
Generate JWT token
        ↓
Redirect to /auth/callback?token=xxx
        ↓
Store token in localStorage
        ↓
Redirect to /dashboard
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
