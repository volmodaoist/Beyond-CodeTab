#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = ["main.js", "manifest.json", "styles.css"];

function help() {
  console.log(`Beyond-CodeTab 常用命令

make                         显示帮助
make deps                    安装依赖
make build                   类型检查并构建到 dist/
make dev                     监听源码变化并构建
make test                    运行核心测试
make test-obsidian            构建并运行真实 Obsidian 回归
make demos                   录制真实 Obsidian GIF 演示（需要 FFmpeg）
make docs-check              检查文档链接、目录锚点和 GIF 文件
make lint                    检查代码规则与格式
make lint-fix                自动修复代码风格
make check                   运行测试、构建、lint 和文档检查

make install vault="/path/to/vault"  构建并安装到指定 Vault

安装只替换 main.js、manifest.json、styles.css，保留 data.json 等配置。
旧安装文件备份至 ~/.beyond-code-tab/backups/。
更新后在 Obsidian 中关闭再启用 Beyond-CodeTab，或重启 Obsidian。`);
}

export function validateVault(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error('请指定 Vault：make install vault="/path/to/vault"');
  }
  const expanded = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  const vault = resolve(expanded);
  if (!existsSync(vault) || !statSync(vault).isDirectory()) {
    throw new Error("Vault 目录不存在：" + vault);
  }
  const config = join(vault, ".obsidian");
  if (!existsSync(config) || !statSync(config).isDirectory()) {
    throw new Error("Vault 尚未初始化，缺少 .obsidian：" + vault);
  }
  return realpathSync(vault);
}

function npm(args) {
  const windows = process.platform === "win32";
  const options = {
    cwd: projectRoot,
    stdio: "inherit",
    shell: windows,
  };
  const result = spawnSync(windows ? "npm.cmd" : "npm", args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("npm " + args.join(" ") + " 失败");
  }
}

export function copyBuiltPlugin(root, vaultPath) {
  const vault = validateVault(vaultPath);
  const dist = join(root, "dist");
  for (const name of artifacts) {
    const source = join(dist, name);
    if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size === 0) {
      throw new Error("缺少构建产物：" + source);
    }
  }
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  const original = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (
    typeof manifest.id !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id) ||
    manifest.id !== original.id ||
    manifest.version !== original.version
  ) {
    throw new Error("构建清单与当前插件不一致，请重新构建");
  }
  const destination = join(vault, ".obsidian", "plugins", manifest.id);
  const existing = artifacts.filter((name) => existsSync(join(destination, name)));
  let backup = null;
  if (existing.length) {
    const backupRoot = join(homedir(), ".beyond-code-tab", "backups");
    mkdirSync(backupRoot, {
      recursive: true,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = mkdtempSync(join(backupRoot, basename(vault) + "-" + stamp + "-"));
    for (const name of existing) {
      copyFileSync(join(destination, name), join(backup, name));
    }
  }
  mkdirSync(destination, {
    recursive: true,
  });
  for (const name of artifacts) {
    const source = join(dist, name);
    const target = join(destination, name);
    copyFileSync(source, target);
    if (!readFileSync(source).equals(readFileSync(target))) {
      throw new Error("安装文件校验失败：" + target);
    }
  }
  const result = {
    destination,
    backup,
    name: manifest.name,
    version: manifest.version,
  };
  return result;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    help();
    return;
  }
  if (args.length) {
    throw new Error("未知参数，请运行 make 查看帮助");
  }
  const vault = validateVault(process.env.CODE_TAB_VAULT);
  if (
    !existsSync(join(projectRoot, "node_modules/esbuild/package.json")) ||
    !existsSync(join(projectRoot, "node_modules/typescript/package.json"))
  ) {
    npm(["ci", "--no-audit", "--no-fund"]);
  }
  npm(["run", "build"]);
  const result = copyBuiltPlugin(projectRoot, vault);
  console.log("已安装 " + result.name + " " + result.version + "\n" + result.destination);
  if (result.backup) {
    console.log("旧文件备份：" + result.backup);
  }
  console.log("请在 Obsidian 中关闭再启用 Beyond-CodeTab，加载新构建。");
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
