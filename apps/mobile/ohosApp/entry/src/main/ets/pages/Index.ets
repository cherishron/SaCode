/**
 * Index.ets - Kuikly 容器页面渲染入口
 *
 * 替换原模板占位页，承载 Kuikly 组件加载 RemoteDevicesPage。
 * 实现加载状态机（Loading → Loaded / Error）与错误兜底 UI。
 *
 * 对应 design.md A3、2.4.4 状态机
 * 对应 tasks.md 任务 7.3
 * 对标 Android 端 MainActivity.loadPage("RemoteDevicesPage")
 */

import { Kuikly, KuiklyNativeManager, KRNativeRenderController } from '@kuikly/render';
import { KuiklyViewDelegate } from '../kuikly/KuiklyViewDelegate';
import hilog from '@ohos.hilog';

const TAG = 'KuiklyContainer';
const DOMAIN = 0x0001;
const PAGE_NAME = 'RemoteDevicesPage';
// 页面参数对齐 Android 端 mapOf("appId" to 1, "debug" to 1)
const PAGE_DATA: Record<string, number> = { appId: 1, debug: 1 };
// 加载超时阈值（10s，spec 5.3.3.4）
const LOAD_TIMEOUT_MS = 10000;
// Loading 占位展示阈值（500ms，spec 5.3.1.5）
const LOADING_THRESHOLD_MS = 500;

// 加载状态枚举（对应 design.md 2.4.4 状态机）
enum LoadState {
    Loading,
    Loaded,
    Error
}

// 错误分类枚举（对应 design.md A3 异常映射）
enum LoadError {
    ASSET_MISSING,    // so 缺失/损坏
    PAGE_INIT_ERROR,  // 运行时初始化异常
    PAGE_NOT_FOUND,   // 路由名未注册
    TIMEOUT,          // 加载超时
    RENDER_ERROR      // 渲染期异常（隔离不退出）
}

// 错误文案映射
const ERROR_MESSAGES: Record<LoadError, string> = {
    [LoadError.ASSET_MISSING]: '产物缺失：libshared.so 加载失败',
    [LoadError.PAGE_INIT_ERROR]: '初始化异常：Kuikly 运行时初始化失败',
    [LoadError.PAGE_NOT_FOUND]: '页面未找到：RemoteDevicesPage 路由未注册',
    [LoadError.TIMEOUT]: '加载超时：页面加载超过 10 秒',
    [LoadError.RENDER_ERROR]: '渲染异常：组件渲染出错'
};

// 全局 KuiklyNativeManager 单例
// 对应 design.md A1：MyNativeManager.loadNative() → Napi.initKuikly()
class MyNativeManager extends KuiklyNativeManager {
    protected loadNative(): number {
        // 由 EntryAbility.onCreate 已调用 Napi.initKuikly() 初始化运行时
        // 此处返回已初始化的句柄（通过 AppStorage 传递）
        const handler = AppStorage.get<number>('kuikly_handler') ?? -1;
        hilog.info(DOMAIN, TAG, 'MyNativeManager.loadNative: handler=%{public}d', handler);
        return handler;
    }
}

const globalNativeManager = new MyNativeManager();

@Entry
@Component
struct Index {
    @State loadState: LoadState = LoadState.Loading;
    @State loadError: LoadError = LoadError.ASSET_MISSING;
    @State showLoadingPlaceholder: boolean = false;
    @State controller: KRNativeRenderController | null = null;

    private delegate: KuiklyViewDelegate = new KuiklyViewDelegate();
    private loadBeginTime: number = 0;
    private timeoutId: number = -1;

    aboutToAppear(): void {
        hilog.info(DOMAIN, TAG, 'aboutToAppear: loading page %{public}s', PAGE_NAME);
        this.loadBeginTime = Date.now();
        this.loadState = LoadState.Loading;

        // 500ms 后展示 Loading 占位（spec 5.3.1.5）
        setTimeout(() => {
            if (this.loadState === LoadState.Loading) {
                this.showLoadingPlaceholder = true;
                hilog.info(DOMAIN, TAG, 'Loading placeholder shown (>500ms)');
            }
        }, LOADING_THRESHOLD_MS);

        // 10s 超时检测（spec 5.3.3.4）
        this.timeoutId = setTimeout(() => {
            if (this.loadState === LoadState.Loading) {
                this.loadState = LoadState.Error;
                this.loadError = LoadError.TIMEOUT;
                this.showLoadingPlaceholder = false;
                hilog.error(DOMAIN, TAG, 'Page load timeout (>10s): %{public}s', PAGE_NAME);
            }
        }, LOAD_TIMEOUT_MS);
    }

    aboutToDisappear(): void {
        hilog.info(DOMAIN, TAG, 'aboutToDisappear');
        if (this.timeoutId !== -1) {
            clearTimeout(this.timeoutId);
        }
    }

    /**
     * Kuikly 控制器就绪回调
     *
     * 对应 design.md A3：onControllerReadyCallback
     */
    onControllerReady(controller: KRNativeRenderController | null): void {
        this.controller = controller;
        if (controller !== null) {
            hilog.info(DOMAIN, TAG, 'Controller ready');
        } else {
            hilog.error(DOMAIN, TAG, 'Controller ready but null — PAGE_INIT_ERROR');
            this.loadState = LoadState.Error;
            this.loadError = LoadError.PAGE_INIT_ERROR;
            this.showLoadingPlaceholder = false;
        }
    }

