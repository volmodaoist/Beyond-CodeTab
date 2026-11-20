# Beyond-CodeTab GIF 演示与录制

这些动画通过真实的桌面 Obsidian 录制，使用原生渲染器、CodeMirror 编辑器和 Vault 文件写入流程。录制复用 [tests/obsidian/host.mjs](../../../tests/obsidian/host.mjs) 中现有的隔离启动脚本。

| GIF | 演示内容 |
| --- | --- |
| [tab-management.gif](tab-management.gif) | 代码与 Markdown 标签页的切换、改名和拖动排序 |
| [code-completion.gif](code-completion.gif) | 使用关键词与内置函数补全，编写完整的 Python 快速排序并保存 |
| [tab-reference.gif](tab-reference.gif) | 复制 JavaScript tab 链接，切换笔记，粘贴并保存引用，再点击链接返回对应 tab |
| [fence-pairing.gif](fence-pairing.gif) | 三、四反引号补全、配对修改与撤销，以及嵌套 Python、JavaScript 代码块形成标签页 |

引用演示通过 Obsidian 编辑器的原生粘贴事件插入链接，保存后停留约 5 秒，再点击跳转。离开源笔记前先选中 Python，返回时自动选中 JavaScript，便于看清引用对具体 tab 的定位效果。

围栏演示在各关键步骤停留约 2–3 秒。快速排序演示会先展示补全候选，再选择词条；录制过程中检查候选框是否完整显示在卡片外，并验证保存后的 Python 示例能够正确排序。

## 重新录制

需要 Node.js 20+、已加入 `PATH` 的 FFmpeg，以及已安装的桌面 Obsidian。现有启动脚本默认使用 macOS 路径，键盘操作使用 macOS 的 Cmd 快捷键。

```bash
npm ci
make demos

# 只重新录制引用演示。
npm run demo:record -- --only tab-reference

# 分别重新录制补全或围栏演示。
npm run demo:record -- --only code-completion
npm run demo:record -- --only fence-pairing
```

生成的 GIF 写入当前目录。原始 JPEG 帧、采集时间、Obsidian 日志和录制报告保留在命令输出的临时 `Artifacts` 目录中。FFmpeg 将采集帧转换为宽 960 像素、帧率 10 fps 的 GIF，配套工具 `ffprobe` 用于读取最终播放时长。

录制使用新建的临时 Vault 和示例笔记，日常 Vault 不会被打开或修改。脚本添加演示指针和简短字幕，插件界面、补全、渲染和保存均通过真实流程完成。复制内容仅保存在录制窗口内；引用链接在该隔离窗口中调用真实注册的协议处理器，避免唤起日常使用的 Obsidian 实例。

如需调整 Obsidian 可执行文件或应用数据目录，请按[测试说明](../../../tests/test-guide.md)设置 `CODE_TAB_OBSIDIAN_BIN` 和 `CODE_TAB_OBSIDIAN_DATA`。

这些 GIF 展示当前源码构建中的功能，`2.2.1` 发布标签对应较早的版本。
