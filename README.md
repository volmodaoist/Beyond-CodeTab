# Beyond-CodeTab

在 Obsidian 中把 Markdown、代码、表格和嵌入组织成可切换的标签页。点击内容即可原地编辑，代码输入支持词表补全。

项目：[volmodaoist/Beyond-CodeTab](https://github.com/volmodaoist/Beyond-CodeTab) · 作者：[volmodaoist](https://github.com/volmodaoist) · 许可证：[MIT](LICENSE)

## 功能特点

- 标签新增、切换、拖动排序、双击改名和确认删除，结果保存到 Markdown。
- 标签栏右侧可复制当前页完整内容、生成指定标签的跳转引用，并打开整个标签组的源码。
- 支持普通 Markdown、代码块、表格、图片、笔记和第三方插件嵌入。
- 阅读视图和实时预览中可原地编辑，编辑区域随正文增高和收缩。
- 单代码块编辑保护围栏，预览与编辑使用一致的语法颜色。
- 内置 Java、C、C++、Python、JavaScript、TypeScript、Go、Shell 词表补全，支持自定义词表和规则。
- 可选 Excalidraw Frame Deck：单独嵌入的画布包含多个 Frame 时可逐页浏览，详见[说明](docs/feat/excalidraw-frame-deck.md)。
- 提供 [OpenAPI](src/openapi/api-doc.md)，其他插件可嵌入标签组、同步内容并接管保存；补全 Core 可独立复制使用。

## 安装与更新

当前 `main` 已包含 OpenAPI、补全和 Beyond-CodeTab 品牌更新。`2.2.1` tag 是这些改动之前的稳定基线；要使用本文全部功能，请从当前 `main` 构建。版本演进见[演进记录](docs/evolution-history.md)。

构建需要 Node.js 20 或更高版本，在仓库根目录执行：

```bash
npm ci
npm run build
```

1. 在目标 Vault 中创建 `.obsidian/plugins/obsidian-code-tab/`。
2. 将 `dist/main.js`、`dist/manifest.json`、`dist/styles.css` 复制进去。
3. 在 Obsidian“设置 → 第三方插件”中启用 **Beyond-CodeTab**。更新已启用的插件后，关闭再启用，或重启 Obsidian。

更新前先备份旧的三个安装文件。保留插件目录中的 `data.json`，以保留补全设置；每个 Vault 要分别安装和重新加载。

显示名称是 `Beyond-CodeTab`，插件 ID 和安装目录仍为 `obsidian-code-tab`，用于延续原有安装与快捷键。构建还生成 `dist/code-tab-api.d.ts` 供接入开发使用，它不是插件运行所必需的安装文件。

## 快速开始

### 普通 Markdown 标签

在 Markdown 中创建一个 `tab` fenced code block，并用 `tab: 标题` 分隔内容：

````markdown
```tab
tab: 简介
这里可以写普通 **Markdown**。

tab: 注意事项
- 第一项
- 第二项
```
````

渲染后会出现“简介”和“注意事项”两个标签。

### 在标签中放代码块

内部代码块通常使用三个反引号，因此外层 `tab` 块需要使用四个反引号：

`````markdown
````tab
tab: Python
```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

tab: JavaScript
```javascript
function greet(name) {
  return `Hello, ${name}!`;
}
```
````
`````

简单原则：外层 fence 必须比内部同类型 fence 更长。编辑已有围栏时，从三个反引号改为四个，或从四个缩回三个，会同步修改另一端；新输入或粘贴四反引号后回车，也能生成对应结束围栏。两端修改作为一次撤销操作。

含有内层三个反引号代码块的 tab 组仍应使用四个或更多反引号；自动配对不会改变 Markdown 的嵌套规则。保存时也会按内层围栏长度保护外层结构。

代码语言可以按日常习惯写成 `c++`。浏览态会在内存中将它映射为 Prism 能识别的 `cpp`，但不会修改笔记源文件：

````markdown
```c++
#include <stdio.h>

int main() {
    return 0;
}
```
````

### 使用命令创建

打开命令面板，执行：

```text
Beyond-CodeTab: 创建标签组件
```

插件会在光标处插入包含两个标签的模板。

## 编辑方式

1. 在阅读视图中选择需要修改的标签。
2. 单击标签内容区域，进入原生 Markdown 编辑状态。
3. 单代码块直接修改正文；Markdown 使用宿主实时预览，可直接修改表格单元格。右下角可选择渲染类型。右上角 `</>` 用于打开整个标签组的原生源码编辑，包括外层围栏和所有 `tab:` 声明。
4. 将鼠标移出内容区域，插件会自动保存并恢复预览。

快捷操作：

| 操作                | 结果                                                             |
| ------------------- | ---------------------------------------------------------------- |
| 单击内容区域        | 进入编辑                                                         |
| 标签栏末尾的 `+`    | 保存当前编辑，新增并选中一个空代码标签                           |
| 拖动标签标题        | 调整标签相对位置，并同步写回 Markdown                            |
| 双击标签标题        | 原地输入新名称；Enter / 失焦保存，Esc 取消                       |
| 右键标签 → 删除标签 | 打开确认弹窗；确认后删除标签及正文                               |
| 编辑态右下角类型框  | 输入代码语言、`markdown` 或插件处理器名称；普通 `Enter` 回到正文 |
| 鼠标移出内容区域    | 自动保存并返回预览                                               |
| `Ctrl/Cmd + Enter`  | 立即保存并返回预览                                               |
| `Esc`               | 有候选窗口时先关闭候选；再次按下取消修改并返回预览               |
| `←` / `→`           | 在标签标题获得焦点时切换标签                                     |
| `Home` / `End`      | 跳到第一个或最后一个标签                                         |

编辑过程中暂时不能切换到另一个标签。这是为了防止切换动作与异步文件保存发生竞争，造成当前编辑内容丢失。先让鼠标离开内容区域完成保存，再切换标签即可。

重命名不接受空名称，标题始终按普通文本显示；保存失败会保留输入。右键删除默认聚焦“取消”，关闭弹窗或按 Esc 都不会删除。删除非活动标签时继续显示当前页，删除活动标签时选择相邻页；删除最后一页会移除整个标签块，确认弹窗会明确提示。

新增标签默认使用“标签3、标签4……”等未被占用的名称，内容是一个 `text` 空代码块。点击新代码块即可输入，无需修改笔记源码；若当前编辑保存失败，则停止新增并保留当前内容。

右下角输入框表示整个标签的**渲染类型**，不限定为编程语言：

| 类型                                   | 保存后的显示方式                         |
| -------------------------------------- | ---------------------------------------- |
| `markdown` / `md`                      | 按 Markdown 渲染表格、段落、代码块和嵌入 |
| `python`、`javascript`、`c++`、`c#` 等 | 按对应语言显示代码高亮                   |
| `mermaid` 或已安装插件的处理器名       | 交给 Obsidian 注册的渲染器处理           |
| 留空 /`text` / 未注册的类型            | 显示纯文本代码块                         |

类型名可自由输入，只排除会破坏围栏结构的空白、反引号和波浪号。代码语言输入后会更新编辑中的高亮；代码与 Markdown 的格式转换在保存时生效，保留正在使用的编辑器和撤销历史。`Esc` 同时放弃正文与类型修改。Markdown 标签切换为代码时，整个标签正文会被包入代码围栏。

标签正文可以直接写 Markdown 表格，也兼容外包一层 `md` / `markdown` 围栏的写法。画布沿用 Obsidian 嵌入语法：

`````markdown
```tab
tab: 表格
| 标识 | 说明 |
| --- | --- |
| intent_id | 一次调仓意图 |

tab: 画布
![[Drawing.excalidraw.md]]
```
`````

画布文件需存在于当前仓库，并启用 Excalidraw 插件。点击画布交给 Excalidraw 处理；点击面板周围的留白可以编辑嵌入链接。仅输入 `excalidraw` 不会自动创建画布或安装对应插件。

编辑区随内容自然增高和收缩，长内容由整页滚动。输入或页面滚动不会触发自动保存；主动移出内容区域、显式保存快捷键才会提交。鼠标移向补全候选窗口时仍保留当前编辑会话。

单代码块的全选、退格和粘贴限制在正文内，保存保留围栏、语言和原有 LF/CRLF 换行。原生编辑器不可用时提供 textarea 降级编辑。

## 复制与标签引用

右侧复制按钮复制当前标签的完整正文。代码会包含语言和代码围栏；正在编辑时复制当前草稿，不会因此保存笔记。混合 Markdown 标签会复制整页正文。

引用按钮生成并复制一个 Markdown 链接，粘贴到其他笔记后可定位到这个 tab 组并选中对应标签。首次生成时，会在原文件中保存两个标识：

- 组的原生块 ID：六位短 ID，放在外层结束围栏之后，如 `^a1b2c3`。
- 标签的稳定 ID：组六位 ID 加标签六位 ID，直接写在标题行末尾，如 `tab: Python ^a1b2c3-d4e5f6`。界面只显示标题。

改名、修改正文和排序会保留标签 ID。复制正文不包含这些标识；删除标签后，旧引用会提示目标不存在。正文编辑时点击引用或 `</>` 会先保存，保存失败会保留当前草稿。

完整结构如下；外层组 ID 是原生块标识，内部标签 ID 由 Beyond-CodeTab 解析：

````markdown
```tab
tab: Python ^a1b2c3-d4e5f6
Python 标签正文

tab: Shell ^a1b2c3-112233
Shell 标签正文
```
^a1b2c3
````

例如，专用跳转链接的形式为：

```markdown
[Python](obsidian://beyond-code-tab?block=a1b2c3&tab=d4e5f6)
```

组 ID 同时能用于原生 `[[Example#^a1b2c3]]` 和 `![[Example#^a1b2c3]]`；原生链接定位或嵌入整个组，专用链接再选择具体标签。新组 ID 在当前 Vault 中检查重复，标签 ID 在组内检查重复。原生块 ID 只能使用英文字母、数字和连字符；代码块 ID 必须写在结束围栏外的独立一行。

专用链接只包含组和标签 ID，在当前 Vault 内查找，需要启用 Beyond-CodeTab。笔记移动、改名或 Vault 改名后无需重建链接。它是跳转链接，不是原生嵌入；复制到另一个 Vault 后，只有该 Vault 中也存在相应标签组时才能跳转。引用按钮用于笔记中的标签组；第三方宿主的存储与撤销继续由宿主接管。

跳转保留目标笔记已有的阅读、实时预览或源码模式；目标已在其他标签页打开时，优先回到该标签页。实时预览继续显示标签组件，源码模式继续显示原始文本。目标尚未打开时，沿用承接跳转的笔记标签页模式。

## 代码补全

进入标签编辑后，输入关键词前缀自动显示候选；`Ctrl + Space` 可主动触发。补全只作用于代码块正文。单代码块使用右下角类型框指定语言，混合 Markdown 中每个代码块使用自己的围栏语言。

| 语言       | 常见别名                     | 示例                |
| ---------- | ---------------------------- | ------------------- |
| Java       | `java`                       | `pub` → `public`    |
| C          | `c`                          | `pri` → `printf`    |
| C++        | `cpp`、`c++`、`cc`、`cxx`    | `vec` → `vector`    |
| Python     | `python`、`python3`、`py`    | `enu` → `enumerate` |
| JavaScript | `javascript`、`js`、`jsx`    | `con` → `const`     |
| TypeScript | `typescript`、`ts`、`tsx`    | `key` → `keyof`     |
| Go         | `go`、`golang`               | `def` → `defer`     |
| Shell      | `shell`、`sh`、`bash`、`zsh` | `ech` → `echo`      |

### 添加自己的词表与规则

打开“设置 → Beyond-CodeTab”，把以下 JSON 填入“自定义代码补全”，点击“应用补全配置”：

```json
{
  "wordLists": [
    {
      "id": "my-commands",
      "languages": ["shell"],
      "words": [
        "deployLocal",
        { "label": "greet", "insertText": "echo hello", "detail": "打印问候" }
      ]
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

在 Shell 代码中输入 `depl` 可以选择 `deployLocal`；输入 `gre` 后选择 `greet`，实际插入 `echo hello`；输入 `docker co` 可以选择规则词条，得到 `docker composeLocal`。

每项需要唯一 `id`、适用 `languages` 和 `words`。`label` 用于显示与前缀匹配，`insertText` 可指定实际插入内容。规则的 `match` 匹配光标前的当前行，默认只替换正在输入的词。JSON 中的正则反斜杠需要写为 `\\`。

配置校验通过才保存并生效，重载插件后会恢复；无效配置保留原设置。清空自定义补全可应用 `{"wordLists": [], "rules": []}`，内置词表仍然可用。配置格式和函数规则见[补全 Core 文档](docs/feat/code-completion-core.md)。

补全是离线词表与规则，不做类型推断、自动导入或 LSP 查询；C++ 成员名也是固定词表。未知语言默认没有内置候选，textarea 降级编辑暂不提供候选窗口。

## 语法约束

- 标签声明必须单独占一行，格式为 `tab: 标题`。
- 标签声明前允许有空格。
- fenced code block 内部出现的 `tab:` 不会被误识别为新标签。
- `c++` 和 `c#` 在预览时分别映射为 `cpp` 和 `csharp`，源 Markdown 保持原样。
- 空标题会自动显示为“标签1”“标签2”等名称。
- 标签内容首尾的空行会被规整，正文内部空行保持不变。
- 使用 `+` 新增标签，拖动标题调整顺序，双击标题重命名，右键确认删除。

## 常见问题

**看不到标签页**：确认笔记使用 `tab` 围栏，标签声明单独占一行。标签内有三个反引号代码块时，外层使用四个反引号；阅读视图或实时预览才会显示组件，源码模式显示原始 Markdown。

**更新后仍是旧名称或旧行为**：确认替换的是当前 Vault 的插件目录，然后关闭再启用插件。`npm run build` 和 `npm run dev` 只更新本仓库的 `dist/`，不会自动安装到 Vault。

**补全没有出现**：先点击进入代码编辑，核对语言标记，再尝试 `Ctrl + Space`。`Esc` 在候选窗口打开时先关闭候选，下一次才取消编辑。

**保存提示内容冲突**：编辑期间源文件可能被其他窗格或同步工具改动。插件拒绝覆盖找不到原内容的块，保留草稿；先复制需要保留的内容，再取消并重新打开最新笔记进行编辑。

移动设备缺少稳定的鼠标离开事件，可使用 `Ctrl/Cmd + Enter` 或源码模式保存。原生编辑器依赖 Obsidian 内部 API；第三方主题、插件组合和 Obsidian 大版本升级后需要重新验证。

## 开发与插件接入

| 需求                                         | 文档                                                           |
| -------------------------------------------- | -------------------------------------------------------------- |
| 嵌入标签组、获取类型提示、操作数据与保存回调 | [简洁 API 文档](src/openapi/api-doc.md)                        |
| 同步、冲突、只读与实例生命周期               | [宿主渲染契约](docs/host-rendering.md)                         |
| 在其他编辑器使用补全                         | [可复制模块 README](src/core/completion/README.md)             |
| 读源码、修改与本地调试                       | [插件开发入门](docs/tech/obsidian-plugin-development-guide.md) |
| 查看完整文档与专题                           | [文档导航](docs/README.md)                                     |

常用验证命令：

```bash
npm run lint
npm test
npm run build
npm run test:obsidian
```

前三项可在没有 Obsidian 的机器上运行。最后一项需要本机安装 Obsidian，使用独立临时 Vault 验证真实编辑、布局和回写，详见[测试说明](tests/test-guide.md)。开发约定见 [AGENTS.md](AGENTS.md)。

## 分享与致谢

本项目维护者：[volmodaoist](https://github.com/volmodaoist)。当前仓库：[Beyond-CodeTab](https://github.com/volmodaoist/Beyond-CodeTab)。

代码来源：

- 上游仓库：[lazyloong/obsidian-code-tab](https://github.com/lazyloong/obsidian-code-tab)
- 上游版本：`2.0-alpha`
- 上游作者：lazyloong
- 许可证：MIT

根许可证记录本项目的版权信息；来源署名和补全模块随附的许可说明继续保留。
