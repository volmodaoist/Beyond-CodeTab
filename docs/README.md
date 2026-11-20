# Beyond-CodeTab 文档导航

当前 `main` 实现了标签编辑、统一 OpenAPI 和词表补全。文档以当前实现为准；manifest 仍为 `2.2.1`，同名 tag 是此前的稳定基线，新增功能尚未发布新 tag，详见[演进记录](evolution-history.md)。

## 使用插件

先读 [README](../README.md)：从源码安装、四反引号嵌套代码块、编辑快捷键、标签管理、自定义补全和常见问题。

## 接入或复用

| 文档                                                   | 内容                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| [API 使用说明](../src/openapi/api-doc.md)              | 发现 API、类型声明、挂载 options、句柄、标签操作和补全注册 |
| [宿主渲染契约](host-rendering.md)                      | 两条数据路径、保存冲突、Busy、预览失败、只读和生命周期     |
| [原子 API 设计](feat/public-api.md)                    | 接口边界、保存事务和后续扩展的取舍                         |
| [补全 Core](feat/code-completion-core.md)              | 词表、规则、UTF-16 范围、配置与编辑器适配                  |
| [可复制补全模块](../src/core/completion/README.md)     | 整体复制使用、最小调用示例、独立测试和许可证               |
| [Excalidraw Frame Deck](feat/excalidraw-frame-deck.md) | 自动识别、Frame 排序、嵌入与降级边界                       |

OpenAPI 是插件之间的本地 TypeScript/DOM 接口，没有 HTTP 服务。外部宿主接管自己的持久化与撤销，Beyond-CodeTab 负责标签组件和编辑会话。

## 开发与维护

- [Obsidian 插件开发入门](tech/obsidian-plugin-development-guide.md)：加载、渲染、编辑、保存、组件生命周期和本地调试。
- [Obsidian 扩展点与官方 API 导览](tech/obsidian-extension-points-and-api.md)：按任务查找宿主能力。
- [测试说明](../tests/test-guide.md)：核心检查、七组真实 Obsidian 回归、产物与定位标识。
- [演进记录](evolution-history.md)：版本基线、重要改动和来源。
- [代码约定](../AGENTS.md)：风格、验证、提交说明与发布要求。

源码和类型定义是契约依据。插件 ID `obsidian-code-tab`、Document 事件 `obsidian-code-tab-api` 和 `CodeTabApi` 类型名继续用于已有安装与接入；对外展示名为 Beyond-CodeTab。
