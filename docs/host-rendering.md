# 可选宿主渲染接口

- **用途**
  - MindMap Studio 等宿主可以把标签组挂到自己的节点中，保留活动组件和标签交互。
  - 普通 Markdown 的处理器保持原有保存方式；宿主模式由回调接管正文写入，不用片段行号直接改文件。
  - 实现入口为 `src/hostRender.ts`，编辑与标签管理仍收在 `MultiTab/tabGroup.ts`。

## 协议 v1

- 向容器所属 `Document` 派发 `CustomEvent('obsidian-codeblock-render', { detail: request })`。
- 请求字段
  - `version: 1`、`language: 'tab'`。
  - `source`：完整标签组源码，不含最外层围栏。
  - `sourcePath`：真实文件路径，供 Markdown 相对链接与嵌入解析。
  - `id`：宿主组件生命周期内稳定的标签组 ID。
  - `container`：已挂载的 DOM 容器。
  - `component`：已加载的 Obsidian Component，宿主负责关闭时卸载。
  - `readOnly`：只读模式；没有 `onChange` 时也按只读处理。
  - `onChange(expected, next)`：异步正文提交，`next: null` 表示移除整个围栏块。宿主需核对预期源码，并将修改纳入自己的保存与撤销管线。
  - `onEditingChange(editing)`：可选编辑开始/结束通知，供宿主避免重建正在输入的组件。
  - `handled: false`：CodeTab 同步设 true 表示接管。
  - `completion`：CodeTab 同步设置初次预览完成 Promise。
- CodeTab 不负责新增、拼接外层围栏，也不自行定位宿主原文件行号。
- 正文编辑、标签新增、改名、删除和排序共用同一个保存回调；回调拒绝时沿用现有错误反馈与状态保护。

## 生命周期与只读

- 子组件挂在请求的 Component 下；卸载后释放预览、编辑器、监听与宿主组选择记录。
- 接口监听注册在主窗口和后续独立窗口；随 CodeTab 或窗口关闭清理。
- 只读组可点击或用方向键切页，不提供新增、改名、删除、排序和内容编辑。
- 活动组件不应被 `innerHTML` 复制后当作交互组件使用；宿主重排时应迁移同一根元素。
- 导出与离屏测量可由宿主单独生成静态副本。

## 验证

- `npm test`、`npm run lint`、`npm run build` 校验本仓库。
- `npm run test:obsidian` 验证普通 Markdown 的五组原有交互。
- 与 MindMap Studio 配套的实际宿主回归在该仓库的 `scripts/verify-plugin-obsidian.mjs`，验证标签切换、编辑增高焦点、文档保存、共享撤销、标签新增/改名和只读嵌入。
- 宿主协议不是 Obsidian 内置 API，需要双方支持 v1；未接入该协议的应用继续使用 CodeTab 的普通 Markdown 处理器。
