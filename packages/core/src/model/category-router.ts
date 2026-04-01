/**
 * Category-based 模型路由器
 *
 * 基于 OMO (Oh My OpenCode) 设计，根据任务语义类别自动选择合适的模型
 *
 * 任务类别：
 * - visual-engineering: 前端/UI/UX 任务
 * - deep: 自主研究+执行，深度代码工作
 * - quick: 单文件更改，快速任务
 * - ultrabrain: 硬逻辑/架构决策，复杂推理
 */

import type { ModelConfig, ModelCapabilityRequirement, ModelManager } from "./index";

// ============================================
// 类型定义
// ============================================

/**
 * 任务类别（基于 OMO 设计）
 */
export type TaskCategory =
  | "visual-engineering"  // 前端/UI/UX 任务
  | "deep"                // 自主研究+执行，深度代码工作
  | "quick"               // 单文件更改，快速任务
  | "ultrabrain";         // 硬逻辑/架构决策，复杂推理

/**
 * 类别描述
 */
export interface CategoryDescriptor {
  /** 类别名称 */
  name: string;
  /** 类别描述 */
  description: string;
  /** 识别关键词（支持权重） */
  keywords: Array<string | { word: string; weight: number }>;
  /** 识别正则模式（支持权重） */
  patterns: Array<RegExp | { pattern: RegExp; weight: number }>;
  /** 否定词（出现时降低该类别得分） */
  negativeKeywords?: string[];
  /** 否定模式（匹配时降低该类别得分） */
  negativePatterns?: RegExp[];
  /** 模型能力需求 */
  capabilityRequirements: ModelCapabilityRequirement;
  /** 推荐模型优先级列表 */
  preferredModels: string[];
  /** 备选模型列表 */
  fallbackModels: string[];
  /** 是否需要长上下文 */
  needsLongContext: boolean;
  /** 是否需要视觉能力 */
  needsVision: boolean;
}

/**
 * 类别识别结果
 */
export interface CategoryRecognitionResult {
  /** 识别到的类别 */
  category: TaskCategory;
  /** 置信度 (0-1) */
  confidence: number;
  /** 匹配的关键词 */
  matchedKeywords: string[];
  /** 匹配的模式 */
  matchedPatterns: string[];
  /** 推荐模型列表 */
  recommendedModels: string[];
  /** 分类详情 */
  details?: {
    /** 原始得分 */
    rawScore: number;
    /** 否定调整 */
    negativeAdjustment: number;
    /** 上下文加成 */
    contextBonus: number;
    /** 所有类别得分 */
    allScores: Record<TaskCategory, number>;
  };
}

/**
 * 分类上下文
 */
