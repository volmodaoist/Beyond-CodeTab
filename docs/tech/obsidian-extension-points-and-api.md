# Obsidian 扩展点与官方 API 导览

这篇文档回答两个问题：**插件可以接入 Obsidian 的哪些位置，以及接入以后可以调用哪些宿主能力。** 可以先读 [从 Beyond-CodeTab 入门 Obsidian 插件开发](./obsidian-plugin-development-guide.md)，再用本文按功能查找 API。

本文的 API 基线为本仓库安装的官方 `obsidian@1.13.1` 类型声明，Beyond-CodeTab 接入位置已按 2026-09-28 的源码更新。它是一份按任务组织的导航，完整签名和版本要求以对应版本的 `obsidian.d.ts` 为准。示例中的 `DemoPlugin` 是独立教学示例，不表示仓库已经实现了相应功能。

## 1. 扩展点和 API 分别是什么

**扩展点决定“何时调用你的代码”，API 决定“你的代码可以做什么”。**

例如，Beyond-CodeTab 调用 `registerMarkdownCodeBlockProcessor("tab", handler)`，注册了一个扩展点：宿主渲染 `tab` 代码块时调用 `handler`。处理函数内部再调用 `MarkdownRenderer.render()`，使用宿主的 Markdown 渲染能力。

| 类型         | 谁发起调用                     | 例子                              | 你需要提供什么           |
| ------------ | ------------------------------ | --------------------------------- | ------------------------ |
| 注册扩展点   | Obsidian 在对应时机调用插件    | 命令、代码块处理器、自定义视图    | 回调、工厂函数或扩展对象 |
| 订阅事件     | Obsidian 在状态变化时通知插件  | 文件修改、打开笔记、元数据更新    | 事件处理函数             |
| 调用宿主 API | 插件主动调用 Obsidian          | 读取文件、渲染 Markdown、打开视图 | 参数和结果处理逻辑       |
| 创建界面     | 插件使用 DOM 或 Obsidian UI 类 | 标签按钮、弹窗、设置项            | 界面结构、样式、交互逻辑 |

并非所有能力都位于 `Plugin` 上。`Plugin` 负责注册和插件自身状态；`this.app` 连接到宿主服务；`MarkdownRenderer`、`Notice`、`Modal` 等则从 `obsidian` 模块导入。

## 2. 按需求选择扩展点

| 你想实现的功能                     | 官方入口                                                             | 常用配套 API                                               |
| ---------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| 命令面板里增加一个操作             | `Plugin.addCommand()`                                                | `Command`、`Editor`、`Notice`                              |
| 左侧工具栏增加按钮                 | `Plugin.addRibbonIcon()`                                             | `setIcon()`、`Modal`                                       |
| 底部显示字数或同步状态             | `Plugin.addStatusBarItem()`                                          | 返回的 `HTMLElement`；状态栏仅桌面端可用                   |
| 扩展右键菜单                       | `workspace.on("file-menu", ...)`、`workspace.on("editor-menu", ...)` | `Menu`、`MenuItem`                                         |
| 提供插件设置页                     | `Plugin.addSettingTab()`                                             | `PluginSettingTab`、设置定义、`loadData()`、`saveData()`   |
| 把特定代码块渲染为卡片或图表       | `registerMarkdownCodeBlockProcessor()`                               | `MarkdownRenderChild`、渲染上下文                          |
| 修改已渲染 Markdown 的 DOM         | `registerMarkdownPostProcessor()`                                    | DOM 查询和修改                                             |
| 在编辑器输入时增加高亮、装饰或交互 | `registerEditorExtension()`                                          | CodeMirror 6 的 `Extension`、`ViewPlugin`、`StateField` 等 |
| 在输入时显示候选项                 | `registerEditorSuggest()`                                            | `EditorSuggest<T>`                                         |
| 增加独立标签页或侧栏面板           | `registerView()`                                                     | `ItemView`、`WorkspaceLeaf`                                |
| 为自定义文件扩展名提供视图         | `registerExtensions()`                                               | 已注册的视图、`FileView` 或 `TextFileView`                 |
| 参与链接悬浮预览                   | `registerHoverLinkSource()`                                          | Page preview 核心插件、`hover-link` 事件、`HoverParent`    |
| 响应文件、工作区或索引变化         | 对应对象的 `.on(...)`                                                | `registerEvent()`                                          |
| 接收 `obsidian://` 链接调用        | `registerObsidianProtocolHandler()`                                  | URL 中解码后的参数                                         |
| 给 Bases 增加展示方式              | `registerBasesView()`，自 1.10.0 起                                  | `BasesView`、查询结果、视图配置                            |
| 向 Obsidian CLI 注册命令           | `registerCliHandler()`，自 1.12.2 起                                 | `CliFlags`、`CliData`、字符串结果                          |

