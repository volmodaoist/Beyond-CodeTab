import type { App, TAbstractFile, TFile } from "obsidian";
import type { TabBlock, TabData } from "./components/types";

export function parseTabs(source: string): TabData[] {
  const lines = normalizeNewlines(source).split("\n");
  const tabs: TabData[] = [];
  let current: { title: string; lines: string[] } | null = null;
  let fence: { marker: string; length: number } | null = null;

  const finishTab = () => {
    if (!current) return;
    // 只裁掉标签内容首尾的空行，正文中的空行必须原样保留。
    tabs.push({ title: current.title, content: trimBlankLines(current.lines).join("\n") });
  };

  for (const line of lines) {
    // tab 内容允许继续嵌套代码块；进入内部 fence 后，不能把代码中的 tab: 当成新标签。
    const fenceMatch = line.match(/^ {0,3}([\x60~]{3,})(.*)$/);

    if (fenceMatch) {
      const marks = fenceMatch[1];
      if (!fence) {
        fence = { marker: marks[0], length: marks.length };
      } else if (
        marks[0] === fence.marker &&
        marks.length >= fence.length &&
        fenceMatch[2].trim() === ""
      ) {
        fence = null;
      }

      if (current) current.lines.push(line);
      continue;
    }

    const tabMatch = !fence && line.match(/^\s*tab:\s*(.*?)\s*$/);
    if (tabMatch) {
      finishTab();
      current = {
        title: tabMatch[1] || "标签" + (tabs.length + 1),
        lines: [],
      };
      continue;
    }

    if (current) current.lines.push(line);
  }

  finishTab();
  return tabs;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

export function normalizeNewlines(value: string): string {
  // 内部统一按 LF 计算；真正回写时会恢复源文件原本的换行风格。
  return value.replace(/\r\n?/g, "\n");
}

export function normalizePreviewFenceLanguages(markdown: string): string {
  // CodeMirror 和 MarkdownRenderer 使用的语言注册表并不完全一致。
  // 例如 CodeMirror 能直接识别 c++，而 Prism 通常要求 cpp；这里集中维护差异。
  const aliases: Record<string, string> = {
    "c++": "cpp",
    "c#": "csharp",
  };

  return normalizeNewlines(markdown)
    .split("\n")
    .map((line) => line.replace(
      /^( {0,3}[\x60~]{3,}\s*)(c\+\+|c#)(?=\s|$)(.*)$/i,
      (_match: string, prefix: string, language: string, suffix: string) => prefix + aliases[language.toLowerCase()] + suffix
    ))
    .join("\n");
}

export function serializeTabs(tabs: TabData[]): string {
  // tab: 声明之间固定留一个空行，输出稳定，后续 diff 更容易阅读。
  return tabs.map((tab) => {
    const header = "tab: " + tab.title;
    return tab.content ? header + "\n" + tab.content : header;
  }).join("\n\n");
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return !!file && "extension" in file && file.extension === "md";
}

export async function updateMarkdownSource(
  app: App, sourcePath: string, expectedLine: number, previousSource: string, nextSource: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(sourcePath);
  if (!isMarkdownFile(file)) {
    throw new Error("无法定位当前 Markdown 文件");
  }

  let replaced = false;
  const update = (fileContent: string) => {
    // 同一笔记可能有多个 tab 块：先匹配旧内容，再用原行号选取距离最近的那个。
    const block = findTabBlock(fileContent, previousSource, expectedLine);
    if (!block) return fileContent;
    replaced = true;
    const replacement = createTabFence(nextSource, block.marker, block.indent, block.newline);
    return fileContent.slice(0, block.start) + replacement + fileContent.slice(block.end);
  };

  if (typeof app.vault.process === "function") {
    // process 在同一次回调里读改写，可降低与 Obsidian 自动保存并发覆盖的风险。
    await app.vault.process(file, update);
  } else {
    // 兼容没有 vault.process 的旧版本 Obsidian。
    const current = await app.vault.read(file);
    const updated = update(current);
    if (updated !== current) await app.vault.modify(file, updated);
  }

  if (!replaced) {
    throw new Error("原标签块已发生变化，请刷新笔记后重试");
  }
}

export function findTabBlock(
  fileContent: string, expectedSource: string, expectedLine: number
): TabBlock | null {
  // 保留 CRLF/LF，否则仅编辑一个标签也会导致整段产生无意义的换行 diff。
  const newline = fileContent.includes("\r\n") ? "\r\n" : "\n";
  const lines = fileContent.split(/\r?\n/);
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + newline.length;
  }

  const matches: TabBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^( {0,3})([\x60~]{3,})tab(?:\s*)$/);
    if (!opening) continue;

    const marker = opening[2][0];
    const markerLength = opening[2].length;
    for (let endIndex = index + 1; endIndex < lines.length; endIndex += 1) {
      const closing = lines[endIndex].match(/^ {0,3}([\x60~]{3,})\s*$/);
      if (!closing || closing[1][0] !== marker || closing[1].length < markerLength) continue;

      const source = lines.slice(index + 1, endIndex).join("\n");
      // 必须同时匹配旧内容。若用户从另一个窗格改过源文，则拒绝盲目覆盖。
      if (source === normalizeNewlines(expectedSource)) {
        const endOffset = offsets[endIndex] + lines[endIndex].length;
        matches.push({
          start: offsets[index],
          end: endOffset,
          line: index,
          marker,
          indent: opening[1],
          newline,
        });
      }
      index = endIndex;
      break;
    }
  }

  matches.sort((left, right) =>
    Math.abs(left.line - expectedLine) - Math.abs(right.line - expectedLine)
  );
  return matches[0] || null;
}

export function createTabFence(source: string, marker: string, indent: string, newline = "\n"): string {
  let longest = 2;
  // 外层 fence 必须长于内部同类 fence，否则嵌套代码块会提前关闭 tab 容器。
  for (const line of normalizeNewlines(source).split("\n")) {
    const match = line.match(/^ {0,3}([\x60~]+)/);
    if (match && match[1][0] === marker) longest = Math.max(longest, match[1].length);
  }
  const fence = marker.repeat(Math.max(3, longest + 1));
  return indent + fence + "tab" + newline +
    source.replace(/\n/g, newline) + newline + indent + fence;
}

export function safeId(value: string): string {
  // DOM id 不能直接使用可能含空格、中文和路径分隔符的 sourcePath。
  // FNV-1a 在这里不承担安全用途，只生成稳定且短的元素 id。
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