export interface ClassificationContext {
  /** 文件路径 */
  filePath?: string;
  /** 文件扩展名 */
  fileExtension?: string;
  /** 项目类型 */
  projectType?: "frontend" | "backend" | "fullstack" | "library" | "cli";
  /** 是否涉及多个文件 */
  multiFile?: boolean;
  /** 是否是修复任务 */
  isFix?: boolean;
  /** 是否是新功能 */
  isNewFeature?: boolean;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 类别路由器配置
 */
export interface CategoryRouterConfig {
  /** 是否启用自动分类 */
  autoClassify?: boolean;
  /** 分类置信度阈值 */
  confidenceThreshold?: number;
  /** 自定义分类规则 */
  customRules?: CategoryClassificationRule[];
  /** 类别到模型的显式映射 */
  categoryModelMap?: Partial<Record<TaskCategory, string[]>>;
}

/**
 * 自定义分类规则
 */
export interface CategoryClassificationRule {
  /** 规则名称 */
  name: string;
  /** 规则优先级（越高越优先） */
  priority: number;
  /** 匹配条件 */
  condition: (input: string, context?: Record<string, unknown> | ClassificationContext) => boolean;
  /** 目标类别 */
  category: TaskCategory;
}

// ============================================
// 预设类别定义
// ============================================

/**
 * 默认类别描述符
 */
export const DefaultCategoryDescriptors: Record<TaskCategory, CategoryDescriptor> = {
  "visual-engineering": {
    name: "Visual Engineering",
    description: "前端/UI/UX 任务，涉及界面设计、样式调整、组件开发",
    keywords: [
      // 高权重关键词（UI 核心）
      { word: "UI", weight: 3 },
      { word: "CSS", weight: 3 },
      { word: "Tailwind", weight: 3 },
      { word: "组件", weight: 2 },
      { word: "界面", weight: 2 },
      { word: "样式", weight: 2 },
      // 中权重关键词
      "前端", "布局", "设计", "动画", "响应式", "移动端",
      "图标", "颜色", "字体", "间距", "边距", "居中", "对齐",
      // 英文关键词
      { word: "frontend", weight: 2 },
      { word: "component", weight: 2 },
      { word: "layout", weight: 2 },
      "ui", "ux", "design", "style", "tailwind",
      "button", "form", "modal", "dialog", "card", "navbar", "sidebar",
    ],
    patterns: [
      // 高权重模式
      { pattern: /(?:style|css|scss|less|tailwind|styled)\s+(?:component|element)/i, weight: 4 },
      { pattern: /(?:react|vue|svelte|angular)\s+component/i, weight: 3 },
      // 普通模式
      /(?:style|css|scss|less|tailwind|styled)/i,
      /(?:component|widget|element|button|form|modal|dialog|card|navbar|sidebar)/i,
      /(?:layout|flexbox|grid|position|center|align|justify)/i,
      /(?:react|vue|svelte|angular|next\.?js|nuxt)/i,
      /(?:design|theme|dark.?mode|light.?mode|color|font|typography)/i,
    ],
    // 否定词：出现这些词时降低 visual-engineering 得分
    negativeKeywords: [
      "不要", "别", "no", "don't", "not",
    ],
    negativePatterns: [
      /不要.*(?:修改|改|动).*(?:样式|UI|界面|CSS)/i,
      /don'?t.*(?:modify|change|touch).*(?:style|css|ui)/i,
      /不是.*(?:前端|UI|样式)/i,
    ],
    capabilityRequirements: {
      vision: true,
      functionCalling: true,
      minContextLength: 32000,
    },
    preferredModels: [
      "claude-3-sonnet",
      "gpt-4o",
      "gpt-4o-mini",
    ],
    fallbackModels: [
      "claude-3-haiku",
      "deepseek-chat",
    ],
    needsLongContext: false,
    needsVision: true,
  },

  "deep": {
    name: "Deep Work",
    description: "自主研究+执行，深度代码工作，需要探索代码库和自主决策",
    keywords: [
      // 高权重关键词
      { word: "实现", weight: 3 },
      { word: "implement", weight: 3 },
      { word: "架构", weight: 3 },
      { word: "architecture", weight: 3 },
      { word: "系统", weight: 2 },
      { word: "重构", weight: 2 },
      { word: "refactor", weight: 2 },
      // 中权重关键词
      "开发", "构建", "创建", "研究", "分析", "探索",
      "优化", "迁移", "集成", "模块",
      "数据库", "API", "服务", "后端", "全栈",
      // 英文关键词
      "develop", "build", "create", "research", "analyze",
      "optimize", "migrate", "integrate", "module",
      "database", "api", "service", "backend", "fullstack",
      "infrastructure", "pipeline", "workflow",
    ],
    patterns: [
      // 高权重模式
      { pattern: /(?:implement|develop|build|create)\s+(?:a|an|the)?\s*(?:new|feature|system|module)/i, weight: 4 },
      { pattern: /(?:refactor|rewrite|restructure)\s+(?:the\s+)?(?:codebase|system|architecture)/i, weight: 4 },
      // 普通模式
      /(?:implement|develop|build|create)\s+(?:a|an|the)?\s*\w+/i,
      /(?:research|analyze|investigate|explore)\s+/i,
      /(?:refactor|optimize|improve|enhance)\s+/i,
      /(?:system|architecture|infrastructure|pipeline|workflow)/i,
      /(?:步骤|phase|stage|step\s+\d+)/i,
    ],
    negativeKeywords: [
      "简单", "快速", "单个", "quick", "simple", "single",
    ],
    negativePatterns: [
      /(?:just|only|simply)\s+(?:fix|update|change)/i,
    ],
    capabilityRequirements: {
      functionCalling: true,
      longContext: true,
      minContextLength: 100000,
    },
    preferredModels: [
      "claude-3-opus",
      "gpt-4o",
      "deepseek-coder",
    ],
    fallbackModels: [
      "claude-3-sonnet",
      "deepseek-chat",
    ],
    needsLongContext: true,
    needsVision: false,
  },

  "quick": {
    name: "Quick Task",
    description: "单文件更改，快速任务，简单修改和调整",
    keywords: [
      // 高权重关键词
      { word: "修复", weight: 3 },
      { word: "fix", weight: 3 },
      { word: "bug", weight: 2 },
      { word: "单个", weight: 2 },
      { word: "simple", weight: 2 },
      { word: "quick", weight: 2 },
      // 中权重关键词
      "修改", "更新", "添加", "删除", "更改", "调整",
      "重命名", "移动", "复制", "简单", "快速",
      // 英文关键词
      "update", "add", "remove", "change", "modify", "adjust",
      "rename", "move", "copy", "single", "minor",
      "typo", "error", "warning",
    ],
    patterns: [
      // 高权重模式
      { pattern: /(?:just|simply|only)\s+(?:fix|update|change|modify)/i, weight: 4 },
      { pattern: /(?:fix|update)\s+(?:the\s+)?(?:typo|bug|error|warning)/i, weight: 3 },
      // 普通模式
      /(?:fix|update|change|modify)\s+(?:the\s+)?(?:a\s+)?(?:single\s+)?(?:file|line|variable|function)/i,
      /(?:quick|simple|minor|small)\s+(?:fix|change|update|task)/i,
      /(?:single|one)\s+(?:file|line|variable)/i,
      /(?:fix|resolve)\s+(?:the\s+)?(?:error|warning|bug|typo|issue)/i,
    ],
    negativeKeywords: [
      "架构", "重构", "系统", "实现", "architecture", "refactor", "system",
    ],
    negativePatterns: [
      /(?:implement|develop|build)\s+(?:new|feature|system)/i,
      /(?:refactor|restructure|redesign)\s+/i,
    ],
    capabilityRequirements: {
      // 快速任务没有特殊能力要求
    },
    preferredModels: [
      "claude-3-haiku",
      "gpt-4o-mini",
      "deepseek-chat",
    ],
    fallbackModels: [
      "claude-3-sonnet",
      "gpt-4o",
    ],
    needsLongContext: false,
    needsVision: false,
  },

  "ultrabrain": {
    name: "Ultrabrain",
    description: "硬逻辑/架构决策，复杂推理，需要深度思考和分析",
    keywords: [
      // 高权重关键词
      { word: "算法", weight: 3 },
      { word: "algorithm", weight: 3 },
      { word: "决策", weight: 3 },
      { word: "decision", weight: 3 },
      { word: "权衡", weight: 2 },
      { word: "tradeoff", weight: 2 },
      // 中权重关键词
      "逻辑", "架构", "设计", "分析", "评估",
      "优化", "性能", "安全", "复杂", "核心", "关键", "重要",
      "策略", "方案", "选择", "比较",
      // 英文关键词
      "logic", "architecture", "design",
      "analysis", "evaluation", "optimization", "performance", "security",
      "complex", "critical", "important", "strategy", "solution",
      "choose", "compare",
    ],
    patterns: [
      // 高权重模式
      { pattern: /(?:decide|choose|compare|evaluate)\s+(?:the\s+)?(?:best|optimal|better)/i, weight: 4 },
      { pattern: /(?:architecture|design)\s+(?:decision|pattern|approach)/i, weight: 3 },
      // 普通模式
      /(?:architecture|design|structure)\s+(?:decision|pattern|approach)/i,
      /(?:algorithm|logic|complex)\s+(?:implementation|design|analysis)/i,
      /(?:performance|optimization|efficiency)\s+(?:improve|enhance|analyze)/i,
      /(?:security|vulnerability|exploit|attack)\s+/i,
      /(?:decide|choose|compare|evaluate|analyze)\s+(?:the\s+)?(?:best|optimal|better)/i,
    ],
    negativeKeywords: [
      "修复", "修改", "fix", "modify", "simple",
    ],
    negativePatterns: [
      /(?:just|simply|only)\s+(?:fix|change|update)/i,
    ],
    capabilityRequirements: {
      functionCalling: true,
      longContext: true,
      minContextLength: 100000,
    },
    preferredModels: [
      "claude-3-opus",
      "gpt-4o",
    ],
    fallbackModels: [
      "claude-3-sonnet",
      "deepseek-coder",
    ],
    needsLongContext: true,
    needsVision: false,
  },
};

// ============================================
// CategoryRouter 实现
// ============================================

/**
 * Category-based 模型路由器
 *
 * 根据任务语义自动分类并选择合适的模型
 */
export class CategoryRouter {
  private config: Required<Omit<CategoryRouterConfig, "customRules" | "categoryModelMap">> & Pick<CategoryRouterConfig, "customRules" | "categoryModelMap">;
  private modelManager?: ModelManager;
  private customRules: CategoryClassificationRule[];