“接入链接悬浮预览”需要在适当的 DOM 事件中发送相应的 `hover-link` 事件；单独注册一个来源名称不会自动为所有元素添加预览行为。类似地，注册视图工厂只让宿主认识一种视图，打开它还需要工作区 API。

## 3. 先认识宿主的几个主要对象

| 对象或类型             | 职责                           | 常用成员                                                                    |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `Plugin`               | 插件入口、功能注册、配置持久化 | `onload()`、`onunload()`、`addCommand()`、`loadData()`、`saveData()`        |
| `app.workspace`        | 当前打开的文件、窗格和视图     | `getActiveFile()`、`getActiveViewOfType()`、`getLeaf()`、`openLinkText()`   |
| `app.vault`            | 笔记库中的文件及其内容         | `getMarkdownFiles()`、`read()`、`create()`、`process()`、文件事件           |
| `app.fileManager`      | 遵循 Obsidian 规则的文件操作   | `renameFile()`、`generateMarkdownLink()`、`processFrontMatter()`            |
| `app.metadataCache`    | Markdown 解析后的索引信息      | `getFileCache()`、`getFirstLinkpathDest()`、`resolvedLinks`                 |
| `Editor`               | 当前编辑器的文本、光标和选区   | `getValue()`、`getSelection()`、`replaceRange()`、`transaction()`           |
| `Component`            | 资源和子组件的生命周期         | `registerEvent()`、`registerDomEvent()`、`registerInterval()`、`addChild()` |
| `app.keymap` / `Scope` | 按键判断和局部快捷键作用域     | 修饰键判断、注册作用域内快捷键                                              |
| `app.secretStorage`    | 按标识读写秘密值，自 1.11.4 起 | `getSecret()`、`setSecret()`、`listSecrets()`                               |

注意两个常见区别：

- `WorkspaceLeaf` 是工作区里的一个承载位置；`View` 是其中显示的内容。同一种视图可以有多个实例。
- `TFile` 是文件对象，包含路径、扩展名等信息；获取正文需要调用 `vault.read(file)` 等方法。`TAbstractFile` 还可能表示文件夹，使用前需要区分。

在插件类中优先从 `this.app` 取宿主对象，在辅助模块中把 `app` 作为参数传入。这样调用来源明确，也便于测试。当前仓库的 [src/markdown.ts](../../src/markdown.ts) 就采用了参数传入的方式。

## 4. 命令、按钮、菜单和弹窗

### 4.1 命令是最适合入门的扩展点

下面是一个可独立作为插件入口的示例：

```ts
import { Notice, Plugin } from "obsidian";
import type { Command } from "obsidian";

export default class DemoPlugin extends Plugin {
  onload() {
    const showNote: Command = {
      id: "show-current-note",
      name: "显示当前笔记",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        new Notice(file ? file.path : "当前没有打开笔记");
      },
    };
    this.addCommand(showNote);

    const wrapSelection: Command = {
      id: "wrap-selection",
      name: "给选区添加粗体标记",
      editorCallback: (editor) => {
        editor.replaceSelection("**" + editor.getSelection() + "**");
      },
    };
    this.addCommand(wrapSelection);
  }
}
```

命令的 ID 和显示名称会由宿主加上插件前缀。`callback` 适合普通操作，`editorCallback` 只在编辑器上下文中执行，并直接获得 `Editor`。它的第二个参数类型是 `MarkdownView | MarkdownFileInfo`，不要假定任何情况下都是完整的 `MarkdownView`。

需要条件控制时使用 `checkCallback` 或 `editorCheckCallback`。当 `checking === true` 时只判断命令能否执行，不能在这个阶段写文件、弹窗或改变选区。

当前 Beyond-CodeTab 的 [src/main.ts](../../src/main.ts) 使用 `editorCallback` 和 `editor.replaceSelection(TAB_TEMPLATE)` 插入顶部常量定义的标签模板。

### 4.2 同一个动作可以有不同入口

| 入口           | 用法                                             | 合适场景                       |
| -------------- | ------------------------------------------------ | ------------------------------ |
| 工具栏图标     | `addRibbonIcon(icon, title, callback)`           | 高频入口，如打开自己的面板     |
| 文件右键菜单   | 订阅 `file-menu`，再 `menu.addItem(...)`         | 对当前右键指向的文件执行操作   |
| 编辑器右键菜单 | 订阅 `editor-menu`                               | 对选中文本进行转换             |
| 自定义菜单     | `new Menu()`，添加菜单项，再显示                 | 自己的组件上的操作菜单         |
| 普通弹窗       | 继承 `Modal`，实现 `onOpen()` / `onClose()`      | 输入参数、显示详情             |
| 搜索选择弹窗   | 继承 `SuggestModal<T>` 或 `FuzzySuggestModal<T>` | 从文件或条目中选择一项         |
| 输入框候选列表 | `AbstractInputSuggest<T>`                        | 给设置页或自定义输入框提供补全 |
| 短消息提示     | `new Notice(message)`                            | 操作结果、错误信息             |

