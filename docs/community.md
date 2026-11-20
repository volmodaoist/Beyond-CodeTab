# 社区与检索

Beyond-CodeTab 提供 Obsidian 代码块标签页、Markdown 标签页、原地编辑、离线代码补全和具体 tab 引用。仓库入口为 [volmodaoist/Beyond-CodeTab](https://github.com/volmodaoist/Beyond-CodeTab)。

## 已准备的项目资料

- [中文 README](../README.md) 作为仓库首页，[英文](../READMEs/README.en.md)、[日文](../READMEs/README.ja.md)、[韩文](../READMEs/README.ko.md)版本放在 `READMEs/` 目录，面向不同语言的用户。
- [真实界面 GIF](assets/demos/README.md) 展示标签管理、补全、复制引用和围栏配对；图片替代文本描述实际功能，便于检索和无障碍阅读。
- package.json 包含插件用途和关键词；仓库首页标题与简介使用 Obsidian、code blocks、Markdown tabs、autocomplete 等实际功能词汇。
- [贡献指南](../CONTRIBUTING.md)和中英文问题模板提供反馈入口。

这些资料帮助用户和搜索引擎理解项目。GitHub topics、搜索引擎抓取和 Obsidian 官方社区收录各有自己的入口；添加关键词不会保证搜索排名或立即被收录。

## GitHub About 与 topics

在仓库首页右侧 **About → 齿轮** 中填写以下描述：

```text
Obsidian plugin for editable code and Markdown tabs, offline autocomplete, and links to individual tabs.
```

建议保留已有 topics，并补充实际相关的标签：

```text
obsidian, obsidian-plugin, obsidian-md, markdown, code-blocks, code-tabs,
markdown-tabs, autocomplete, code-completion, typescript, note-taking,
personal-knowledge-management, developer-tools
```

也可以在本机完成 GitHub CLI 登录后执行：

```bash
gh auth login
gh repo edit volmodaoist/Beyond-CodeTab \
  --description "Obsidian plugin for editable code and Markdown tabs, offline autocomplete, and links to individual tabs." \
  --add-topic obsidian --add-topic obsidian-plugin --add-topic obsidian-md \
  --add-topic markdown --add-topic code-blocks --add-topic code-tabs \
  --add-topic markdown-tabs --add-topic autocomplete --add-topic code-completion \
  --add-topic typescript --add-topic note-taking \
  --add-topic personal-knowledge-management --add-topic developer-tools
```

命令只修改该仓库的描述并添加 topics，不创建 Git tag 或 Release。topics 属于 GitHub 仓库设置，README 和 package.json 的关键词不会自动变成 topics。

## Obsidian 官方社区插件列表

截至本次文档整理，官方 [community-plugins.json](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json) 中没有 `obsidian-code-tab` 或 `volmodaoist/Beyond-CodeTab` 对应条目。因此还不能在 Obsidian 内直接按 Beyond-CodeTab 搜索安装。

正式申请前，需要发布包含当前功能的稳定版本：tag 与 manifest 版本一致，GitHub Release 附带 `main.js`、`manifest.json`、`styles.css`。当前 `2.2.1` tag 是较早基线，不能代表 README 演示的全部功能。

接着按官方的[插件提交流程](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)向 `obsidianmd/obsidian-releases` 提交条目并等待审核。提交时重新核对当前 manifest 命名规则、最低支持版本和官方列表；社区收录需要维护者审核，不能通过添加 GitHub topics 自动完成。

## 社区分享

可以使用 README 中的真实 GIF，在 Obsidian Forum、相关开发者社区或社交平台介绍项目。建议同时提供一段最小 `tab` 语法、当前从源码安装的方式和 GitHub 链接。

这次文档工作没有向社区发帖或创建收录申请。对外介绍时明确当前安装渠道和补全范围：补全基于离线词表与规则，没有类型推断、自动导入或 LSP 服务。
