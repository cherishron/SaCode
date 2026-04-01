/**
 * 技能注册表适配器
 *
 * 支持多种技能注册表源：
 * - ClawHub (默认): https://clawhub.ai
 * - SkillHub (腾讯云镜像): https://skillhub.tencent.com
 */

export {
  SkillHubAdapter,
  createSkillHubAdapter,
} from "./skillhub";

export type { SkillHubConfig } from "./skillhub";