文件右键菜单回调已经给出了目标 `file`，应使用这个对象；工作区当前激活文件可能是另外一个文件。

Beyond-CodeTab 的 [tabActions.ts](../../src/components/MultiTab/tabActions.ts) 在标签按钮的 `contextmenu` 事件中创建 `Menu`，用 `setUseNativeMenu(false)` 选择随主题显示的 DOM 菜单，再通过 `Modal` 确认删除。双击改名使用临时 HTML 输入框。这些界面通过回调交给 `tabGroup.ts` 写回，不直接修改 Vault。

## 5. Markdown 渲染和编辑器扩展

这几种能力名称相似，但作用阶段不同：

| 能力                                   | 输入和作用对象                          | 适合做什么                            |
| -------------------------------------- | --------------------------------------- | ------------------------------------- |
| `registerMarkdownCodeBlockProcessor()` | 特定语言标记的代码块内部文本和 DOM 容器 | Beyond-CodeTab、图表、交互卡片        |
| `registerMarkdownPostProcessor()`      | 已渲染的 Markdown DOM 片段              | 增强表格、处理链接、添加展示效果      |
| `MarkdownRenderer.render()`            | Markdown 字符串和目标容器               | 在自己创建的面板、弹窗中显示 Markdown |
| `Editor`                               | 编辑器文本及选区                        | 插入模板、替换文本、移动光标          |
| `registerEditorExtension()`            | CodeMirror 6 编辑器                     | 输入行为、装饰、widget、编辑器状态    |
| `registerEditorSuggest()`              | 输入位置和触发上下文                    | 输入关键字时提供候选项                |

### 5.1 自定义代码块

这个教学示例将 `demo-preview` 代码块中的文本当成 Markdown 渲染：

```ts
import { MarkdownRenderChild, MarkdownRenderer, Plugin } from "obsidian";

export default class DemoPreviewPlugin extends Plugin {
  onload() {
    this.registerMarkdownCodeBlockProcessor("demo-preview", async (source, element, context) => {
      const child = new MarkdownRenderChild(element);
      context.addChild(child);
      await MarkdownRenderer.render(this.app, source, element, context.sourcePath, child);
    });
  }
}
```

笔记中可以这样使用：

````markdown
```demo-preview
**这是粗体**，这里可以写 [[另一篇笔记]]。
```
````

`source` 不含外层代码围栏。`context.sourcePath` 用来解析相对链接，也能帮助定位数据来源；它比“当前激活笔记”更能代表这块内容的来源。

`context.getSectionInfo(element)` 可以提供当前源码区段信息，但可能返回 `null`，而且文档修改后行号可能变化。需要定位时再读取，并处理无法定位的情况。

普通 Markdown 后处理器主要面向阅读视图，不是修改 Markdown 解析器语法的入口。代码块处理器还可参与实时预览中已经渲染的代码块；当代码块正在显示或编辑源码时，不应要求自定义 DOM 始终存在。

`MarkdownRenderer.render()` 返回 Promise；内容含有异步渲染逻辑时需要正确等待。旧的 `renderMarkdown()` 已被标记弃用，新代码使用 `render()`。

### 5.2 操作文本和改造编辑器是两个层次

`Editor` 是宿主提供的通用编辑接口。常用操作包括：

| 操作                         | API                                    |
| ---------------------------- | -------------------------------------- |
| 获取全部文本或某一行         | `getValue()`、`getLine()`              |
| 获取和替换选区               | `getSelection()`、`replaceSelection()` |
| 读取和替换指定范围           | `getRange()`、`replaceRange()`         |
| 获取和设置光标               | `getCursor()`、`setCursor()`           |
| 操作多个选区                 | `listSelections()`、`setSelections()`  |
| 将多次修改组织为一次事务     | `transaction()`                        |
| 在行列位置与字符串偏移间转换 | `posToOffset()`、`offsetToPos()`       |
| 编辑器历史和内置操作         | `undo()`、`redo()`、`exec()`           |

如果需求是“将选区转成列表”，通常使用 `Editor` 就够了。如果需求是“用户输入时，某段文本始终显示为特殊 widget”，才需要 CodeMirror 6。

`registerEditorExtension()` 接受 CodeMirror 6 的 `Extension` 或扩展数组。`ViewPlugin`、`StateField`、`Decoration` 等来自 CodeMirror 包；Obsidian 还公开了 `editorInfoField`、`editorLivePreviewField` 等用于连接宿主上下文的字段。扩展应区分源码模式与实时预览，也要跟随编辑器生命周期处理状态。

