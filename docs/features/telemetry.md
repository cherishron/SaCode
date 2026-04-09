# Telemetry

Usage and performance metrics for SaCode CLI.

## Overview

SaCode collects anonymous usage and performance metrics to help improve the product. Telemetry data is used for:

- Identifying performance bottlenecks
- Understanding feature usage patterns
- Improving error handling and stability

## What is collected

| Category        | Data                                | Purpose                            |
| --------------- | ----------------------------------- | ---------------------------------- |
| **Usage**       | Command names, feature usage        | Understand which features are used |
| **Performance** | Request latency, response times     | Identify slow operations           |
| **Errors**      | Error types, frequency              | Improve stability                  |
| **Environment** | Node.js version, OS, SaCode version | Compatibility tracking             |

## What is NOT collected

| Category          | Excluded                     |
| ----------------- | ---------------------------- |
| **Personal data** | Names, emails, usernames     |
| **Content**       | Chat messages, file contents |
| **Credentials**   | API keys, tokens, passwords  |
| **File paths**    | Absolute paths to your files |

## Configuration

Telemetry can be controlled via environment variables:

Terminal window

```env
# Enable/disable telemetry
SACODE_TELEMETRY_ENABLED=true

# Telemetry endpoint (internal)
SACODE_TELEMETRY_ENDPOINT=https://telemetry.sacode.dev/collect
```

## Opting out

To disable telemetry:

Terminal window

```env
SACODE_TELEMETRY_ENABLED=false
```

## Data retention

| Data type           | Retention period |
| ------------------- | ---------------- |
| Usage metrics       | 90 days          |
| Performance metrics | 30 days          |
| Error reports       | 90 days          |

## Next steps

- **[Settings](/docs/features/settings/)** — All configurable settings
- **[FAQ](/docs/resources/faq/)** — Common questions
- **[Privacy policy](/docs/resources/tos-privacy/)** — Terms and privacy
