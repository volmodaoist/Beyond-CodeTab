import type { App, TFile } from "obsidian";
import {
  createTabFence,
  findTabBlock,
  normalizeNewlines,
  parseTabs,
  serializeTabs,
} from "../../markdown";
import type { TabData } from "./types";

export interface TabReference {
  blockId: string;
  tabId: string;
  source: string;
  link: string;
}

export interface ReferencedTab {
  line: number;
  index: number;
  anchorLine: number;
}

export interface ReferencedTabLocation extends ReferencedTab {
  file: TFile;
}

const allocatedGroupIds = new WeakMap<App, Set<string>>();

export function referenceUrl(blockId: string, tabId: string): string {
  const query = new URLSearchParams();
  query.set("block", blockId);
  const prefix = blockId + "-";
  query.set("tab", tabId.startsWith(prefix) ? tabId.slice(prefix.length) : tabId);
  return "obsidian://beyond-code-tab?" + query.toString();
}

function shortIdentifier(used: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = crypto.randomUUID().slice(0, 6);
    if (!used.has(id)) {
      return id;
    }
  }
  throw new Error("无法生成唯一的标签引用 ID，请重试");
}

async function createGroupId(app: App): Promise<string> {
  const texts = await Promise.all(
    app.vault.getMarkdownFiles().map((file) => app.vault.cachedRead(file)),
  );
  const used = allocatedGroupIds.get(app) ?? new Set<string>();
  for (const text of texts) {
    const pattern = /(?:^|\s)\^([a-zA-Z0-9-]+)[ \t]*$/gm;
    let match = pattern.exec(text);
    while (match) {
      used.add(match[1]);
      match = pattern.exec(text);
    }
  }
  const id = shortIdentifier(used);
  used.add(id);
  allocatedGroupIds.set(app, used);
  return id;
}

function referenceForTab(source: string, blockId: string, tab: TabData): TabReference {
  const tabId = tab.id;
  if (!tabId) {
    throw new Error("标签缺少引用标识");
  }
  const url = referenceUrl(blockId, tabId);
  const title = tab.title.replace(/[\\[\]]/g, "\\$&");
  const reference: TabReference = {
    blockId,
    tabId,
    source,
    link: "[" + title + "](" + url + ")",
  };
  return reference;
}

/** 引用元数据只在首次生成时写入，正常正文与复制结果不包含元数据。 */
export async function createTabReference(
  app: App,
  sourcePath: string,
  line: number,
  source: string,
  index: number,
): Promise<TabReference> {
  const file = app.vault.getFileByPath(sourcePath);
  if (!file || file.extension !== "md") {
    throw new Error("无法定位当前笔记");
  }
  const current = await app.vault.read(file);
  const existing = findTabBlock(current, source, line);
  if (!existing) {
    throw new Error("原标签块已发生变化，请刷新笔记后重试");
  }
  const selected = parseTabs(source)[index];
  if (!selected) {
    throw new Error("当前标签已不存在");
  }
  if (existing.referenceId && selected.id) {
    return referenceForTab(source, existing.referenceId, selected);
  }
  const groupId = existing.referenceId ?? (await createGroupId(app));
  let result: TabReference | null = null;
  await app.vault.process(file, (text) => {
    const block = findTabBlock(text, source, line);
    if (!block) {
      throw new Error("原标签块已发生变化，请刷新笔记后重试");
    }
    const tabs = parseTabs(source);
    const tab = tabs[index];
    if (!tab) {
      throw new Error("当前标签已不存在");
    }
    const blockId = block.referenceId ?? groupId;
    if (!tab.id) {
      const prefix = blockId + "-";
      const used = new Set(
        tabs.flatMap((item) => (item.id?.startsWith(prefix) ? [item.id.slice(prefix.length)] : [])),
      );
      tab.id = prefix + shortIdentifier(used);
    }
    const next = serializeTabs(tabs);
    result = referenceForTab(next, blockId, tab);
    const replacement = createTabFence(next, block.marker, block.indent, block.newline);
    const anchor = block.referenceId ? "" : block.newline + "^" + blockId;
    return text.slice(0, block.start) + replacement + anchor + text.slice(block.end);
  });
  if (!result) {
    throw new Error("引用创建失败");
  }
  return result;
}

/** 优先使用原生块缓存定位文件；缓存尚未更新时读取笔记查找，不持久化路径索引。 */
export async function findReferencedTab(
  app: App,
  blockId: string,
  tabId: string,
): Promise<ReferencedTabLocation | null> {
  const files = app.vault.getMarkdownFiles();
  const cached = files.filter((file) => app.metadataCache.getFileCache(file)?.blocks?.[blockId]);
  const search = async (candidates: TFile[]): Promise<ReferencedTabLocation | null> => {
    let location: ReferencedTabLocation | null = null;
    for (const file of candidates) {
      const text = await app.vault.read(file);
      const target = resolveReferencedTab(text, blockId, tabId);
      if (!target) {
        continue;
      }
      if (location) {
        throw new Error("标签引用 ID 重复，请为复制的标签组重新设置 ID");
      }
      const match: ReferencedTabLocation = {
        file,
        line: target.line,
        index: target.index,
        anchorLine: target.anchorLine,
      };
      location = match;
    }
    return location;
  };
  const location = await search(cached);
  if (location) {
    return location;
  }
  return search(files.filter((file) => !cached.includes(file)));
}

/** 专用链接先找到原生块锚点，再按稳定 tab ID 选择；标题与顺序不参与定位。 */
export function resolveReferencedTab(
  text: string,
  blockId: string,
  tabId: string,
): ReferencedTab | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let start = 0; start < lines.length; start += 1) {
    const opening = lines[start].match(/^ {0,3}(`{3,}|~{3,})tab\s*$/);
    if (!opening) {
      continue;
    }
    for (let end = start + 1; end < lines.length; end += 1) {
      const closing = lines[end].match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (!closing || closing[1][0] !== opening[1][0] || closing[1].length < opening[1].length) {
        continue;
      }
      if (lines[end + 1]?.trim() === "^" + blockId) {
        const tabs = parseTabs(lines.slice(start + 1, end).join("\n"));
        const index = tabs.findIndex((tab) => tab.id === blockId + "-" + tabId);
        if (index >= 0) {
          const target: ReferencedTab = {
            line: start,
            index,
            anchorLine: end + 1,
          };
          return target;
        }
        return null;
      }
      start = end;
      break;
    }
  }
  return null;
}
