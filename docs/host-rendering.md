# Code Tab 公开嵌入 API

统一 API 已在当前工作树实现，尚未发布。简洁的参数、句柄和补全示例见 [src/openapi/api-doc.md](../src/openapi/api-doc.md)，类型以 `src/openapi/types.ts` 与构建产物 `dist/code-tab-api.d.ts` 为准。

## 挂载和源码

接入方通过容器所属 Document 的 `obsidian-code-tab-api` 事件取得 `CodeTabApi`，调用 `await api.render(options)`，保存返回的 `CodeTabHandle`。旧 `obsidian-codeblock-render` 渲染请求已移除，不再使用 version、language、handled 或请求上的 completion。

options 必填 container、已加载的父 Component、id、完整 source 块体与 sourcePath。source 不含最外层 tab 围栏。sourcePath 是相对链接和嵌入上下文，公开挂载不会直接写该文件。

相同调用者 id 的多个实例隔离活动页、异步操作和编辑状态。同一容器已有活动实例时返回 ContainerInUse。初始化失败释放容器；父组件或插件初始化期间卸载时拒绝挂载 Promise。

## 两条数据路径

- 宿主已有数据 → `update(patch)` → 组件同步 → 快照通知。没有保存回声。
- 用户编辑或 `apply` → 校验 → `onChange(expected, next)` → 宿主接受 → 内容 revision 更新 → 预览与状态通知。

onChange 必须把预期块体核对、实际保存与宿主撤销合并为自己的事务。next 为 null 时删除整个块。回调拒绝保留已接受内容，正文草稿也保留以便重试。

expected 保留宿主最后一次接受的原始 source，CRLF 匹配依据不会因 parse/serialize 丢失。修改后的宿主块体保留原换行风格。parse/serialize 会规范化空白，不承诺字节级往返。

revision 只随已接受 source 改变；选择和交互状态不增加版本。快照中的 source 不包含草稿，editing 专指正文编辑。标题输入、删除确认、保存和渲染同样使修改接口 Busy。

## 事务与失败

apply 接收顺序操作批次，后续索引基于前一步结果；move-tab 的 toIndex 是最终位置。先校验全部操作和 expectedRevision，再调用一次 onChange。无效、空批次及无源码变化的批次不保存。

删除最后一页提交 null，句柄保留空组及原容器；宿主决定移除节点或后续插入。标题可以重复，不适合作为稳定数据键。

同值 update 不重建，交互中也可无操作返回。变更 source/sourcePath/readOnly 时，Busy 保留输入，由宿主保留最新待同步值并在交互结束后重试。不要同步递归订阅更新。

RenderFailed 与 CommitFailed 分开：预览失败可能发生在宿主已经接受保存之后。读取快照判断 source/revision，再 update 重试预览，避免重复保存与撤销。订阅回调失败隔离，不破坏事务。

## 生命周期

没有 onChange 时始终只读；只读保留切页，禁用编辑及标签管理。父 Component 卸载或 Code Tab 停用会释放句柄、预览、编辑器、监听与内部选择记录。dispose 重复调用安全，不保存草稿，清空内容但保留宿主容器。

原生 Markdown 处理器在切换或关闭视图时允许初始化被取消，Disposed 正常收尾，避免异步渲染产生未捕获异常；公开 api.render 仍拒绝 Disposed，让宿主丢弃迟到结果。其它渲染失败继续上抛。

宿主节点关闭前显式选择 commit 或 cancel。节点重排移动同一 DOM 容器，不复制 innerHTML。保存或预览迟到后不能修改已关闭节点或复用容器上的新实例。插件重新启用后重新发现 API 并挂载。

Document 发现监听覆盖主窗口和新弹出窗口，并随关闭清理。声明文件仅提供类型，运行时枚举通过 api.errorCodes / api.completion.errorCodes 取得。

## 实现与验证

`src/openapi/render.ts` 管理容器所有权与生命周期，公开挂载及普通 Markdown 共用 `MultiTab/tabGroup.ts`。普通 Markdown 保存继续走 Vault 源码匹配路径；宿主保存只走回调。

补全引擎独立位于 `src/core/completion/`，详见 [补全 Core](feat/code-completion-core.md)。共享引擎应由 Code Tab 释放，注册者只清理自己的规则。

执行 `npm run lint && npm test && npm run build`，真实回归为 `npm run test:obsidian`。接口和补全回归在 `tests/obsidian/openapi-completion.mjs`，包含初始化/卸载、写入冲突、CRLF、词表和设置恢复。导图实际保存与共享撤销需要在接入仓库继续验证，见 [导图迁移指南](mindmap-openapi-handoff.md)。
