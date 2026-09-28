# Code Tab 测试

测试脚本随项目保存在本目录，使用 Node.js 20 或更高版本。真实界面回归还需要本机安装 Obsidian。

## 运行命令

在项目根目录执行：

```bash
npm ci
npm test                    # 解析、回写、围栏保护和高亮等单元测试
npm run test:obsidian        # 先构建，再运行三组真实 Obsidian 界面测试
```

默认隐藏独立测试窗口。需要观察点击、输入和切换用例的过程时：

```bash
CODE_TAB_SHOW_TEST_WINDOW=1 npm run test:obsidian
```

只调试一组界面测试时，先构建当前源码：

```bash
npm run build
node tests/obsidian/inline-edit.mjs
# 或运行标签栏和语言框的测试
node tests/obsidian/tab-controls.mjs
# 或运行表格、Markdown 转换与嵌入测试
node tests/obsidian/markdown-content.mjs
```

如果本机已有 Excalidraw，可把插件目录传给测试，验证真实画布嵌入：

```bash
CODE_TAB_EXCALIDRAW_PLUGIN='/你的仓库/.obsidian/plugins/obsidian-excalidraw-plugin' \
  node tests/obsidian/markdown-content.mjs
```

测试只把 `main.js`、`styles.css`、`manifest.json` 复制到临时仓库，并创建一张自己的测试画布。未设置该变量时只跳过 Excalidraw 用例，普通嵌入仍会验证。

## 脚本分工与产物

| 文件 | 验证内容 |
| --- | --- |
| [obsidian/host.mjs](obsidian/host.mjs) | 创建临时仓库，安装当前构建产物，启动本机 Obsidian，通过 Playwright 连接调试端口，结束后关闭测试进程 |
| [obsidian/inline-edit.mjs](obsidian/inline-edit.mjs) | 点击前后尺寸及逐字符高亮、回车/粘贴、自然增高/收缩、撤销/重做、保存/取消、围栏保护及降级输入 |
| [obsidian/tab-controls.mjs](obsidian/tab-controls.mjs) | 加号与中英文标签的对齐、新增标签、语言输入与即时高亮、重复点击和写入失败处理 |
| [obsidian/markdown-content.mjs](obsidian/markdown-content.mjs) | 表格及逐单元格尺寸、保存/取消、Markdown 类型转换、第三方处理器和原生嵌入；可选真实 Excalidraw |
| [fixtures/table.md](fixtures/table.md) | 中文长文本与行内代码混合的表格，用于重现点击后的上下位移 |
| 本目录中的 `*.test.mjs` | 无需启动 Obsidian 的解析、数据回写和编辑器逻辑测试 |

三组界面测试分别启动一个临时 Obsidian 进程，在同一进程中依次切换阅读视图、实时预览、明暗主题和窗口宽度。这就是可见模式下会看到多种用例反复切换的原因。测试使用临时笔记，日常仓库中的内容不参与运行。

每组测试会打印 `Artifacts: .../code-tab-e2e-...`。该目录保留截图、`report.json`、`obsidian.log` 和测试仓库中的 Markdown；失败时另存 `failure.png`。对齐测试还会保存宽、窄窗口下标签组件的局部截图。

默认应用路径为 `/Applications/Obsidian.app`。可用 `CODE_TAB_OBSIDIAN_BIN` 指定可执行文件，用 `CODE_TAB_OBSIDIAN_DATA` 指定包含 `obsidian-版本.asar` 的应用数据目录。快捷键用例目前按 macOS 编写。

## 快速定位组件

组件使用 `data-testid` 作为稳定的自动化定位标识，样式和文案变化时仍可按组件用途查找。标识允许在多个标签组中重复，操作前先限定目标标签组。

| `data-testid` | 组件 |
| --- | --- |
| `code-tab-group` | 整个标签组件 |
| `code-tab-list` | 标签栏 |
| `code-tab-tab` | 单个标签按钮 |
| `code-tab-add` | 新增标签按钮 |
| `code-tab-panel` | 单个标签内容面板 |
| `code-tab-editor` | 编辑态的编辑器容器 |
| `code-tab-language` | 渲染类型输入框（沿用已有标识，支持 Markdown、代码语言和插件类型名） |
| `code-tab-fallback` | 原生编辑器不可用时的 textarea |

例如，用 Playwright 定位当前可见的第一个标签组件：

```js
const group = page.getByTestId("code-tab-group").filter({ visible: true }).nth(0);
await group.getByTestId("code-tab-add").click();

const panel = group.getByTestId("code-tab-panel").filter({ visible: true });
await panel.locator("pre").click();
await group.getByTestId("code-tab-language").fill("python");
await group.getByTestId("code-tab-language").press("Meta+Enter");
```

Obsidian 可能同时保留阅读视图与实时预览的 DOM，因此测试需要筛选可见组件。同组内可继续按 `getByRole("tab", { name: "tab1" })` 查找标题，或用 `getByTestId("code-tab-tab").nth(0)` 按顺序定位。

标签和内容面板已有 `code-tab-tab-<分组哈希>-<序号>`、`code-tab-panel-<分组哈希>-<序号>` 形式的 DOM `id`，用于 `aria-controls` / `aria-labelledby` 关联。这些值依赖笔记路径、块位置和标签顺序；自动化脚本统一使用上表的语义标识。
