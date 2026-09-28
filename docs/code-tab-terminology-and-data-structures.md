# Code Tab 术语与数据结构

## 1. 围栏代码块

````markdown
```python
print("hello")
```
````

上面是一个 Markdown **围栏代码块（fenced code block）**：

- 首行称为起始围栏 (opening fence)，标识代码块开始
- 末行称为结束围栏 (closing fence)，标识代码块结束
- 围栏由至少三个连续的同类字符组成，可以使用反引号或波浪号。本项目解析和保存均支持这两种字符；波浪号围栏与行内删除线是不同语法。
- `marker` 表示单个围栏字符，`marks` 表示当前行匹配到的整段标记字符，长度不固定为三个。
- 首尾两行的围栏是边界标记，中间夹着的内容就是代码块的正文，首行围栏后面紧跟的 `python` 属于起始行的信息字符串，这个信息用于告诉 markdown 编辑器使用何种高亮方案呈现这个代码，其不属于正文，也不属于围栏，i.e. 反引号本身。
- 模板默认使用四个反引号作为外层 `tab` 围栏，便于内部放三个反引号的代码块；插件并不要求所有外层围栏都固定为四个。保存时会根据内层同类围栏选择足够长的外层围栏。

## 2. 外层标签块与内层正文

Code Tab 使用语言标记 `tab` 注册 Obsidian 代码块处理器。外层代码块对应一个**标签组 (tab group)**，其中包含两个标签：

`````markdown
````tab
tab: tab1-标题
```python
print("hello tab1")
```

tab: tab2-标题
```python
print("hello tab2")
```
````
`````

一个外层 `tab` 块可以包含多个标签，每个标签用 `tab: 标题` 声明。标题会显示为用于切换的按钮；显示该标签正文的区域称为内容面板。Obsidian 先取出外层 `tab` 块的文本，插件拆分标签，再把每个标签正文交给 `MarkdownRenderer` 渲染。

- 外层 `tab` 是交给 Obsidian 分派处理器的标记，只有编写了外层的 tab 才会触发 code tab 插件
- 内层 `tab:` 是插件定义的标签声明，不是另一个代码块围栏。它下面可以直接写段落、表格、列表、`![[文件]]` 嵌入，也可以放一个或多个代码块。

## 3. 标签内容与文件位置：TabData、TabContent 和 TabBlock

### TabData：一个标签的内容数据

```ts
interface TabData {
  title: string;
  content: string;
}

// parseTabs(source) 的结果可以用下面两个业务对象表示。
const exampleTab: TabData = {
  title: "示例",
  content: '```python\nprint("hello")\n```',
};
const descriptionTab: TabData = {
  title: "说明",
  content: "这里是 **Markdown 正文**。",
};
const tabs: TabData[] = [exampleTab, descriptionTab];
```

`TabData[]` 数组顺序即为标签顺序。`content` 就是 Markdown 字符串，解析器不把其中的标题、列表和代码拆成语法树，也不生成 HTML。没有填写标题时，解析器会使用默认值，自动生成标签名称。

### TabContent：标签正文怎样进入预览和编辑

[MultiTab/tabContent.ts](../src/components/MultiTab/tabContent.ts) 中的 `readTabContent()` 将 `TabData.content` 分类为：

```ts
interface TabContent {
  source: string;
  editorSource: string;
  renderType: string;
  kind: "code" | "markdown";
  body: CodeBlockBody | null;
}
```

| 字段 | 作用 |
| --- | --- |
| `source` | 原始标签正文，用来保留原围栏和附加信息 |
| `editorSource` | 交给原生编辑器和预览器的文本；`md` / `markdown` 单围栏会解包，代码围栏保留 |
| `renderType` | 右下角类型框的初始值，如 `markdown`、`python`、`mermaid` |
| `kind` | `markdown` 使用完整 Markdown 编辑；`code` 使用单围栏正文编辑方式 |
| `body` | 原始单代码块的正文范围，类型来自 [CodeBlockEditor/fences.ts](../src/components/CodeBlockEditor/fences.ts)；不是单围栏时为 `null` |

