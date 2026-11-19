# Code Tab 原子 API 与扩展边界

状态：统一 API 已在当前工作树实现，尚未发布。路径为 `src/openapi/`。完整类型见 types.ts 与 `dist/code-tab-api.d.ts`；使用说明见 [简洁接口文档](../../src/openapi/api-doc.md)。

## 原子能力

| 边界 | 责任 |
| --- | --- |
| 数据 | parse/serialize 处理不含外层围栏的块体，数据为 title/content |
| 宿主同步 | update 接受宿主已经确定的数据，不回声保存 |
| 用户变更 | apply 与界面编辑统一走 onChange，由宿主接受事务 |
| 内容版本 | revision 表示已接受内容，批次必须传 expectedRevision |
| 视图状态 | 选择、焦点、编辑和订阅独立于内容版本 |
| 生命周期 | 父 Component、容器所有权、dispose 和迟到结果保护 |

标签以索引配合 revision 定位。标题是展示字段，允许重名；稳定标签 ID 及其 Markdown 映射尚未实现。

## 保存与事务取舍

宿主接受变更后才更新已接受源码。正文、标题、增删和排序走同一提交路径。一批操作先在副本上校验，再保存一次；无效批次不触发写入。

忙碌时拒绝覆盖草稿，调用者保留待同步数据并重试，没有强制覆盖或内部宿主任务队列。预览失败可发生在提交接受之后，RenderFailed 不能等同于“内容未保存”。

公开挂载只调用宿主保存回调。普通 Markdown 共用 MultiTab 组件，继续使用 Vault 源码匹配和换行保护。sourcePath 是渲染上下文，不能替代保存匹配依据。

## 模块结构

- `types.ts`：输入、数据、操作和句柄类型。
- `errors.ts`：独立错误枚举与错误类。
- `operations.ts`：副本操作、全批次校验和活动索引跟踪。
- `api.ts`：解析、序列化、渲染与能力门面。
- `render.ts`：Obsidian 挂载和容器生命周期。
- `discovery.ts`：Document 能力发现。
- `MultiTab/tabGroup.ts`：标签数据、编辑会话和提交控制。

用户已明确允许破坏性重构，不分 v1/v2，不保留旧渲染请求适配。使用 obsidian-code-tab-api 发现，没有版本字段。此次实现不移动稳定 tag 或发布新版本。

## 后续扩展

原子能力可用于节点嵌入、教学、题目编辑、多语言片段和文档生成。稳定标签 ID、草稿导入导出、静态导出和能力细化可独立讨论，未作为当前 API 承诺。

补全通过独立 `src/core/completion/` 开放词表与规则。纯文本候选查询不需要渲染 Code Tab，其他编辑器可以自行适配。
