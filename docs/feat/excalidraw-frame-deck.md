# Excalidraw Frame Deck 技术方案

## 1. 目标

当 Beyond-CodeTab 的一个标签正文仅包含一个 Excalidraw 嵌入，并且该画板包含两个及以上 Frame 时，将它自动渲染为可手动翻页的 Frame Deck：

```text
┌──────────────────────────────────────────────┐
│                                  ◀  2 / 6  ▶ │
│                                              │
│              当前 Excalidraw Frame           │
│                                              │
└──────────────────────────────────────────────┘
```

用户继续使用标准 Markdown，不引入新的围栏或专有数据格式：

````markdown
```tab
tab: 架构演进
![[互联网架构演进.excalidraw.md]]
```
````

功能范围：

- 自动识别单一 Excalidraw 嵌入；
- 两个及以上 Frame 时默认显示第一页；
- 提供上一页、页码、下一页按钮；
- 使用水平滑动动画手动翻页；
- 保留 Excalidraw 原有源码/打开画板能力；
- Excalidraw 插件或 API 不可用时，无感降级为原始 MarkdownRenderer 渲染。

第一版不实现自动播放、缩略图、演讲者备注、页内构建动画和 Frame 编辑。

## 2. 设计原则

### 2.1 Excalidraw 是稳定的可选依赖

Beyond-CodeTab 可以依赖 Excalidraw 的公开自动化能力，但不能让该依赖影响普通 Markdown、代码和其他第三方渲染器。运行时先做能力检测，任何环节不满足条件都回到现有预览路径。

### 2.2 不解析画板存储格式

Beyond-CodeTab 不读取或解压 `json` / `compressed-json`，不实现 `lz-string`、Text Elements 同步、场景迁移、字体和嵌入文件恢复。

场景读取统一调用 ExcalidrawAutomate：

```ts
const scene = await ea.getSceneFromFile(file);
```

这样无论画板使用 `.excalidraw` 还是 `.excalidraw.md`，以及底层存储格式如何变化，都由 Excalidraw 插件负责。

### 2.3 不生成旁路 SVG 文件

每一页使用 Excalidraw 的 Frame fragment 嵌入：

```markdown
![[画板.excalidraw.md#^frame=<frame-id>]]
```

Beyond-CodeTab 仍通过 `MarkdownRenderer` 渲染这个 fragment。Excalidraw 可以在 DOM 内部使用 SVG 展示画板，但不会在 Vault 中生成需要用户维护的 `.svg` 文件。

### 2.4 不修改 Excalidraw 所有的 DOM

翻页按钮由 Beyond-CodeTab 创建并管理，视觉上放在 Excalidraw 源码按钮左侧，但不插入 Excalidraw 插件内部的工具栏。这样 Excalidraw 升级或重建嵌入节点时，不会销毁 Beyond-CodeTab 的控制器。

## 3. 自动识别规则

只有同时满足以下条件时启用 Frame Deck：

1. 标签正文按 Markdown 渲染；
2. 去掉首尾空白后仅包含一个 `![[...]]` 嵌入；
3. 链接没有指定 `#^frame=...`、`#^area=...` 或其他子区域；
4. Obsidian 能将链接解析到文件；
5. Excalidraw 插件已启用，并确认该文件是 Excalidraw；
6. `getSceneFromFile()` 返回两个及以上未删除 Frame。

如果标签中还包含标题、说明、列表或其他嵌入，则保持普通 Markdown 预览，避免改变复合内容的语义。

解析结果保留：

- 原始链接路径；
- 可选别名或尺寸参数；
- Obsidian 解析后的真实文件路径。

## 4. Frame 排序

内部状态始终使用 Frame ID，不使用可能重复或被修改的名称。

排序优先级：

1. 已存在有效的 `customData.slideshow.order` 时，按显式顺序；
2. 有名称的 Frame 按名称自然排序，使 `2` 位于 `10` 之前；
3. 无名称或同名时，按 `y`、`x` 空间位置排序；
4. 最后按 Frame ID 保证稳定结果。

显式排序缺失的 Frame 放在显式排序 Frame 之后，再使用名称和空间位置排序。

## 5. 组件结构

新增文件：

```text
src/components/MultiTab/
├── excalidrawFrame.ts       # 纯解析、排序和 fragment 构造
├── excalidrawApi.ts         # 第三方插件发现、版本兼容与场景读取
├── excalidrawFrameDeck.ts   # DOM、翻页、状态刷新与生命周期
├── excalidrawFrameDeck.css  # 画板宽度、控制器和页面动画
├── tabPreview.ts            # 选择 Frame Deck 或默认渲染器
├── tabGroup.ts
└── styles.css
```

`excalidrawFrame.ts` 不依赖 Obsidian，便于使用 Node 单元测试覆盖边界。

