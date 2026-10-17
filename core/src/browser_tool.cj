package core

import std.collection.ArrayList

// 浏览器工具声明：模型可见的工具名、Schema 和审批标记。
// 只读操作（list/get/screenshot/snapshot）免审批；写操作一律需审批。
// evaluate 不伪装只读：即使参数是纯查询也需审批，防止页面副作用。

let BROWSER_TABS_LIST_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"browserId\":{\"type\":\"string\"}}}"
let BROWSER_TABS_GET_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"browserId\",\"tabId\"],\"properties\":{\"browserId\":{\"type\":\"string\"},\"tabId\":{\"type\":\"integer\"}}}"
let BROWSER_TABS_NEW_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"url\"],\"properties\":{\"browserId\":{\"type\":\"string\"},\"url\":{\"type\":\"string\"}}}"
let BROWSER_TABS_FINALIZE_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"keep\"],\"properties\":{\"browserId\":{\"type\":\"string\"},\"keep\":{\"type\":\"array\",\"items\":{\"type\":\"integer\"}}}}"
let BROWSER_NAVIGATE_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"url\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"url\":{\"type\":\"string\"}}}"
let BROWSER_SCREENSHOT_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"clip\":{\"type\":\"object\",\"properties\":{\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"width\":{\"type\":\"number\"},\"height\":{\"type\":\"number\"}}},\"fullPage\":{\"type\":\"boolean\"}}}"
let BROWSER_SNAPSHOT_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"}}}"
let BROWSER_CLICK_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"ref\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"}}}"
let BROWSER_FILL_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"ref\",\"text\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"ref\":{\"type\":\"string\"},\"text\":{\"type\":\"string\"}}}"
let BROWSER_PRESS_KEY_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"key\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"key\":{\"type\":\"string\"}}}"
let BROWSER_SCROLL_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"}}}"
let BROWSER_EVALUATE_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"script\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"script\":{\"type\":\"string\"}}}"

public func browserToolSpecs(): Array<ToolSpec> {
    let specs = ArrayList<ToolSpec>()
    specs.add(ToolSpec("browser.tabs.list", "列出当前 profile 中已打开的 HTTP(S) 标签页。", BROWSER_TABS_LIST_SCHEMA, false))
    specs.add(ToolSpec("browser.tabs.get", "获取指定标签页的标题、URL 和状态。", BROWSER_TABS_GET_SCHEMA, false))
    specs.add(ToolSpec("browser.tabs.new", "在用户浏览器中打开新标签页并导航到指定 URL。", BROWSER_TABS_NEW_SCHEMA, true))
    specs.add(ToolSpec("browser.tabs.finalize", "结束本轮操作：关闭未列入 keep 的 Agent 创建标签页，释放未列入的认领标签页。", BROWSER_TABS_FINALIZE_SCHEMA, true))
    specs.add(ToolSpec("browser.navigate", "将已认领的标签页导航到指定 URL。", BROWSER_NAVIGATE_SCHEMA, true))
    specs.add(ToolSpec("browser.screenshot", "截取标签页当前视口的 JPEG 图像。", BROWSER_SCREENSHOT_SCHEMA, false))
    specs.add(ToolSpec("browser.snapshot", "获取标签页的 AI 无障碍快照，用于语义定位元素。", BROWSER_SNAPSHOT_SCHEMA, false))
    specs.add(ToolSpec("browser.click", "点击标签页中的元素（按 ref 或坐标）。", BROWSER_CLICK_SCHEMA, true))
    specs.add(ToolSpec("browser.fill", "在标签页的输入框中填写文本。", BROWSER_FILL_SCHEMA, true))
    specs.add(ToolSpec("browser.press_key", "在标签页中按下键盘键。", BROWSER_PRESS_KEY_SCHEMA, true))
    specs.add(ToolSpec("browser.scroll", "在标签页中滚动页面。", BROWSER_SCROLL_SCHEMA, true))
    specs.add(ToolSpec("browser.evaluate", "在标签页中执行 JavaScript。需审批，即使脚本看起来是只读的。", BROWSER_EVALUATE_SCHEMA, true))
    return specs.toArray()
}
