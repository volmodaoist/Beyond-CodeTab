import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const watch = process.argv.includes("--watch");

const options = {
  absWorkingDir: root,
  entryPoints: ["src/main.ts", "src/styles.css"],
  outdir: "dist",
  bundle: true,
  // 与 Obsidian 共享 CodeMirror 实例，避免重复打包后扩展对象无法被宿主识别。
  external: ["obsidian", "@codemirror/state", "@codemirror/view", "@codemirror/autocomplete"],
  format: "cjs",
  platform: "browser",
  target: "es2019",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  plugins: [
    {
      name: "plugin-assets",
      setup(build) {
        // CSS 的 @import 由 esbuild 合并并自动监听；清单也参与 watch。
        build.onLoad(
          {
            filter: /main[.]ts$/,
          },
          () => ({
            watchFiles: ["manifest.json"].map((path) =>
              fileURLToPath(new URL(path, import.meta.url)),
            ),
          }),
        );
        build.onEnd(async (result) => {
          if (result.errors.length) {
            return;
          }
          await mkdir(new URL("dist/", import.meta.url), {
            recursive: true,
          });
          const sources = await Promise.all([
            readFile(new URL("src/openapi/types.ts", import.meta.url), "utf8"),
            readFile(new URL("src/core/completion/types.ts", import.meta.url), "utf8"),
            readFile(new URL("src/openapi/errors.ts", import.meta.url), "utf8"),
            readFile(new URL("src/core/completion/errors.ts", import.meta.url), "utf8"),
          ]);
          const types = sources
            .slice(0, 2)
            .map((text) =>
              text.replace(/^import type .*?;\n/gm, (line) =>
                line.includes('"obsidian"') ? line : "",
              ),
            );
          const enums = sources.slice(2).map((text) => text.slice(0, text.indexOf("export class")));
          await writeFile(
            new URL("dist/code-tab-api.d.ts", import.meta.url),
            [...types, ...enums].join("\n"),
          );
          await Promise.all([
            copyFile(
              new URL("manifest.json", import.meta.url),
              new URL("dist/manifest.json", import.meta.url),
            ),
          ]);
        });
      },
    },
  ],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
