# 导图中的 Markdown 双链补全接入

- 导图片段没有原生文件编辑上下文，宿主通过既有 `api.completion.registerRule()` 注册 `markdown` 规则，提供候选及 UTF-16 替换范围；不将源文件绑定到片段编辑器，也不另起 Vault 保存。
- `codeCompletionExtensions` 优先识别代码正文，保留现有语言/围栏保护；普通 Markdown 区域仅在注册了 Markdown 规则时进入补全引擎。无规则时行为沿用原样。
- Markdown 规则已负责匹配，弹层不再用包含 `[[` 的范围过滤文件标签。Markdown 候选活动时 Tab 选择；Enter/Escape/鼠标继续使用现有 CodeMirror 补全交互与保存保护。
- 宿主清理自己的规则，CodeTab 管理编辑器和补全会话。公开 API 类型未改变；本文适配仅修改 `components/CodeBlockEditor/completion.ts`。
- 联测脚本位于导图仓库 `scripts/verify-wikilink-obsidian.mjs`，覆盖普通节点及 Markdown 标签、文件/别名/标题、候选选择不误提交和显式保存。
