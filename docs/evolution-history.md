# Beyond-CodeTab 演进记录

本文只记录重要版本及其主要特性。实现细节和专题设计分别见同目录下的其他文档。

## 仓库迁移（2026-11-19）

- GitHub 仓库迁移至 [volmodaoist/Beyond-CodeTab](https://github.com/volmodaoist/Beyond-CodeTab)，`origin` 使用 `git@github-zizi:volmodaoist/Beyond-CodeTab.git`。
- 目标仓库承接 Code Tab 的原有开发历史。修正此前误关联到 Oh-My-Immersive 的操作，移除误接入的 Immersive Folder 合并历史，并保留图片清理、提交检查及发布工作流。
- Code Tab 的源码、插件标识 `obsidian-code-tab`、版本 `2.2.1` 和原有版本标签继续保留；原有功能提交没有重写，文档中的提交引用仍然有效。
- 发布工作流使用 `dist/` 中的构建产物，产物来源验证示例指向 Beyond-CodeTab 仓库。

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

- 对外品牌统一为 `Beyond-CodeTab`，维护者为 `volmodaoist`，清单补充作者主页，包信息补充项目、问题反馈与仓库链接。插件 ID `obsidian-code-tab`、`tab` Markdown 语法及现有 API 标识用于延续安装与接入。

- 实现统一 `src/openapi/`：解析/序列化、挂载句柄、快照、外部同步、批量事务、选择/焦点、编辑控制、订阅与释放。类型声明随构建输出，使用说明见 [api-doc.md](../src/openapi/api-doc.md)。
- 实现可复制的 `src/core/completion/`，内置八种热门语言词表，开放词表和规则注册/替换/清理及 JSON 设置。错误码采用独立枚举。
- 用户明确允许破坏性接口重构，移除旧渲染请求协议，不分 v1/v2。通过容器所属 Document 发现 API 后挂载句柄。
- 补全与普通 Markdown/宿主嵌入共用，保留围栏、高亮和保存流程；初始化下一帧不再覆盖用户已经移动的光标。
- 将预览失败与保存失败分开，渲染失败可重试且不会重复保存或增加内容版本。完整回归包括 81 项核心测试和六组真实 Obsidian 界面测试；可选 Excalidraw 未运行。
- 清理与当前定制版样式不一致的上游截图。
- 将 `.github/workflows/check-commit.py` 接入 `commit-msg` 钩子，清理并检查提交说明中的署名和邮箱；提交前继续执行 lint，提交后核对实际写入的说明。
- 宿主提供真实文件路径、稳定组 ID、已加载父 Component 与正文提交回调，避免在节点片段中依赖原文件行号；同名实例状态隔离。
- 宿主模式的内容编辑、增删标签、改名与排序共用保存回调；只读组保留切页，禁用编辑和标签管理。
- 普通 Markdown 保持原有 Vault 保存方式；详细接口见 [host-rendering.md](host-rendering.md)。

- `tabGroup.ts` 继续持有标签数据、编辑会话和安全写回事务；静态 DOM/ARIA 同步移入 `tabView.ts`，HTML5 拖拽瞬时状态移入 `tabDragController.ts`。
- 混合 Markdown 围栏扫描移入 `fencedCodeRanges.ts`，Prism 高亮模块只负责分词和 CodeMirror decoration。
- 原生编辑器与降级输入框样式移入 `editorStyles.css`，标签外壳和预览布局继续保留在 `styles.css`。
- 这次拆分不增加框架、基类或新的持久状态，对外 Markdown 格式和交互行为保持不变。
