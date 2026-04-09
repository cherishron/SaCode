# Get started with Agent skills

Learn how to discover, install, and use Agent skills in SaCode CLI.

## Overview

Agent skills are specialized capabilities that extend SaCode's functionality. Skills are discovered and installed through registries (ClawHub and SkillHub) and provide domain-specific expertise.

## Searching for skills

Terminal window

```bash
# Search all skills
sacode skills search

# Search with query
sacode skills search telegram

# Search by tags
sacode skills search -t "im,adapter"

# Limit results
sacode skills search -l 10

# Use alternative registry
sacode skills search -r skillhub
```

## Installing skills

Terminal window

```bash
# Install a skill by slug
sacode skills install add-telegram

# Install with specific version
sacode skills install add-telegram -v 1.2.0

# Force overwrite existing
sacode skills install add-telegram -f
```

## Managing installed skills

Terminal window

```bash
# List installed skills
sacode skills list

# Update a specific skill
sacode skills update add-telegram

# Update all skills
sacode skills update

# Uninstall a skill
sacode skills uninstall add-telegram
```

## Publishing skills

Terminal window

```bash
# Login to registry
sacode skills login -t your-api-token

# Publish a skill
sacode skills publish ./.sacode/skills/my-skill -s my-skill -v 1.0.0
```

## Skill structure

Skills are stored in `.sacode/skills/` with the following structure:

```
.sacode/skills/
├── setup/          # Project initialization skills
├── add-telegram/   # Telegram adapter skill
├── add-wechat/     # WeChat adapter skill
└── customize/      # Custom configuration skill
```

## Registry authentication

Terminal window

```bash
sacode skills login -t your-api-token -r clawhub
```

## Security measures

The skill system includes multiple security protections:

| Protection                | Description                                   |
| ------------------------- | --------------------------------------------- |
| **Path traversal**        | Blocks `..` sequences in skill paths          |
| **URL injection**         | Prevents malicious URLs in registry responses |
| **File size limits**      | Maximum file size per skill                   |
| **File count limits**     | Maximum number of files per skill             |
| **Extension whitelist**   | Only allowed file extensions                  |
| **Checksum verification** | Validates skill integrity                     |

## Next steps

- **[Plugin management](/docs/cli/cli-reference.md#plugin-management)** — Extend with plugins
- **[Skills system guide](/docs/guides/skills-system.md)** — Detailed skills documentation
- **[Custom commands](/docs/configuration/custom-commands/)** — Create personalized shortcuts
