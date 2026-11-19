# Portable completion core

该目录可整体复制到其他 TypeScript 项目。运行时代码只导入本目录文件，不依赖 Obsidian、CodeMirror、DOM、文件系统或网络。`AbortSignal` 使用标准类型。保留随附 MIT `LICENSE`。

```ts
import { createCompletionEngine } from "./completion";
import type { CompletionContext, CompletionWordList } from "./completion";

const engine = createCompletionEngine();
const words: CompletionWordList = {
  id: "my-plugin:commands",
  languages: ["shell"],
  words: ["deployLocal"],
};
const unregister = engine.registerWords(words);
const context: CompletionContext = {
  documentId: "editor-1",
  revision: 0,
  text: "depl",
  offset: 4,
  language: "bash",
  trigger: "automatic",
};
const result = await engine.complete(context);
// item.from/to 是正文 UTF-16 区间；适配器负责校验光标和版本后插入。
unregister();
engine.dispose();
```

内置 Java、C、C++、Python、JavaScript、TypeScript、Go、Shell 词表及常见别名。补全是前缀词表与规则匹配；C++ 成员表只是常用方法词表，没有类型推断、LSP 或 snippet 占位符。

`registerWords/replaceWords/registerRule/replaceRule` 返回清理函数。id 建议添加调用方前缀；`config:` 由声明配置保留。`configure` 整体替换用户声明，不影响普通注册项。失败规则通过结果的 failures 报告，其他规则仍能返回候选。取消、注册版本变化和释放拒绝迟到结果。

在 Code Tab 根目录运行 `node --test src/core/completion/tests/*.test.mjs`。复制到其他项目时，测试需要 Node.js 20+ 与 esbuild；可先安装 `npm install --save-dev esbuild`。测试本身打包 index.ts，不加载任何宿主模块。

部分词表参考同一作者的 obsidian-leetcode 编辑器，已移除题库专用的 TreeNode、ListNode 等条目。完整契约和 JSON 配置示例见 Code Tab 的 `docs/feat/code-completion-core.md`。
