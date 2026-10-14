# Code Tab 演进记录

本文只记录重要版本及其主要特性。实现细节和专题设计分别见同目录下的其他文档。

## Git Tag 现状

- 当前 `manifest.json` 版本为 `2.2.1`。轻量 tag `2.2.1` 固定指向提交 `86d6385`，作为交互与布局修复完成后的稳定基线；后续维护性重构位于该 tag 之后，不移动基线。

  - `1.0`：轻量 tag，指向早期 1.0 更新节点
    - 建立 Code Tab 插件的基础结构
    - 支持在 Markdown 中声明并渲染标签内容
  - `2.0-alpha`：轻量 tag，指向上游 2.0-alpha 重构节点
    - 支持新增、删除、重命名、拖拽和内容编辑。
    - 每个标签常驻一个原生 Markdown embed。
    - 原生 embed 带来整页 padding、多余控件和较重的布局结构。
  - `2.2.1`：轻量 tag，指向当前稳定功能基线
    - 包含混合 Markdown 编辑、高亮、列表布局、拖拽和 Excalidraw Frame Deck。
    - 作为后续模块拆分前的可回退节点。

## 2.0.1

- 浏览态改用公开的 `MarkdownRenderer`，不再常驻原生编辑器。
- 页面结构变轻，但阅读视图暂时不能直接编辑。

## 2.2.0

- 浏览态继续使用轻量 Markdown 渲染。
- 进入编辑时按需创建 Obsidian 原生 Markdown embed editor，退出后立即卸载。
- 原生编辑器不可用时使用可见的降级输入框。
- 保护代码围栏、光标边界、选区、粘贴和快捷键保存行为。


## 2.2.1

- 统一 `c++`、`c#` 等语言别名，保持浏览态与编辑态的语法着色一致。
- 编辑区域随正文自然增高和收缩，不产生内部纵向滚动。
- 支持新增、重命名、删除和拖拽排序，并将结果安全写回 Markdown。
- 支持代码、Markdown 和其他已注册处理器之间的渲染类型转换。
- 改进表格原地编辑，避免进入编辑时发生布局跳动。
- 支持可选的 Excalidraw Frame Deck 循环翻页。
- 按 `MultiTab`、`CodeBlockEditor` 和内容适配层拆分组件职责。

## 2.2.1 之后（未发布）

- `tabGroup.ts` 继续持有标签数据、编辑会话和安全写回事务；静态 DOM/ARIA 同步移入 `tabView.ts`，HTML5 拖拽瞬时状态移入 `tabDragController.ts`。
- 混合 Markdown 围栏扫描移入 `fencedCodeRanges.ts`，Prism 高亮模块只负责分词和 CodeMirror decoration。
- 原生编辑器与降级输入框样式移入 `editorStyles.css`，标签外壳和预览布局继续保留在 `styles.css`。
- 这次拆分不增加框架、基类或新的持久状态，对外 Markdown 格式和交互行为保持不变。