Beyond-CodeTab 只改造自己临时创建的编辑器，因此没有调用插件级 `registerEditorExtension()`。当前 [tabEditor.ts](../../src/components/MultiTab/tabEditor.ts) 通过 `StateEffect.appendConfig` 安装局部扩展：`CodeBlockEditor` 提供围栏折叠、编辑边界保护和 Prism mark 装饰，类型改变时通过 `Compartment.reconfigure()` 更新着色。外层 DOM 标记和表格边界属性通过 `EditorView.editorAttributes` 声明，跟随文档更新。

Prism 由 [tabPreview.ts](../../src/components/MultiTab/tabPreview.ts) 调用公开的 `loadPrism()` 加载；普通 Markdown、表格和嵌入继续交给 `MarkdownRenderer.render()`。右下角输入的类型也可以是插件处理器名，不限于 Prism 语言。

`registerEditorSuggest()` 则是专门的输入候选扩展。通常继承 `EditorSuggest<T>`，实现 `onTrigger()`、`getSuggestions()`、`renderSuggestion()`、`selectSuggestion()`。候选输入和独立弹窗分别使用 `EditorSuggest` 与 `SuggestModal`。

## 6. 自定义视图、工作区与文件类型

插件可以在侧栏或普通标签页里放一个自己的页面。例如任务面板、笔记统计、图表浏览器，都适合 `ItemView`。

下面的示例注册一个右侧面板，并通过命令打开：

```ts
import { ItemView, Notice, Plugin } from "obsidian";
import type { Command, ViewState } from "obsidian";

const VIEW_TYPE = "code-tab-demo-panel";

class DemoView extends ItemView {
  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "插件开发示例";
  }

  async onOpen() {
    const paragraph: DomElementInfo = {
      text: "这是一个自定义视图。",
    };
    this.contentEl.createEl("p", paragraph);
  }

  async onClose() {
    this.contentEl.empty();
  }
}

export default class DemoViewPlugin extends Plugin {
  onload() {
    this.registerView(VIEW_TYPE, (leaf) => new DemoView(leaf));
    const openPanel: Command = {
      id: "open-demo-panel",
      name: "打开示例面板",
      callback: async () => {
        try {
          const workspace = this.app.workspace;
          const leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? workspace.getRightLeaf(false);
          if (!leaf) {
            return;
          }
          const state: ViewState = {
            type: VIEW_TYPE,
            active: true,
          };
          await leaf.setViewState(state);
          await workspace.revealLeaf(leaf);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "打开面板失败");
        }
      },
    };
    this.addCommand(openPanel);
  }
}
```

需要等启动布局恢复后再操作工作区时，可以使用 `workspace.onLayoutReady()`。`getActiveFile()`、`getActiveViewOfType()` 和 `getRightLeaf()` 都有可能返回 `null`，调用方应明确处理。

对于与文件内容绑定的视图，可继续看 `FileView`、`TextFileView`。后者提供 `getViewData()`、`setViewData()`、`clear()` 等接口，让视图参与文本文件的载入和保存。再通过 `registerExtensions(["myboard"], VIEW_TYPE)`，把自己的扩展名交给已注册的视图处理。

如果只是想在笔记中显示一个交互块，优先使用代码块处理器；只有需要独立页面、独立导航或自定义文件类型时，才需要注册视图。Beyond-CodeTab 当前使用的是前一种方式。

## 7. 文件、属性和元数据索引

### 7.1 按操作目的选择 API

| 需求                       | 推荐入口                                             | 要点                                       |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| 枚举笔记或所有文件         | `vault.getMarkdownFiles()` / `getFiles()`            | 返回文件对象，尚未读取正文                 |
| 按路径查找文件             | `getFileByPath()` / `getAbstractFileByPath()`        | 可能找不到；路径相对笔记库根目录           |
| 读取内容用于展示           | `vault.cachedRead()`                                 | 可以使用缓存                               |
| 直接读取文件               | `vault.read()`                                       | 不代表下一次写入前文件不会再变化           |
| 根据原内容计算新内容       | `vault.process(file, transform)`                     | 在宿主管理的读改写操作中执行同步转换       |
| 写入已确定的完整内容       | `vault.modify()`                                     | 会替换文件正文                             |
| 创建文件或文件夹           | `vault.create()` / `createFolder()`                  | 处理已有路径和不存在的父目录               |
| 处理图片等二进制文件       | `readBinary()` / `createBinary()` / `modifyBinary()` | 使用 `ArrayBuffer`                         |
| 把库内资源用于页面显示     | `vault.getResourcePath()`                            | 生成宿主可以访问的资源 URL                 |
| 重命名并按用户设置更新链接 | `fileManager.renameFile()`                           | 普通 `vault.rename()` 不负责同样的链接维护 |
| 根据用户偏好生成笔记链接   | `fileManager.generateMarkdownLink()`                 | 传入链接所在笔记的路径                     |
| 修改 YAML frontmatter 属性 | `fileManager.processFrontMatter()`                   | 同步修改回调收到的对象                     |
| 按用户设置移至回收站       | `fileManager.trashFile()`                            | 与直接删除语义不同                         |
| 确定附件保存位置           | `fileManager.getAvailablePathForAttachment()`        | 遵循附件位置设置并处理重名                 |

