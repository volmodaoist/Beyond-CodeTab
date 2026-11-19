import { CodeTabError, CodeTabErrorCode } from "./errors";
import type { CodeTabData, CodeTabOperation } from "./types";

export interface TabOperationResult {
  tabs: CodeTabData[];
  activeIndex: number;
}

export function copyTab(tab: CodeTabData): CodeTabData {
  if (!tab || typeof tab.title !== "string" || typeof tab.content !== "string") {
    throw new CodeTabError(CodeTabErrorCode.InvalidOperation, "标签必须包含字符串标题和正文");
  }
  if (!tab.title.trim() || /[\r\n]/.test(tab.title)) {
    throw new CodeTabError(CodeTabErrorCode.InvalidOperation, "标签标题不能为空或包含换行");
  }
  const result: CodeTabData = {
    title: tab.title,
    content: tab.content,
  };
  return result;
}

function checkIndex(index: number, length: number, insert = false): void {
  if (!Number.isInteger(index) || index < 0 || index >= length + Number(insert)) {
    throw new CodeTabError(CodeTabErrorCode.InvalidOperation, "标签索引无效");
  }
}

/** 全批次只在副本上操作；索引按顺序基于前一次操作后的数组。 */
export function applyTabOperations(
  current: readonly CodeTabData[],
  operations: readonly CodeTabOperation[],
  selected = 0,
): TabOperationResult {
  if (!Array.isArray(operations)) {
    throw new CodeTabError(CodeTabErrorCode.InvalidOperation, "operations 必须是数组");
  }
  const tabs = current.map(copyTab);
  let activeIndex = tabs.length ? selected : -1;
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") {
      throw new CodeTabError(CodeTabErrorCode.InvalidOperation, "无效的标签操作");
    }
    switch (operation.type) {
      case "insert-tab": {
        checkIndex(operation.index, tabs.length, true);
        const tab = copyTab(operation.tab);
        tabs.splice(operation.index, 0, tab);
        activeIndex = activeIndex < 0 ? 0 : activeIndex + Number(operation.index <= activeIndex);
        break;
      }
      case "replace-tab": {
        checkIndex(operation.index, tabs.length);
        tabs[operation.index] = copyTab(operation.tab);
        break;
      }
      case "remove-tab": {
        checkIndex(operation.index, tabs.length);
        tabs.splice(operation.index, 1);
        activeIndex -= Number(operation.index < activeIndex);
        activeIndex = Math.min(activeIndex, tabs.length - 1);
        break;
      }
      case "move-tab": {
        checkIndex(operation.fromIndex, tabs.length);
        checkIndex(operation.toIndex, tabs.length);
        const moved = tabs.splice(operation.fromIndex, 1)[0];
        tabs.splice(operation.toIndex, 0, moved);
        if (activeIndex === operation.fromIndex) {
          activeIndex = operation.toIndex;
        } else if (operation.fromIndex < activeIndex && operation.toIndex >= activeIndex) {
          activeIndex -= 1;
        } else if (operation.fromIndex > activeIndex && operation.toIndex <= activeIndex) {
          activeIndex += 1;
        }
        break;
      }
      default:
        throw new CodeTabError(CodeTabErrorCode.InvalidOperation, "不支持的标签操作");
    }
  }
  const result: TabOperationResult = {
    tabs,
    activeIndex,
  };
  return result;
}
