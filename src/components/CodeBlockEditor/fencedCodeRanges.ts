export interface CodeRange {
  from: number;
  to: number;
  language: string;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
};

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase();
  return LANGUAGE_ALIASES[normalized] || normalized;
}

/** 扫描 Markdown 围栏并返回正文区间；高亮模块只负责消费区间和 Prism 分词。 */
export function findFencedCodeRanges(source: string): CodeRange[] {
  const lines = source.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  const ranges: CodeRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === "`" && opening[2].includes("`"))) {
      continue;
    }
    const marker = opening[1][0];
    const markerLength = opening[1].length;
    const rawLanguage = opening[2].trim().split(/\s/u)[0];
    const language = normalizeLanguage(rawLanguage);
    for (let closingIndex = index + 1; closingIndex < lines.length; closingIndex += 1) {
      const closing = lines[closingIndex].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (!closing || closing[1][0] !== marker || closing[1].length < markerLength) {
        continue;
      }
      const from = offsets[index] + lines[index].length + 1;
      const range: CodeRange = {
        from,
        to: Math.max(from, offsets[closingIndex] - 1),
        language,
      };
      ranges.push(range);
      index = closingIndex;
      break;
    }
  }

  return ranges;
}
