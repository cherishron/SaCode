# Database Schema

> Database design documentation

---

## Database Type

SaClaw supports multiple database backends:
- **SQLite** (default, development)
- **MySQL** (production)
- **PostgreSQL** (production)

---

## Schema Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     User     │────<│   Session    │     │ ChatSession  │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id           │     │ id           │     │ id           │
│ username     │     │ userId       │     │ userId       │────┐
│ email        │     │ token        │     │ title        │    │
│ password     │     │ expiresAt    │     │ createdAt    │    │
│ oauthProvider│     │ createdAt    │     │ updatedAt    │    │
│ oauthId      │     └──────────────┘     └──────────────┘    │
│ avatar       │                                │             │
│ createdAt    │                                │             │
│ updatedAt    │                                │             │
└──────────────┘                                │             │
       │                                        │             │
       │         ┌──────────────┐               │             │
       │         │ ChatMessage  │               │             │
       │         ├──────────────┤               │             │
       └────────>│ id           │<──────────────┘             │
                 │ sessionId   │                             │
                 │ role        │                             │
                 │ content     │                             │
                 │ timestamp   │                             │
                 └──────────────┘                             │
                                                              │
┌──────────────┐     ┌──────────────┐                        │
│ IMConnection │     │SessionMapping│                        │
├──────────────┤     ├──────────────┤                        │
│ id           │     │ id           │                        │
│ userId       │<────┤ sessionId    │<───────────────────────┘
│ platform     │     │ platform     │
│ config       │     │ chatId       │
│ status       │     │ createdAt    │
│ createdAt    │     └──────────────┘
└──────────────┘
```

---

## Tables

### User

User accounts (local + OAuth).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | String | PRIMARY KEY | Unique identifier (cuid) |
| username | String | UNIQUE, NOT NULL | Username |
| email | String | UNIQUE, NOT NULL | Email address |
| password | String | NULLABLE | Hashed password (bcrypt) |
| oauthProvider | String | NULLABLE | OAuth provider name |
| oauthId | String | NULLABLE | OAuth provider user ID |
| avatar | String | NULLABLE | Avatar URL |
| createdAt | DateTime | DEFAULT now() | Creation timestamp |
| updatedAt | DateTime | AUTO UPDATE | Last update timestamp |

**Indexes:**
- `username` (unique)
- `email` (unique)
- `[oauthProvider, oauthId]` (composite)

```prisma
model User {
  id            String    @id @default(cuid())
  username      String    @unique
  email         String    @unique
  password      String?
  oauthProvider String?
  oauthId       String?
  avatar        String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions      Session[]
  chatSessions  ChatSession[]
  imConnections IMConnection[]

  @@index([oauthProvider, oauthId])
}
```

---

### Session

User login sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | String | PRIMARY KEY | Unique identifier |
| userId | String | FOREIGN KEY | User reference |
| token | String | UNIQUE, NOT NULL | JWT token |
| expiresAt | DateTime | NOT NULL | Expiration timestamp |
| createdAt | DateTime | DEFAULT now() | Creation timestamp |

**Indexes:**
- `userId`
- `token` (unique)

```prisma
model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([token])
}
```

---

### ChatSession

Chat conversation sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | String | PRIMARY KEY | Unique identifier |
| userId | String | FOREIGN KEY | User reference |
| title | String | NULLABLE | Session title |
| createdAt | DateTime | DEFAULT now() | Creation timestamp |
| updatedAt | DateTime | AUTO UPDATE | Last update timestamp |

```prisma
model ChatSession {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages  ChatMessage[]
  mappings  SessionMapping[]

  @@index([userId])
}
```

---

### ChatMessage

Individual chat messages.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | String | PRIMARY KEY | Unique identifier |
| sessionId | String | FOREIGN KEY | Session reference |
| role | Enum | NOT NULL | user, assistant, system |
| content | Text | NOT NULL | Message content |
| timestamp | DateTime | DEFAULT now() | Message timestamp |

```prisma
model ChatMessage {
  id        String      @id @default(cuid())
  sessionId String
  session   ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role      MessageRole
  content   String      @db.Text
  timestamp DateTime    @default(now())

  @@index([sessionId])
  @@index([timestamp])
}

enum MessageRole {
  user
  assistant
  system
}
```

---

### IMConnection

IM platform connection configurations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | String | PRIMARY KEY | Unique identifier |
| userId | String | FOREIGN KEY | User reference |
| platform | String | NOT NULL | Platform name |
| config | JSON | NOT NULL | Platform-specific config |
| status | Enum | DEFAULT disconnected | Connection status |
| createdAt | DateTime | DEFAULT now() | Creation timestamp |

```prisma
model IMConnection {
  id        String         @id @default(cuid())
  userId    String
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform  String
  config    Json
  status    ConnectionStatus @default(disconnected)
  createdAt DateTime       @default(now())

  @@unique([userId, platform])
  @@index([userId])
}

enum ConnectionStatus {
  disconnected
  connecting
  connected
  error
}
```

---

### SessionMapping

Cross-channel session mappings.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | String | PRIMARY KEY | Unique identifier |
| sessionId | String | FOREIGN KEY | ChatSession reference |
| platform | String | NOT NULL | IM platform name |
| chatId | String | NOT NULL | Platform chat ID |
| createdAt | DateTime | DEFAULT now() | Creation timestamp |

```prisma
model SessionMapping {
  id        String      @id @default(cuid())
  sessionId String
  session   ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  platform  String
  chatId    String
  createdAt DateTime    @default(now())

  @@unique([platform, chatId])
  @@index([sessionId])
}
```

---

## Relationships

| Relationship | Type | Description |
|--------------|------|-------------|
| User → Session | One-to-Many | User has multiple login sessions |
| User → ChatSession | One-to-Many | User has multiple chat sessions |
| User → IMConnection | One-to-Many | User has multiple IM connections |
| ChatSession → ChatMessage | One-to-Many | Session has multiple messages |
| ChatSession → SessionMapping | One-to-Many | Session has multiple mappings |

---

## Migrations

### Create Initial Schema

```bash
# Generate Prisma client
pnpm -C packages/database prisma generate

# Push schema to database (development)
pnpm -C packages/database prisma db push

# Create migration (production)
pnpm -C packages/database prisma migrate dev --name init
```

### Reset Database

```bash
# Reset and seed
pnpm -C packages/database prisma migrate reset
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
