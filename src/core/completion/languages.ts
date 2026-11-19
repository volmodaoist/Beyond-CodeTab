const ALIASES: Record<string, string> = {
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  python: "python",
  python3: "python",
  py: "python",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  golang: "go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
};

export function normalizeCompletionLanguage(value: string): string {
  const language = value.trim().toLowerCase();
  return ALIASES[language] ?? language;
}
