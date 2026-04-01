# Authentication API

> Authentication endpoints documentation

---

## Base URL

```
http://localhost:3000/api
```

---

## Endpoints Overview

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/auth/register` | POST | Register new user | No |
| `/auth/login` | POST | Login with credentials | No |
| `/auth/logout` | POST | Logout current session | Yes |
| `/auth/me` | GET | Get current user | Yes |
| `/auth/password` | PUT | Change password | Yes |
| `/auth/oauth/:provider` | GET | OAuth redirect | No |
| `/auth/oauth/:provider/callback` | GET | OAuth callback | No |

---

## POST /auth/register

Register a new user account.

### Request

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecureP@ss123"
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| username | string | Yes | Unique username (3-20 chars) |
| email | string | Yes | Valid email address |
| password | string | Yes | Password (min 6 chars) |

### Response

**201 Created**

```json
{
  "success": true,
  "user": {
    "id": "clh1234567890",
    "username": "john_doe",
    "email": "john@example.com",
    "avatar": null,
    "createdAt": "2026-03-19T10:00:00Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**400 Bad Request**

```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Username already exists"
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `USERNAME_EXISTS` | 400 | Username already taken |
| `EMAIL_EXISTS` | 400 | Email already registered |

---

## POST /auth/login

Authenticate user and get access token.

### Request

```http
POST /api/auth/login
Content-Type: application/json

{
  "usernameOrEmail": "john_doe",
  "password": "SecureP@ss123"
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| usernameOrEmail | string | Yes | Username or email |
| password | string | Yes | User password |

### Response

**200 OK**

```json
{
  "success": true,
  "user": {
    "id": "clh1234567890",
    "username": "john_doe",
    "email": "john@example.com",
    "avatar": null
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**401 Unauthorized**

```json
{
  "success": false,
  "error": "INVALID_CREDENTIALS",
  "message": "Invalid username or password"
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_CREDENTIALS` | 401 | Wrong username/password |
| `RATE_LIMITED` | 429 | Too many login attempts |

---

## POST /auth/logout

Invalidate current session.

### Request

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## GET /auth/me

Get current authenticated user.

### Request

```http
GET /api/auth/me
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "id": "clh1234567890",
  "username": "john_doe",
  "email": "john@example.com",
  "avatar": null,
  "oauthProvider": null,
  "createdAt": "2026-03-19T10:00:00Z"
}
```

**401 Unauthorized**

```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or expired token"
}
```

---

## PUT /auth/password

Change user password.

### Request

```http
PUT /api/auth/password
Authorization: Bearer <token>
Content-Type: application/json

{
  "oldPassword": "SecureP@ss123",
  "newPassword": "NewSecureP@ss456"
}
```

### Response

**200 OK**

```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

**400 Bad Request**

```json
{
  "success": false,
  "error": "INVALID_PASSWORD",
  "message": "Current password is incorrect"
}
```

---

## GET /auth/oauth/:provider

Initiate OAuth authentication flow.

### Supported Providers

| Provider | Endpoint |
|----------|----------|
| GitHub | `/auth/oauth/github` |
| Google | `/auth/oauth/google` |
| WeChat | `/auth/oauth/wechat` |
| QQ | `/auth/oauth/qq` |
| WeCom | `/auth/oauth/wework` |

### Request

```http
GET /api/auth/oauth/github
```

### Response

**302 Found**

```
Location: https://github.com/login/oauth/authorize?client_id=...&redirect_uri=...&scope=user:email&state=...
```

---

## GET /auth/oauth/:provider/callback

Handle OAuth provider callback.

### Request

```http
GET /api/auth/oauth/github/callback?code=...&state=...
```

### Response

**302 Found**

```
Location: /auth/callback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Error Response

**302 Found**

```
Location: /auth/callback?error=oauth_failed&message=...
```

---

## Authentication

All protected endpoints require a Bearer token in the Authorization header.

```http
Authorization: Bearer <jwt_token>
```

### Token Format

JWT token with the following payload:

```json
{
  "userId": "clh1234567890",
  "username": "john_doe",
  "email": "john@example.com",
  "iat": 1710849600,
  "exp": 1711454400
}
```

### Token Expiration

- Default: 7 days
- Configurable via `JWT_EXPIRES_IN` environment variable

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/auth/login` | 5 requests | 15 minutes |
| `/auth/register` | 3 requests | 1 hour |

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