`excalidrawApi.ts` 是唯一允许访问 `app.plugins`、`plugin.ea` 和 `plugin.getEA()`
等非公开入口的模块。Excalidraw 升级导致接口形状变化时，只调整该适配层；其余组件只依赖
`ExcalidrawSceneSource.getElements()`。

`ExcalidrawFrameDeck` 作为当前 tab 预览 `Component` 的子组件，负责：

- 场景加载与 Frame 列表；
- 当前 Frame ID；
- 上一页、下一页和页码；
- 当前页与目标页的 MarkdownRenderer 子生命周期；
- 文件变化后的刷新；
- 动画期间的并发保护；
- 卸载时清理监听器、计时器和页面组件。

## 6. 渲染与动画

初始渲染只创建第一页。翻页时：

1. 检查目标索引和动画锁；
2. 在第二个页面容器中预渲染目标 Frame；
3. 两个页面放在同一 CSS Grid 区域；
4. 下一页从右侧进入，上一页从左侧进入；
5. 当前页向相反方向退出；
6. 动画时长结束后释放旧页面的 Component；组件提前卸载时主动结束等待；
7. 更新当前 Frame ID、页码和按钮状态。

动画只使用 `transform` 和 `opacity`，不操作 Excalidraw 摄像机。系统启用 `prefers-reduced-motion: reduce` 时取消位移动画。

快速重复点击期间忽略新导航，防止多个异步 MarkdownRenderer 互相覆盖。

普通单画板、复合 Markdown 画板和 Frame Deck 共用 `excalidrawFrameDeck.css` 中的宽度
规则。选择器限制在 `.code-tab__panel` 内，不改变笔记其他位置的 Excalidraw 或普通图片。

## 7. 状态与文件更新

插件内增加内存状态：

```ts
activeFrames: Map<string, string>;
```

键由标签组 ID、标签索引和 Excalidraw 文件路径组成，值为当前 Frame ID。它不写入用户 Markdown，重启 Obsidian 后自然回到第一页。

画板文件发生修改时，经短暂 debounce 后重新读取 Scene：

- 当前 Frame 仍存在：保持当前页并刷新内容；
- 当前 Frame 已删除：回退到不超过新长度的相邻页；
- Frame 少于两个：当前预览退回普通单画板渲染。

第一版在 Beyond-CodeTab 自身重建预览时完成少于两个 Frame 的降级；已挂载组件只需安全刷新当前可用页。

## 8. 控件与可访问性

控件位于 Beyond-CodeTab 面板右上角，并为 Excalidraw 原有控件预留空间：

- 最后一页点击下一页回到第一页；
- 第一页点击上一页回到最后一页；
- 动画执行期间短暂禁用两个按钮，避免并发渲染；
- 显示 `当前页 / 总页数`；
- 按钮使用 Obsidian 图标 `chevron-left`、`chevron-right`；
- 提供 `aria-label` 和原生 `title`；
- 页码使用 `aria-live="polite"`；
- 按钮点击不触发 Beyond-CodeTab 的源码编辑。

## 9. 降级策略

以下情况全部回退到现有 `MarkdownRenderer.render()`：

- Excalidraw 插件未安装或未启用；
- 找不到 ExcalidrawAutomate；
- API 版本缺少 `getSceneFromFile()` 或 `isExcalidrawFile()`；
- 链接无法解析；
- 文件不是 Excalidraw；
- 场景读取失败；
- Frame 数量少于两个；
- 标签不是单一嵌入。

降级不弹 Notice，避免普通笔记因可选增强不可用而产生噪声；开发信息写入 `console.warn`。

## 10. 维护边界

- 存储格式与压缩算法属于 Excalidraw，不得在 Beyond-CodeTab 中实现；
- 插件私有入口和版本兼容只进入 `excalidrawApi.ts`；
- Frame 的解析、排序和 fragment 构造只进入 `excalidrawFrame.ts`；
- 两页交接顺序、动画锁和 Component 释放保留在 `ExcalidrawFrameDeck`，不拆成事件总线；
- 画板专用样式只进入 `excalidrawFrameDeck.css`，最终仍由 esbuild 合并为一个样式文件；
- 新增缩略图、自动播放或键盘演示模式前，再评估是否抽取独立导航状态机。

## 11. 验证

单元测试覆盖：

- 单一嵌入解析与拒绝复合 Markdown；
- `.excalidraw` / `.excalidraw.md`；
- 已指定 fragment 时不接管；
- 别名和尺寸保留；
- 显式 order、自然名称、空间位置和 ID 排序；
- Frame fragment 构造。

Obsidian 回归覆盖：

- 两个以上 Frame 出现翻页控件；
- 默认第一页、循环边界和页码；
- 前后翻页更新 fragment；
- 点击翻页按钮不进入编辑态；
- Excalidraw API 缺失时仍显示原始嵌入；
- 普通 Markdown、代码、表格和现有 Excalidraw 单画板行为不变。

最终运行：

```bash
npm run lint:fix
npm run lint
npm test
npm run build
npm run test:obsidian
```
