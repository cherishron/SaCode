/**
 * Specialist Agents 类型定义
 *
 * 基于 OMO (Oh My OpenCode) 设计的多 Agent 系统
 * 每个专家 Agent 都有特定的职责、能力和模型偏好
 */

import type { TaskCategory } from "../agent/types";

// ============================================
// Agent 角色定义
// ============================================

/**
 * 专家 Agent 角色
 */
export type SpecialistRole =
  | "sisyphus"       // 主编排器 - 驱动任务完成
  | "hephaestus"     // 深度工作者 - 执行深度代码工作
  | "prometheus"     // 战略规划者 - 访谈式规划
  | "oracle"         // 架构顾问 - 架构/调试建议
  | "scout"          // 侦察兵 - 快速搜索、代码导航、知识检索
  | "tester"         // 测试工程师 - 编写和执行测试
  | "securityauditor"; // 安全审计员 - 代码安全审查

/**
 * Agent 执行模式
 */
export type AgentExecutionMode =
  | "autonomous"    // 自主执行，无需确认
  | "interactive"   // 交互式，需要确认
  | "supervised";   // 监督式，关键步骤确认

/**
 * 专家 Agent 配置
 */
export interface SpecialistAgentConfig {
  /** Agent 唯一标识 */
  id: string;
  /** 角色 */
  role: SpecialistRole;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 系统提示词模板 */
  systemPromptTemplate: string;
  /** 执行模式 */
  executionMode: AgentExecutionMode;
  /** 模型偏好类别 */
  preferredCategory: TaskCategory;
  /** 推荐模型列表 */
  recommendedModels: string[];
  /** 允许的工具 */
  allowedTools: string[];
  /** 禁用的工具 */
  disabledTools?: string[];
  /** 最大迭代次数 */
  maxIterations: number;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 是否支持委派 */
  canDelegate: boolean;
  /** 可委派的目标角色 */
  delegateTargets?: SpecialistRole[];
  /** 标签 */
  tags: string[];
}

/**
 * 专家 Agent 状态
 */
export interface SpecialistAgentState {
  /** 当前状态 */
  status: "idle" | "working" | "waiting" | "completed" | "failed";
  /** 当前任务 */
  currentTask?: string;
  /** 开始时间 */
  startTime?: Date;
  /** 完成时间 */
  endTime?: Date;
  /** 执行结果 */
  result?: string;
  /** 错误信息 */
  error?: string;
  /** 迭代计数 */
  iterationCount: number;
  /** 委派计数 */
  delegationCount: number;
}

/**
 * 专家 Agent 实例
 */
