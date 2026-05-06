import "./styles.css";
import { formatUnits, parseUnits, type Address } from "viem";
import { type NetworkName } from "./config/networks";
import {
  connectWallet,
  createNetworkPublicClient,
  createNetworkWalletClient,
  switchWalletChain
} from "./web3/viem";

// ── Pixel Canvas Animation ────────────────────────────────────────────────────
(function initPixelCanvas() {
  const canvas = document.getElementById("pixel-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  const SCALE = 4;

  let cols = 0;
  let rows = 0;
  let frame = 0;

  interface Star {
    x: number; y: number; phase: number; speed: number; size: number;
    burstT: number; nextBurst: number;
  }

  let stars: Star[] = [];

  function resize() {
    canvas!.width  = window.innerWidth;
    canvas!.height = window.innerHeight;
    cols = Math.ceil(canvas!.width  / SCALE);
    rows = Math.ceil(canvas!.height / SCALE);
  }

  function initStars() {
    stars = Array.from({ length: 120 }, () => ({
      x:         Math.random(),
      y:         Math.random() * 0.85,
      phase:     Math.random() * Math.PI * 2,
      speed:     0.012 + Math.random() * 0.022,
      size:      Math.random() < 0.18 ? 2 : 1,
      burstT:    0,
      nextBurst: Math.floor(Math.random() * 200),
    }));
  }

  function px(x: number, y: number, color: string, size = 1) {
    ctx!.fillStyle = color;
    ctx!.fillRect(x * SCALE, y * SCALE, SCALE * size, SCALE * size);
  }

  function drawGrid() {
    ctx!.strokeStyle = "rgba(24, 24, 31, 0.9)";
    ctx!.lineWidth   = 1;
    const step = SCALE * 8;
    for (let x = 0; x < canvas!.width; x += step) {
      ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, canvas!.height); ctx!.stroke();
    }
    for (let y = 0; y < canvas!.height; y += step) {
      ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(canvas!.width, y); ctx!.stroke();
    }
  }

  function drawStars() {
    stars.forEach((s) => {
      s.phase += s.speed;
      if (s.burstT > 0) {
        s.burstT--;
      } else {
        s.nextBurst--;
        if (s.nextBurst <= 0) {
          s.burstT    = 3 + Math.floor(Math.random() * 4);
          s.nextBurst = 60 + Math.floor(Math.random() * 220);
        }
      }
      const baseAlpha  = 0.12 + 0.45 * (0.5 + 0.5 * Math.sin(s.phase));
      const burstAlpha = s.burstT > 0 ? 0.98 : 0;
      const alpha      = Math.min(1, baseAlpha + burstAlpha);

      const rx = Math.floor(s.x * cols);
      const ry = Math.floor(s.y * rows);
      if (ry < 0 || ry >= rows) return;

      if (s.burstT > 0 && s.size === 2) {
        px(rx - 1, ry,     `rgba(255,255,220,0.35)`);
        px(rx + 1, ry,     `rgba(255,255,220,0.35)`);
        px(rx,     ry - 1, `rgba(255,255,220,0.35)`);
        px(rx,     ry + 1, `rgba(255,255,220,0.35)`);
      }
      px(rx, ry, `rgba(255,255,255,${alpha.toFixed(2)})`, s.size);
    });
  }

  function tick() {
    frame++;
    ctx!.fillStyle = "#050507";
    ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
    drawGrid();
    drawStars();
    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", () => { resize(); initStars(); });
  resize();
  initStars();
  requestAnimationFrame(tick);
})();

const VAULTS_API = "https://curatorapi.juliancapital.top/vaults";
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const RPC_MIN_INTERVAL_MS = 220;

const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const;

const VAULT_ABI = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  }
] as const;

interface MarketInfo {
  availableLiquidityFormatted: string;
  vaultSupplyAssetsFormatted: string;
}

interface Vault {
  name: string;
  address: string;
  network: string;
  token: string;
  userTotalAssetsFormatted: string;
  apr: string;
  snapshotAt: string;
  marketsInfo: MarketInfo[];
}

interface VaultsResponse {
  timestamp: number;
  vaults: Vault[];
}

type ActionMode = "deposit" | "withdraw";

