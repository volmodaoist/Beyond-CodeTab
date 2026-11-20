# 可移植代码补全 Core

状态：已合入当前 `main`，新增能力尚未发布新 tag。目录为 `src/core/completion/`，公开导出在 index.ts；Beyond-CodeTab 通过 `api.completion` 提供共享实例。

## 当前范围

内置 Java、C、C++、Python、JavaScript、TypeScript、Go、Shell 的关键词及常见库、类型、命令词汇。别名包括 py/python3、js/jsx、ts/tsx、c++/cc/cxx、golang、sh/bash/zsh。C 与 C++ 分开，未知语言没有 Python 回退。

补全使用前缀与正则规则，不进行类型推断、LSP 或代码执行。C++ 的点号与箭头提供固定常用成员词表。snippet 占位符、自动导入、系统头文件索引和文档词汇 provider 尚未实现。字符串与注释不会通过语法树自动屏蔽，规则提供者可根据 context 自行过滤。

## 可复制的边界

运行时代码只导入本目录模块，输入正文、UTF-16 光标、语言、文档及版本，输出候选和替换区间。不依赖 Obsidian、CodeMirror、DOM、Vault、网络或文件系统。

目录包含 types/errors/languages/profiles/engine/index.ts、README、LICENSE 与独立 tests。复制整个目录即可使用，见 [模块 README](../../src/core/completion/README.md)。测试只要求 Node.js 与 esbuild。

适配层在 `src/components/CodeBlockEditor/completion.ts`。它定位单代码块或混合 Markdown 的围栏正文，映射偏移并接入 CodeMirror 候选窗口，检查文档身份、正文版本、光标、语言、注册版本及取消信号后插入。保留 Markdown 根解析器、Prism 着色、围栏保护及保存流程。

## 请求和候选

context 包含 documentId、revision、text、offset、language、trigger 与可选 signal。text 只包含代码正文，offset/from/to 都按 UTF-16 计数。trigger 为 automatic 或 explicit。

result 包含 documentId、revision、registryRevision、language、offset、items 和 failures。item 包含 label、insertText、from/to，以及可选 detail/boost。准确类型见 [types.ts](../../src/core/completion/types.ts)。

Core 不跟踪宿主光标；适配器必须在应用结果前检查当前会话，并取消过期请求。注册变化、AbortSignal 取消和引擎释放会拒绝迟到结果。规则失败隔离为 failures，不阻止其他候选。

## 开放接口

| 方法                                         | 行为                                         |
| -------------------------------------------- | -------------------------------------------- |
| `createCompletionEngine()`                   | 创建独立引擎及八种语言内置词表               |
| `registerWords(list)` / `registerRule(rule)` | 注册唯一 id，返回清理函数                    |
| `replaceWords(list)` / `replaceRule(rule)`   | 替换已存在 id；旧清理不会删除新版本          |
| `unregister(id)`                             | 删除普通注册项，返回是否删除                 |
| `list()`                                     | 冻结的注册项信息副本                         |
| `complete(context)`                          | 异步聚合、去重、排序，最多返回 200 项        |
| `configure(configuration)`                   | 整体校验后替换用户声明配置，失败保留旧配置   |
| `getRevision()` / `subscribe(listener)`      | 注册版本与变化通知，返回取消函数             |
| `dispose()`                                  | 关闭独立引擎；共享实例由 Beyond-CodeTab 释放 |

词条可以是字符串或 `{ label, insertText?, detail?, boost? }`。注册 id 建议加插件前缀，languages 可用别名或 `"*"`。`config:` 为声明配置保留；内置项使用 `builtin:`，接入插件避免覆盖它们。

规则恰好提供 words 或 complete 回调之一，可加 RegExp match。match 匹配光标前当前行的末尾，复制正则并移除 g/y，不修改调用者的 lastIndex。词表规则按 label 前缀过滤，默认只替换当前词；函数规则自行返回包含光标的有效正文区间。

`CompletionErrorCode` 是独立枚举：InvalidContext、InvalidRule、DuplicateId、NotFound、Cancelled、Stale、Disposed。通过 engine.errorCodes 访问运行时枚举。

## 用户 JSON 配置

设置页编辑后点击“应用补全配置”完成校验、写盘与生效。无效 JSON 或正则保留原配置。重载插件会恢复；保存时字符串词条规范化为 label 对象。

```json
{
  "wordLists": [
    {
      "id": "project-commands",
      "languages": ["shell"],
      "words": ["deployLocal", { "label": "greet", "insertText": "echo hello", "boost": 20 }]
    }
  ],
  "rules": [
    {
      "id": "docker-commands",
      "languages": ["shell"],
      "match": "docker\\s+\\w*$",
      "words": ["composeLocal"]
    }
  ]
}
```

parseCompletionConfiguration 接收 unknown 并验证，缺省数组按空处理，配置 id 跨词表/规则唯一。声明只支持词表与正则字符串，不能提供代码回调，不使用 eval。configure 不影响其他插件的普通注册项；API 注册项不持久化，注册插件每次加载需重新注册。

## 编辑器交互与验证

自动输入触发，Ctrl+Space 显式触发。Esc 先关闭候选，再取消编辑；Ctrl/Cmd+Enter 仍保存。弹窗属于当前编辑器，鼠标移向它不触发移出保存；失焦在 120ms 后复核。类型修改重新配置，未知语言默认无候选。初始化下一帧不会覆盖已经发生的用户输入或点击。

`npm test` 覆盖语言、别名、UTF-16、规则、配置事务、去重、取消、隔离和清理。`tests/obsidian/openapi-completion.mjs` 验证真实插入、围栏、自定义词表/正则、Esc 与设置恢复。textarea 降级保留编辑保存，不提供 CodeMirror 候选窗口。

## 来源与改造

参考同级 `obsidian-leetcode`，核对基线为 `2fb7a32`。数据来源为 `src/solve/editor/completion/vocabularies/python.ts`、cpp.ts、otherLanguages.ts；候选与失焦策略参考 CompletionExtension.ts。数据保留 MIT 许可，Core 随附 LICENSE。参考仓库未修改。

移除 TreeNode、ListNode、竞赛别名和模板，将 C 单独建表，未知语言不回退 Python。没有搬入 snippetCompletion、completeAnyWord 或整组语言扩展。

后续可通过函数规则接入语法过滤、语义服务或任务词汇，服务连接与生命周期由提供者管理。Core 只负责候选契约和聚合。
