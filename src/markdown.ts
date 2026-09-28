import type { App, TAbstractFile, TFile } from "obsidian";
import type { TabBlock, TabData } from "./components/MultiTab/types";

// 单行围栏的解析结果；是否构成结束围栏，由调用方结合起始围栏判断。
interface FenceLine {
  marker: string; // 单个围栏字符：反引号或波浪号。
  length: number; // 围栏标记的字符数量，不包含行首空格。
  suffix: string; // 围栏之后的原始文本，如 python、空字符串或空白。
}

/**
 * 识别行首允许有 0～3 个普通空格的围栏行，匹配失败返回 null。
 * \x60 表示反引号；第一个捕获组是围栏标记，第二个是其后的文本。
 * 返回具名字段，让调用方通过 marker、length、suffix 获取类型提示。
 */
function parseFenceLine(line: string): FenceLine | null {
  const match = line.match(/^ {0,3}([\x60~]{3,})(.*)$/);
  if (!match) {
    return null;
  }
  const marks = match[1];
  const result: FenceLine = {
    marker: marks[0],
    length: marks.length,
    suffix: match[2],
  };

  return result;
}

// 提供 CodeTab 专用的 MD 文件处理与回写工具
// 读取一个字符串格式的输入，然后按 tab: 声明分组，解析成 TabData 数组。
export function parseTabs(source: string): TabData[] {
  // Obsidian 已去掉最外层 tab 围栏，source 只包含标签声明和正文。
  const lines = normalizeNewlines(source).split("\n");
  const tabs: TabData[] = [];
  const tabPattern = /^\s*tab:\s*(.*?)\s*$/;

  // i 始终指向下一条未处理行，由循环体推进，不在 for 末尾自动 i++。
  // 收集完一个标签后，i 停在下一条 tab: 声明上，供下一轮直接处理。
  for (let i = 0; i < lines.length;) {
    // 当有标签声明时，从下一行开始收集正文；声明前的说明也通过下面的循环扫描。
    const tabMatch = lines[i].match(tabPattern);
    if (tabMatch) {
      i++;
    }
    const bg = i;
    // 当前标签一直延续到代码块外的下一条 tab: 声明，或者 source 末尾。
    // 段落、列表、引用等普通 Markdown 逐行前进，内层代码块则整块前进。
    while (i < lines.length && !tabPattern.test(lines[i])) {
      const opening = parseFenceLine(lines[i]);
      i++;
      // 普通正文已经处理完一行，继续寻找标签边界。
      if (!opening) {
        continue;
      }

      // 已越过起始围栏，从下一行开始寻找结束围栏, 这个内层循环不检查 tab，因此代码中的声明不会截断当前标签。
      while (i < lines.length) {
        const closing = parseFenceLine(lines[i]);
        i++;
        if (
          closing &&
          closing.marker === opening.marker &&
          closing.length >= opening.length &&
          closing.suffix.trim() === ""
        ) {
          // i 已指向结束围栏的下一行，接着扫描普通正文或下一条标签声明。
          break;
        }
      }
      // 没有找到结束围栏时，i 到达末尾，剩余行全部归入这个代码块。
    }
    // 首条标签声明之前的说明和代码块只扫描、不保存；块内的 tab: 也会一起略过。
    if (!tabMatch) {
      continue;
    }

    // [bg, i) 恰好覆盖当前标签的完整正文，含内层围栏，不含下一条标签声明。
    // 只裁掉正文首尾的空行，内部空行与缩进保持原样；content 的类型是字符串。
    const contentLines = lines.slice(bg, i);
    const tab: TabData = {
      title: tabMatch[1] || "标签" + (tabs.length + 1),
      content: trimBlankLines(contentLines).join("\n"),
    };

    tabs.push(tab);
  }

  return tabs;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(start, end);
}

export function normalizeNewlines(value: string): string {
  // 内部统一按 LF 计算；真正回写时会恢复源文件原本的换行风格。
  // 这个函数是作用是把文件解析变成标签数据，并且把编辑之后的数据回写笔记 (处理 \r, \r\n 两种情况)
  return value.replace(/\r\n?/g, "\n");
}

