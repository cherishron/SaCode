# Authentication Module - Detail Design

> Detailed design for authentication system

---

## 1. Authentication Architecture

### 1.1 Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication Flow                           │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │   Client    │───▶│  API Route  │───▶│ Auth Service│          │
│  └─────────────┘    └─────────────┘    └──────┬──────┘          │
│                                               │                  │
│                     ┌─────────────────────────┼──────────────┐  │
│                     │                         │              │  │
│                     ▼                         ▼              ▼  │
│              ┌─────────────┐          ┌─────────────┐  ┌──────┐ │
│              │ Local Auth  │          │ OAuth Flow  │  │ JWT  │ │
│              │ (bcrypt)    │          │ (Passport)  │  │ Token│ │
│              └─────────────┘          └─────────────┘  └──────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Local Authentication

### 2.1 Service Interface

```typescript
interface LocalAuthConfig {
  jwt: {
    secret: string;
    expiresIn: string;
  };
  password: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumber: boolean;
    requireSpecialChar: boolean;
  };
}

interface LoginInput {
  usernameOrEmail: string;
  password: string;
}

interface LoginResult {
  success: boolean;
  user?: Omit<User, "password">;
  token?: string;
  error?: string;
}

interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

class LocalAuthService {
  constructor(
    private config: LocalAuthConfig,
    private userRepo: UserRepository
  ) {}

  async login(input: LoginInput): Promise<LoginResult>;
  async register(input: RegisterInput): Promise<LoginResult>;
  async verifyToken(token: string): Promise<UserPayload | null>;
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean>;
}
```

### 2.2 Password Handling

```typescript
import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function validatePassword(password: string, rules: PasswordRules): ValidationResult {
  const errors: string[] = [];

  if (password.length < rules.minLength) {
    errors.push(`Password must be at least ${rules.minLength} characters`);
  }
  if (rules.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain uppercase letter");
  }
  if (rules.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain lowercase letter");
  }
  if (rules.requireNumber && !/[0-9]/.test(password)) {
    errors.push("Password must contain number");
  }
  if (rules.requireSpecialChar && !/[!@#$%^&*]/.test(password)) {
    errors.push("Password must contain special character");
  }

  return { valid: errors.length === 0, errors };
}
```

### 2.3 JWT Token

```typescript
import jwt from "jsonwebtoken";

interface UserPayload {
  userId: string;
  username: string;
  email: string;
  iat: number;
  exp: number;
}

function generateToken(user: User, secret: string, expiresIn: string): string {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
    },
    secret,
    { expiresIn }
  );
}

function verifyToken(token: string, secret: string): UserPayload | null {
  try {
    return jwt.verify(token, secret) as UserPayload;
  } catch {
    return null;
  }
}
```

---

## 3. OAuth 2.0 Authentication

### 3.1 OAuth Service Interface

```typescript
interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string[];
}

interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

interface OAuthService {
  getAuthorizationUrl(state: string): string;
  exchangeCodeForToken(code: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
}

abstract class BaseOAuthService implements OAuthService {
  constructor(protected config: OAuthConfig) {}

  abstract getAuthorizationUrl(state: string): string;
  abstract exchangeCodeForToken(code: string): Promise<string>;
  abstract fetchProfile(accessToken: string): Promise<OAuthProfile>;
}
```

### 3.2 GitHub OAuth

