-- =============================================================================
-- SaAiApiGateway 统一账号体系 · 完整建库 SQL
-- =============================================================================
-- 目标：以 users 为唯一身份锚点，统一支撑
--        ① 网关管理后台（admin 密码登录）
--        ② SaCode CLI / Desktop（API Key 数据面 + 登录拉取模型）
--        ③ SaApp 移动端（手机号 / 微信 / 密码 → JWT）
--        ④ 微信小程序（wx.login code2session → openid/unionid → JWT）
--
-- 约定（对齐 backend/internal/model 的 GORM 模型）：
--   BaseModel   = id BIGINT UNSIGNED PK AUTO_INCREMENT + created_at + updated_at（无软删除）
--   TenantModel = tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 1
--   字符集 utf8mb4，引擎 InnoDB，金额统一 DECIMAL(20,8)
--
-- 多租户决策（2026-09-20）：当前只做个人端（B2C），身份层全局唯一、不做租户隔离。
--   - 7 张新身份表（user_identities/wx_app_configs/verification_codes/refresh_tokens/
--     user_devices/login_logs/user_preferences）已移除 tenant_id。
--   - users.tenant_id 保留但固定为 1：网关现有 auth.go/session.go 以 tenant_id 查询 users，
--     移除会破坏既有认证代码；个人端恒为 1，不作隔离维度。
--   - 资源/计费层（providers/channels/models/api_keys/quotas/call_logs 等）保留 tenant_id，
--     未来若引入企业/组织账号或私有化部署再启用隔离。
--
-- 说明：本文件是「统一账号体系」权威建库脚本，覆盖并超集 backend/schema.sql。
--       生产环境结构变更仍由 backend/cmd/migrate（GORM AutoMigrate）管理，
--       新增身份表须同步补充对应 Go 模型后纳入迁移，避免双真源漂移。
--       本文件存放于 SaCode 工作区 docs/plans/ 作为跨仓设计真源。
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `sa_ai_api_gateway`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE `sa_ai_api_gateway`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- 第一部分：基础设施
-- =============================================================================

