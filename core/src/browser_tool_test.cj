package core

import std.collection.ArrayList

func testBrowserToolSpecsCoverCoreVerbs(): Unit {
    let specs = ArrayList<ToolSpec>(browserToolSpecs())
    let names = ArrayList<String>()
    for (s in specs) {
        names.add(s.name)
    }
    @Assert(names.contains("browser.tabs.list"))
    @Assert(names.contains("browser.tabs.get"))
    @Assert(names.contains("browser.screenshot"))
    @Assert(names.contains("browser.snapshot"))
    @Assert(names.contains("browser.navigate"))
    @Assert(names.contains("browser.click"))
    @Assert(names.contains("browser.fill"))
    @Assert(names.contains("browser.press_key"))
    @Assert(names.contains("browser.scroll"))
    @Assert(names.contains("browser.evaluate"))
    @Assert(names.contains("browser.tabs.new"))
    @Assert(names.contains("browser.tabs.finalize"))
}

func testBrowserWriteToolsRequireApproval(): Unit {
    let specs = browserToolSpecs()
    for (s in specs) {
        if (s.name == "browser.navigate" || s.name == "browser.click" ||
            s.name == "browser.fill" || s.name == "browser.press_key" ||
            s.name == "browser.scroll" || s.name == "browser.evaluate" ||
            s.name == "browser.tabs.new" || s.name == "browser.tabs.finalize") {
            @Assert(s.needsApproval)
        }
        if (s.name == "browser.tabs.list" || s.name == "browser.tabs.get" ||
            s.name == "browser.screenshot" || s.name == "browser.snapshot") {
            @Assert(!s.needsApproval)
        }
    }
}

func testBrowserToolSpecCountIs12(): Unit {
    let specs = browserToolSpecs()
    @Assert(specs.size == 12)
}