export function normalizePreviewFenceLanguages(markdown: string): string {
  // CodeMirror 和 MarkdownRenderer 使用的语言注册表并不完全一致。
  // 例如 CodeMirror 能直接识别 c++，然而 Prism 通常要求 cpp；这里集中维护差异。
  const aliases: Record<string, string> = {
    "c++": "cpp",
    "c#": "csharp",
  };

  return normalizeNewlines(markdown)
    .split("\n")
    .map((line) =>
      line.replace(
        /^( {0,3}[\x60~]{3,}\s*)(c\+\+|c#)(?=\s|$)(.*)$/i,
        (_match: string, prefix: string, language: string, suffix: string) =>
          prefix + aliases[language.toLowerCase()] + suffix,
      ),
    )
    .join("\n");
}

export function serializeTabs(tabs: TabData[]): string {
  // tab: 声明之间固定留一个空行，输出稳定，后续 diff 更容易阅读。
  return tabs
    .map((tab) => {
      const header = "tab: " + tab.title;
      return tab.content ? header + "\n" + tab.content : header;
    })
    .join("\n\n");
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return !!file && "extension" in file && file.extension === "md";
}

export async function updateMarkdownSource(
  app: App,
  sourcePath: string,
  expectedLine: number,
  previousSource: string,
  nextSource: string | null,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(sourcePath);
  if (!isMarkdownFile(file)) {
    throw new Error("无法定位当前 Markdown 文件");
  }

  let replaced = false;
  const update = (fileContent: string) => {
    // 同一笔记可能有多个 tab 块：先匹配旧内容，再用原行号选取距离最近的那个。
    const block = findTabBlock(fileContent, previousSource, expectedLine);
    if (!block) {
      return fileContent;
    }
    replaced = true;
    // 删除最后一个标签时用 null 明确表示移除整个块，仍使用相同的旧内容冲突检查。
    const replacement =
      nextSource === null
        ? ""
        : createTabFence(nextSource, block.marker, block.indent, block.newline);
    return fileContent.slice(0, block.start) + replacement + fileContent.slice(block.end);
  };

  if (typeof app.vault.process === "function") {
    // process 在同一次回调里读改写，可降低与 Obsidian 自动保存并发覆盖的风险。
    await app.vault.process(file, update);
  } else {
    // 兼容没有 vault.process 的旧版本 Obsidian。
    const current = await app.vault.read(file);
    const updated = update(current);
    if (updated !== current) {
      await app.vault.modify(file, updated);
    }
  }

  if (!replaced) {
    throw new Error("原标签块已发生变化，请刷新笔记后重试");
  }
}

export function findTabBlock(
  fileContent: string,
  expectedSource: string,
  expectedLine: number,
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
    if (!opening) {
      continue;
    }

    const marker = opening[2][0];
    const markerLength = opening[2].length;
    for (let endIndex = index + 1; endIndex < lines.length; endIndex += 1) {
      const closing = lines[endIndex].match(/^ {0,3}([\x60~]{3,})\s*$/);
      if (!closing || closing[1][0] !== marker || closing[1].length < markerLength) {
        continue;
      }

      const source = lines.slice(index + 1, endIndex).join("\n");
      // 必须同时匹配旧内容。若用户从另一个窗格改过源文，则拒绝盲目覆盖。
      if (source === normalizeNewlines(expectedSource)) {
        const endOffset = offsets[endIndex] + lines[endIndex].length;
        const block: TabBlock = {
          start: offsets[index],
          end: endOffset,
          line: index,
          marker,
          indent: opening[1],
          newline,
        };

        matches.push(block);
      }
      index = endIndex;
      break;
    }
  }

  matches.sort(
    (left, right) => Math.abs(left.line - expectedLine) - Math.abs(right.line - expectedLine),
  );
  return matches[0] || null;
}

export function createTabFence(
  source: string,
  marker: string,
  indent: string,
  newline = "\n",
): string {
  let longest = 2;
  // 外层 fence 必须长于内部同类 fence，否则嵌套代码块会提前关闭 tab 容器。
  for (const line of normalizeNewlines(source).split("\n")) {
    const match = line.match(/^ {0,3}([\x60~]+)/);
    if (match && match[1][0] === marker) {
      longest = Math.max(longest, match[1].length);
    }
  }
  const fence = marker.repeat(Math.max(3, longest + 1));
  return (
    indent + fence + "tab" + newline + source.replace(/\n/g, newline) + newline + indent + fence
  );
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