-- ------------------------- schema_migrations -------------------------
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` BIGINT NOT NULL PRIMARY KEY,
  `checksum` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `started_at` DATETIME NOT NULL,
  `applied_at` DATETIME NULL DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `error_message` TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- tenants（租户） -------------------------
-- 多租户隔离根；tenants 仅内嵌 BaseModel，没有 tenant_id 列。
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `name` VARCHAR(128) NOT NULL,
  `slug` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `description` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_tenants_slug` (`slug`),
  KEY `idx_tenants_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- 第二部分：统一身份核心（新增）
-- =============================================================================

-- ------------------------- users（统一账号锚点） -------------------------
-- 所有产品共享同一张 users 表；account_type 区分账号来源，role 区分权限。
-- password_hash 改为可空：微信/短信-only 用户没有密码。
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '个人端固定为 1；保留以兼容网关现有 users 查询，不作身份隔离维度',
  `username` VARCHAR(64) NOT NULL COMMENT '全局唯一登录名',
  `name` VARCHAR(128) NULL DEFAULT NULL COMMENT '昵称/显示名',
  `email` VARCHAR(255) NULL DEFAULT NULL,
  `email_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `phone` VARCHAR(32) NULL DEFAULT NULL COMMENT 'E.164 或国内 11 位',
  `phone_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `password_hash` VARCHAR(255) NULL DEFAULT NULL COMMENT 'bcrypt；微信/短信用户为 NULL',
  `avatar_url` VARCHAR(512) NULL DEFAULT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'user' COMMENT 'admin / user',
  `account_type` VARCHAR(32) NOT NULL DEFAULT 'normal' COMMENT 'normal/admin/wechat/phone',
  `register_source` VARCHAR(32) NOT NULL DEFAULT 'password' COMMENT 'password/sms/wechat/admin',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active/disabled/locked',
  `session_epoch` BIGINT NOT NULL DEFAULT 0 COMMENT '递增即全局撤销该用户所有会话/令牌',
  `register_ip` VARCHAR(64) NULL DEFAULT NULL,
  `last_login_at` DATETIME NULL DEFAULT NULL,
  `last_login_ip` VARCHAR(64) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_tenant_username` (`username`),
  UNIQUE KEY `uk_users_email` (`email`),
  UNIQUE KEY `uk_users_phone` (`phone`),
  KEY `idx_users_tenant_id` (`tenant_id`),
  KEY `idx_users_account_type` (`account_type`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- user_identities（联邦身份绑定） -------------------------
-- 承载微信（小程序/公众号/开放平台）及第三方 OAuth 绑定。
-- 微信 union_id 是跨 App 的统一锚点：同一开放平台下不同 App 的 openid 通过 unionid 归一到同一 user。
CREATE TABLE IF NOT EXISTS `user_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `provider` VARCHAR(32) NOT NULL COMMENT 'wechat_miniapp/wechat_official/wechat_open/apple/google/github',
  `provider_app_id` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '具体 App（如微信 appid）',
  `external_id` VARCHAR(128) NOT NULL COMMENT '该 App 下的 openid（App 内唯一）',
  `union_id` VARCHAR(128) NULL DEFAULT NULL COMMENT '微信 unionid（跨 App 锚点）',
  `nickname` VARCHAR(128) NULL DEFAULT NULL,
  `avatar_url` VARCHAR(512) NULL DEFAULT NULL,
  `credential_json` TEXT NULL COMMENT '加密存储的 access_token 等敏感凭据',
  `verified_at` DATETIME NULL DEFAULT NULL,
  `last_login_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_identity_provider_external` (`provider`, `provider_app_id`, `external_id`),
  UNIQUE KEY `uk_identity_union` (`provider`, `union_id`),
  KEY `idx_identity_user_id` (`user_id`),
  KEY `idx_identity_union_id` (`union_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- wx_app_configs（微信应用配置） -------------------------
-- code2session / 网页授权需要 appid + secret；secret 加密存储。
CREATE TABLE IF NOT EXISTS `wx_app_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `app_type` VARCHAR(32) NOT NULL COMMENT 'miniapp/official/open',
  `app_id` VARCHAR(64) NOT NULL COMMENT '微信 appid',
  `app_secret_ciphertext` TEXT NOT NULL COMMENT '加密后的 appsecret',
  `name` VARCHAR(128) NULL DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wx_app` (`app_type`, `app_id`),
  KEY `idx_wx_app_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- verification_codes（统一验证码） -------------------------
-- 短信 / 邮箱验证码，覆盖注册、登录、绑定、找回密码等场景。code 仅存哈希。
CREATE TABLE IF NOT EXISTS `verification_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `channel` VARCHAR(16) NOT NULL COMMENT 'sms/email',
  `target` VARCHAR(255) NOT NULL COMMENT '手机号或邮箱',
  `scene` VARCHAR(32) NOT NULL COMMENT 'register/login/bind_phone/bind_email/reset_password',
  `code_hash` VARCHAR(128) NOT NULL COMMENT '验证码哈希，禁止明文',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL DEFAULT NULL,
  `attempt_count` INT NOT NULL DEFAULT 0,
  `max_attempts` INT NOT NULL DEFAULT 5,
  `request_ip` VARCHAR(64) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_code_lookup` (`channel`, `target`, `scene`),
  KEY `idx_code_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- refresh_tokens（刷新令牌） -------------------------
-- JWT access token 无状态；refresh token 落库以支持轮换与撤销。
-- session_epoch 与 users.session_epoch 绑定，用户级全局撤销时一并失效。
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `session_epoch` BIGINT NOT NULL DEFAULT 0 COMMENT '签发时的 users.session_epoch',
  `token_hash` VARCHAR(128) NOT NULL COMMENT 'refresh token 的 sha256',
  `device_id` VARCHAR(64) NULL DEFAULT NULL,
  `client_type` VARCHAR(32) NOT NULL DEFAULT 'unknown' COMMENT 'sacode/desktop/saapp_ios/saapp_android/miniapp/web',
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL DEFAULT NULL,
  `replaced_by` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '轮换链：被哪个新 token 取代',
  `last_used_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_refresh_token_hash` (`token_hash`),
  KEY `idx_refresh_user_id` (`user_id`),
  KEY `idx_refresh_expires_at` (`expires_at`),
  KEY `idx_refresh_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- user_devices（设备注册表） -------------------------
-- 移动端/桌面端/小程序设备登记，支撑推送、会话管理与「登录设备」列表。
CREATE TABLE IF NOT EXISTS `user_devices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `device_id` VARCHAR(64) NOT NULL COMMENT '客户端生成的稳定设备标识',
  `client_type` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `platform` VARCHAR(32) NULL DEFAULT NULL COMMENT 'ios/android/windows/macos/linux/web/wechat',
  `device_name` VARCHAR(128) NULL DEFAULT NULL,
  `push_token` VARCHAR(512) NULL DEFAULT NULL COMMENT '移动端推送 token（加密/脱敏存储）',
  `last_active_at` DATETIME NULL DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_user_device` (`user_id`, `device_id`),
  KEY `idx_device_client_type` (`client_type`),
  KEY `idx_device_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- login_logs（登录审计） -------------------------
CREATE TABLE IF NOT EXISTS `login_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '登录失败可能为 0',
  `login_type` VARCHAR(32) NOT NULL COMMENT 'password/sms/wechat/refresh/oauth/admin',
  `client_type` VARCHAR(32) NULL DEFAULT NULL,
  `device_id` VARCHAR(64) NULL DEFAULT NULL,
  `ip` VARCHAR(64) NULL DEFAULT NULL,
  `user_agent` VARCHAR(512) NULL DEFAULT NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `failure_reason` VARCHAR(128) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_user_started` (`user_id`, `created_at`),
  KEY `idx_login_success` (`success`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- user_preferences（跨产品偏好） -------------------------
-- 承载「登录即用」：SaCode 默认模型、SaApp 主题/语言等，按 product 维度隔离。
CREATE TABLE IF NOT EXISTS `user_preferences` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `product` VARCHAR(32) NOT NULL DEFAULT 'global' COMMENT 'global/sacode/saapp/miniapp',
  `pref_key` VARCHAR(64) NOT NULL COMMENT '如 default_model / locale / theme',
  `pref_value` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pref_user_product_key` (`user_id`, `product`, `pref_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- 第三部分：网关既有能力（Provider 路由 / 计费 / 观测）
-- =============================================================================

-- ------------------------- providers -------------------------
CREATE TABLE IF NOT EXISTS `providers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `owner_user_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `name` VARCHAR(128) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `type` VARCHAR(32) NOT NULL,
  `access_protocol` VARCHAR(32) NOT NULL DEFAULT 'openai_chat',
  `region_policy` VARCHAR(32) NOT NULL DEFAULT 'overseas',
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `description` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_providers_owner_code` (`tenant_id`, `owner_user_id`, `code`),
  KEY `idx_providers_tenant_id` (`tenant_id`),
  KEY `idx_providers_owner_user_id` (`owner_user_id`),
  KEY `idx_providers_type` (`type`),
  KEY `idx_providers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- channels -------------------------
CREATE TABLE IF NOT EXISTS `channels` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `owner_user_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `provider_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `region` VARCHAR(32) NOT NULL DEFAULT 'overseas',
  `base_url` VARCHAR(512) NOT NULL,
  `api_key_ciphertext` TEXT NOT NULL,
  `api_key_hint` VARCHAR(32) NULL DEFAULT NULL,
  `weight` INT NOT NULL DEFAULT 100,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `timeout_seconds` INT NOT NULL DEFAULT 600,
  `last_health_at` DATETIME NULL DEFAULT NULL,
  `last_latency_ms` BIGINT NOT NULL DEFAULT 0,
  `failure_count` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_channels_owner_provider` (`tenant_id`, `owner_user_id`, `provider_id`),
  KEY `idx_channels_provider_id` (`provider_id`),
  KEY `idx_channels_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- models -------------------------
CREATE TABLE IF NOT EXISTS `models` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `owner_user_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `model_name` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(128) NOT NULL,
  `provider_type` VARCHAR(32) NOT NULL,
  `context_window` INT NOT NULL DEFAULT 0,
  `input_price` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `output_price` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `cache_read_price` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `cache_write_price` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `supports_stream` TINYINT(1) NOT NULL DEFAULT 1,
  `supports_vision` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_tools` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_models_owner_name` (`tenant_id`, `owner_user_id`, `model_name`),
  KEY `idx_models_provider_type` (`provider_type`),
  KEY `idx_models_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- model_mappings -------------------------
CREATE TABLE IF NOT EXISTS `model_mappings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `owner_user_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `model_id` BIGINT UNSIGNED NOT NULL,
  `provider_id` BIGINT UNSIGNED NOT NULL,
  `channel_id` BIGINT UNSIGNED NOT NULL,
  `client_model` VARCHAR(128) NOT NULL,
  `upstream_model` VARCHAR(128) NOT NULL,
  `priority` INT NOT NULL DEFAULT 0,
  `weight` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `route_mode` VARCHAR(32) NOT NULL DEFAULT 'weighted',
  `quota_mode` VARCHAR(32) NOT NULL DEFAULT 'unlimited',
  `daily_token_limit` BIGINT NOT NULL DEFAULT 0,
  `daily_amount_limit` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `daily_request_limit` BIGINT NOT NULL DEFAULT 0,
  `auto_recover_next_day` TINYINT(1) NOT NULL DEFAULT 1,
  `health_cooldown_after_fails` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_model_mappings_owner_upstream` (`tenant_id`, `owner_user_id`, `model_id`, `provider_id`, `channel_id`, `upstream_model`, `priority`),
  KEY `idx_model_mappings_client_model` (`client_model`),
  KEY `idx_model_mappings_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- mapping_runtime_states -------------------------
CREATE TABLE IF NOT EXISTS `mapping_runtime_states` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `mapping_id` BIGINT UNSIGNED NOT NULL,
  `state` VARCHAR(32) NOT NULL DEFAULT 'available',
  `state_date` VARCHAR(16) NULL DEFAULT NULL,
  `cooldown_until` DATETIME NULL DEFAULT NULL,
  `last_failure_code` VARCHAR(64) NULL DEFAULT NULL,
  `last_failure_at` DATETIME NULL DEFAULT NULL,
  `usage_date` VARCHAR(16) NULL DEFAULT NULL,
  `used_tokens` BIGINT NOT NULL DEFAULT 0,
  `used_amount` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `used_requests` BIGINT NOT NULL DEFAULT 0,
  `last_probe_at` DATETIME NULL DEFAULT NULL,
  `consecutive_fails` INT NOT NULL DEFAULT 0,
  `last_probe_msg` VARCHAR(255) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_mapping_runtime` (`mapping_id`),
  KEY `idx_mapping_runtime_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- provider_models -------------------------
CREATE TABLE IF NOT EXISTS `provider_models` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `owner_user_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `provider_id` BIGINT UNSIGNED NOT NULL,
  `channel_id` BIGINT UNSIGNED NOT NULL,
  `upstream_model_id` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(128) NULL DEFAULT NULL,
  `metadata_json` TEXT NULL,
  `sync_status` VARCHAR(32) NOT NULL DEFAULT 'discovered',
  `discovered_at` DATETIME NULL DEFAULT NULL,
  `last_seen_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_provider_models_owner` (`tenant_id`, `owner_user_id`, `provider_id`, `channel_id`, `upstream_model_id`),
  KEY `idx_provider_models_sync_status` (`sync_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- api_keys -------------------------
-- SaCode / Desktop 数据面调用凭据；绑定 user_id，登录后自动签发。
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `scope_mode` VARCHAR(32) NOT NULL DEFAULT 'all_models',
  `key_prefix` VARCHAR(16) NOT NULL,
  `key_hash` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `expires_at` DATETIME NULL DEFAULT NULL,
  `last_used_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_api_keys_key_hash` (`key_hash`),
  KEY `idx_api_keys_user_id` (`user_id`),
  KEY `idx_api_keys_tenant_id` (`tenant_id`),
  KEY `idx_api_keys_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- api_key_model_scopes -------------------------
CREATE TABLE IF NOT EXISTS `api_key_model_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `api_key_id` BIGINT UNSIGNED NOT NULL,
  `model_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_api_key_model_scopes` (`tenant_id`, `api_key_id`, `model_id`),
  KEY `idx_api_key_model_scopes_model_id` (`model_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- quotas -------------------------
CREATE TABLE IF NOT EXISTS `quotas` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `api_key_id` BIGINT UNSIGNED NOT NULL,
  `total_amount` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `used_amount` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `frozen_amount` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `reset_period` VARCHAR(32) NOT NULL DEFAULT 'never',
  `reset_at` DATETIME NULL DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_quotas_api_key_id` (`api_key_id`),
  KEY `idx_quotas_tenant_id` (`tenant_id`),
  KEY `idx_quotas_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- call_logs -------------------------
CREATE TABLE IF NOT EXISTS `call_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `api_key_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `provider_id` BIGINT UNSIGNED NOT NULL,
  `channel_id` BIGINT UNSIGNED NOT NULL,
  `model_id` BIGINT UNSIGNED NOT NULL,
  `client_model` VARCHAR(128) NOT NULL,
  `upstream_model` VARCHAR(128) NOT NULL,
  `request_id` VARCHAR(64) NOT NULL,
  `request_protocol` VARCHAR(32) NOT NULL,
  `upstream_protocol` VARCHAR(32) NOT NULL,
  `stream` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL,
  `http_status` INT NOT NULL DEFAULT 0,
  `error_code` VARCHAR(64) NULL DEFAULT NULL,
  `error_message` TEXT NULL,
  `input_tokens` BIGINT NOT NULL DEFAULT 0,
  `output_tokens` BIGINT NOT NULL DEFAULT 0,
  `cached_tokens` BIGINT NOT NULL DEFAULT 0,
  `total_tokens` BIGINT NOT NULL DEFAULT 0,
  `precharged_amount` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `actual_amount` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `latency_ms` BIGINT NOT NULL DEFAULT 0,
  `ttft_ms` BIGINT NOT NULL DEFAULT 0,
  `started_at` DATETIME NULL DEFAULT NULL,
  `finished_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_call_logs_request_id_lookup` (`request_id`),
  KEY `idx_call_logs_tenant_user_started` (`tenant_id`, `user_id`, `started_at`),
  KEY `idx_call_logs_api_key_id` (`api_key_id`),
  KEY `idx_call_logs_model_id` (`model_id`),
  KEY `idx_call_logs_status` (`status`),
  KEY `idx_call_logs_started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------- stats_daily -------------------------
CREATE TABLE IF NOT EXISTS `stats_daily` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `stat_date` DATE NOT NULL,
  `provider_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `model_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `api_key_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `request_count` BIGINT NOT NULL DEFAULT 0,
  `success_count` BIGINT NOT NULL DEFAULT 0,
  `error_count` BIGINT NOT NULL DEFAULT 0,
  `input_tokens` BIGINT NOT NULL DEFAULT 0,
  `output_tokens` BIGINT NOT NULL DEFAULT 0,
  `cached_tokens` BIGINT NOT NULL DEFAULT 0,
  `total_tokens` BIGINT NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `latency_sum_ms` BIGINT NOT NULL DEFAULT 0,
  `latency_p95_ms` BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_stats_daily_dimension_v2` (`tenant_id`, `stat_date`, `provider_id`, `model_id`, `api_key_id`),
  KEY `idx_stats_daily_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 第四部分：种子数据（最小可用）
-- =============================================================================

-- 默认租户
INSERT INTO `tenants` (`id`, `created_at`, `updated_at`, `name`, `slug`, `status`, `description`)
SELECT 1, NOW(), NOW(), 'Default Tenant', 'default', 'active', '统一账号体系默认租户'
WHERE NOT EXISTS (SELECT 1 FROM `tenants` WHERE `id` = 1);

-- 初始管理员（密码需在部署时用 bcrypt 重新生成后替换占位哈希）
-- 占位哈希必须在上线前替换为真实 bcrypt 值并轮换初始口令。
INSERT INTO `users`
  (`id`, `created_at`, `updated_at`, `tenant_id`, `username`, `name`, `email`, `email_verified`,
   `password_hash`, `role`, `account_type`, `register_source`, `status`, `session_epoch`)
SELECT 1, NOW(), NOW(), 1, 'admin', 'Administrator', 'admin@example.com', 1,
       '$2a$10$REPLACE_WITH_REAL_BCRYPT_HASH_ON_DEPLOY', 'admin', 'admin', 'admin', 'active', 0
WHERE NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = 1);

-- =============================================================================
-- 附：统一账号体系 → 各产品映射速查
-- =============================================================================
-- 网关管理后台 : users(role=admin) + POST /api/admin/login → Redis session
-- SaCode CLI/桌面: users + POST /api/auth/login → api_keys(数据面) + refresh_tokens
--                  → GET /v1/models 拉取模型 → user_preferences.default_model
-- SaApp 移动端  : users(phone/wechat) + verification_codes/user_identities
--                  → JWT access + refresh_tokens + user_devices
-- 微信小程序    : wx.login code → wx_app_configs.code2session → user_identities(openid/unionid)
--                  → users → JWT access + refresh_tokens
-- 全局撤销      : users.session_epoch += 1 → 所有 refresh_tokens 校验失败
-- =============================================================================
