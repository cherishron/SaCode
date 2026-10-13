// 一份目标映射供构建、打包与 CI 共用；OHOS 不是 GNU Linux 包的别名。
export const platforms = {
  'win32-x64': { triple: 'x86_64-w64-mingw32', folder: 'windows_x86_64_cjnative', asset: 'windows-x64', os: 'win32', cpu: 'x64', suffix: '.exe' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', folder: 'linux_x86_64_cjnative', asset: 'linux-x64', os: 'linux', cpu: 'x64', suffix: '' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu', folder: 'linux_aarch64_cjnative', asset: 'linux-aarch64', os: 'linux', cpu: 'arm64', suffix: '' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', folder: 'macos_x86_64_cjnative', asset: 'mac-x64', os: 'darwin', cpu: 'x64', suffix: '' },
  'darwin-arm64': { triple: 'aarch64-apple-darwin', folder: 'macos_aarch64_cjnative', asset: 'mac-aarch64', os: 'darwin', cpu: 'arm64', suffix: '' },
  'ohos-arm64': { triple: 'aarch64-linux-ohos', folder: 'ohos_aarch64_cjnative', asset: 'ohos-aarch64', os: 'ohos', cpu: 'arm64', suffix: '' },
  'ohos-x64': { triple: 'x86_64-linux-ohos', folder: 'ohos_x86_64_cjnative', asset: 'ohos-x64', os: 'ohos', cpu: 'x64', suffix: '' },
};
export function selectedPlatform(target = process.env.SACODE_TARGET || `${process.platform}-${process.arch}`) {
  if (!platforms[target]) throw new Error(`未支持的平台/架构 ${target}`);
  return { ...platforms[target], target };
}
