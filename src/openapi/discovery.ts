import type { CodeTabApi, CodeTabApiRequest } from "./types";

export const CODE_TAB_API_EVENT = "obsidian-code-tab-api";

/** 可以复制到接入方；只依赖公开类型与容器所属 Document。 */
export function getCodeTabApi(doc: Document): CodeTabApi | null {
  const win = doc.defaultView;
  if (!win) {
    return null;
  }
  const request: CodeTabApiRequest = {};
  const options: CustomEventInit<CodeTabApiRequest> = {
    detail: request,
  };
  doc.dispatchEvent(new win.CustomEvent(CODE_TAB_API_EVENT, options));
  return request.api ?? null;
}
