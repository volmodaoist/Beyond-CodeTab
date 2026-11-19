import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import { parseCompletionConfiguration } from "./core/completion";
import type { CompletionConfiguration, CompletionEngine } from "./core/completion";
import type CodeTabPlugin from "./main";

export function emptyCompletionConfiguration(): CompletionConfiguration {
  const configuration: CompletionConfiguration = {
    wordLists: [],
    rules: [],
  };
  return configuration;
}

export class CompletionSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: CodeTabPlugin,
    private readonly engine: CompletionEngine,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    let draft = JSON.stringify(this.plugin.completionConfiguration, null, 2);
    let saving = false;
    const input = new Setting(this.containerEl);
    input.setName("自定义代码补全");
    input.setDesc(
      "使用 JSON 添加 wordLists 或带正则 match 的 rules。每项包含 id、languages 和 words；规则匹配光标前当前行，默认只替换正在输入的词。配置仅提供词表和正则，不执行代码。",
    );
    input.addTextArea((area) => {
      area.setValue(draft);
      area.inputEl.rows = 14;
      area.inputEl.cols = 50;
      area.inputEl.setAttribute("data-testid", "code-tab-completion-config");
      area.onChange((value) => {
        draft = value;
      });
    });
    const save = new Setting(this.containerEl);
    save.addButton((button) => {
      button.setButtonText("应用补全配置");
      button.setCta();
      button.buttonEl.setAttribute("data-testid", "code-tab-completion-config-save");
      button.onClick(async () => {
        if (saving) {
          return;
        }
        saving = true;
        button.setDisabled(true);
        try {
          const configuration = parseCompletionConfiguration(JSON.parse(draft));
          await this.plugin.saveCompletionConfiguration(configuration);
          new Notice("补全配置已应用");
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "补全配置无效");
        } finally {
          saving = false;
          button.setDisabled(false);
        }
      });
    });
    const list = new Setting(this.containerEl);
    list.setName("内置补全语言");
    list.setDesc(this.engine.languages.join("、"));
  }
}
