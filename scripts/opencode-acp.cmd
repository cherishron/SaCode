@echo off
rem SaCode ACP launcher for OpenCode via bun
setlocal
set "BUN=C:\Users\jingg\.version-fox\cache\nodejs\v-24.14.1\nodejs-24.14.1\node_modules\bun\bin\bun.exe"
"%BUN%" x opencode-ai acp %*