例如，这个辅助函数通过官方 API 更新笔记属性：

```ts
import type { App, TFile } from "obsidian";

export async function markReviewed(app: App, file: TFile): Promise<void> {
  if (file.extension !== "md") {
    return;
  }
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    frontmatter.reviewed = true;
  });
}
```

调用方需要处理返回 Promise 的失败，例如 YAML 格式错误。`processFrontMatter()` 提供属性层面的修改，不承诺逐字保持原 YAML 的排版。

当前 Beyond-CodeTab 在 [src/markdown.ts](../../src/markdown.ts) 中使用 `vault.process()` 保存标签内容，并校验原代码块内容是否仍然匹配。两者承担不同责任：`process()` 提供宿主层的读改写操作；旧内容匹配判断这次编辑基于的内容是否已经过时。文件 API 不会自动知道“这个标签块是不是用户开始编辑时的那个”。

`vault.process()` 的转换函数必须同步返回字符串，不能写成 `async`。它也不是与所有外部编辑器和同步工具之间的分布式锁。

### 7.2 MetadataCache 用于查询解析结果

`app.metadataCache.getFileCache(file)` 可以获得 `CachedMetadata`，其中可能包含：

- `headings`：标题及位置。
- `links`、`embeds`：链接与嵌入。
- `tags`、`frontmatter`：标签和 YAML 属性。
- `blocks`、`listItems`、`sections`：块 ID、列表项和文档区段。

查找 `[[某篇笔记]]` 对应文件时，可用 `getFirstLinkpathDest(linkpath, sourcePath)`，交由宿主处理链接解析。

索引更新与文件写入不是同一个时刻，读取缓存可能得到 `null`，字段也可能不存在。需要等待解析完成时，订阅 `metadataCache` 的 `changed`、`resolve` 或 `resolved` 事件。修改缓存对象不会替你把内容保存到笔记。

## 8. 事件与生命周期：把资源挂在正确的对象上

常用事件可以按来源分类：

| 事件来源            | 常见事件                                             | 用途                   |
| ------------------- | ---------------------------------------------------- | ---------------------- |
| `app.vault`         | `create`、`modify`、`delete`、`rename`               | 响应文件变化           |
| `app.metadataCache` | `changed`、`deleted`、`resolve`、`resolved`          | 响应索引和链接解析变化 |
| `app.workspace`     | `file-open`、`active-leaf-change`、`layout-change`   | 响应当前页面和布局变化 |
| `app.workspace`     | `editor-change`、`editor-paste`、`editor-drop`       | 响应编辑和输入事件     |
| `app.workspace`     | `file-menu`、`files-menu`、`editor-menu`、`url-menu` | 为宿主菜单添加操作     |
| `app.workspace`     | `window-open`、`window-close`、`css-change`          | 响应弹出窗口和样式变化 |
| DOM 元素            | `click`、`keydown` 等标准 DOM 事件                   | 自己界面中的交互       |

例如，下面的辅助函数为插件登记一个元数据监听器：

```ts
import type { Plugin } from "obsidian";

export function registerHeadingLog(plugin: Plugin): void {
  plugin.registerEvent(
    plugin.app.metadataCache.on("changed", (file, _data, cache) => {
      console.log(file.path, cache.headings?.length ?? 0);
    }),
  );
}
```

生命周期管理的几个入口是：

| API                                         | 卸载时的处理                       |
| ------------------------------------------- | ---------------------------------- |
| `registerEvent(eventRef)`                   | 取消 Obsidian 事件订阅             |
| `registerDomEvent(element, type, handler)`  | 移除 DOM 监听器                    |
| `registerInterval(window.setInterval(...))` | 清除定时器                         |
| `register(cleanup)`                         | 执行自定义清理函数                 |
| `addChild(component)`                       | 将子组件纳入父组件的加载和卸载流程 |
| `removeChild(component)`                    | 移除并卸载动态子组件               |
| `context.addChild(renderChild)`             | 将 Markdown 组件交给渲染器管理     |

插件级功能挂在 `Plugin` 上；某个代码块自己的事件挂在该块的 `MarkdownRenderChild` 上。否则代码块消失后，资源可能继续留到整个插件卸载时才释放。

Beyond-CodeTab 在 [src/main.ts](../../src/main.ts) 中注册处理器，由 [OpenAPI 渲染适配](../../src/openapi/render.ts) 为每个 `tab` 块挂载 `MarkdownRenderChild`，在 [tabGroup.ts](../../src/components/MultiTab/tabGroup.ts) 中为每页建立生命周期组件。编辑时再挂载 [TabEditor](../../src/components/MultiTab/tabEditor.ts)，由它管理原生 embed、类型输入框和输入事件；保存、取消或整块卸载时一起释放。窗口捕获阶段的键盘监听和补全失焦定时器随组件清理。

