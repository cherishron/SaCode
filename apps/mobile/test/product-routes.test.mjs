import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const mobile = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, mobile), 'utf8');

test('component demo source and production entry points are removed', () => {
  assert.equal(existsSync(new URL('shared/src/commonMain/kotlin/com/sa/demo/saui/catalog/SaUICatalogPage.kt', mobile)), false);
  const login = read('shared/src/commonMain/kotlin/com/sa/demo/feature/login/LoginPage.kt');
  const android = read('androidApp/src/main/java/com/sa/demo/MainActivity.kt');
  assert.doesNotMatch(login, /SaUICatalogPage|打开组件库 Demo/);
  assert.doesNotMatch(android, /SaUICatalogPage|saui\.catalog/);
  assert.match(android, /registerPageRouter\("RemoteDevicesPage"\)/);
  assert.doesNotMatch(android, /registerPageRouter\("(?:LoginPage|ChatPage|AgentPage|BindAgentPage|AccountPage)"\)/);
  assert.doesNotMatch(android, /OAuthBridge|handleOAuthIntent|loadPage\("LoginPage"\)/);
  assert.match(android, /ProductRoutes\.START_PAGE/);
  assert.match(android, /ProductRoutes\.resolve\(requestedPage\)/);
  const devices = read('shared/src/commonMain/kotlin/com/sa/demo/feature/agent/RemoteDevicesPage.kt');
  assert.doesNotMatch(devices, /AuthRepository\.storedUsername|LocalSessionEpoch|HomeTabs\.build/);
  assert.match(devices, /LocalDeviceProfile\(SecureStores\.get\(\)\)/);
  assert.doesNotMatch(read('androidApp/src/main/AndroidManifest.xml'), /android:host="oauth"/);
});

test('HarmonyOS starts the SaCode device page instead of legacy login or demo', () => {
  const index = read('ohosApp/entry/src/main/ets/pages/Index.ets');
  assert.match(index, /const PAGE_NAME = 'RemoteDevicesPage'/);
  assert.doesNotMatch(index, /SaUICatalogPage|SaUI Demo/);
});

test('shared components and installed application identity remain intact', () => {
  for (const path of ['shared/src/commonMain/kotlin/com/sa/demo/saui/base/SaButton.kt', 'shared/src/commonMain/kotlin/com/sa/demo/saui/chat/ChatMessageBubble.kt']) {
    assert.ok(existsSync(new URL(path, mobile)), path);
  }
  assert.match(read('androidApp/build.gradle.kts'), /applicationId = "com\.sa\.demo"/);
});