例如普通 Markdown 表格的 `kind` 为 `markdown`、`body` 为 `null`；包在 `md` 围栏里的表格也是 `markdown`，但保留 `body`，以便类型未变时恢复原围栏。其他单围栏的 `kind` 为 `code`，这也包括交给第三方处理器的围栏，并不代表它一定是 Prism 支持的编程语言。

`writeTabContent()` 在保存时应用正文和类型修改：保持原类型时尽量保留原围栏，代码改为 Markdown 时取出正文，Markdown 改为代码时添加足够长的围栏。它返回新的标签正文，不写文件。

### TabBlock：一个外层标签块在文件中的位置

```ts
interface TabBlock {
  start: number;
  end: number;
  line: number;
  marker: string;
  indent: string;
  newline: string;
}
```

`findTabBlock()` 返回这个结构，或者在没有匹配项时返回 `null`。它描述整个外层标签块，里面可以包含多个 `TabData`。

| 字段 | 含义 |
| --- | --- |
| `start` | 外层起始围栏行在整篇文件字符串中的起始偏移，包含该行缩进 |
| `end` | 结束围栏行末尾之后的位置；不包含该行后面的换行符 |
| `line` | 起始围栏所在行，从 `0` 开始计数 |
| `marker` | 外层围栏使用的单个字符 |
| `indent` | 起始围栏前的空格字符串 |
| `newline` | 用于生成替换文本的换行符，通常为 `"\n"` 或 `"\r\n"` |

`start` 和 `end` 使用 JavaScript 字符串的 UTF-16 索引单位，与 `String.slice()` 一致，并非文件字节偏移。替换范围是左闭右开的 `[start, end)`：

```ts
const updated = fileContent.slice(0, block.start) + replacement + fileContent.slice(block.end);
```

`TabData` 回答“标签里有什么”，`TabBlock` 回答“完整标签块在笔记哪里”。它们没有继承关系，也不是一个标签对应一个 `TabBlock`。

## 4. 解析过程中的临时数据

当前 [parseTabs()](../src/markdown.ts) 使用分组循环，每完成一个标签就执行一次 `tabs.push(tab)`：

1. `i` 指向下一条未处理行。遇到 `tab:` 声明后前进一行，用 `bg` 记录正文起点。
2. 扫描正文直到围栏外的下一条 `tab:` 声明或文本末尾。
3. 遇到内层起始围栏时，内层循环直接越过整个代码块；其中的 `tab:` 不会成为标签边界。
4. 用 `lines.slice(bg, i)` 获取完整正文，裁掉首尾空行，构造 `TabData` 并 `push`。
5. 下一轮从尚未消费的标签声明开始，因此连续空标签和末尾空标签也能保留。

第一条标签声明之前的说明和代码块只扫描、不保存。未闭合的内层围栏会延续到文本末尾，其后看似标签声明的行也属于该代码块正文。

### FenceLine：把正则匹配转换为具名字段

`parseFenceLine()` 返回内部接口 `FenceLine` 或 `null`：

```ts
interface FenceLine {
  marker: string;
  length: number;
  suffix: string;
}
```

函数内的原始匹配为：

```ts
const match = line.match(/^ {0,3}([\x60~]{3,})(.*)$/);
```

`\x60` 表示反引号。正则允许行首有 0～3 个普通空格，之后匹配至少三个反引号或波浪号，并收集余下文本。匹配成功时返回匹配数组，失败时返回 `null`。

| 下标 | 例子：两个空格后接三个反引号和 `python` |
| --- | --- |
| `match[0]` | 整行匹配文本，包括开头空格 |
| `match[1]` | 三个反引号组成的字符串，即 `marks` |
| `match[2]` | `"python"`，返回为 `suffix` |

匹配成功后，通过具名、有类型的局部变量返回结果：

```ts
const marks = match[1];
const result: FenceLine = {
  marker: marks[0],
  length: marks.length,
  suffix: match[2],
};

return result;
```

调用方用 `opening` 和 `closing` 表示起止围栏。识别结束围栏需要三个条件：标记字符相同、长度不短于起始围栏、`suffix.trim()` 为空。

