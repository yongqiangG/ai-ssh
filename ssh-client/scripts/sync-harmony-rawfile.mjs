// 鸿蒙 rawfile 同步（阶段 1 迁移）：跑 HARMONY_TERMINAL=1 的 singlefile 构建，
// 把自包含 terminal.html 放进 harmony entry rawfile。
// resource://rawfile 页 origin 为 null，js/css 子资源加载会被 CORS 拦死
// （261019 黑屏根因），手工拼 chunk 会炸 ESM 边界（e is not defined 实证），
// 故用 vite-plugin-singlefile 在构建期合法内联。在 npm run build:mobile 后执行。
import { copyFileSync, existsSync, rmSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dst = resolve(root, "harmony/entry/src/main/resources/rawfile/terminal");

// singlefile 构建（独立 outDir，避免清掉正常构建的 dist-mobile）
const out = resolve(root, "dist-mobile-terminal");
execSync("npx vite build --config vite.mobile.config.ts", {
  cwd: root,
  env: { ...process.env, HARMONY_TERMINAL: "1" },
  stdio: "inherit",
});

const src = resolve(out, "terminal.html");
if (!existsSync(src)) {
  console.error("[sync-harmony] singlefile 产物缺失：dist-mobile-terminal/terminal.html");
  process.exit(1);
}
// 校验自包含：不应有外链 script/stylesheet
const html = String(process.argv.length); // placeholder no-op
const content = (await import("node:fs")).readFileSync(src, "utf8");
if (/(src|href)="\.\/[^"]+"/.test(content)) {
  console.error("[sync-harmony] 产物仍有外链，检查 singlefile 插件是否生效");
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
copyFileSync(src, resolve(dst, "terminal.html"));
console.log(`[sync-harmony] rawfile/terminal/terminal.html 单文件同步完成（${(statSync(src).size / 1024).toFixed(0)}KB）`);
