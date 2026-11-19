# Code Tab API 使用说明

统一 API 位于 `src/openapi/`。当前工作树已实现，尚未发布；没有 v1/v2 区分，旧的 `obsidian-codeblock-render` 事件已移除。

## 1. 获取 API 与类型提示

运行 `npm run build`，将 `dist/code-tab-api.d.ts` 复制到接入插件。使用 `import type` 导入，编辑器就能提示 options、句柄、操作和补全参数。

```ts
import type { CodeTabApi, CodeTabApiRequest } from "./code-tab-api";

function getCodeTabApi(container: HTMLElement): CodeTabApi | null {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  if (!win) {
    return null;
  }
  const request: CodeTabApiRequest = {};
  const options: CustomEventInit<CodeTabApiRequest> = {
    detail: request,
  };
  doc.dispatchEvent(new win.CustomEvent("obsidian-code-tab-api", options));
  return request.api ?? null;
}
```

API 不存在时返回 `null`，宿主可显示普通代码块。通过容器所属 Document 发现，适用于主窗口和弹出窗口。

## 2. 渲染标签组

````ts
import type { CodeTabRenderOptions } from "./code-tab-api";

const api = getCodeTabApi(container);
if (!api) {
  return;
}
const options: CodeTabRenderOptions = {
  container,
  component: loadedParent,
  id: blockId,
  source: "tab: Python\n```python\nprint(1)\n```",
  sourcePath: "示例.md",
  onChange: async (expected, next) => {
    await hostStore.commitBlock(blockId, expected, next);
  },
};
const handle = await api.render(options);
````

`container` 是已挂入 DOM 的容器；`component` 是已加载的 Obsidian Component；`id` 是宿主块 ID。`source` 包含各 `tab:` 声明和正文，**不包含最外层 tab 围栏**。`sourcePath` 仅供相对链接和嵌入解析。

`onChange(expected, next)` 由宿主接管保存：核对当前块体等于 `expected`，在自己的保存与撤销事务中写入 `next`，失败就拒绝 Promise。`next === null` 表示删除整个块。示例的 `hostStore.commitBlock` 需要由接入方实现。

可选 `readOnly: true` 禁用编辑和标签管理；未提供 `onChange` 时也只读。可选 `onEditingChange(editing)` 通知正文编辑开始和结束。

## 3. 常用接口

| 接口                                  | 用途                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `api.parse(source)`                   | 把块体解析成 `{ title, content }[]` 的只读副本          |
| `api.serialize(tabs)`                 | 标签数据转为块体；会规范化部分空白                      |
| `handle.getSnapshot()`                | 读取已接受源码、revision、tabs、activeIndex 和状态      |
| `handle.update(patch)`                | 同步宿主已确定的 source/sourcePath/readOnly，不触发保存 |
| `handle.apply(operations, options)`   | 批量修改标签，只提交一次保存                            |
| `handle.selectTab(index)`             | 切页                                                    |
| `handle.focus(target?)`               | 聚焦 `"tab"`、`"content"` 或 `"editor"`；默认 tab       |
| `handle.startEditing(index?)`         | 编辑指定页；默认活动页                                  |
| `handle.commit()` / `handle.cancel()` | 保存或取消当前正文草稿                                  |
| `handle.subscribe(listener)`          | 立即及后续通知快照，返回取消订阅函数                    |
| `handle.dispose()`                    | 释放组件并清空容器内容；重复调用安全                    |

快照状态包含 `readOnly`、`editing`、`saving`、`rendering`。`revision` 只随已接受源码变化增加，切页不增加；`source` 不包含未提交草稿。`editing` 指正文编辑，标题输入和删除确认也会使修改接口忙碌。

```ts
import type { CodeTabApplyOptions, CodeTabData, CodeTabOperation } from "./code-tab-api";

const tab: CodeTabData = {
  title: "说明",
  content: "新的正文",
};
const operation: CodeTabOperation = {
  type: "insert-tab",
  index: handle.getSnapshot().tabs.length,
  tab,
};
const applyOptions: CodeTabApplyOptions = {
  expectedRevision: handle.getSnapshot().revision,
};
await handle.apply([operation], applyOptions);
```

操作支持 `insert-tab(index, tab)`、`replace-tab(index, tab)`、`remove-tab(index)`、`move-tab(fromIndex, toIndex)`。批次顺序执行，后续索引基于前一步结果；移动目标为最终位置。

编辑、改名、删除确认、保存或渲染期间，内容变更返回 `Busy`，宿主保留待同步数据后重试。不要覆盖草稿。关闭节点时先决定 `commit` 或 `cancel`，再释放；父 Component 卸载也会自动释放。

## 4. 自定义补全

`api.completion` 内置 Java、C、C++、Python、JS/TS、Go、Shell 的词表补全。Code Tab 原生编辑器自动消费；支持输入触发和 Ctrl+Space。Esc 先关闭候选，再取消编辑。

```ts
import type { CompletionRule, CompletionWordList } from "./code-tab-api";

const wordList: CompletionWordList = {
  id: "mindmap:commands",
  languages: ["shell"],
  words: ["deployLocal"],
};
const removeWords = api.completion.registerWords(wordList);
const rule: CompletionRule = {
  id: "mindmap:docker",
  languages: ["shell"],
  match: /docker\s+\w*$/,
  words: ["composeLocal"],
};
const removeRule = api.completion.registerRule(rule);
// 插件卸载时清理自己的注册项。
removeWords();
removeRule();
```

正则匹配光标前的当前行；词表默认只替换当前词。`replaceWords/replaceRule` 替换同 id 注册项，`unregister(id)` 移除，`list()` 查看注册项。id 建议带插件前缀；`config:` 为用户配置保留。

其他编辑器可调用 `complete(context)` 获取候选；范围是**代码正文的 UTF-16 偏移**，由适配器检查版本、光标与取消信号后插入。`configure` 整体替换声明配置；普通用户可在 Code Tab 设置页编辑 JSON 并应用保存。详细示例见 [补全 Core](../../docs/feat/code-completion-core.md)。

接入方只清理自己的规则。`api.completion.dispose()` 会关闭全插件共享补全，应由 Code Tab 生命周期调用。

## 5. 错误处理

错误码是独立枚举。复制声明后，运行时用 `api.errorCodes` 和 `api.completion.errorCodes` 比较，不需要从声明文件导入运行时对象。

```ts
try {
  await handle.commit();
} catch (error) {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === api.errorCodes.CommitFailed) {
      // 草稿仍保留；让用户重试或取消。
    }
  }
}
```

常见错误：`Busy` 正在交互、`RevisionMismatch` 快照已过期、`CommitFailed` 宿主未接受保存、`Disposed` 实例已释放。`RenderFailed` 可能发生在保存成功之后，先读快照再重试预览，避免重复记录撤销。

完整契约见 [宿主渲染说明](../../docs/host-rendering.md)，导图迁移见 [交接指南](../../docs/mindmap-openapi-handoff.md)。
