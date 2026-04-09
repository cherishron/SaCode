# Tools reference

Complete reference for all tools available in SaCode CLI.

## Overview

SaCode provides 33 tools across multiple categories. Tools are used by the AI model during Function Calling loops to interact with the filesystem, browser, web, and system.

## Tool categories

| Category             | Count | Tools                                                                                          |
| -------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| **Built-in**         | 8     | ask_user_question, exit_plan_mode, image_read, save_memory, todo_read, todo_write, Skill, task |
| **File**             | 6     | read_file, write_file, replace, list_directory, edit_file, delete_file                         |
| **Browser**          | 5     | web_search, web_fetch, run_shell_command, image_read, xml_escape                               |
| **Web**              | 3     | web_search, web_fetch, http_request                                                            |
| **Search**           | 1     | grep_tool                                                                                      |
| **LSP**              | 1     | lsp_tool                                                                                       |
| **Task Management**  | 3     | task_create_tool, task_update_tool, cron_create_tool                                           |
| **Agent Management** | 3     | agent_tool, team_create_tool, team_delete_tool                                                 |
| **Git**              | 2     | enter_worktree_tool, exit_worktree_tool                                                        |

## Built-in tools

### ask_user_question

Ask the user a clarifying question during execution.

**Parameters:**

- **question** (string): The question to ask
- **header** (string): Short label for the question
- **options** (array): Available answer choices
- **multiple** (boolean): Allow selecting multiple options

### exit_plan_mode

Exit plan mode and begin implementation.

### image_read

Extract information from images or PDFs.

**Parameters:**

- **file_path** (string): Path to the image file
- **goal** (string): What to extract from the image

### save_memory

Save information to persistent memory.

**Parameters:**

- **content** (string): Content to save
- **scope** (string): Memory scope

### todo_read / todo_write

Read and write task/todo lists.

**Parameters (todo_write):**

- **todos** (array): List of todo items with status

### Skill

Load a skill for specialized instructions.

**Parameters:**

- **name** (string): Skill name
- **user_message** (string): Arguments for the skill

### task

Spawn a subagent task.

**Parameters:**

- **category** (string): Task category
- **load_skills** (array): Skills to load
- **description** (string): Task description
- **prompt** (string): Detailed instructions
- **run_in_background** (boolean): Run asynchronously

## File tools

### read_file

Read file contents.

**Parameters:**

- **file_path** (string): Absolute path to the file
- **offset** (number, optional): Starting line number
- **limit** (number, optional): Maximum lines to read

### write_file

Write content to a file.

**Parameters:**

- **file_path** (string): Absolute path
- **content** (string): File content

### replace

Replace text in a file.

**Parameters:**

- **file_path** (string): Absolute path
- **old_string** (string): Text to find
- **new_string** (string): Replacement text
- **replaceAll** (boolean, optional): Replace all occurrences

### list_directory

List directory contents.

**Parameters:**

- **file_path** (string): Absolute path to directory

### edit_file

Edit file with line range or regex replacement.

**Parameters:**

- **file_path** (string): Absolute path
- **instruction** (string): Description of the edit
- **old_string** (string): Text to replace
- **new_string** (string): Replacement text
- **mode** (string, optional): `string` or `regex`

### delete_file

Delete a file or directory.

**Parameters:**

- **file_path** (string): Absolute path
- **recursive** (boolean, optional): Delete directory recursively

## Web tools

### web_search

DuckDuckGo web search.

**Parameters:**

- **query** (string): Search query
- **numResults** (number, optional): Number of results (default: 8)
- **tbs** (string, optional): Time filter

### web_fetch

Fetch web page content.

**Parameters:**

- **url** (string): URL to fetch
- **prompt** (string, optional): Extraction instructions

### http_request

Generic HTTP client.

**Parameters:**

- **url** (string): Request URL
- **method** (string): HTTP method
- **headers** (object, optional): Custom headers
- **body** (string, optional): Request body
- **timeout** (number, optional): Timeout in ms

## Search tools

### grep_tool

High-performance code search with ripgrep.

**Parameters:**

- **pattern** (string): Regex pattern
- **path** (string, optional): Search directory
- **include** (string, optional): File pattern filter
- **case_sensitive** (boolean, optional): Case-sensitive search
- **context** (number, optional): Context lines around match

## LSP tools

### lsp_tool

Language Server Protocol integration.

**Parameters:**

- **file** (string): File path
- **line** (number): Line number (1-based)
- **character** (number): Character position (0-based)
- **action** (string): Action type: `definition`, `references`, `completion`, `diagnostics`, `symbols`, `format`, `rename`
- **language** (string): Programming language

## Task management tools

### task_create_tool

Create a scheduled task (interval/once type).

**Parameters:**

- **name** (string): Task name
- **type** (string): `interval` or `once`
- **config** (object): Task configuration
- **message** (string): Task message
- **channel** (string): Target channel

### task_update_tool

Update an existing task.

**Parameters:**

- **taskId** (string): Task to update
- **updates** (object): Fields to update

### cron_create_tool

Create a cron scheduled task.

**Parameters:**

- **name** (string): Task name
- **cronExpression** (string): Cron expression
- **message** (string): Task message
- **channel** (string): Target channel
- **chatId** (string): Target chat ID

## Agent management tools

### agent_tool

Call a subagent.

**Parameters:**

- **subagent_type** (string): Agent type
- **prompt** (string): Instructions
- **coordination_mode** (string): `sequential`, `parallel`, or `hierarchical`

### team_create_tool

Create an agent team.

**Parameters:**

- **name** (string): Team name
- **agents** (array): Agent list
- **coordination_mode** (string): Coordination strategy

### team_delete_tool

Delete an agent team.

**Parameters:**

- **name** (string): Team name

## Git tools

### enter_worktree_tool

Enter a Git worktree.

**Parameters:**

- **branch** (string): Branch name
- **path** (string): Worktree path

### exit_worktree_tool

Exit the current Git worktree.

## Next steps

- **[Command reference](/docs/reference/commands/)** — CLI command documentation
- **[Configuration reference](/docs/reference/configuration/)** — Settings and environment variables
- **[File management tutorial](/docs/cli/tutorials/file-management/)** — Using file tools effectively
