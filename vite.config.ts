import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Actions 发布时使用仓库名作为 base path，避免资源 404。
  base: process.env.GITHUB_ACTIONS ? "/JulianCapitalVaults/" : "/"
});
