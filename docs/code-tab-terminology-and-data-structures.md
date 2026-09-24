# Code Tab 数据结构



## 代码块示例

````markdown
```python
print("hello")
```
````

图中所示的是一个 markdown **围栏代码块 (fenced code block)**  示例，

- 首行称为起始围栏 (opening fence)，标识代码块开始
- 末行称为结束围栏 (closing fence)，标识代码块结束
- 围栏由至少三个连续的同类字符组成，用于标记围栏的字符称为 `marker`，三个连续标记符号构成的字符串称为 `marks`，通常代码标记可以使用反引号，也可以使用波浪号，但是大部分 MD 编辑器里面波浪线会被渲染变成取消划线，故只考虑反引号。
- 首尾两行的围栏是边界标记，中间夹着的内容就是代码块的正文，首行围栏后面紧跟的 `python` 属于起始行的信息字符串，这个信息用于告诉 markdown 编辑器使用何种高亮方案呈现这个代码，其不属于正文，也不属于围栏，i.e. 反引号本身。
- 本项目使用四个反引号来作为 Multi Tab 渲染的标记符



## 外层标签块与内层代码块

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

外层 tab 可以包含多个内层 tab，每个内层的 tab 可以携带一个标题。这个标题会被渲染变成标签组界面上用于切换的标题按钮。某个标签正文的区域，我们称为内容面板。这里的“嵌套”由两次处理实现：Obsidian 先取出外层 `tab` 块的文本，插件拆分标签，再把每个标签正文交给 `MarkdownRenderer` 渲染。

- 外层 `tab` 是交给 Obsidian 分派处理器的标记，只有编写了外层的 tab 才会触发 code tab 插件
- 内层 `tab:` 每个 Code Tab 相当于一个原生的 Markdown 代码块，代码块围栏顶部的标题信息会被用来渲染作为切换按钮





## 两个核心数据结构：TabData 与 TabBlock

### TabData：一个标签的内容数据

```ts
interface TabData {
  title: string;
  content: string;
}

// 标签组经过 `parseTabs(source)` 解析之后得到下面的数组
const tabs: TabData[] = [
  {
    title: "示例",
    content: "```python\nprint(\"hello\")\n```",
  },
  {
    title: "说明",
    content: "这里是 **Markdown 正文**。",
  },
];
```

`TabData[]` 数组顺序即为标签顺序。`content` 就是 Markdown 字符串，解析器不把其中的标题、列表和代码拆成语法树，也不生成 HTML。没有填写标题时，解析器会使用默认值，自动生成标签名称。



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
const updated = fileContent.slice(0, block.start)
  + replacement
  + fileContent.slice(block.end);
```

`TabData` 回答“标签里有什么”，`TabBlock` 回答“完整标签块在笔记哪里”。它们没有继承关系，也不是一个标签对应一个 `TabBlock`。

## 5. 解析过程中的临时数据

`parseTabs()` 按行扫描，使用两个局部状态：

```ts
let current: { title: string; lines: string[] } | null = null;
let fence: { marker: string; length: number } | null = null;
```

- `current`：正在收集的标签。遇到新声明时，将前一个标签的 `lines` 合成 `content`，放入结果数组。
- `fence === null`：当前不在内层围栏代码块中，可以识别 `tab:` 声明。
- `fence` 为对象：已进入内层代码块，记录起始围栏的字符和长度，代码中的 `tab:` 作为普通正文保留。

这些是函数内部的临时对象，不会写入笔记，也没有单独导出的接口。

### fenceMatch 是正则匹配结果

```ts
const fenceMatch = line.match(/^ {0,3}([\x60~]{3,})(.*)$/);
```

`\x60` 表示反引号。正则允许行首有 0～3 个普通空格，之后匹配至少三个反引号或波浪号，并收集余下文本。匹配成功时返回匹配数组，失败时返回 `null`。

| 下标 | 例子：两个空格后接三个反引号和 `python` |
| --- | --- |
| `fenceMatch[0]` | 整行匹配文本，包括开头空格 |
| `fenceMatch[1]` | 三个反引号组成的字符串 |
| `fenceMatch[2]` | `"python"` |

识别结束围栏还要结合已有的 `fence` 状态：标记字符相同、长度不短于起始围栏、后面的文本为空白。

当前字符类 `[\x60~]{3,}` 也会匹配反引号和波浪号混合的序列；它比标准围栏要求的“连续同类字符”更宽松。因此，这个正则是当前插件的检测逻辑，不代表完整的 Markdown 语法校验。

另一个容易混淆的同名变量是 `createTabFence()` 中的 `fence`：它是 `marker.repeat(...)` 生成的围栏字符串。阅读 `fence` 时，需要结合所在函数区分“解析状态对象”和“输出围栏字符串”。`main.ts` 的模板命令中也使用字符串形式的 `fence`。

## 6. 渲染上下文、DOM 与编辑状态

下面这些对象出现在 [src/components/tabGroup.ts](../src/components/tabGroup.ts) 中，用于把文本数据与界面连接起来。