```typescript
class GitHubOAuthService extends BaseOAuthService {
  private readonly authorizeUrl = "https://github.com/login/oauth/authorize";
  private readonly tokenUrl = "https://github.com/login/oauth/access_token";
  private readonly apiBaseUrl = "https://api.github.com";

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope.join(" "),
      state,
    });
    return `${this.authorizeUrl}?${params}`;
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });

    const data = await response.json();
    return data.access_token;
  }

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(`${this.apiBaseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const user = await response.json();
    return {
      id: user.id.toString(),
      email: user.email,
      name: user.name ?? user.login,
      avatar: user.avatar_url,
    };
  }
}
```

### 3.3 WeChat OAuth

```typescript
class WeChatOAuthService extends BaseOAuthService {
  private readonly authorizeUrl = "https://open.weixin.qq.com/connect/qrconnect";
  private readonly tokenUrl = "https://api.weixin.qq.com/sns/oauth2/access_token";
  private readonly profileUrl = "https://api.weixin.qq.com/sns/userinfo";

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      appid: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.config.scope.join(","),
      state,
    });
    return `${this.authorizeUrl}?${params}#wechat_redirect`;
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const params = new URLSearchParams({
      appid: this.config.clientId,
      secret: this.config.clientSecret,
      code,
      grant_type: "authorization_code",
    });

    const response = await fetch(`${this.tokenUrl}?${params}`);
    const data = await response.json();
    return data.access_token;
  }

  async fetchProfile(accessToken: string, openid: string): Promise<OAuthProfile> {
    const params = new URLSearchParams({
      access_token: accessToken,
      openid,
    });

    const response = await fetch(`${this.profileUrl}?${params}`);
    const user = await response.json();

    return {
      id: user.openid,
      email: user.email ?? "",
      name: user.nickname,
      avatar: user.headimgurl,
    };
  }
}
```

---

## 4. Authentication Middleware

### 4.1 Middleware Implementation

```typescript
interface AuthMiddlewareConfig {
  getTokenFromHeader: (req: Request) => string | undefined;
  verifyToken: (token: string) => Promise<UserPayload | null>;
  getUserById: (id: string) => Promise<User | null>;
}

interface AuthenticatedRequest extends Request {
  user?: UserPayload;
}

function createAuthMiddleware(config: AuthMiddlewareConfig) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = config.getTokenFromHeader(req);

    if (!token) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const payload = await config.verifyToken(token);

    if (!payload) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    req.user = payload;
    next();
  };
}
```

### 4.2 Usage

```typescript
import { createAuthMiddleware, LocalAuthService } from "@saclaw/auth";

const authService = new LocalAuthService(config, userRepo);

const authMiddleware = createAuthMiddleware({
  getTokenFromHeader: (req) => req.headers.authorization?.replace("Bearer ", ""),
  verifyToken: (token) => authService.verifyToken(token),
  getUserById: (id) => userRepo.findById(id),
});

// Apply to routes
app.use("/api/protected/*", authMiddleware);
```

---

## 5. Database Schema

### 5.1 User Model

```prisma
model User {
  id            String    @id @default(cuid())
  username      String    @unique
  email         String    @unique
  password      String?   // null for OAuth-only users
  oauthProvider String?   // github, google, wechat, qq, wework
  oauthId       String?   // OAuth provider user ID
  avatar        String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  chatSessions  ChatSession[]

  @@index([oauthProvider, oauthId])
}
```

### 5.2 Session Model

```prisma
model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([token])
}
```

---

## 6. API Endpoints

### 6.1 Authentication Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | Local login |
| `/api/auth/logout` | POST | Logout (invalidate session) |
| `/api/auth/me` | GET | Get current user |
| `/api/auth/password` | PUT | Change password |
| `/api/auth/oauth/:provider` | GET | OAuth redirect |
| `/api/auth/oauth/:provider/callback` | GET | OAuth callback |

### 6.2 Request/Response Examples

**POST /api/auth/register**

```json
// Request
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecureP@ss123"
}

// Response (201)
{
  "success": true,
  "user": {
    "id": "clh123...",
    "username": "john_doe",
    "email": "john@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**POST /api/auth/login**

```json
// Request
{
  "usernameOrEmail": "john_doe",
  "password": "SecureP@ss123"
}

// Response (200)
{
  "success": true,
  "user": {
    "id": "clh123...",
    "username": "john_doe",
    "email": "john@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**GET /api/auth/oauth/github**

```
// Response (302)
Location: https://github.com/login/oauth/authorize?client_id=...&redirect_uri=...&scope=user:email&state=...
```

**GET /api/auth/oauth/github/callback**

```
// Response (302)
Location: /auth/callback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
