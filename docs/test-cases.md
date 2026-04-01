# Test Cases

> Test case documentation for SaClaw

---

## Test Overview

| Category | Tests | Coverage |
|----------|-------|----------|
| Unit Tests | 151 | Core functionality |
| Integration Tests | 14 | End-to-end flows |
| E2E Tests | 8 | Full system |

---

## 1. Provider Tests

### 1.1 Provider Factory

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| PF-001 | Create OpenAI provider | Returns OpenAIProvider instance |
| PF-002 | Create Anthropic provider | Returns AnthropicProvider instance |
| PF-003 | Create DeepSeek provider | Returns DeepSeekProvider instance |
| PF-004 | Create unknown provider | Throws ProviderError |
| PF-005 | Create from environment | Uses env config correctly |
| PF-006 | Edge Runtime without env | Throws ENV_NOT_AVAILABLE error |

### 1.2 OpenAI Provider

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| OAI-001 | Stream text response | Yields text chunks |
| OAI-002 | Handle tool calls | Yields tool_call events |
| OAI-003 | Retry on rate limit | Retries with backoff |
| OAI-004 | Handle network error | Retries network errors |
| OAI-005 | Stream error recovery | Recovers from mid-stream errors |
| OAI-006 | Report token usage | Yields usage event |

### 1.3 Anthropic Provider

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| ANT-001 | Stream text response | Yields text chunks |
| ANT-002 | Accumulate tool_use params | Yields complete tool_call at content_block_stop |
| ANT-003 | Handle system message | Passes system prompt correctly |
| ANT-004 | Retry on overload | Retries with backoff |
| ANT-005 | Stream error recovery | Recovers from mid-stream errors |

### 1.4 Base Provider

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| BP-001 | Detect retryable errors | Returns true for network errors |
| BP-002 | Detect non-retryable errors | Returns false for auth errors |
| BP-003 | Exponential backoff | Delay doubles each retry |
| BP-004 | Max retries limit | Stops after max attempts |

---

## 2. Session Tests

### 2.1 Session Manager

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| SM-001 | Create session | Returns new session with unique ID |
| SM-002 | Get existing session | Returns session data |
| SM-003 | Get non-existent session | Returns null |
| SM-004 | Add message to session | Message appended to history |
| SM-005 | Delete session | Session removed from memory |
| SM-006 | Session TTL cleanup | Expired sessions removed |

### 2.2 Session Mapper

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| SMP-001 | Create mapping | Returns unique sessionId |
| SMP-002 | Get mapping by platform | Returns correct sessionId |
| SMP-003 | Cross-platform mapping | Same sessionId for different platforms |
| SMP-004 | Remove mapping | Mapping deleted |
| SMP-005 | Persist mapping | Mapping survives restart |

---

## 3. Router Tests

### 3.1 Smart Router

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| SR-001 | Add routing rule | Rule added to list |
| SR-002 | Remove routing rule | Rule removed from list |
| SR-003 | Evaluate conditions | Returns matching rules |
| SR-004 | Priority ordering | High priority rules evaluated first |
| SR-005 | Complex conditions | Multiple conditions evaluated correctly |
| SR-006 | Default route | Falls back to default when no match |

---

## 4. Task Tests

### 4.1 Long Task Manager

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| LT-001 | Register task type | Type available for use |
| LT-002 | Start task | Task moves to running state |
| LT-003 | Report progress | Progress events emitted |
| LT-004 | Complete task | Task moves to completed state |
| LT-005 | Pause task | Task moves to paused state |
| LT-006 | Resume task | Task continues from pause point |
| LT-007 | Cancel task | Task moves to cancelled state |
| LT-008 | Task failure | Error recorded, task failed |

---

## 5. Scheduler Tests

### 4.1 Task Scheduler

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| TS-001 | Add interval task | Task runs at interval |
| TS-002 | Add once task | Task runs once at scheduled time |
| TS-003 | Add cron task | Task runs on cron schedule |
| TS-004 | Remove task | Task no longer runs |
| TS-005 | Update task | Task schedule updated |
| TS-006 | Task recovery | Tasks restored after restart |

---

## 6. MCP Tests

### 6.1 MCP Server

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| MCP-001 | Register tool | Tool available for execution |
| MCP-002 | Execute tool | Returns correct result |
| MCP-003 | Tool error handling | Returns error response |
| MCP-004 | List tools | Returns all registered tools |
| MCP-005 | Resource access | Returns resource content |

### 6.2 MCP Client

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| MCC-001 | Connect to server | Connection established |
| MCC-002 | List remote tools | Returns server tools |
| MCC-003 | Call remote tool | Returns tool result |
| MCC-004 | Handle disconnect | Reconnection attempted |

---

## 7. Auth Tests

### 7.1 Local Auth

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| LA-001 | Register user | User created in database |
| LA-002 | Login success | Returns JWT token |
| LA-003 | Login wrong password | Returns error |
| LA-004 | Token verification | Returns user payload |
| LA-005 | Expired token | Returns null |
| LA-006 | Password hash | bcrypt hash generated |
| LA-007 | Password verify | Correct comparison |

### 7.2 OAuth

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| OA-001 | GitHub OAuth URL | Returns correct authorization URL |
| OA-002 | GitHub callback | Exchanges code for token |
| OA-003 | User creation | Creates user from OAuth profile |
| OA-004 | Existing user | Finds existing user by OAuth ID |

---

## 8. Adapter Tests

### 8.1 Adapter Factory

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| AF-001 | Create Telegram adapter | Returns TelegramAdapter |
| AF-002 | Create Discord adapter | Returns DiscordAdapter |
| AF-003 | Create unknown adapter | Throws error |

### 8.2 Telegram Adapter

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| TA-001 | Connect to Telegram | Status: connected |
| TA-002 | Receive message | Normalized message emitted |
| TA-003 | Send message | Message ID returned |
| TA-004 | Get channels | Returns chat list |
| TA-005 | Disconnect | Status: disconnected |

### 8.3 DingTalk Adapter

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| DT-001 | Connect to DingTalk | Status: connected |
| DT-002 | AI Card streaming | Content updated progressively |
| DT-003 | Get departments | Returns department list |
| DT-004 | Token refresh | Access token refreshed |

---

## 9. Cache Tests

### 9.1 Cache Manager

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| CM-001 | Set cache value | Value stored |
| CM-002 | Get cache value | Value retrieved |
| CM-003 | Cache miss | Returns null |
| CM-004 | TTL expiration | Value removed after TTL |
| CM-005 | LRU eviction | Oldest entries removed when full |
| CM-006 | getOrSet | Fetches and caches on miss |

---

## 10. API Tests

### 10.1 Auth Endpoints

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| API-001 | POST /auth/register | 201 Created |
| API-002 | POST /auth/login | 200 OK with token |
| API-003 | GET /auth/me | 200 OK with user |
| API-004 | POST /auth/logout | 200 OK |
| API-005 | Protected route without token | 401 Unauthorized |

### 10.2 Chat Endpoints

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| API-006 | POST /chat | Streaming response |
| API-007 | GET /chat/sessions | 200 OK with list |
| API-008 | POST /chat/sessions | 201 Created |
| API-009 | DELETE /chat/sessions/:id | 204 No Content |

### 10.3 IM Endpoints

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| API-010 | GET /im | 200 OK with connections |
| API-011 | POST /im/:platform/connect | 200 OK |
| API-012 | POST /im/:platform/send | 200 OK |

---

## Test Commands

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm vitest run packages/core/src/__tests__/provider.test.ts

# Run E2E tests
pnpm test:e2e
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
