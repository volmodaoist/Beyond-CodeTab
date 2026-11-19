import { parseTabs, serializeTabs } from "../markdown";
import { CodeTabError, CodeTabErrorCode } from "./errors";
import { copyTab } from "./operations";
import type { CodeTabApi, CodeTabHandle, CodeTabRenderOptions } from "./types";
import type { CompletionEngine } from "../core/completion";

export function createCodeTabApi(
  render: (options: CodeTabRenderOptions) => Promise<CodeTabHandle>,
  completion: CompletionEngine,
): CodeTabApi {
  const api: CodeTabApi = {
    errorCodes: Object.freeze(CodeTabErrorCode),
    completion,
    capabilities: Object.freeze([
      "render",
      "update",
      "snapshot",
      "transactions",
      "selection",
      "focus",
      "editing-control",
      "subscribe",
      "source-tools",
    ]),
    parse: (source) => {
      if (typeof source !== "string") {
        throw new CodeTabError(CodeTabErrorCode.InvalidOptions, "source 必须是字符串");
      }
      const tabs = parseTabs(source).map((tab) => Object.freeze(copyTab(tab)));
      return Object.freeze(tabs);
    },
    serialize: (tabs) => {
      if (!Array.isArray(tabs)) {
        throw new CodeTabError(CodeTabErrorCode.InvalidOptions, "tabs 必须是数组");
      }
      return serializeTabs(tabs.map(copyTab));
    },
    render,
  };
  return Object.freeze(api);
}