当前字符类 `[\x60~]{3,}` 也会匹配反引号和波浪号混合的序列；它比标准围栏要求的“连续同类字符”更宽松。因此，这个正则是当前插件的检测逻辑，不代表完整的 Markdown 语法校验。

`createTabFence()` 中的 `fence` 则是 `marker.repeat(...)` 生成的输出围栏字符串。`main.ts` 中的 `TAB_FENCE` 也是字符串，`TAB_TEMPLATE` 用它组装命令插入的模板。它们都不是 `FenceLine` 对象。

## 5. 渲染上下文、DOM 与编辑状态

下面这些对象出现在 [src/components/MultiTab/tabGroup.ts](../src/components/MultiTab/tabGroup.ts) 中，用于把文本数据与界面连接起来。

| 名称 | 类型或内容 | 职责 |
| --- | --- | --- |
| `context` | Obsidian 的 `MarkdownPostProcessorContext` | 提供来源文件、区段信息和组件生命周期入口 |
| `context.sourcePath` | 相对于 Vault 根目录的笔记路径，如 `示例/Test.md` | 解析相对链接，并定位要保存的笔记 |
| `group` | `TabGroupInfo`，含 `id`、`lineStart` | 当前标签组在渲染过程中的标识和起始行 |
| `group.id` | 文件路径加冒号加起始行 | 用于关联当前标签组的选中状态 |
| `activeTabs` | 插件实例上的 `Map<string, number>` | 保存标签组 ID 到选中标签索引的映射 |
| `activeIndex` | 从 `0` 开始的标签索引 | 当前显示哪个标签 |
| `editingIndex` | `-1` 或从 `0` 开始的标签索引 | `-1` 表示没有编辑会话，其他值表示正在编辑的标签 |
| `changingTabs` | `boolean` | 正在新增、改名或删除时阻止重复结构操作 |
| `saveCurrentEditor` | 保存回调或 `null` | 新增标签等操作先等待当前编辑保存完成 |
| `views: TabView[]` | 标签视图数组 | 每项关联按钮、面板、预览和生命周期；删除时一起释放，事件按视图查找当前序号 |
| `component` | `MarkdownRenderChild` | 将事件和子组件纳入该代码块的生命周期 |

`context.getSectionInfo(element)` 可能返回 `null`，当前 `getGroupInfo()` 会将起始行暂记为 `0`。`group.id` 依赖行号，前文插入内容后可能变化；它不是写进笔记的永久 ID。`safeId(group.id)` 生成供 DOM ID 使用的短哈希后缀，不用于文件定位，也不保证全局唯一。

`activeTabs`、DOM 和编辑索引都是内存中的状态。保存到笔记的是标签标题和正文；插件卸载时会清空 `activeTabs`。

### TabView：一页标签的界面与资源

`TabView` 定义在 `tabGroup.ts` 内部，关联该标签的 `button`、`panel`、生命周期 `component`、当前 `preview`、可复用的 `highlighting` 和预览是否正在渲染的 `rendering` 标志。

它与 `TabData` 分工不同：`TabData` 可以序列化成 Markdown，`TabView` 只能用于当前界面。删除标签时一起释放其 DOM 和组件。事件通过 `views.indexOf(view)` 获取当前索引，避免删除前面的标签后，旧闭包仍操作原来的序号。