监听文件修改后再次写同一文件，可能触发自己的监听器。需要通过内容是否变化、操作来源或业务条件避免重复写入。`vault` 的 `create` 事件在启动加载库时也可能出现；只关心启动后的新文件时，可在 `onLayoutReady()` 中再注册。

## 9. 设置与持久化

设置通常包含三个部分：内存中的设置对象、设置页面、磁盘持久化。`loadData()` 和 `saveData()` 读写插件目录中的 `data.json`，它们不会自动修改笔记正文。

在本仓库使用的 1.13.1 API 中，设置页提供了新的声明式接口。下面的完整示例要求 Obsidian 1.13.0 或更高版本：

```ts
import { Plugin, PluginSettingTab } from "obsidian";
import type { SettingControl, SettingDefinitionItem } from "obsidian";

interface DemoSettings {
  showHint: boolean;
}

class DemoSettingsTab extends PluginSettingTab {
  getSettingDefinitions(): SettingDefinitionItem[] {
    const control: SettingControl = {
      type: "toggle",
      key: "showHint",
      defaultValue: true,
    };
    const setting: SettingDefinitionItem = {
      name: "显示提示",
      desc: "控制示例功能是否显示提示。",
      control,
    };
    return [setting];
  }
}

export default class DemoSettingsPlugin extends Plugin {
  settings: DemoSettings = {
    showHint: true,
  };

  async onload() {
    const saved = await this.loadData();
    if (typeof saved?.showHint === "boolean") {
      this.settings.showHint = saved.showHint;
    }
    this.addSettingTab(new DemoSettingsTab(this.app, this));
  }
}
```

`PluginSettingTab` 的默认 `getControlValue()` 从 `plugin.settings` 读取值，`setControlValue()` 修改并持久化设置。需要自定义存储时，可以覆盖它们。上述开关只演示配置读写，实际功能还需要读取 `settings.showHint`。

旧教程常见的方式是覆盖 `display()`，再通过 `new Setting(containerEl).addToggle(...)` 手动创建控件并调用 `saveData()`。1.13.1 的声明将 `display()` 标记为自 1.13.0 起弃用，建议新设置页使用 `getSettingDefinitions()`；需要兼容旧版时仍要设计相应的回退路径。

配置文件被同步工具从外部更新时，可以实现 `onExternalSettingsChange()` 重新读取设置。内存状态与持久化状态也要区分：Beyond-CodeTab 的 `activeTabs` 是插件实例内的 Map，不会自动保存到 `data.json`。

## 10. 外部调用、网络请求和通用工具

### 10.1 URI 与 CLI 是两种外部入口

`registerObsidianProtocolHandler()` 可以接收自定义的 `obsidian://` 动作。`registerCliHandler()` 则把命令注册给 Obsidian 自己的 CLI，要求对应宿主支持并配置好 CLI。它与仓库里负责构建插件的 npm 脚本无关。

```ts
import { Notice, Plugin, requireApiVersion } from "obsidian";

export default class DemoIntegrationPlugin extends Plugin {
  onload() {
    this.registerObsidianProtocolHandler("code-tab-demo", (params) => {
      new Notice(params.message || "收到外部调用");
    });

    if (requireApiVersion("1.12.2")) {
      this.registerCliHandler("code-tab-demo:count", "返回当前笔记库的 Markdown 文件数", null, () =>
        String(this.app.vault.getMarkdownFiles().length),
      );
    }
  }
}
```

URI 示例是 `obsidian://code-tab-demo?message=Hello`。动作处理器收到解码后的参数。实际功能应检查必要参数，并使用能区分插件的动作名。

CLI 命令 ID 必须全局唯一；官方建议默认命令使用插件 ID，子命令使用 `<plugin-id>:<action>`。处理函数返回字符串或 `Promise<string>`。这些注册不会把 Obsidian 自动变成 HTTP 服务。

### 10.2 常用辅助能力

