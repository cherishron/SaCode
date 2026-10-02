// SaCode Desktop — 自动更新（D6，更新源：GitHub Releases）
//
// 通过 @tauri-apps/plugin-updater 检查并安装更新。
// 防御式设计：插件未注册 / 非桌面环境 / 网络失败时静默降级，绝不阻塞主流程。
//
// 启用条件（均在 src-tauri/tauri.conf.json 中配置）：
//   - bundle.createUpdaterArtifacts = true
//   - plugins.updater.endpoints / pubkey
// 后端签名私钥走 CI secret：TAURI_UPDATER_PRIVATE_KEY。

import { check, type Update } from '@tauri-apps/plugin-updater'

export type UpdateCheckResult =
  | { status: 'up-to-date'; current: string }
  | { status: 'update-available'; update: Update; current: string }
  | { status: 'error'; reason: string }

/** 检查是否有可用更新。插件缺失或环境不支持时返回 error，由调用方决定降级行为。 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check()
    if (!update) {
      return { status: 'up-to-date', current: 'unknown' }
    }
    return {
      status: 'update-available',
      update,
      current: update.currentVersion,
    }
  } catch (err) {
    return { status: 'error', reason: String(err) }
  }
}

/**
 * 下载并安装更新。可选 onProgress 回调上报下载进度（字节）。
 * 安装完成后需重启应用方可生效，重启由调用方决定时机（如提示用户后 relaunch）。
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  if (!onProgress) {
    await update.downloadAndInstall()
    return
  }
  let downloaded = 0
  let total = 0
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0
      downloaded = 0
      onProgress(downloaded, total)
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      onProgress(downloaded, total)
    } else if (event.event === 'Finished') {
      onProgress(total || downloaded, total || downloaded)
    }
  })
}
