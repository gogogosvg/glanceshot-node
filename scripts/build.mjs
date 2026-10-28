// 跨平台构建（Windows 的 npm 用 cmd 跑脚本，不能用 rm -rf 和单引号 echo）
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
rmSync("dist", { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { stdio: "inherit" });
execFileSync(process.execPath, [tsc, "-p", "tsconfig.cjs.json"], { stdio: "inherit" });
writeFileSync("dist/cjs/package.json", '{"type":"commonjs"}\n');