| 类别             | 官方 API                                                 | 说明                                                                       |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| HTTP 请求        | `requestUrl()`、`request()`                              | 宿主提供的请求能力；`requestUrl()` 可读取状态码、响应头、JSON 和二进制内容 |
| 路径与链接       | `normalizePath()`、`parseLinktext()`、`getLinkpath()`    | 处理库内路径和链接文本                                                     |
| YAML 与属性      | `parseYaml()`、`stringifyYaml()`、`getFrontMatterInfo()` | 解析和序列化相关文本                                                       |
| 图标与提示       | `setIcon()`、`addIcon()`、`setTooltip()`                 | 使用宿主图标和提示样式                                                     |
| 搜索             | `prepareFuzzySearch()`、`prepareSimpleSearch()`          | 得到匹配结果，配合 `renderMatches()` 展示                                  |
| 防抖             | `debounce()`                                             | 将连续触发合并为延迟执行，适合输入和刷新场景                               |
| 平台与版本       | `Platform`、`requireApiVersion()`                        | 判断桌面端、移动端和 API 版本                                              |
| 展示工具         | `loadPrism()`、`loadMermaid()`、`renderMath()`           | 按需加载高亮、图表或使用公式渲染能力                                       |
| HTML 与 Markdown | `htmlToMarkdown()`、`sanitizeHTMLToDom()`                | 内容转换、处理 HTML 片段                                                   |

`requestUrl()` 的官方声明说明它不受浏览器 CORS 限制，但这不会绕过服务端身份验证，也不代表所有 `fetch()` 选项都可照搬。它返回的响应使用 `.text`、`.json` 等属性，具体按 `RequestUrlResponse` 类型访问。

样式同样有官方约定。可以在 `styles.css` 中使用 `--background-primary`、`--text-normal`、`--interactive-accent` 等主题变量。本项目的样式分别位于 [MultiTab/styles.css](../../src/components/MultiTab/styles.css) 和 [CodeBlockEditor/styles.css](../../src/components/CodeBlockEditor/styles.css)，由根 CSS 的 `@import` 汇总并打包为一个 `dist/styles.css`。DOM 的 `createEl()`、`empty()` 等便利方法也有官方类型声明；它们不会自动提供响应式数据绑定。

## 11. Bases 等较新扩展能力

Bases 自定义视图适合把属性查询结果展示为卡片、时间线或其他布局。其基本流程是：

1. 继承 `BasesView`。
2. 用 `registerBasesView(viewId, registration)` 注册名称、图标和工厂函数。
3. 从 `this.data` 读取查询结果，从 `this.config` 读取视图配置。
4. 在 `onDataUpdated()` 中根据最新查询结果更新界面。

`BasesView` 自 1.10.0 起提供。宿主会替换其 `data` 结果对象，不应长期保存旧引用。`registerBasesView()` 在当前库未启用 Bases 时返回 `false`。

这类视图的输入是 Bases 查询结果，普通 `ItemView` 的数据则由插件自己组织。要增加一个自定义侧栏，不需要引入 Bases；要为 Bases 的结果增加展示方式，才使用这组专门接口。

较新能力的版本入口可按下面核对：

| 能力                                | 声明中的起始版本 |
| ----------------------------------- | ---------------- |
| `Vault.process()`                   | 1.1.0            |
| `FileManager.processFrontMatter()`  | 1.4.4            |
| `Plugin.onExternalSettingsChange()` | 1.5.7            |
| `Plugin.onUserEnable()`             | 1.7.2            |
| `Plugin.registerBasesView()`        | 1.10.0           |
| `SecretStorage` 读写方法            | 1.11.4           |
| `Plugin.registerCliHandler()`       | 1.12.2           |
| `Plugin.settings`、声明式设置定义   | 1.13.0           |

`onload()` 用于每次插件加载时注册功能；`onUserEnable()` 是用户主动启用插件后的初始化入口，可以用来显示引导或打开首次使用面板。二者不应混同。

安装了新版 API 类型，只说明 TypeScript 能识别这些方法。目标用户的 Obsidian 版本仍然需要满足要求，`manifest.json` 的 `minAppVersion` 应反映实际依赖，不能通过填写一个较低版本来获得兼容性。

## 12. 如何区分公开 API 和内部实现

判断一个接口是否公开，先查对应版本的官方类型声明和开发文档。控制台里能访问到某个属性，或者自己给它补上了 TypeScript 类型，都不等于宿主承诺支持它。

当前 Beyond-CodeTab 是很直观的例子：

