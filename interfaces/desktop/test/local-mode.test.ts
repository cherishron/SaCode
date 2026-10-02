import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocalProviderPayload,
  cloudFeatureDisableReason,
  emptyLocalProviderForm,
  inferLocalMode,
  LOCAL_PROVIDER_EMPTY_HINT,
  localModeBannerHint,
  localModeBannerText,
  parseModelsText,
  validateLocalProviderForm,
} from '../src/ui/logic/local-mode.ts';

// ---- inferLocalMode（C1 状态推断） ----

test('未登录默认 local', () => {
  assert.equal(inferLocalMode({ account: null }), 'local');
  assert.equal(inferLocalMode({ account: { logged_in: false } }), 'local');
  assert.equal(
    inferLocalMode({ account: { logged_in: false }, accountError: 'x' }),
    'local',
    '从未登录时云侧报错不降级',
  );
});

test('登录成功 → online', () => {
  assert.equal(inferLocalMode({ account: { logged_in: true } }), 'online');
});

test('登录过但服务报错 → cloud_degraded', () => {
  assert.equal(
    inferLocalMode({
      account: { logged_in: true },
      cloudServiceError: 'entitlement unavailable',
    }),
    'cloud_degraded',
  );
  assert.equal(
    inferLocalMode({
      account: null,
      accountError: 'status failed',
      everLoggedIn: true,
    }),
    'cloud_degraded',
    '曾登录 + 状态接口失败 → cloud_degraded',
  );
  assert.equal(
    inferLocalMode({
      account: { logged_in: false, logged_in_at: '2026-01-01' },
      cloudServiceError: 'boom',
    }),
    'cloud_degraded',
    'logged_in_at 表明登录过',
  );
});

// ---- 横幅文案（C1） ----

test('localModeBannerText 三态一行文案', () => {
  assert.equal(localModeBannerText('local'), '本地模式 · 使用本地模型');
  assert.equal(localModeBannerText('online'), '云增强已连接');
  assert.equal(localModeBannerText('cloud_degraded'), '云增强不可用');
});

test('localModeBannerHint 均为一行补充', () => {
  assert.ok(localModeBannerHint('local').length > 0);
  assert.ok(localModeBannerHint('online').length > 0);
  assert.ok(localModeBannerHint('cloud_degraded').length > 0);
});

// ---- 云能力置灰（C4） ----

test('cloudFeatureDisableReason：online 可用，其余置灰有原因', () => {
  assert.equal(cloudFeatureDisableReason('online'), null);
  assert.ok(cloudFeatureDisableReason('local')?.includes('可选'));
  assert.ok(cloudFeatureDisableReason('cloud_degraded')?.includes('不可用'));
});

// ---- 向导 models 解析（C5） ----

test('parseModelsText 每行一个，忽略空行与空白', () => {
  assert.deepEqual(parseModelsText('qwen3:8b\n\n  qwen3:32b  \r\nllama3'), [
    'qwen3:8b',
    'qwen3:32b',
    'llama3',
  ]);
  assert.deepEqual(parseModelsText(''), []);
});

test('buildLocalProviderPayload 组装 createLocalProvider 入参', () => {
  const payload = buildLocalProviderPayload({
    name: ' ollama-local ',
    api_type: 'yapi',
    base_url: ' http://127.0.0.1:11434/v1 ',
    api_key: ' sk-test ',
    models_text: 'qwen3:8b\nqwen3:32b',
    thinking: true,
    reasoning_effort: 'high',
  });
  assert.deepEqual(payload, {
    name: 'ollama-local',
    api_type: 'yapi',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: 'sk-test',
    models: ['qwen3:8b', 'qwen3:32b'],
    thinking: true,
    reasoning_effort: 'high',
  });
});

test('buildLocalProviderPayload 缺必填返回 null', () => {
  const base = emptyLocalProviderForm();
  assert.equal(buildLocalProviderPayload(base), null);
  assert.equal(
    buildLocalProviderPayload({ ...base, name: 'a', base_url: 'https://x.test/v1' }),
    null,
    '无 models 也不可提交',
  );
});

test('validateLocalProviderForm 给出可读原因', () => {
  const base = emptyLocalProviderForm();
  assert.match(validateLocalProviderForm(base) ?? '', /名称不能为空/);
  assert.match(
    validateLocalProviderForm({ ...base, name: '中文名' }) ?? '',
    /字母、数字/,
  );
  assert.match(
    validateLocalProviderForm({
      ...base,
      name: 'ok-name',
      base_url: 'https://api.example.com/v1',
    }) ?? '',
    /模型 ID/,
  );
  assert.equal(
    validateLocalProviderForm({
      ...base,
      name: 'deepseek',
      api_type: 'openai',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-x',
      models_text: 'deepseek/deepseek-v4-flash',
    }),
    null,
  );
});

test('emptyLocalProviderForm 默认 medium 档且空状态文案就绪', () => {
  assert.equal(emptyLocalProviderForm().reasoning_effort, 'medium');
  assert.equal(emptyLocalProviderForm().thinking, false);
  assert.equal(emptyLocalProviderForm().api_type, 'openai');
  assert.ok(LOCAL_PROVIDER_EMPTY_HINT.includes('3 分钟'));
});