interface AppState {
  loading: boolean;
  error: string | null;
  vaults: Vault[];
  selectedAddress: string | null;
  actionMode: ActionMode;
  inputAmount: string;
  searchQuery: string;
  positions: Record<string, number>;
  onchainPositions: Record<string, number>;
  onchainPositionRawByVault: Record<string, bigint>;
  tokenMetaByVault: Record<string, { asset: Address; decimals: number }>;
  walletBalancesByVault: Record<string, number>;
  walletBalanceRawByVault: Record<string, bigint>;
  walletAddress: Address | null;
  positionLoading: boolean;
  txPending: boolean;
  notice: string;
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root element not found.");
}

const root = app;

const state: AppState = {
  loading: true,
  error: null,
  vaults: [],
  selectedAddress: null,
  actionMode: "deposit",
  inputAmount: "",
  searchQuery: "",
  positions: {},
  onchainPositions: {},
  onchainPositionRawByVault: {},
  tokenMetaByVault: {},
  walletBalancesByVault: {},
  walletBalanceRawByVault: {},
  walletAddress: null,
  positionLoading: false,
  txPending: false,
  notice: ""
};

let lastOnchainSyncKey = "";

// ── Hash routing ──────────────────────────────────────────────────────────────
function getHashAddress(): string | null {
  const m = location.hash.match(/^#\/vault\/(0x[0-9a-fA-F]+)$/i);
  return m ? (m[1] as string) : null;
}

function syncFromHash() {
  const addr = getHashAddress();
  if (!addr) {
    state.selectedAddress = null;
    state.actionMode = "deposit";
    state.inputAmount = "";
    state.notice = "";
    lastOnchainSyncKey = "";
  } else {
    state.selectedAddress = addr;
  }
  render();
}

function navigateTo(address: string | null) {
  if (address) {
    history.pushState({}, "", "#/vault/" + address);
    state.selectedAddress = address;
    state.actionMode = "deposit";
    state.inputAmount = "";
    state.notice = "";
    lastOnchainSyncKey = "";
  } else {
    history.pushState({}, "", location.pathname + location.search);
    state.selectedAddress = null;
    state.notice = "";
    state.inputAmount = "";
    lastOnchainSyncKey = "";
  }
  render();
}

window.addEventListener("popstate", syncFromHash);
const nextRpcAtByNetwork: Partial<Record<NetworkName, number>> = {};

const networkLabelMap: Record<string, string> = {
  eth: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  hyperevm: "HyperEVM"
};

const networkLogoMap: Record<string, string> = {
  eth: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
  base: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
  arbitrum: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
  hyperevm: "https://icons.llamao.fi/icons/chains/rsz_hyperliquid.jpg"
};

function networkLogoImg(network: string): string {
  const src = networkLogoMap[network];
  const label = escapeHtml(networkLabelMap[network] ?? network);
  if (!src) {
    return `<span class="network-logo-fallback"></span>`;
  }
  return `<img class="network-logo" src="${src}" alt="${label}" onerror="this.style.display='none'" />`;
}

function parseNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeAmountInput(value: string): string {
  const compact = value.replaceAll(",", ".").replaceAll(/\s+/g, "");
  const cleaned = compact.replaceAll(/[^\d.]/g, "");
  const dotIndex = cleaned.indexOf(".");
  if (dotIndex === -1) {
    return cleaned;
  }

  const head = cleaned.slice(0, dotIndex + 1);
  const tail = cleaned.slice(dotIndex + 1).replaceAll(".", "");
  return `${head}${tail}`;
}

function trimFormattedAmount(value: string): string {
  if (!value.includes(".")) {
    return value;
  }

  const trimmed = value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function throttleRpc(network: NetworkName): Promise<void> {
  const now = Date.now();
  const nextAt = nextRpcAtByNetwork[network] ?? 0;
  if (nextAt > now) {
    await sleep(nextAt - now);
  }
  nextRpcAtByNetwork[network] = Date.now() + RPC_MIN_INTERVAL_MS;
}

async function throttledRead<T>(network: NetworkName, fn: () => Promise<T>): Promise<T> {
  await throttleRpc(network);
  return fn();
}

function isNetworkName(value: string): value is NetworkName {
  return value === "eth" || value === "base" || value === "arbitrum" || value === "hyperevm";
}

function getVaultNetwork(vault: Vault): NetworkName {
  if (!isNetworkName(vault.network)) {
    throw new Error(`Unsupported vault network: ${vault.network}`);
  }

  return vault.network;
}

function formatCompactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatToken(value: number, token: string): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)} ${token}`;
}

function shortAddress(address: string): string {
  if (address.length < 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPosition(vault: Vault): number {
  const onchain = state.onchainPositions[vault.address];
  if (typeof onchain === "number") {
    return onchain;
  }

  const current = state.positions[vault.address];
  if (typeof current === "number") {
    return current;
  }

  return parseNum(vault.userTotalAssetsFormatted);
}

function getLiquidity(vault: Vault): number {
  return vault.marketsInfo.reduce((sum, market) => {
    const marketLiquidity = parseNum(market.availableLiquidityFormatted);
    const vaultSupply = parseNum(market.vaultSupplyAssetsFormatted);
    return sum + Math.min(marketLiquidity, vaultSupply);
  }, 0);
}

function getSelectedVault(): Vault | undefined {
  if (!state.selectedAddress) {
    return undefined;
  }

  return state.vaults.find((vault) => vault.address === state.selectedAddress);
}

async function getOrLoadTokenMeta(vault: Vault): Promise<{ asset: Address; decimals: number }> {
  const cached = state.tokenMetaByVault[vault.address];
  if (cached) {
    return cached;
  }

  const network = getVaultNetwork(vault);
  const publicClient = createNetworkPublicClient(network);
  const vaultAddress = vault.address as Address;
  const asset = await throttledRead(network, () =>
    publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: "asset"
    })
  );

  const decimals = await throttledRead(network, () =>
    publicClient.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: "decimals"
    })
  );

  const meta = { asset, decimals: Number(decimals) };
  state.tokenMetaByVault[vault.address] = meta;
  return meta;
}

async function refreshOnchainPosition(vault: Vault) {
  if (!state.walletAddress) {
    return;
  }

  const syncKey = `${vault.address}:${state.walletAddress}`;

  state.positionLoading = true;
  render();

  try {
    const network = getVaultNetwork(vault);
    const publicClient = createNetworkPublicClient(network);
    const vaultAddress = vault.address as Address;
    const user = state.walletAddress;
    const tokenMeta = await getOrLoadTokenMeta(vault);

    let shares = 0n;
    let walletBalance = 0n;

    await throttleRpc(network);
    try {
      const multicallResult = await publicClient.multicall({
        contracts: [
          {
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: "balanceOf",
            args: [user]
          },
          {
            address: tokenMeta.asset,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [user]
          }
        ],
        allowFailure: false,
        multicallAddress: MULTICALL3_ADDRESS
      });

      shares = multicallResult[0];
      walletBalance = multicallResult[1];
    } catch {
      shares = await throttledRead(network, () =>
        publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: "balanceOf",
          args: [user]
        })
      );

      walletBalance = await throttledRead(network, () =>
        publicClient.readContract({
          address: tokenMeta.asset,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [user]
        })
      );
    }

    let assets = 0n;
    if (shares > 0n) {
      assets = await throttledRead(network, () =>
        publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: "convertToAssets",
          args: [shares]
        })
      );
    }

    state.onchainPositions[vault.address] = Number(formatUnits(assets, tokenMeta.decimals));
    state.onchainPositionRawByVault[vault.address] = assets;
    state.walletBalancesByVault[vault.address] = Number(formatUnits(walletBalance, tokenMeta.decimals));
    state.walletBalanceRawByVault[vault.address] = walletBalance;
    state.notice = "";
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Failed to read on-chain position.";
  } finally {
    lastOnchainSyncKey = syncKey;
    state.positionLoading = false;
    render();
  }
}

async function connectWalletAction(preferred: NetworkName) {
  try {
    const wallet = await connectWallet(preferred);
    state.walletAddress = wallet.address;
    state.notice = "Wallet connected.";
    render();

    const selected = getSelectedVault();
    if (selected) {
      await refreshOnchainPosition(selected);
    }
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Wallet connect failed.";
    render();
  }
}

async function executeAction(vault: Vault) {
  if (!state.walletAddress) {
    state.notice = "Please connect wallet first.";
    render();
    return;
  }

  state.txPending = true;
  state.notice = "Preparing transaction...";
  render();

  try {
    const network = getVaultNetwork(vault);
    await switchWalletChain(network);

    const walletClient = createNetworkWalletClient(network);
    const publicClient = createNetworkPublicClient(network);
    const tokenMeta = await getOrLoadTokenMeta(vault);
    const rawInput = state.inputAmount.trim();
    if (!rawInput) {
      throw new Error("Enter a valid amount.");
    }

    let amount = 0n;
    try {
      amount = parseUnits(rawInput, tokenMeta.decimals);
    } catch {
      throw new Error(`Invalid amount precision (max ${tokenMeta.decimals} decimals).`);
    }

    if (amount <= 0n) {
      throw new Error("Enter a valid amount.");
    }

    const currentRaw = state.onchainPositionRawByVault[vault.address];
    if (state.actionMode === "withdraw" && typeof currentRaw === "bigint" && amount > currentRaw) {
      throw new Error("Amount exceeds current position.");
    }

    const user = state.walletAddress;
    const vaultAddress = vault.address as Address;

    if (state.actionMode === "deposit") {
      const allowance = await throttledRead(network, () =>
        publicClient.readContract({
          address: tokenMeta.asset,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [user, vaultAddress]
        })
      );

      if (allowance < amount) {
        state.notice = "Approving token...";
        render();
        const approveHash = await walletClient.writeContract({
          address: tokenMeta.asset,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [vaultAddress, amount],
          account: user
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      state.notice = "Sending deposit transaction...";
      render();
      const txHash = await walletClient.writeContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "deposit",
        args: [amount, user],
        account: user
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    } else {
      state.notice = "Sending withdraw transaction...";
      render();
      const txHash = await walletClient.writeContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "withdraw",
        args: [amount, user, user],
        account: user
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    state.notice = "Transaction confirmed.";
    state.inputAmount = "";
    await refreshOnchainPosition(vault);
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Transaction failed.";
    render();
  } finally {
    state.txPending = false;
    render();
  }
}

const HOME_URL = "https://sh11thead.github.io/";

function renderTopbar(network: NetworkName): string {
  const walletLabel = state.walletAddress
    ? escapeHtml(shortAddress(state.walletAddress))
    : "CONNECT WALLET";
  return `
    <header class="topbar">
      <a class="brand" href="${HOME_URL}" aria-label="JulianCapital home">
        <span class="brand-name">JULIAN<span class="accent-text">CAPITAL</span></span>
      </a>
      <nav class="topbar-menu">
        <a href="${HOME_URL}#dapps"><span class="nav-num">↩</span><span class="nav-label">HOME</span></a>
        <span class="menu-active"><span class="nav-num">05</span><span class="nav-label">VAULTS</span></span>
        <button id="connectWalletBtn" class="wallet-btn" data-network="${network}" type="button">${walletLabel}</button>
      </nav>
    </header>
  `;
}

function renderVaultList(vaults: Vault[]): string {
  const totalDeposits = vaults.reduce((sum, vault) => sum + getPosition(vault), 0);

  return `
    ${renderTopbar("eth")}
    <main class="vault-layout">
      <div class="page-section-header">
        <div class="page-title-wrap">
          <p class="page-title-kicker">// ON-CHAIN YIELD</p>
          <h1 class="page-title">VAULTS</h1>
        </div>
        <div class="stat-pill">TOTAL DEPOSITS <strong>${formatCompactUsd(totalDeposits)}</strong></div>
      </div>

      <section class="surface">
        <div class="table-toolbar">
          <input id="searchInput" class="search-input" type="search" placeholder="// FILTER VAULTS" value="${escapeHtml(state.searchQuery)}" />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>NETWORK</th>
                <th>VAULT</th>
                <th>DEPOSITS</th>
                <th>LIQUIDITY</th>
                <th>CURATOR</th>
                <th>APY</th>
              </tr>
            </thead>
            <tbody>
              ${vaults.length === 0
      ? `<tr><td colspan="6" class="empty">No vaults found.</td></tr>`
      : vaults
        .map((vault) => {
          const deposit = getPosition(vault);
          const liquidity = getLiquidity(vault);
          return `
                          <tr class="vault-row" data-open="${vault.address}">
                            <td>
                              <div class="network-cell">
                                ${networkLogoImg(vault.network)}
                                ${escapeHtml(networkLabelMap[vault.network] ?? vault.network).toUpperCase()}
                              </div>
                            </td>
                            <td>
                              <div class="vault-title">${escapeHtml(vault.name).toUpperCase()}</div>
                              <div class="subtle">${escapeHtml(shortAddress(vault.address))}</div>
                            </td>
                            <td>
                              <div>${formatToken(deposit, vault.token)}</div>
                              <div class="subtle">${formatCompactUsd(deposit)}</div>
                            </td>
                            <td>
                              <div>${formatToken(liquidity, vault.token)}</div>
                              <div class="subtle">${formatCompactUsd(liquidity)}</div>
                            </td>
                            <td>
                              <div class="curator-cell">
                                <span class="jc-logo">JC</span>
                                JULIAN CAPITAL
                              </div>
                            </td>
                            <td><span class="apy-value">${parseNum(vault.apr).toFixed(2)}%</span></td>
                          </tr>
                        `;
        })
        .join("")
    }
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `;
}

function renderVaultDetail(vault: Vault): string {
  const position = getPosition(vault);
  const input = parseNum(state.inputAmount);
  const apy = parseNum(vault.apr);
  const liquidity = getLiquidity(vault);
  const isWithdraw = state.actionMode === "withdraw";
  const actionLabel = isWithdraw ? "WITHDRAW" : "DEPOSIT";
  const hasWalletContext = Boolean(state.walletAddress) && !state.positionLoading;

  const predictedPosition = hasWalletContext
    ? isWithdraw
      ? Math.max(position - input, 0)
      : Math.max(position + input, 0)
    : null;

  const yearly = (position * apy) / 100;
  const monthly = yearly / 12;
  const nextYearly = predictedPosition === null ? null : (predictedPosition * apy) / 100;
  const nextMonthly = nextYearly === null ? null : nextYearly / 12;

  const isInvalid = input <= 0 || (isWithdraw && input > position);
  const vaultNetwork = getVaultNetwork(vault);
  const walletBalance = state.walletBalancesByVault[vault.address] ?? 0;
  const positionText = state.walletAddress
    ? state.positionLoading
      ? "READING ON-CHAIN..."
      : formatToken(position, vault.token)
    : "CONNECT WALLET TO READ";

  return `
    ${renderTopbar(vaultNetwork)}
    <main class="detail-layout">
      <div class="detail-page-header">
        <button id="backBtn" class="back-btn" type="button">← BACK TO VAULTS</button>
        <h1 class="detail-vault-name">${escapeHtml(vault.name).toUpperCase()}</h1>
        <div class="meta-row">
          <span>${escapeHtml(shortAddress(vault.address))}</span>
          <span class="meta-network">${networkLogoImg(vault.network)}${escapeHtml(networkLabelMap[vault.network] ?? vault.network).toUpperCase()}</span>
          <span>${escapeHtml(vault.token)}</span>
        </div>
      </div>

      <div class="metric-grid">
        <div class="metric-block">
          <p class="metric-label">TOTAL DEPOSITS</p>
          <p class="metric-value">${formatCompactUsd(position)}</p>
          <p class="metric-sub">${positionText}</p>
        </div>
        <div class="metric-block">
          <p class="metric-label">AVAILABLE LIQUIDITY</p>
          <p class="metric-value">${formatCompactUsd(liquidity)}</p>
          <p class="metric-sub">${formatToken(liquidity, vault.token)}</p>
        </div>
        <div class="metric-block">
          <p class="metric-label">NET APY</p>
          <p class="metric-value accent">${apy.toFixed(2)}%</p>
          <p class="metric-sub">SNAPSHOT ${new Date(vault.snapshotAt).toLocaleString()}</p>
        </div>
      </div>

      <section class="detail-main">
        <div class="detail-left">
          <p class="detail-left-title">// POSITION PROJECTIONS</p>
          <div class="panel stats-panel">
            <div class="panel-line"><span>NETWORK</span><strong>${escapeHtml(networkLabelMap[vault.network] ?? vault.network).toUpperCase()}</strong></div>
            <div class="panel-line"><span>APY</span><strong class="apy-value">${apy.toFixed(2)}%</strong></div>
            <div class="panel-line"><span>PROJECTED MONTHLY</span><strong id="preview-monthly">${formatCompactUsd(monthly)} → ${nextMonthly === null ? "-" : formatCompactUsd(nextMonthly)}</strong></div>
            <div class="panel-line"><span>PROJECTED YEARLY</span><strong id="preview-yearly">${formatCompactUsd(yearly)} → ${nextYearly === null ? "-" : formatCompactUsd(nextYearly)}</strong></div>
          </div>
        </div>

        <aside class="detail-right">
          <div class="mode-tabs">
            <button data-mode="deposit" class="${state.actionMode === "deposit" ? "active" : ""}" type="button">DEPOSIT</button>
            <button data-mode="withdraw" class="${state.actionMode === "withdraw" ? "active" : ""}" type="button">WITHDRAW</button>
          </div>

          <section class="panel">
            <p class="panel-title">${actionLabel} ${escapeHtml(vault.token)}</p>
            <div class="amount-wrap">
              <input id="amountInput" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeHtml(state.inputAmount)}" />
              <button id="maxBtn" type="button">MAX</button>
            </div>
            <div class="panel-line">
              <span>CURRENT POSITION</span>
              <strong>${positionText}</strong>
            </div>
            <div class="panel-line">
              <span>AFTER ACTION</span>
              <strong id="preview-after">${predictedPosition === null ? "-" : formatToken(predictedPosition, vault.token)}</strong>
            </div>
            <div class="panel-line">
              <span>WALLET BALANCE</span>
              <strong>${state.walletAddress ? formatToken(walletBalance, vault.token) : "-"}</strong>
            </div>
          </section>

          <button id="actionBtn" class="submit-btn" type="button" ${isInvalid || !state.walletAddress || state.txPending ? "disabled" : ""}>${state.txPending ? "PENDING..." : actionLabel}</button>
          ${state.notice ? `<p class="notice">// ${escapeHtml(state.notice)}</p>` : ""}
        </aside>
      </section>
    </main>
  `;
}

function updateAmountPreview(vault: Vault) {
  const position = getPosition(vault);
  const input = parseNum(state.inputAmount);
  const apy = parseNum(vault.apr);
  const isWithdraw = state.actionMode === "withdraw";
  const hasWalletContext = Boolean(state.walletAddress) && !state.positionLoading;

  const predicted = hasWalletContext
    ? isWithdraw
      ? Math.max(position - input, 0)
      : Math.max(position + input, 0)
    : null;

  const yearly = (position * apy) / 100;
  const monthly = yearly / 12;
  const nextYearly = predicted === null ? null : (predicted * apy) / 100;
  const nextMonthly = nextYearly === null ? null : nextYearly / 12;
  const isInvalid = input <= 0 || (isWithdraw && input > position);

  const afterEl = document.querySelector<HTMLElement>("#preview-after");
  if (afterEl) afterEl.textContent = predicted === null ? "-" : formatToken(predicted, vault.token);

  const monthlyEl = document.querySelector<HTMLElement>("#preview-monthly");
  if (monthlyEl) monthlyEl.textContent = `${formatCompactUsd(monthly)} -> ${nextMonthly === null ? "-" : formatCompactUsd(nextMonthly)}`;

  const yearlyEl = document.querySelector<HTMLElement>("#preview-yearly");
  if (yearlyEl) yearlyEl.textContent = `${formatCompactUsd(yearly)} -> ${nextYearly === null ? "-" : formatCompactUsd(nextYearly)}`;

  const actionBtn = document.querySelector<HTMLButtonElement>("#actionBtn");
  if (actionBtn) actionBtn.disabled = isInvalid || !state.walletAddress || state.txPending;
}

function render() {
  if (state.loading) {
    root.innerHTML = `
      ${renderTopbar("eth")}
      <main class="vault-layout"><div class="loading">LOADING VAULTS...</div></main>
    `;
    return;
  }

  if (state.error) {
    root.innerHTML = `
      ${renderTopbar("eth")}
      <main class="vault-layout"><div class="error">${escapeHtml(state.error)}</div></main>
    `;
    return;
  }

  const selectedVault = getSelectedVault();

  if (!selectedVault) {
    const query = state.searchQuery.trim().toLowerCase();
    const filtered = state.vaults.filter((vault) => {
      if (!query) {
        return true;
      }

      const text = `${vault.name} ${vault.network} ${vault.token} ${vault.address}`.toLowerCase();
      return text.includes(query);
    });

    root.innerHTML = renderVaultList(filtered);

    const searchInput = document.querySelector<HTMLInputElement>("#searchInput");
    searchInput?.addEventListener("input", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      state.searchQuery = target.value;
      render();
    });

    const connectWalletBtn = document.querySelector<HTMLButtonElement>("#connectWalletBtn");
    connectWalletBtn?.addEventListener("click", async () => {
      await connectWalletAction("eth");
    });

    document.querySelectorAll<HTMLElement>(".vault-row").forEach((row) => {
      row.addEventListener("click", () => {
        const address = row.dataset.open;
        if (!address) {
          return;
        }

        navigateTo(address);
      });
    });

    return;
  }

  root.innerHTML = renderVaultDetail(selectedVault);

  const detailSyncKey = `${selectedVault.address}:${state.walletAddress ?? ""}`;
  if (state.walletAddress && !state.positionLoading && state.txPending === false && lastOnchainSyncKey !== detailSyncKey) {
    void refreshOnchainPosition(selectedVault);
  }

  const backBtn = document.querySelector<HTMLButtonElement>("#backBtn");
  backBtn?.addEventListener("click", () => {
    navigateTo(null);
  });

  document.querySelectorAll<HTMLButtonElement>(".mode-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (mode !== "deposit" && mode !== "withdraw") {
        return;
      }

      state.actionMode = mode;
      state.notice = "";
      render();
    });
  });

  const amountInput = document.querySelector<HTMLInputElement>("#amountInput");
  amountInput?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    const sanitized = sanitizeAmountInput(target.value);
    if (sanitized !== target.value) {
      target.value = sanitized;
    }
    state.inputAmount = sanitized;
    state.notice = "";
    updateAmountPreview(selectedVault);
  });

  const maxBtn = document.querySelector<HTMLButtonElement>("#maxBtn");
  maxBtn?.addEventListener("click", () => {
    const tokenMeta = state.tokenMetaByVault[selectedVault.address];
    if (tokenMeta) {
      const raw = state.actionMode === "withdraw"
        ? state.onchainPositionRawByVault[selectedVault.address]
        : state.walletBalanceRawByVault[selectedVault.address];
      if (typeof raw === "bigint") {
        state.inputAmount = trimFormattedAmount(formatUnits(raw, tokenMeta.decimals));
      }
    }

    if (!state.inputAmount) {
      const fallback = state.actionMode === "withdraw"
        ? getPosition(selectedVault).toString()
        : (state.walletBalancesByVault[selectedVault.address] ?? 0).toString();
      state.inputAmount = trimFormattedAmount(fallback);
    }

    state.notice = "";
    render();
  });

  const actionBtn = document.querySelector<HTMLButtonElement>("#actionBtn");
  actionBtn?.addEventListener("click", async () => {
    await executeAction(selectedVault);
  });

  const connectWalletBtn = document.querySelector<HTMLButtonElement>("#connectWalletBtn");
  connectWalletBtn?.addEventListener("click", async () => {
    await connectWalletAction(getVaultNetwork(selectedVault));
  });
}

async function init() {
  try {
    state.loading = true;
    render();

    const response = await fetch(VAULTS_API);
    if (!response.ok) {
      throw new Error(`Vault API request failed: ${response.status}`);
    }

    const data = (await response.json()) as VaultsResponse;
    state.vaults = data.vaults;
    state.positions = data.vaults.reduce<Record<string, number>>((acc, vault) => {
      acc[vault.address] = parseNum(vault.userTotalAssetsFormatted);
      return acc;
    }, {});
    state.error = null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Failed to load vaults.";
  } finally {
    state.loading = false;
    syncFromHash();
  }
}

void init();