| 仓库中的使用位置                                    | API 或机制                                                   | 边界                                                            |
| --------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/main.ts`                                       | `Plugin`、`addCommand()`、代码块处理器                       | 公开扩展点                                                      |
| `src/main.ts`                                       | `MarkdownRenderChild`、`context.addChild()`                  | 公开生命周期 API                                                |
| `src/components/MultiTab/tabPreview.ts`             | `MarkdownRenderer.render()`、`loadPrism()`                   | 公开 Markdown 渲染和语法加载 API                                |
| `src/components/MultiTab/tabGroup.ts`               | `registerDomEvent()`、`addChild()`、`removeChild()`          | 公开生命周期 API                                                |
| `src/components/MultiTab/tabActions.ts`             | `Menu`、`Modal`、`Notice`                                    | 公开界面 API                                                    |
| `src/markdown.ts`                                   | `vault.process()`、`read()`、`modify()`                      | 公开文件 API                                                    |
| `src/components/MultiTab/tabEditor.ts`              | `app.embedRegistry.getEmbedCreator()`、`editor.cm`           | 内部接口，用于创建原生编辑器并取得其 CodeMirror 实例            |
| `src/components/CodeBlockEditor/` 和 `tabEditor.ts` | `StateField`、`Decoration`、`EditorView.editorAttributes` 等 | CodeMirror 自己的扩展 API；接入 Obsidian 实例仍需上面的内部接口 |
| `src/components/MultiTab/types.ts`                  | `AppWithEmbedRegistry`、`NativeMarkdownEmbed`                | 本项目为内部接口定义的类型，不是官方类型                        |
| 原生编辑器相关代码                                  | `showEditor()`、`editor.cm`                                  | 依赖内部对象结构，不属于通用 `Editor` 的公开创建接口            |

在本文核对的公开 API 中，`Editor` 主要用于操作已有的编辑器，没有与本项目 `embedRegistry` 用法等价的“在任意容器创建完整原生 Markdown embed editor”的公开工厂。

因此，Beyond-CodeTab 的浏览态使用公开 `MarkdownRenderer`，进入编辑态时才尝试内部 embed 接口，失败后回退到 `textarea`。学习时可以先用公开渲染和简单输入控件完成业务流程，再研究这层内部集成。

Obsidian 也没有把所有内置功能都开放为注册接口。例如，不能仅凭控制台出现了某个设置管理器，就推断存在稳定的“注册任意 Properties 类型”能力。需要的功能在公开声明中找不到时，应先确认文档和版本，再决定是否采用替代实现。

## 13. 源码阅读与查询路径

学习本仓库可以按如下次序将扩展点对应到实际代码：

1. [src/main.ts](../../src/main.ts)：看 `onload()` 如何注册代码块和命令。
2. [MultiTab/tabGroup.ts](../../src/components/MultiTab/tabGroup.ts)、[tabPreview.ts](../../src/components/MultiTab/tabPreview.ts)、[tabActions.ts](../../src/components/MultiTab/tabActions.ts)：看状态协调、公开渲染和界面 API 如何配合。
3. [MultiTab/tabEditor.ts](../../src/components/MultiTab/tabEditor.ts) 与 [CodeBlockEditor](../../src/components/CodeBlockEditor/index.ts)：看临时编辑器、局部扩展和资源释放。
4. [src/markdown.ts](../../src/markdown.ts)：看为什么保存需要同时处理文件定位、原内容校验和文本替换。
5. [MultiTab/types.ts](../../src/components/MultiTab/types.ts) 与 [tabContent.ts](../../src/components/MultiTab/tabContent.ts)：区分业务数据、内容分类、官方类型和内部接口适配类型。
6. [tests/README.md](../../tests/README.md)：选择无需宿主的逻辑检查，或真实 Obsidian 的布局、输入和文件回写回归；表格瞬间位移需要逐帧采样。

安装依赖后，本地权威入口是 `node_modules/obsidian/obsidian.d.ts`。在编辑器中对 `Plugin` 或方法名“跳转到定义”，可以直接看到参数、返回值、`@since` 和 `@deprecated`。在终端里也可以查找：

```bash
rg -n 'registerMarkdownCodeBlockProcessor|registerEditorExtension|registerBasesView' node_modules/obsidian/obsidian.d.ts
rg -n 'export class Vault|export class Workspace|export class MetadataCache' node_modules/obsidian/obsidian.d.ts
rg -n 'registerCliHandler|getSettingDefinitions|@deprecated' node_modules/obsidian/obsidian.d.ts
```

官方资料入口：

- [Obsidian 开发者文档](https://docs.obsidian.md/)：概念、教程和 TypeScript API 参考。
- [Plugin API](https://docs.obsidian.md/Reference/TypeScript+API/Plugin)：查看插件提供的注册方法和生命周期接口。
- [官方 API 类型仓库](https://github.com/obsidianmd/obsidian-api)：查看公开声明及其变更；默认分支可能比项目依赖更新。
- [官方 obsidian.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)：直接查看完整 API 签名、事件列表、版本与弃用信息。
- [本项目使用的 1.13.1 包](https://www.npmjs.com/package/obsidian/v/1.13.1)：确认版本基线。
- [官方示例插件](https://github.com/obsidianmd/obsidian-sample-plugin)：查看最小插件结构和常见注册方式。
- [Markdown 后处理文档](https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing)：理解渲染扩展点。
- [CodeMirror 6 扩展文档](https://docs.obsidian.md/Plugins/Editor/CodeMirror+6+extensions)：继续学习编辑器层扩展。

下一步最适合做的练习，是为 Beyond-CodeTab 增加一个独立命令：读取当前笔记、统计其中的标签块，再用 `Notice` 显示结果。这个练习能串起命令入口、工作区、文件 API 和已有解析逻辑，同时保留清晰的功能边界。