  constructor(config: CategoryRouterConfig = {}, modelManager?: ModelManager) {
    this.config = {
      autoClassify: config.autoClassify ?? true,
      confidenceThreshold: config.confidenceThreshold ?? 0.5,
      ...(config.customRules ? { customRules: config.customRules } : {}),
      ...(config.categoryModelMap ? { categoryModelMap: config.categoryModelMap } : {}),
    };
    if (modelManager !== undefined) {
      this.modelManager = modelManager;
    }
    this.customRules = config.customRules ?? [];
  }

  /**
   * 设置模型管理器
   */
  setModelManager(manager: ModelManager): void {
    this.modelManager = manager;
  }

  /**
   * 添加自定义分类规则
   */
  addCustomRule(rule: CategoryClassificationRule): void {
    this.customRules.push(rule);
    // 按优先级排序
    this.customRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 分类任务
   *
   * @param input 任务描述或用户输入
   * @param context 可选的上下文信息（支持 ClassificationContext）
   */
  classify(input: string, context?: Record<string, unknown> | ClassificationContext): CategoryRecognitionResult {
    const normalizedInput = input.toLowerCase();
    const matchedKeywords: string[] = [];
    const matchedPatterns: string[] = [];

    // 提取分类上下文
    const classificationContext = this.extractClassificationContext(context);

    // 1. 先检查自定义规则（按优先级）
    for (const rule of this.customRules) {
      if (rule.condition(input, context)) {
        return {
          category: rule.category,
          confidence: 1.0,
          matchedKeywords: [`custom-rule:${rule.name}`],
          matchedPatterns: [],
          recommendedModels: this.getModelsForCategory(rule.category),
        };
      }
    }

    // 2. 计算每个类别的匹配分数（带权重）
    const scores: Map<TaskCategory, number> = new Map();
    const categoryMatches: Map<TaskCategory, { keywords: string[]; patterns: string[] }> = new Map();
    const negativeAdjustments: Map<TaskCategory, number> = new Map();

    for (const [category, descriptor] of Object.entries(DefaultCategoryDescriptors) as [TaskCategory, CategoryDescriptor][]) {
      let score = 0;
      let negativeAdjustment = 0;
      const catMatches = { keywords: [] as string[], patterns: [] as string[] };

      // 关键词匹配（支持权重）
      for (const keywordItem of descriptor.keywords) {
        const keyword = typeof keywordItem === "string" ? keywordItem : keywordItem.word;
        const weight = typeof keywordItem === "string" ? 1 : keywordItem.weight;
        
        if (normalizedInput.includes(keyword.toLowerCase())) {
          score += weight;
          catMatches.keywords.push(keyword);
        }
      }

      // 正则模式匹配（支持权重）
      for (const patternItem of descriptor.patterns) {
        const pattern = patternItem instanceof RegExp ? patternItem : patternItem.pattern;
        const weight = patternItem instanceof RegExp ? 2 : patternItem.weight;
        
        if (pattern.test(input)) {
          score += weight;
          catMatches.patterns.push(pattern.source);
        }
      }

      // 否定词检测
      if (descriptor.negativeKeywords) {
        for (const negKeyword of descriptor.negativeKeywords) {
          if (normalizedInput.includes(negKeyword.toLowerCase())) {
            negativeAdjustment += 2;
          }
        }
      }

      // 否定模式检测
      if (descriptor.negativePatterns) {
        for (const negPattern of descriptor.negativePatterns) {
          if (negPattern.test(input)) {
            negativeAdjustment += 3;
          }
        }
      }

      scores.set(category, score);
      categoryMatches.set(category, catMatches);
      negativeAdjustments.set(category, negativeAdjustment);
    }

    // 3. 应用上下文加成
    const contextBonus = this.calculateContextBonus(classificationContext);
    for (const [category, bonus] of Object.entries(contextBonus) as [TaskCategory, number][]) {
      const currentScore = scores.get(category) ?? 0;
      scores.set(category, currentScore + bonus);
    }

    // 4. 应用否定调整后找出最佳匹配
    const adjustedScores: Map<TaskCategory, number> = new Map();
    for (const [category, score] of scores) {
      const adjustment = negativeAdjustments.get(category) ?? 0;
      adjustedScores.set(category, Math.max(0, score - adjustment));
    }

    let bestCategory: TaskCategory = "deep"; // 默认使用 deep
    let bestScore = 0;

    for (const [category, score] of adjustedScores) {
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    // 5. 获取匹配结果
    const bestMatches = categoryMatches.get(bestCategory)!;
    matchedKeywords.push(...bestMatches.keywords);
    matchedPatterns.push(...bestMatches.patterns);

    // 6. 计算置信度（改进的算法）
    const confidence = this.calculateConfidence(
      adjustedScores,
      bestCategory,
      bestScore,
      matchedKeywords.length,
      matchedPatterns.length
    );

    // 如果没有明显匹配，使用默认类别
    if (bestScore === 0) {
      bestCategory = "deep";
    }

    // 7. 构建所有得分记录
    const allScores: Record<TaskCategory, number> = {
      "visual-engineering": adjustedScores.get("visual-engineering") ?? 0,
      "deep": adjustedScores.get("deep") ?? 0,
      "quick": adjustedScores.get("quick") ?? 0,
      "ultrabrain": adjustedScores.get("ultrabrain") ?? 0,
    };

    return {
      category: bestCategory,
      confidence,
      matchedKeywords,
      matchedPatterns,
      recommendedModels: this.getModelsForCategory(bestCategory),
      details: {
        rawScore: scores.get(bestCategory) ?? 0,
        negativeAdjustment: negativeAdjustments.get(bestCategory) ?? 0,
        contextBonus: contextBonus[bestCategory] ?? 0,
        allScores,
      },
    };
  }

  /**
   * 提取分类上下文
   */
  private extractClassificationContext(context?: Record<string, unknown> | ClassificationContext): ClassificationContext {
    if (!context) return {};
    
    // 如果已经是 ClassificationContext 格式，直接返回
    if ("filePath" in context || "fileExtension" in context || "projectType" in context) {
      return context as ClassificationContext;
    }

    // 尝试从通用 context 中提取信息
    const result: ClassificationContext = {};
    
    if (typeof context.filePath === "string") {
      result.filePath = context.filePath;
      result.fileExtension = this.extractFileExtension(context.filePath);
    }
    
    if (typeof context.multiFile === "boolean") {
      result.multiFile = context.multiFile;
    }

    return result;
  }

  /**
   * 提取文件扩展名
   */
  private extractFileExtension(filePath: string): string {
    const match = filePath.match(/\.([^.]+)$/);
    return match ? match[1]?.toLowerCase() ?? "" : "";
  }

  /**
   * 计算上下文加成
   */
  private calculateContextBonus(context?: ClassificationContext): Partial<Record<TaskCategory, number>> {
    const bonus: Partial<Record<TaskCategory, number>> = {};

    if (!context) return bonus;

    // 基于文件扩展名加成
    if (context.fileExtension) {
      const ext = context.fileExtension;
      
      // 前端文件
      if (["vue", "jsx", "tsx", "svelte", "css", "scss", "less", "html"].includes(ext)) {
        bonus["visual-engineering"] = (bonus["visual-engineering"] ?? 0) + 3;
      }
      
      // 后端文件
      if (["go", "rs", "py", "java", "rb", "php"].includes(ext)) {
        bonus["deep"] = (bonus["deep"] ?? 0) + 2;
      }
      
      // 配置文件
      if (["json", "yaml", "yml", "toml"].includes(ext)) {
        bonus["quick"] = (bonus["quick"] ?? 0) + 2;
      }
    }

    // 基于项目类型加成
    if (context.projectType) {
      switch (context.projectType) {
        case "frontend":
          bonus["visual-engineering"] = (bonus["visual-engineering"] ?? 0) + 2;
          break;
        case "backend":
          bonus["deep"] = (bonus["deep"] ?? 0) + 2;
          break;
        case "fullstack":
          bonus["deep"] = (bonus["deep"] ?? 0) + 1;
          bonus["visual-engineering"] = (bonus["visual-engineering"] ?? 0) + 1;
          break;
      }
    }

    // 基于任务性质加成
    if (context.isFix) {
      bonus["quick"] = (bonus["quick"] ?? 0) + 1;
    }
    if (context.isNewFeature) {
      bonus["deep"] = (bonus["deep"] ?? 0) + 1;
    }
    if (context.multiFile) {
      bonus["deep"] = (bonus["deep"] ?? 0) + 1;
      bonus["quick"] = (bonus["quick"] ?? 0) - 1;
    }

    return bonus;
  }

  /**
   * 计算置信度（改进算法）
   */
  private calculateConfidence(
    scores: Map<TaskCategory, number>,
    _bestCategory: TaskCategory,
    bestScore: number,
    keywordMatches: number,
    patternMatches: number
  ): number {
    // 如果最高分为 0，返回低置信度
    if (bestScore === 0) {
      return 0.3;
    }

    const sortedScores = Array.from(scores.values()).sort((a, b) => b - a);
    const topScore = sortedScores[0] ?? 0;
    const secondScore = sortedScores[1] ?? 0;
    
    // 基础置信度
    let confidence = 0.4;

    // 1. 基于与次高分的差距（最大 +0.3）
    if (topScore > 0) {
      const gap = topScore - secondScore;
      const gapBonus = Math.min(0.3, gap * 0.05);
      confidence += gapBonus;
    }

    // 2. 基于匹配数量（最大 +0.15）
    const matchBonus = Math.min(0.15, (keywordMatches * 0.02) + (patternMatches * 0.05));
    confidence += matchBonus;

    // 3. 基于最高分绝对值（高分表示更明确的意图）
    if (topScore >= 5) {
      confidence += 0.1;
    } else if (topScore >= 3) {
      confidence += 0.05;
    }

    // 4. 如果有模式匹配（比纯关键词更可靠）
    if (patternMatches > 0) {
      confidence += 0.05;
    }

    // 确保置信度在 [0.3, 0.95] 范围内
    return Math.max(0.3, Math.min(0.95, confidence));
  }

  /**
   * 获取类别对应的模型列表
   */
  getModelsForCategory(category: TaskCategory): string[] {
    // 检查自定义映射
    if (this.config.categoryModelMap?.[category]) {
      return this.config.categoryModelMap[category] ?? [];
    }

    const descriptor = DefaultCategoryDescriptors[category];
    return [...descriptor.preferredModels, ...descriptor.fallbackModels];
  }

  /**
   * 获取类别能力需求
   */
  getCapabilityRequirements(category: TaskCategory): ModelCapabilityRequirement {
    return DefaultCategoryDescriptors[category].capabilityRequirements;
  }

  /**
   * 根据类别选择模型
   *
   * @param category 任务类别
   * @returns 选中的模型配置
   */
  selectModelForCategory(category: TaskCategory): ModelConfig | undefined {
    if (!this.modelManager) {
      return undefined;
    }

    const descriptor = DefaultCategoryDescriptors[category];
    const requirements = descriptor.capabilityRequirements;

    // 1. 先尝试从推荐模型中选择可用的
    for (const modelId of descriptor.preferredModels) {
      const model = this.modelManager.getModel(modelId);
      if (model?.enabled && this.meetsRequirements(model, requirements)) {
        return model;
      }
    }

    // 2. 尝试备选模型
    for (const modelId of descriptor.fallbackModels) {
      const model = this.modelManager.getModel(modelId);
      if (model?.enabled && this.meetsRequirements(model, requirements)) {
        return model;
      }
    }

    // 3. 使用能力选择
    return this.modelManager.selectModelByCapability(requirements);
  }

  /**
   * 智能路由：分类 + 模型选择
   *
   * @param input 任务描述
   * @param context 上下文
   */
  route(
    input: string,
    context?: Record<string, unknown>
  ): {
    classification: CategoryRecognitionResult;
    model: ModelConfig | undefined;
  } {
    const classification = this.classify(input, context);
    const model = this.selectModelForCategory(classification.category);

    return { classification, model };
  }

  /**
   * 检查模型是否满足能力需求
   */
  private meetsRequirements(model: ModelConfig, requirements: ModelCapabilityRequirement): boolean {
    const caps = model.capabilities;

    if (requirements.vision && !caps.vision) return false;
    if (requirements.functionCalling && !caps.functionCalling) return false;
    if (requirements.longContext && !caps.longContext) return false;
    if (requirements.minContextLength && caps.maxContextLength < requirements.minContextLength) {
      return false;
    }

    return true;
  }

  /**
   * 获取所有类别描述符
   */
  getAllCategories(): Record<TaskCategory, CategoryDescriptor> {
    return { ...DefaultCategoryDescriptors };
  }

  /**
   * 获取类别描述符
   */
  getCategoryDescriptor(category: TaskCategory): CategoryDescriptor {
    return DefaultCategoryDescriptors[category];
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Category Router
 */
export function createCategoryRouter(
  config?: CategoryRouterConfig,
  modelManager?: ModelManager
): CategoryRouter {
  return new CategoryRouter(config, modelManager);
}

/**
 * 快速分类函数
 */
export function classifyTask(input: string, context?: Record<string, unknown>): TaskCategory {
  const router = new CategoryRouter();
  const result = router.classify(input, context);
  return result.category;
}

/**
 * 快速路由函数
 */
export function routeTask(
  input: string,
  modelManager: ModelManager,
  context?: Record<string, unknown>
): { category: TaskCategory; model: ModelConfig | undefined } {
  const router = new CategoryRouter({}, modelManager);
  const { classification, model } = router.route(input, context);
  return { category: classification.category, model };
}
