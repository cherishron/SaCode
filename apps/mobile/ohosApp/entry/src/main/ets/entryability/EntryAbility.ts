/**
 * EntryAbility.ts - 鸿蒙端入口 Ability
 *
 * 在 onCreate 中调用 NAPI initKuikly() 初始化 Kuikly 运行时，
 * 传入 appId="com.sa.demo"、debug=true。
 *
 * 对应 design.md 2.4.3 EntryAbility 生命周期桥接
 * 对应 tasks.md 任务 7.1
 * 对标 Android 端 AndroidApplication.onCreate 初始化链路
 */

import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';
import hilog from '@ohos.hilog';

// NAPI 模块引用（由 napi_init.cpp 导出）
import Napi from 'entry/KuiklyNapi';

const TAG = 'EntryAbility';
const DOMAIN = 0x0001;

// Kuikly 初始化参数（对齐 Android 端 mapOf("appId" to 1, "debug" to 1)）
const KUIKLY_APP_ID = 'com.sa.demo';
const KUIKLY_DEBUG = true;

export default class EntryAbility extends UIAbility {
    onCreate(want, launchParam) {
        hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onCreate');

        // 初始化 Kuikly Native 运行时
        // 对应 design.md C1：NAPI initKuikly 调用
        // 对应 spec 5.2.1.2：NAPI 桥接入口
        try {
            const handler = Napi.initKuikly();
            if (handler > 0) {
                hilog.info(DOMAIN, TAG, 'Kuikly runtime initialized, handler=%{public}d', handler);
                // 存储 handler 供 Index.ets 中的 MyNativeManager.loadNative() 使用
                AppStorage.setOrCreate('kuikly_handler', handler);
            } else {
                hilog.error(DOMAIN, TAG,
                    'Kuikly runtime init failed, handler=%{public}d (ASSET_MISSING/PAGE_INIT_ERROR)', handler);
                AppStorage.setOrCreate('kuikly_handler', handler);
            }
        } catch (e) {
            hilog.error(DOMAIN, TAG, 'Kuikly runtime init exception: %{public}s', JSON.stringify(e));
            AppStorage.setOrCreate('kuikly_handler', -1);
        }
    }

    onWindowStageCreate(windowStage: window.WindowStage) {
        hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onWindowStageCreate');

        // 设置全屏沉浸式窗口（安全区规避，spec 5.3.1.7）
        // 对应 design.md 2.4.5：窗口与安全区
        try {
            const mainWindow = windowStage.getMainWindowSync();
            mainWindow.setWindowLayoutFullScreen(true);
        } catch (e) {
            hilog.error(DOMAIN, TAG, 'Failed to set fullscreen: %{public}s', JSON.stringify(e));
        }

        windowStage.loadContent('pages/Index', (err) => {
            if (err.code) {
                hilog.error(DOMAIN, TAG, 'Failed to load content. Cause: %{public}s', JSON.stringify(err));
                return;
            }
            hilog.info(DOMAIN, TAG, '%{public}s', 'Loaded content successfully');
        });
    }

    onWindowStageDestroy() {
        hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onWindowStageDestroy');
    }

    onForeground() {
        hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onForeground');
        // 对应 design.md 2.4.3：经 AppStorage 事件通道写入 foreground 事件
        // ArkUI 组件树生命周期与 UIAbility 天然联动，壳层不重复实现 onResume 语义
        AppStorage.setOrCreate('kuikly_lifecycle', 'foreground');
    }

    onBackground() {
        hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onBackground');
        // 对应 design.md 2.4.3：经 AppStorage 事件通道写入 background 事件
        AppStorage.setOrCreate('kuikly_lifecycle', 'background');
    }

    onDestroy() {
        hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onDestroy');
        // 对应 design.md 2.4.3：补齐模板缺失的 onDestroy 分支
        // 经 AppStorage 事件通道写入 destroy 事件通知容器
        AppStorage.setOrCreate('kuikly_lifecycle', 'destroy');
    }
}
