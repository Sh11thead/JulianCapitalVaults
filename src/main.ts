import "./styles.css";
import { formatUnits, parseUnits, type Address } from "viem";
import { type NetworkName } from "./config/networks";
import {
  connectWallet,
  createNetworkPublicClient,
  createNetworkWalletClient,
  switchWalletChain
} from "./web3/viem";

const VAULTS_API = "https://curatorapi.juliancapital.top/vaults";
const OFFICIAL_LOGO_PATH = `${import.meta.env.BASE_URL}julian-capital-logo.png`;
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
  tokenMetaByVault: Record<string, { asset: Address; decimals: number }>;
  walletBalancesByVault: Record<string, number>;
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
  tokenMetaByVault: {},
  walletBalancesByVault: {},
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
    state.walletBalancesByVault[vault.address] = Number(formatUnits(walletBalance, tokenMeta.decimals));
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

  const amountNum = parseNum(state.inputAmount);
  if (amountNum <= 0) {
    state.notice = "Enter a valid amount.";
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
    const amount = parseUnits(state.inputAmount, tokenMeta.decimals);
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

function renderWalletButton(network: NetworkName): string {
  if (state.walletAddress) {
    return `<button id="connectWalletBtn" class="wallet-btn" type="button">${escapeHtml(shortAddress(state.walletAddress))}</button>`;
  }

  return `<button id="connectWalletBtn" class="wallet-btn" data-network="${network}" type="button">Connect Wallet</button>`;
}

function renderVaultList(vaults: Vault[]): string {
  const totalDeposits = vaults.reduce((sum, vault) => sum + getPosition(vault), 0);

  return `
    <main class="vault-layout">
      <header class="page-header">
        <div class="header-left">
          <img class="brand-logo" src="${OFFICIAL_LOGO_PATH}" alt="Julian Capital logo" />
          <h1>Julian Capital Vaults</h1>
        </div>
        <div class="header-right">
          <div class="pill">Total Deposits <strong>${formatCompactUsd(totalDeposits)}</strong></div>
          ${renderWalletButton("eth")}
        </div>
      </header>

      <section class="surface">
        <div class="table-toolbar">
          <input id="searchInput" class="search-input" type="search" placeholder="Filter vaults" value="${escapeHtml(state.searchQuery)}" />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Network</th>
                <th>Vault</th>
                <th>Deposits</th>
                <th>Liquidity</th>
                <th>Curator</th>
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
                                ${escapeHtml(networkLabelMap[vault.network] ?? vault.network)}
                              </div>
                            </td>
                            <td>
                              <div class="vault-title">${escapeHtml(vault.name)}</div>
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
                                <img class="curator-logo" src="${OFFICIAL_LOGO_PATH}" alt="Julian Capital" />
                                Julian Capital
                              </div>
                            </td>
                            <td><strong>${parseNum(vault.apr).toFixed(2)}%</strong></td>
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
  const actionLabel = isWithdraw ? "Withdraw" : "Deposit";
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
      ? "Reading on-chain..."
      : formatToken(position, vault.token)
    : "Connect wallet to read";

  return `
    <main class="detail-layout">
      <button id="backBtn" class="back-btn" type="button">Back to vaults</button>

      <section class="detail-main">
        <div class="detail-left">
          <h1>${escapeHtml(vault.name)}</h1>
          <div class="meta-row">
            <span>${escapeHtml(shortAddress(vault.address))}</span>
            <span class="meta-network">${networkLogoImg(vault.network)}${escapeHtml(networkLabelMap[vault.network] ?? vault.network)}</span>
            <span>${escapeHtml(vault.token)}</span>
          </div>

          <div class="metric-grid">
            <div>
              <p class="metric-label">Total Deposits</p>
              <p class="metric-value">${formatCompactUsd(position)}</p>
              <p class="metric-sub">${positionText}</p>
            </div>
            <div>
              <p class="metric-label">Liquidity</p>
              <p class="metric-value">${formatCompactUsd(liquidity)}</p>
              <p class="metric-sub">${formatToken(liquidity, vault.token)}</p>
            </div>
            <div>
              <p class="metric-label">Net APY</p>
              <p class="metric-value">${apy.toFixed(2)}%</p>
              <p class="metric-sub">Snapshot ${new Date(vault.snapshotAt).toLocaleString()}</p>
            </div>
          </div>
        </div>

        <aside class="detail-right">
          <div class="detail-brand">
            <img class="brand-logo" src="${OFFICIAL_LOGO_PATH}" alt="Julian Capital logo" />
            ${renderWalletButton(vaultNetwork)}
          </div>
          <div class="mode-tabs">
            <button data-mode="deposit" class="${state.actionMode === "deposit" ? "active" : ""}" type="button">Deposit</button>
            <button data-mode="withdraw" class="${state.actionMode === "withdraw" ? "active" : ""}" type="button">Withdraw</button>
          </div>

          <section class="panel">
            <p class="panel-title">${actionLabel} ${escapeHtml(vault.token)}</p>
            <div class="amount-wrap">
              <input id="amountInput" type="number" min="0" step="0.01" placeholder="0.00" value="${escapeHtml(state.inputAmount)}" />
              <button id="maxBtn" type="button">MAX</button>
            </div>
            <div class="panel-line">
              <span>Current position</span>
              <strong>${positionText}</strong>
            </div>
            <div class="panel-line">
              <span>After action</span>
              <strong id="preview-after">${predictedPosition === null ? "-" : formatToken(predictedPosition, vault.token)}</strong>
            </div>
            <div class="panel-line">
              <span>Wallet balance</span>
              <strong>${state.walletAddress ? formatToken(walletBalance, vault.token) : "-"}</strong>
            </div>
          </section>

          <section class="panel stats-panel">
            <div class="panel-line"><span>Network</span><strong>${escapeHtml(networkLabelMap[vault.network] ?? vault.network)}</strong></div>
            <div class="panel-line"><span>APY</span><strong>${apy.toFixed(2)}%</strong></div>
            <div class="panel-line"><span>Projected monthly</span><strong id="preview-monthly">${formatCompactUsd(monthly)} -> ${nextMonthly === null ? "-" : formatCompactUsd(nextMonthly)}</strong></div>
            <div class="panel-line"><span>Projected yearly</span><strong id="preview-yearly">${formatCompactUsd(yearly)} -> ${nextYearly === null ? "-" : formatCompactUsd(nextYearly)}</strong></div>
          </section>

          <button id="actionBtn" class="submit-btn" type="button" ${isInvalid || !state.walletAddress || state.txPending ? "disabled" : ""}>${state.txPending ? "Pending..." : actionLabel}</button>
          ${state.notice ? `<p class="notice">${escapeHtml(state.notice)}</p>` : ""}
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
    root.innerHTML = `<main class="vault-layout"><div class="loading">Loading vaults...</div></main>`;
    return;
  }

  if (state.error) {
    root.innerHTML = `<main class="vault-layout"><div class="error">${escapeHtml(state.error)}</div></main>`;
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
    state.inputAmount = target.value;
    state.notice = "";
    updateAmountPreview(selectedVault);
  });

  const maxBtn = document.querySelector<HTMLButtonElement>("#maxBtn");
  maxBtn?.addEventListener("click", () => {
    const position = getPosition(selectedVault);
    state.inputAmount = state.actionMode === "withdraw" ? position.toFixed(2) : (state.walletBalancesByVault[selectedVault.address] ?? 0).toFixed(2);
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
