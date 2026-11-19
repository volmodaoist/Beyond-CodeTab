import { CompletionError, CompletionErrorCode } from "./errors";
import { normalizeCompletionLanguage } from "./languages";
import { DEFAULT_WORDS, CPP_MEMBERS } from "./profiles";
import type {
  CompletionConfiguration,
  CompletionContext,
  CompletionEngine,
  CompletionFailure,
  CompletionItem,
  CompletionRegistration,
  CompletionResult,
  CompletionRule,
  CompletionRuleConfig,
  CompletionWord,
  CompletionWordEntry,
  CompletionWordList,
} from "./types";

function invalid(message: string): never {
  throw new CompletionError(CompletionErrorCode.InvalidRule, message);
}

function wordEntry(word: CompletionWord): CompletionWordEntry {
  if (typeof word === "string") {
    const entry: CompletionWordEntry = {
      label: word,
    };
    return entry;
  }
  return word;
}

function wordsOf(words: readonly CompletionWord[]): readonly CompletionWordEntry[] {
  if (!Array.isArray(words)) {
    invalid("words 必须是数组");
  }
  return Object.freeze(
    words.map((word) => {
      const item = wordEntry(word);
      if (
        !item ||
        typeof item.label !== "string" ||
        !item.label ||
        (item.insertText !== undefined && typeof item.insertText !== "string") ||
        (item.detail !== undefined && typeof item.detail !== "string") ||
        (item.boost !== undefined && !Number.isFinite(item.boost))
      ) {
        invalid("无效的补全词条");
      }
      const entry: CompletionWordEntry = {
        label: item.label,
        insertText: item.insertText,
        detail: item.detail,
        boost: item.boost,
      };
      return Object.freeze(entry);
    }),
  );
}

function languagesOf(languages: readonly string[]): readonly string[] {
  if (
    !Array.isArray(languages) ||
    !languages.length ||
    languages.some((language) => typeof language !== "string" || !language.trim())
  ) {
    invalid("languages 必须是非空字符串数组");
  }
  return Object.freeze([...new Set(languages.map(normalizeCompletionLanguage))]);
}

function normalizeRule(rule: CompletionRule, internal = false): CompletionRule {
  if (
    !rule ||
    typeof rule.id !== "string" ||
    !rule.id.trim() ||
    (!internal && rule.id.startsWith("config:"))
  ) {
    invalid("规则需要非空 id，config: 前缀由配置接口保留");
  }
  if (
    (rule.words === undefined) === (rule.complete === undefined) ||
    (rule.complete !== undefined && typeof rule.complete !== "function")
  ) {
    invalid("规则需要且只能提供 words 或 complete");
  }
  if (
    rule.match !== undefined &&
    Object.prototype.toString.call(rule.match) !== "[object RegExp]"
  ) {
    invalid("match 必须是正则表达式");
  }
  const normalized: CompletionRule = {
    id: rule.id,
    languages: languagesOf(rule.languages),
    words: rule.words === undefined ? undefined : wordsOf(rule.words),
    complete: rule.complete,
    match: rule.match
      ? new RegExp(rule.match.source, rule.match.flags.replace(/[gy]/g, ""))
      : undefined,
  };
  return Object.freeze(normalized);
}

/** 校验 JSON 声明配置；不求值用户输入的代码。 */
export function parseCompletionConfiguration(value: unknown): CompletionConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("配置必须是包含 wordLists 和 rules 的对象");
  }
  const data = value as Record<string, unknown>;
  const parseLists = (raw: unknown, rule: boolean): CompletionRuleConfig[] => {
    if (raw === undefined) {
      return [];
    }
    if (!Array.isArray(raw)) {
      invalid("wordLists 和 rules 必须是数组");
    }
    return raw.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        invalid("配置项必须是对象");
      }
      const fields = entry as Record<string, unknown>;
      if (
        typeof fields.id !== "string" ||
        !fields.id.trim() ||
        !Array.isArray(fields.languages) ||
        !Array.isArray(fields.words)
      ) {
        invalid("配置项需要 id、languages 和 words");
      }
      if (
        (fields.match !== undefined && typeof fields.match !== "string") ||
        (fields.flags !== undefined && typeof fields.flags !== "string")
      ) {
        invalid("声明规则的 match 和 flags 必须是字符串");
      }
      if (!rule && (fields.match !== undefined || fields.flags !== undefined)) {
        invalid("带 match 的配置应放入 rules");
      }
      if (fields.languages.some((language) => typeof language !== "string")) {
        invalid("languages 需要字符串");
      }
      const definition: CompletionRule = {
        id: "config:" + fields.id,
        languages: fields.languages as string[],
        words: fields.words as CompletionWord[],
        match:
          fields.match === undefined
            ? undefined
            : new RegExp(fields.match, typeof fields.flags === "string" ? fields.flags : ""),
      };
      const normalized = normalizeRule(definition, true);
      const result: CompletionRuleConfig = {
        id: fields.id,
        languages: normalized.languages,
        words: normalized.words ?? [],
        match: normalized.match?.source,
        flags: normalized.match?.flags,
      };
      return Object.freeze(result);
    });
  };
  let wordLists: CompletionRuleConfig[];
  let rules: CompletionRuleConfig[];
  try {
    wordLists = parseLists(data.wordLists, false);
    rules = parseLists(data.rules, true);
  } catch (error) {
    if (error instanceof CompletionError) {
      throw error;
    }
    invalid("正则表达式无效");
  }
  const ids = [...wordLists, ...rules].map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    invalid("配置 id 不能重复");
  }
  const config: CompletionConfiguration = {
    wordLists: Object.freeze(wordLists),
    rules: Object.freeze(rules),
  };
  return Object.freeze(config);
}