| 名称 | 类型或内容 | 职责 |
| --- | --- | --- |
| `context` | Obsidian 的 `MarkdownPostProcessorContext` | 提供来源文件、区段信息和组件生命周期入口 |
| `context.sourcePath` | 相对于 Vault 根目录的笔记路径，如 `示例/Test.md` | 解析相对链接，并定位要保存的笔记 |
| `group` | `{ id, lineStart }` | 当前标签组在渲染过程中的标识和起始行 |
| `group.id` | 文件路径加冒号加起始行 | 用于关联当前标签组的选中状态 |
| `activeTabs` | 插件实例上的 `Map<string, number>` | 保存标签组 ID 到选中标签索引的映射 |
| `activeIndex` | 从 `0` 开始的标签索引 | 当前显示哪个标签 |
| `editingIndex` | `-1` 或从 `0` 开始的标签索引 | `-1` 表示没有编辑会话，其他值表示正在编辑的标签 |
| `buttons` / `panelElements` | DOM 元素数组 | 与标签数组按索引对应，分别承载标题按钮和正文面板 |
| `component` | `MarkdownRenderChild` | 将事件和子组件纳入该代码块的生命周期 |

`context.getSectionInfo(element)` 可能返回 `null`，当前 `getGroupInfo()` 会将起始行暂记为 `0`。`group.id` 依赖行号，前文插入内容后可能变化；它不是写进笔记的永久 ID。`safeId(group.id)` 生成供 DOM ID 使用的短哈希后缀，不用于文件定位，也不保证全局唯一。

`activeTabs`、DOM 和编辑索引都是内存中的状态。保存到笔记的是标签标题和正文；插件卸载时会清空 `activeTabs`。

### 原生编辑器相关类型

| 类型 | 来源 | 当前作用 |
| --- | --- | --- |
| `App` | Obsidian 公开 API | 提供 `vault` 等宿主服务 |
| `TAbstractFile` / `TFile` | Obsidian 公开 API | 前者可表示文件或文件夹，后者表示具体文件；正文需通过 Vault 读取 |
| `Editor` | Obsidian 公开 API | 读取和设置编辑文本、控制焦点等 |
| `NativeMarkdownEmbed` | 项目自行声明 | 描述当前使用的原生嵌入编辑器，包括 `editable`、可选的 `editor` 和 `showEditor()` |
| `AppWithEmbedRegistry` | 项目自行声明 | 为 `App` 补充可选的 `embedRegistry.getEmbedCreator()` 类型 |

原生 embed 和 `editor.cm.dom` 涉及内部 API。项目补充的类型只描述实际访问的成员，不表示 Obsidian 对这些内部接口提供公开兼容性承诺。创建失败时，插件使用 `textarea` 作为降级编辑器；两种编辑入口最终都提供正文字符串给保存逻辑。

## 7. 从数据转换理解函数分工

| 函数 | 输入 | 输出或作用 |
| --- | --- | --- |
| `normalizeNewlines()` | 字符串 | 将 CRLF 或 CR 换成 LF；不解析标签、不写文件 |
| `parseTabs()` | 一个标签组的内部 `source` | `TabData[]` |
| `normalizePreviewFenceLanguages()` | 单标签 Markdown 正文 | 供预览器使用的语言别名转换副本 |
| `serializeTabs()` | `TabData[]` | 含标签声明、不含外层围栏的 `nextSource` |
| `findTabBlock()` | 整篇笔记、旧 `source`、预期行号 | 匹配块的 `TabBlock` 或 `null` |
| `createTabFence()` | 新 `source`、围栏字符、缩进和换行符 | 带外层围栏的完整替换文本 |
| `updateMarkdownSource()` | `App`、文件路径、预期行号、旧/新 `source` | 通过 Vault 回写；失败时抛出错误 |

渲染时，`parseTabs()` 先生成数据，`tabGroup.ts` 再为每个标签创建按钮和面板，并调用 `MarkdownRenderer.render()`。`markdown.ts` 本身不创建这些界面。

保存时，先把 `nextTabs` 序列化为 `nextSource`，再由 `updateMarkdownSource()` 读取当前文件、查找旧块、生成新围栏并替换。只有文件保存成功后，界面中的 `tabs` 和 `source` 才更新。

### 格式规整与旧内容匹配

- **格式规整**：解析会裁掉标签正文首尾的空行，序列化会固定标签声明写法和标签间的空行。因此往返转换不保证原始文本逐字节不变。
- **换行格式**：内部统一使用 LF。保存逻辑支持换行风格一致的 LF/CRLF 文件；当前按文件是否含 CRLF 推断换行风格，不应理解为能保真处理任意混合换行文件。
- **旧内容匹配**：保存时按旧 `source` 查找块，多个相同内容的块再按旧行号距离选择。找不到时拒绝覆盖，避免仅凭已经过时的行号修改笔记。
- **读改写**：优先使用 `vault.process()`；旧版宿主没有该方法时采用 `read()` 加 `modify()`，分开的读写不提供相同的并发保护。

更多宿主概念可参考 [插件开发入门](./obsidian-plugin-development-guide.md) 和 [Obsidian 扩展点与官方 API 导览](./obsidian-extension-points-and-api.md)。对应的文本行为测试位于 [tests/markdown.test.mjs](../tests/markdown.test.mjs)。
