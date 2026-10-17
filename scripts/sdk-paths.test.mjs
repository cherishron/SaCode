import test from "node:test";
import assert from "node:assert/strict";
import { sdkRoot, runtimeLibDir, pathEntries } from "./sdk-paths.mjs";

// 这两条判据决定装出来的 dsh 缺不缺 DLL：默认 SDK 根目录写错，包里没有运行期库；
// PATH 切错，MinGW/OpenSSL 那几颗在 Windows 上永远搜不到（盘符后面的冒号不是分隔符）。
test("默认 SDK 根目录不丢路径分隔符", () => {
  assert.equal(sdkRoot({}), "D:/Program Files/HuaWei/Cangjie");
});

test("CANGJIE_HOME 覆盖优先于默认值", () => {
  assert.equal(sdkRoot({ CANGJIE_HOME: "E:/sdk" }), "E:/sdk");
});

test("运行期库目录挂在解析出来的 SDK 根下", () => {
  const rt = runtimeLibDir({ CANGJIE_HOME: "E:/sdk" });
  assert.ok(rt.startsWith("E:"));
  assert.ok(rt.includes("runtime"));
  assert.ok(rt.endsWith("windows_x86_64_cjnative"));
});

test("Windows 的 PATH 只按分号切，盘符冒号不是分隔符", () => {
  assert.deepEqual(pathEntries("C:\\tools;D:\\Program Files\\x", "win32"), ["C:\\tools", "D:\\Program Files\\x"]);
});

test("非 Windows 平台按冒号切", () => {
  assert.deepEqual(pathEntries("/usr/bin:/bin", "linux"), ["/usr/bin", "/bin"]);
});

test("空值与多余分隔符不产生空目录项", () => {
  assert.deepEqual(pathEntries("", "win32"), []);
  assert.deepEqual(pathEntries(undefined, "win32"), []);
  assert.deepEqual(pathEntries("A;;B;", "win32"), ["A", "B"]);
});
