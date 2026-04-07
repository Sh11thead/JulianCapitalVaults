# JulianCapitalVaults

TypeScript + Vite 的 Web3 前端项目模板，已包含 GitHub Pages 自动构建发布流程与多网络 RPC 配置。

## 快速开始

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建输出目录为 `dist/`。

## GitHub Pages 自动发布

已配置工作流文件：`.github/workflows/deploy.yml`

- 触发条件：push 到 `main` 分支（每次 commit push 都会触发）
- 构建命令：`npm run build`
- 发布目标：GitHub Pages

> 首次使用时，请在仓库 Settings -> Pages 中将 Source 设为 `GitHub Actions`。

## 多网络 RPC 配置

网络配置文件：`src/config/networks.ts`

你可以在 `NETWORKS` 对象中维护多个网络，例如：

- Ethereum
- Arbitrum
- Polygon
- Base

配置项包含：

- `key`
- `name`
- `chainId`
- `rpcUrl`

在业务代码中可使用：

- `getNetwork(name)` 获取指定网络配置
- `getAllNetworks()` 获取全部网络配置