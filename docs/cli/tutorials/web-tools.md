# Web search and fetch

Learn how to search and fetch content from the web using SaCode CLI.

## Overview

SaCode CLI provides web capabilities through the `@sacode/capabilities` package. The AI model can search the web, fetch page content, and make HTTP requests.

## Available web tools

| Tool           | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `web_search`   | DuckDuckGo web search with language and time filtering          |
| `web_fetch`    | Fetch and extract web page content                              |
| `http_request` | Full HTTP client with all methods, custom headers, and timeouts |

## Web search

Search the web for current information:

Terminal window

```bash
sacode chat -m "搜索最新的 TypeScript 最佳实践"
```

The AI uses the `web_search` tool with configurable parameters:

- **query** — Search query string
- **numResults** — Number of results (default: 8)
- **tbs** — Time filter (e.g., `qdr:m3` for past 3 months)
- **lang** — Language code

## Web fetch

Fetch content from a specific URL:

Terminal window

```bash
sacode chat -m "获取 https://example.com 的内容摘要"
```

The `web_fetch` tool automatically detects content types (JSON, HTML, text) and extracts relevant information.

## HTTP requests

Make arbitrary HTTP requests:

Terminal window

```bash
sacode chat -m "发送 POST 请求到 https://api.example.com/users"
```

The `http_request` tool supports:

- All HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Custom headers
- Request body (JSON, form data)
- Timeout configuration
- Redirect following (max 5 by default)

## Configuration

Terminal window

```env
CAP_WEB_ENABLED=true

# Web search
CAP_WEB_SEARCH_ENABLED=true
CAP_WEB_SEARCH_PROVIDER=duckduckgo
CAP_WEB_SEARCH_TIMEOUT=10000

# Web fetch
CAP_WEB_FETCH_ENABLED=true
CAP_WEB_FETCH_DEFAULT_TIMEOUT=30000

# HTTP requests
CAP_WEB_HTTP_ENABLED=true
CAP_WEB_HTTP_DEFAULT_TIMEOUT=30000
CAP_WEB_HTTP_MAX_REDIRECTS=5
```

## Next steps

- **[File management](/docs/cli/tutorials/file-management/)** — Work with local files
- **[Tools reference](/docs/reference/tools/)** — Complete tool documentation
- **[Execute shell commands](/docs/cli/tutorials/shell-commands/)** — Run system commands