DOM 的 `id` 用于关联标签与面板的 ARIA 属性，依赖文件、位置和索引；自动化定位统一用语义化的 `data-testid`，并先限定可见的标签组，完整列表见 [测试说明](../tests/README.md#快速定位组件)。

### 原生编辑器相关类型

| 类型 | 来源 | 当前作用 |
| --- | --- | --- |
| `App` | Obsidian 公开 API | 提供 `vault` 等宿主服务 |
| `TAbstractFile` / `TFile` | Obsidian 公开 API | 前者可表示文件或文件夹，后者表示具体文件；正文需通过 Vault 读取 |
| `Editor` | Obsidian 公开 API | 读取和设置编辑文本、控制焦点等 |
| `NativeMarkdownEmbed` | 项目自行声明 | 描述当前使用的原生嵌入编辑器，包括 `editable`、可选的 `editor` 和 `showEditor()` |
| `AppWithEmbedRegistry` | 项目自行声明 | 为 `App` 补充可选的 `embedRegistry.getEmbedCreator()` 类型 |

`embedRegistry` 和通过 Obsidian `Editor` 访问 `editor.cm` 涉及内部接口；拿到的 CodeMirror `EditorView` 则提供其自己的扩展 API。项目补充的类型只描述实际访问的成员，不表示 Obsidian 对内部接口提供公开兼容性承诺。创建失败时，插件使用 `textarea` 作为降级编辑器；两种编辑入口最终都提供正文字符串给保存逻辑。

## 6. 从数据转换理解函数分工

| 函数 | 输入 | 输出或作用 |
| --- | --- | --- |
| `normalizeNewlines()` | 字符串 | 将 CRLF 或 CR 换成 LF；不解析标签、不写文件 |
| `parseTabs()` | 一个标签组的内部 `source` | `TabData[]` |
| `readTabContent()` | 单标签 Markdown 正文 | 供预览和编辑使用的 `TabContent` |
| `writeTabContent()` | `TabContent`、编辑结果、渲染类型 | 保留或转换围栏后的标签正文 |
| `normalizePreviewFenceLanguages()` | 单标签 Markdown 正文 | 供预览器使用的语言别名转换副本 |
| `serializeTabs()` | `TabData[]` | 含标签声明、不含外层围栏的 `nextSource` |
| `findTabBlock()` | 整篇笔记、旧 `source`、预期行号 | 匹配块的 `TabBlock` 或 `null` |
| `createTabFence()` | 新 `source`、围栏字符、缩进和换行符 | 带外层围栏的完整替换文本 |
| `updateMarkdownSource()` | `App`、文件路径、预期行号、旧 `source`、新 `source` 或 `null` | 通过 Vault 回写；`null` 删除匹配块，失败时抛出错误 |

渲染时，`parseTabs()` 先生成数据，`tabGroup.ts` 再为每个标签创建按钮和面板，并委托 `tabPreview.ts` 调用 `MarkdownRenderer.render()`。`markdown.ts` 本身不创建这些界面。

保存正文或修改标签结构时，先把 `nextTabs` 序列化为 `nextSource`，再由 `updateMarkdownSource()` 读取当前文件、查找旧块、生成新围栏并替换。删除最后一页使用 `nextSource = null`，表示移除整个匹配块；它与空字符串不同。只有文件保存成功后，界面中的 `tabs` 和 `source` 才更新。

## 7. 格式规整与旧内容匹配

- **格式规整**：解析会裁掉标签正文首尾的空行，序列化会固定标签声明写法和标签间的空行。因此往返转换不保证原始文本逐字节不变。
- **表格格式**：宿主原生表格编辑器会自动补齐管道表格的列宽空格和分隔线。表格回归会归一化这些空格后比较内容，同时要求其他 Markdown 保持原样。
- **换行格式**：内部统一使用 LF。保存逻辑支持换行风格一致的 LF/CRLF 文件；当前按文件是否含 CRLF 推断换行风格，不应理解为能保真处理任意混合换行文件。
- **旧内容匹配**：保存时按旧 `source` 查找块，多个相同内容的块再按旧行号距离选择。找不到时拒绝覆盖，避免仅凭已经过时的行号修改笔记。
- **读改写**：优先使用 `vault.process()`；旧版宿主没有该方法时采用 `read()` 加 `modify()`，分开的读写不提供相同的并发保护。

更多宿主概念可参考 [插件开发入门](./obsidian-plugin-development-guide.md) 和 [Obsidian 扩展点与官方 API 导览](./obsidian-extension-points-and-api.md)。文本行为见 [markdown.test.mjs](../tests/markdown.test.mjs) 与 [tab-content.test.mjs](../tests/tab-content.test.mjs)，真实表格编辑见 [markdown-content.mjs](../tests/obsidian/markdown-content.mjs) 与 [table-transition.mjs](../tests/obsidian/table-transition.mjs)。