export function createCompletionEngine(): CompletionEngine {
  const entries = new Map<string, CompletionRule>();
  const kinds = new Map<string, "words" | "rule">();
  const listeners = new Set<() => void>();
  let revision = 0;
  let disposed = false;

  const alive = (): void => {
    if (disposed) {
      throw new CompletionError(CompletionErrorCode.Disposed, "补全引擎已释放");
    }
  };
  const notify = (): void => {
    revision += 1;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // 调用者的监听失败不改变注册事务。
      }
    }
  };
  const register = (
    rule: CompletionRule,
    kind: "words" | "rule",
    replace = false,
  ): (() => void) => {
    alive();
    const normalized = normalizeRule(rule);
    if (replace ? !entries.has(rule.id) : entries.has(rule.id)) {
      throw new CompletionError(
        replace ? CompletionErrorCode.NotFound : CompletionErrorCode.DuplicateId,
        "补全规则 id 已存在或不存在",
      );
    }
    entries.set(rule.id, normalized);
    kinds.set(rule.id, kind);
    notify();
    return () => {
      if (!disposed && entries.get(rule.id) === normalized) {
        entries.delete(rule.id);
        kinds.delete(rule.id);
        notify();
      }
    };
  };
  const asRule = (list: CompletionWordList): CompletionRule => {
    const rule: CompletionRule = {
      id: list?.id,
      languages: list?.languages,
      words: list?.words,
    };
    return rule;
  };
  const engine: CompletionEngine = {
    errorCodes: Object.freeze(CompletionErrorCode),
    languages: Object.freeze(Object.keys(DEFAULT_WORDS)),
    registerWords: (list) => register(asRule(list), "words"),
    replaceWords: (list) => register(asRule(list), "words", true),
    registerRule: (rule) => register(rule, "rule"),
    replaceRule: (rule) => register(rule, "rule", true),
    unregister: (id) => {
      alive();
      if (id.startsWith("config:")) {
        invalid("声明配置通过 configure 整体替换");
      }
      const removed = entries.delete(id);
      if (removed) {
        kinds.delete(id);
        notify();
      }
      return removed;
    },
    list: () => {
      alive();
      const registrations = [...entries.values()].map((entry) => {
        const registration: CompletionRegistration = {
          id: entry.id,
          languages: entry.languages,
          kind: kinds.get(entry.id) ?? "rule",
        };
        return Object.freeze(registration);
      });
      return Object.freeze(registrations);
    },
    getRevision: () => {
      alive();
      return revision;
    },
    subscribe: (listener) => {
      alive();
      if (typeof listener !== "function") {
        invalid("listener 必须是函数");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    configure: (configuration) => {
      alive();
      const config = parseCompletionConfiguration(configuration);
      const next: CompletionRule[] = [...config.wordLists, ...config.rules].map((entry) => {
        const configured = entry as CompletionRuleConfig;
        const rule: CompletionRule = {
          id: "config:" + entry.id,
          languages: entry.languages,
          words: entry.words,
          match: configured.match ? new RegExp(configured.match, configured.flags) : undefined,
        };
        return normalizeRule(rule, true);
      });
      for (const id of [...entries.keys()]) {
        if (id.startsWith("config:")) {
          entries.delete(id);
          kinds.delete(id);
        }
      }
      for (const entry of next) {
        entries.set(entry.id, entry);
        kinds.set(entry.id, entry.match ? "rule" : "words");
      }
      notify();
    },
    complete: async (input) => {
      alive();
      if (
        !input ||
        typeof input.text !== "string" ||
        typeof input.documentId !== "string" ||
        !input.documentId ||
        typeof input.language !== "string" ||
        !Number.isInteger(input.revision) ||
        input.revision < 0 ||
        !Number.isInteger(input.offset) ||
        input.offset < 0 ||
        input.offset > input.text.length ||
        !["automatic", "explicit"].includes(input.trigger)
      ) {
        throw new CompletionError(CompletionErrorCode.InvalidContext, "无效的补全正文或光标位置");
      }
      const stamp = revision;
      const context: CompletionContext = {
        documentId: input.documentId,
        revision: input.revision,
        language: normalizeCompletionLanguage(input.language),
        text: input.text,
        offset: input.offset,
        trigger: input.trigger,
        signal: input.signal,
      };
      Object.freeze(context);
      const current = (): void => {
        alive();
        if (context.signal?.aborted) {
          throw new CompletionError(CompletionErrorCode.Cancelled, "补全请求已取消");
        }
        if (stamp !== revision) {
          throw new CompletionError(CompletionErrorCode.Stale, "补全规则已变化");
        }
      };
      current();
      const before = context.text.slice(
        context.text.lastIndexOf("\n", context.offset - 1) + 1,
        context.offset,
      );
      const word =
        before.match(
          context.language === "shell" ? /[\p{ID_Continue}$-]*$/u : /[\p{ID_Continue}$]*$/u,
        )?.[0] ?? "";
      const from = context.offset - word.length;
      const failures: CompletionFailure[] = [];
      const applicable = [...entries.values()].filter(
        (entry) => entry.languages.includes(context.language) || entry.languages.includes("*"),
      );
      const groups = await Promise.all(
        applicable.map(async (entry): Promise<readonly CompletionItem[]> => {
          try {
            if (entry.match) {
              const match = entry.match.exec(before);
              if (!match || match.index + match[0].length !== before.length) {
                return [];
              }
            }
            if (entry.complete) {
              return await entry.complete(context);
            }
            if (!word && context.trigger !== "explicit") {
              return [];
            }
            return (entry.words ?? []).flatMap((value) => {
              const item = wordEntry(value);
              if (!item.label.toLowerCase().startsWith(word.toLowerCase())) {
                return [];
              }
              const completion: CompletionItem = {
                label: item.label,
                insertText: item.insertText ?? item.label,
                detail: item.detail,
                boost: item.boost ?? 0,
                from,
                to: context.offset,
              };
              return [completion];
            });
          } catch (error) {
            const failure: CompletionFailure = {
              ruleId: entry.id,
              message: error instanceof Error ? error.message : "补全规则失败",
            };
            failures.push(Object.freeze(failure));
            return [];
          }
        }),
      );
      current();
      const unique = new Map<string, CompletionItem>();
      for (const group of groups) {
        if (!Array.isArray(group)) {
          continue;
        }
        for (const item of group) {
          if (
            !item ||
            typeof item.label !== "string" ||
            !item.label ||
            typeof item.insertText !== "string" ||
            !Number.isInteger(item.from) ||
            !Number.isInteger(item.to) ||
            item.from < 0 ||
            item.from > context.offset ||
            item.to < context.offset ||
            item.to > context.text.length ||
            (item.boost !== undefined && !Number.isFinite(item.boost))
          ) {
            continue;
          }
          const key = JSON.stringify([item.from, item.to, item.insertText]);
          const previous = unique.get(key);
          if (!previous || (item.boost ?? 0) > (previous.boost ?? 0)) {
            const copy: CompletionItem = {
              label: item.label,
              insertText: item.insertText,
              detail: typeof item.detail === "string" ? item.detail : undefined,
              boost: item.boost ?? 0,
              from: item.from,
              to: item.to,
            };
            unique.set(key, Object.freeze(copy));
          }
        }
      }
      const items = [...unique.values()]
        .sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0) || a.label.localeCompare(b.label))
        .slice(0, 200);
      const result: CompletionResult = {
        documentId: context.documentId,
        revision: context.revision,
        registryRevision: stamp,
        language: context.language,
        offset: context.offset,
        items: Object.freeze(items),
        failures: Object.freeze(failures),
      };
      return Object.freeze(result);
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      entries.clear();
      kinds.clear();
      listeners.clear();
    },
  };
  for (const [language, words] of Object.entries(DEFAULT_WORDS)) {
    const list: CompletionWordList = {
      id: "builtin:" + language,
      languages: [language],
      words,
    };
    engine.registerWords(list);
  }
  const memberRule: CompletionRule = {
    id: "builtin:cpp-members",
    languages: ["cpp"],
    match: /(?:\.|->)[\w]*$/,
    words: CPP_MEMBERS,
  };
  engine.registerRule(memberRule);
  return engine;
}
