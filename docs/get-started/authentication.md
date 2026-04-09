# Authentication

Setup authentication for SaCode CLI and Web UI.

## Overview

SaCode supports a hybrid authentication system:

- **Local authentication** — Username/password with bcrypt hashing and JWT tokens
- **OAuth 2.0** — Third-party login via GitHub, Google, 微信, QQ, 企业微信

## Local authentication

Local authentication is enabled by default. No additional configuration is required.

### Configuration

Ensure these environment variables are set in your `.env` file:

Terminal window

```env
# Enable local authentication
AUTH_LOCAL_ENABLED=true

# JWT secret (use a strong random string)
JWT_SECRET=your-jwt-secret-change-this

# Session secret
SESSION_SECRET=your-session-secret-change-this
```

### Usage

Register a new user via the Web UI at `http://localhost:5173/login`, or use the API:

Terminal window

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "email": "admin@example.com", "password": "secure-password"}'
```

Login to receive a JWT token:

Terminal window

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secure-password"}'
```

### Security

- Passwords are hashed with **bcrypt** (cost factor 10)
- JWT tokens use **HS256** algorithm
- Default token expiration: **7 days** (configurable)
- OAuth state includes **CSRF protection**

## OAuth 2.0 providers

### GitHub OAuth

Terminal window

```env
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set **Authorization callback URL** to `http://localhost:3000/api/auth/oauth/github/callback`
4. Copy Client ID and Client Secret to your `.env`

### Google OAuth

Terminal window

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 credentials
3. Set **Authorized redirect URI** to `http://localhost:3000/api/auth/oauth/google/callback`
4. Copy Client ID and Client Secret to your `.env`

### 微信 OAuth

Terminal window

```env
WECHAT_APP_ID=your-wechat-app-id
WECHAT_APP_SECRET=your-wechat-app-secret
```

Requires a 微信开放平台 account with verified developer status.

### QQ OAuth

Terminal window

```env
QQ_APP_ID=your-qq-app-id
QQ_APP_KEY=your-qq-app-key
```

Requires a QQ互联 developer account.

### 企业微信 OAuth

Terminal window

```env
WEWORK_CORP_ID=your-wework-corp-id
WEWORK_AGENT_ID=your-wework-agent-id
WEWORK_SECRET=your-wework-secret
```

Requires an 企业微信 admin account.

## OAuth flow

```
User → Login.vue → OAuth button → /api/auth/oauth/:provider
                                                    ↓
                                           Redirect to provider
                                                    ↓
                                           User authorizes
                                                    ↓
                                    /api/auth/oauth/:provider/callback
                                                    ↓
                                    Create/find user → Generate JWT
                                                    ↓
                                    Redirect to /auth/callback?token=xxx
```

## Session management

### Token verification

All API routes (except `/api/auth/*`) require a valid JWT token:

Terminal window

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer your-jwt-token"
```

### Logout

Terminal window

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer your-jwt-token"
```

### Password management

Users can change their password via the API:

Terminal window

```bash
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{"oldPassword": "old-pass", "newPassword": "new-pass"}'
```

## Environment variable validation

In production mode, SaCode validates required secrets on startup:

- `JWT_SECRET` — Required
- `SESSION_SECRET` — Required
- `ENCRYPTION_KEY` — Required (for sensitive data encryption)

Development mode shows warnings for missing secrets but continues running.

## Encryption

Sensitive data (OAuth secrets, IM tokens) is encrypted with **AES-256-GCM**:

- Uses **scrypt** for key derivation
- Random **IV** per encryption operation
- Backward compatible with legacy Base64 format (auto-migration)

Terminal window

```env
# Required in production
ENCRYPTION_KEY=your-32-byte-encryption-key-here
```

## Next steps

- **[Quickstart](/docs/get-started/)** — Your first session with SaCode CLI
- **[CLI cheatsheet](/docs/cli/cli-reference/)** — Quick reference for all commands
- **[Security architecture](/docs/architecture/security.md)** — Detailed security design