    /**
     * 返回键桥接
     *
     * 对应 design.md A4、spec 5.3.1.4：
     *   转发 controller.sendBackPressEvent() 至 Kuikly 页面
     *   true=已消费不退出 / false=系统默认
     */
    onBackPress(): boolean {
        if (this.controller === null) {
            hilog.info(DOMAIN, TAG, 'onBackPress: controller not ready, return false');
            return false;
        }
        try {
            const consumed = this.controller.sendBackPressEvent();
            hilog.info(DOMAIN, TAG, 'onBackPress: consumed=%{public}s', consumed ? 'true' : 'false');
            return consumed;
        } catch (e) {
            hilog.error(DOMAIN, TAG, 'onBackPress exception: %{public}s', JSON.stringify(e));
            return false;
        }
    }

    /**
     * 重试加载（Error → Loading 状态复位）
     *
     * 对应 design.md 2.4.4：Error → Loading（点击重试复位）
     */
    retryLoad(): void {
        hilog.info(DOMAIN, TAG, 'Retry loading page: %{public}s', PAGE_NAME);
        this.loadState = LoadState.Loading;
        this.loadError = LoadError.ASSET_MISSING;
        this.showLoadingPlaceholder = false;
        this.loadBeginTime = Date.now();

        // 重新设置超时检测
        if (this.timeoutId !== -1) {
            clearTimeout(this.timeoutId);
        }
        this.timeoutId = setTimeout(() => {
            if (this.loadState === LoadState.Loading) {
                this.loadState = LoadState.Error;
                this.loadError = LoadError.TIMEOUT;
                hilog.error(DOMAIN, TAG, 'Retry load timeout: %{public}s', PAGE_NAME);
            }
        }, LOAD_TIMEOUT_MS);
    }

    build() {
        Stack() {
            if (this.loadState === LoadState.Loading) {
                // Loading 态：展示 Loading 占位（>500ms 后）
                if (this.showLoadingPlaceholder) {
                    Column() {
                        LoadingProgress()
                            .width(48)
                            .height(48)
                            .color('#0052D9')
                        Text('正在加载 SaCode...')
                            .fontSize(16)
                            .fontColor('#666666')
                            .margin({ top: 16 })
                    }
                    .width('100%')
                    .height('100%')
                    .justifyContent(FlexAlign.Center)
                    .backgroundColor('#FFFFFF')
                }

                // Kuikly 组件（始终挂载，加载完成后自动渲染）
                Kuikly({
                    pageName: PAGE_NAME,
                    pageData: PAGE_DATA,
                    delegate: this.delegate,
                    nativeManager: globalNativeManager,
                    initialSize: { width: '100%', height: '100%' },
                    onControllerReadyCallback: (controller: KRNativeRenderController | null) => {
                        this.onControllerReady(controller);
                    }
                })
                .width('100%')
                .height('100%')
                .onPageLoadComplete((isSucceed: boolean) => {
                    if (this.timeoutId !== -1) {
                        clearTimeout(this.timeoutId);
                    }
                    if (isSucceed) {
                        this.loadState = LoadState.Loaded;
                        this.showLoadingPlaceholder = false;
                        const costMs = Date.now() - this.loadBeginTime;
                        hilog.info(DOMAIN, TAG,
                            'Page loaded successfully: %{public}s, cost=%{public}dms', PAGE_NAME, costMs);
                    } else {
                        this.loadState = LoadState.Error;
                        this.loadError = LoadError.PAGE_NOT_FOUND;
                        this.showLoadingPlaceholder = false;
                        hilog.error(DOMAIN, TAG, 'Page load failed: %{public}s', PAGE_NAME);
                    }
                })
            } else if (this.loadState === LoadState.Loaded) {
                // Loaded 态：Kuikly 页面已渲染完成
                Kuikly({
                    pageName: PAGE_NAME,
                    pageData: PAGE_DATA,
                    delegate: this.delegate,
                    nativeManager: globalNativeManager,
                    initialSize: { width: '100%', height: '100%' },
                    onControllerReadyCallback: (controller: KRNativeRenderController | null) => {
                        this.onControllerReady(controller);
                    }
                })
                .width('100%')
                .height('100%')
            } else {
                // Error 态：错误兜底 UI（spec 5.3.1.6）
                Column() {
                    Text(ERROR_MESSAGES[this.loadError])
                        .fontSize(16)
                        .fontColor('#FF4D4F')
                        .textAlign(TextAlign.Center)
                        .margin({ bottom: 24 })

                    Button('重试')
                        .fontSize(16)
                        .fontColor('#FFFFFF')
                        .backgroundColor('#0052D9')
                        .onClick(() => {
                            this.retryLoad();
                        })
                }
                .width('100%')
                .height('100%')
                .justifyContent(FlexAlign.Center)
                .backgroundColor('#FFFFFF')
            }
        }
        .width('100%')
        .height('100%')
    }
}