export interface SpecialistAgent {
  /** 配置 */
  config: SpecialistAgentConfig;
  /** 状态 */
  state: SpecialistAgentState;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 委派请求
 */
export interface DelegationRequest {
  /** 请求 ID */
  id: string;
  /** 来源 Agent */
  from: SpecialistRole;
  /** 目标 Agent */
  to: SpecialistRole;
  /** 任务描述 */
  task: string;
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 优先级 */
  priority: "low" | "normal" | "high" | "critical";
  /** 超时时间 */
  timeout?: number;
}

/**
 * 委派响应
 */
export interface DelegationResponse {
  /** 请求 ID */
  requestId: string;
  /** 是否接受 */
  accepted: boolean;
  /** 拒绝原因 */
  rejectionReason?: string;
  /** 执行结果 */
  result?: string;
  /** 执行时间（毫秒） */
  duration?: number;
}

// ============================================
// 预设 Agent 配置
// ============================================

/**
 * 默认专家 Agent 配置
 */
export const DefaultSpecialistConfigs: Record<SpecialistRole, SpecialistAgentConfig> = {
  sisyphus: {
    id: "sisyphus",
    role: "sisyphus",
    name: "Sisyphus",
    description: "主编排器，负责规划、委派和驱动任务完成。不停止直到任务完成。不直接执行具体操作，而是委派给专家 Agent。",
    systemPromptTemplate: `You are Sisyphus, the main orchestrator agent.

## Your Role
You are the central coordinator. You plan, delegate, and monitor — but you do NOT execute tasks yourself.

## Core Responsibilities
1. **Analyze** - Understand the full scope before delegating
2. **Plan** - Break down complex goals into manageable tasks
3. **Delegate** - Assign tasks to the right specialist agents
4. **Monitor** - Track progress and handle blockers
5. **Drive** - Never stop until the task is fully completed

## Agent Capabilities
| Agent | Best For | Tools |
|-------|----------|-------|
| Hephaestus | Implementation, refactoring, file changes | read, write, execute |
| Prometheus | Planning, requirements gathering | read, search |
| Oracle | Architecture review, debugging | read, search |
| Scout | Code search, documentation, navigation | read, search |
| Tester | Test writing, test execution, coverage | read, write, execute |
| SecurityAuditor | Security review, vulnerability detection | read, search |

## Delegation Guidelines
1. **Parallel When Possible** - Independent tasks can run concurrently
2. **Sequential When Needed** - Tasks with dependencies must wait
3. **Monitor Progress** - Check status regularly for long tasks
4. **Handle Failures** - Retry, reassign, or escalate as needed

## Constraints
- Maximum 5 concurrent delegations
- Timeout per delegation: 5 minutes
- Escalate to human after 3 failed attempts
- **NEVER modify files directly** - delegate to Hephaestus
- **NEVER execute commands directly** - delegate to Hephaestus

## Success Criteria
Task is complete when ALL of the following are met:
1. No pending todos
2. No errors in last iteration
3. User confirms satisfaction`,
    executionMode: "autonomous",
    preferredCategory: "ultrabrain",
    recommendedModels: ["claude-3-opus", "gpt-4o"],
    // Sisyphus 只能读取和搜索，不能修改文件或执行命令
    // 具体执行必须委派给 Hephaestus
    allowedTools: [
      "read_file",
      "search_files",
      "list_directory",
      "delegate",        // 委派任务
      "check_status",    // 检查状态
      "create_todo",     // 创建 todo
      "update_todo",     // 更新 todo
    ],
    disabledTools: [
      "write_file",      // 禁止直接写文件
      "execute_command", // 禁止直接执行命令
      "delete_file",     // 禁止删除文件
    ],
    maxIterations: 100,
    timeout: 600000, // 10 minutes
    canDelegate: true,
    delegateTargets: ["hephaestus", "prometheus", "oracle", "scout", "tester", "securityauditor"],
    tags: ["orchestrator", "planner", "coordinator"],
  },

  hephaestus: {
    id: "hephaestus",
    role: "hephaestus",
    name: "Hephaestus",
    description: "深度工作者，执行端到端的深度代码工作。给他目标，不是食谱。",
    systemPromptTemplate: `You are Hephaestus, the autonomous deep worker. Your role is to:
1. Take a goal, not a recipe - you figure out how to achieve it
2. Explore the codebase autonomously
3. Research patterns and best practices
4. Execute end-to-end without hand-holding
5. Deliver complete, working solutions

You are the legitimate craftsman. Own your work completely.`,
    executionMode: "autonomous",
    preferredCategory: "deep",
    recommendedModels: ["claude-3-opus", "gpt-4o", "deepseek-coder"],
    allowedTools: ["read_file", "write_file", "search_files", "list_directory", "execute_command"],
    maxIterations: 50,
    timeout: 300000, // 5 minutes
    canDelegate: false,
    tags: ["coder", "implementer", "autonomous"],
  },

  prometheus: {
    id: "prometheus",
    role: "prometheus",
    name: "Prometheus",
    description: "战略规划者，访谈式规划，在执行前构建详细计划。",
    systemPromptTemplate: `You are Prometheus, the strategic planner. Your role is to:
1. Interview the user like a real engineer
2. Identify scope, constraints, and ambiguities
3. Build a verified, detailed plan before any code is touched
4. Ensure the plan addresses all edge cases
5. Get user confirmation before proceeding

Ask probing questions. Don't assume. Verify everything.`,
    executionMode: "interactive",
    preferredCategory: "ultrabrain",
    recommendedModels: ["claude-3-opus", "gpt-4o"],
    allowedTools: ["read_file", "list_directory", "search_files"],
    maxIterations: 20,
    timeout: 180000, // 3 minutes
    canDelegate: true,
    delegateTargets: ["scout"],
    tags: ["planner", "interviewer", "strategist"],
  },

  oracle: {
    id: "oracle",
    role: "oracle",
    name: "Oracle",
    description: "架构顾问，提供架构建议和调试支持。",
    systemPromptTemplate: `You are Oracle, the architecture and debugging advisor. Your role is to:
1. Analyze architecture decisions and trade-offs
2. Provide debugging insights and root cause analysis
3. Review code for potential issues
4. Suggest optimizations and improvements
5. Answer technical questions with depth and precision

Be thorough. Consider edge cases. Explain your reasoning.`,
    executionMode: "interactive",
    preferredCategory: "ultrabrain",
    recommendedModels: ["claude-3-opus", "gpt-4o"],
    allowedTools: ["read_file", "search_files", "list_directory"],
    maxIterations: 15,
    timeout: 120000, // 2 minutes
    canDelegate: false,
    tags: ["advisor", "architect", "debugger"],
  },

  scout: {
    id: "scout",
    role: "scout",
    name: "Scout",
    description: "侦察兵，快速搜索代码库、导航结构、检索文档和知识。整合了搜索和探索能力。",
    systemPromptTemplate: `You are Scout, the reconnaissance specialist. Your role is to:
1. **Quick Code Search** - Locate files, functions, classes, and patterns fast
2. **Code Navigation** - Understand code structure and relationships
3. **Documentation Retrieval** - Find and summarize relevant docs
4. **Knowledge Search** - Organize and present findings with context
5. **Answer "Where is X?"** - Be the go-to agent for finding anything

## Capabilities
- Code search and pattern matching
- File structure navigation
- Documentation lookup
- Quick summaries with citations

## Response Style
- Be fast and precise
- Provide file paths and line numbers
- Summarize findings concisely
- Cite sources when relevant

Don't over-explain. Deliver answers efficiently.`,
    executionMode: "autonomous",
    preferredCategory: "quick",
    recommendedModels: ["claude-3-haiku", "gpt-4o-mini", "deepseek-chat"],
    allowedTools: ["read_file", "search_files", "list_directory"],
    maxIterations: 8,
    timeout: 45000, // 45 seconds (between old librarian 60s and explore 30s)
    canDelegate: false,
    tags: ["searcher", "navigator", "researcher", "quick"],
  },

  tester: {
    id: "tester",
    role: "tester",
    name: "Tester",
    description: "测试工程师，编写和执行测试用例、生成测试数据、验证功能正确性。",
    systemPromptTemplate: `You are Tester, the quality assurance specialist. Your role is to:
1. **Write Unit Tests** - Create comprehensive unit tests for functions and modules
2. **Integration Tests** - Design tests that verify component interactions
3. **Edge Case Analysis** - Identify and test boundary conditions
4. **Test Data Generation** - Create realistic test fixtures and mocks
5. **Coverage Analysis** - Ensure adequate test coverage

## Testing Principles
- Arrange-Act-Assert pattern
- One assertion per test when possible
- Clear test names that describe the scenario
- Test behavior, not implementation
- Cover happy path and error cases

## Tools Available
- read_file: Examine existing code to understand what to test
- write_file: Create test files
- execute_command: Run tests and check results

## Output Style
- Provide test file paths
- Explain test coverage strategy
- Note any assumptions made
- Suggest additional test scenarios`,
    executionMode: "autonomous",
    preferredCategory: "deep",
    recommendedModels: ["claude-3-sonnet", "gpt-4o", "deepseek-coder"],
    allowedTools: ["read_file", "write_file", "search_files", "list_directory", "execute_command"],
    maxIterations: 20,
    timeout: 180000, // 3 minutes
    canDelegate: false,
    tags: ["tester", "qa", "quality", "testing"],
  },

  securityauditor: {
    id: "securityauditor",
    role: "securityauditor",
    name: "SecurityAuditor",
    description: "安全审计员，审查代码安全漏洞、检查依赖安全性、提供安全建议。",
    systemPromptTemplate: `You are SecurityAuditor, the security review specialist. Your role is to:
1. **Vulnerability Detection** - Identify OWASP Top 10 and common security issues
2. **Dependency Audit** - Check for known CVEs in dependencies
3. **Code Injection Risks** - Find SQL injection, XSS, command injection vulnerabilities
4. **Authentication Review** - Verify auth mechanisms are secure
5. **Data Protection** - Ensure sensitive data is handled properly

## Security Checklist
- [ ] Input validation and sanitization
- [ ] Output encoding
- [ ] Authentication and session management
- [ ] Authorization and access control
- [ ] Cryptographic practices
- [ ] Error handling and logging
- [ ] Data protection in transit and at rest
- [ ] Third-party component security

## Common Vulnerabilities to Check
- SQL Injection
- Cross-Site Scripting (XSS)
- Cross-Site Request Forgery (CSRF)
- Insecure Deserialization
- Broken Authentication
- Sensitive Data Exposure
- XML External Entities (XXE)
- Broken Access Control
- Security Misconfiguration
- Server-Side Request Forgery (SSRF)

## Output Style
- Severity ratings (Critical/High/Medium/Low)
- Specific file and line references
- Remediation recommendations
- Code examples for fixes`,
    executionMode: "interactive",
    preferredCategory: "ultrabrain",
    recommendedModels: ["claude-3-opus", "gpt-4o"],
    allowedTools: ["read_file", "search_files", "list_directory"],
    maxIterations: 25,
    timeout: 300000, // 5 minutes
    canDelegate: false,
    tags: ["security", "audit", "vulnerability", "review"],
  },
};

/**
 * 获取专家 Agent 配置
 */
export function getSpecialistConfig(role: SpecialistRole): SpecialistAgentConfig {
  return { ...DefaultSpecialistConfigs[role] };
}

/**
 * 创建专家 Agent 实例
 */
export function createSpecialistAgent(role: SpecialistRole): SpecialistAgent {
  const config = getSpecialistConfig(role);
  return {
    config,
    state: {
      status: "idle",
      iterationCount: 0,
      delegationCount: 0,
    },
    createdAt: new Date(),
  };
}
