import "./styles.css";
import { getAllNetworks, type NetworkName } from "./config/networks";
import { connectWallet, createNetworkPublicClient, switchWalletChain } from "./web3/viem";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root element not found.");
}

const networkList = getAllNetworks();
const defaultNetwork = "eth" as NetworkName;

app.innerHTML = `
  <main class="layout">
    <section class="card">
      <h1>Julian Capital Vaults</h1>
      <p class="subtitle">viem + 多网络配置驱动的钱包连接与切链</p>

      <div class="toolbar">
        <button id="connectBtn" type="button">连接钱包</button>
        <select id="networkSelect" aria-label="Target network">
          ${networkList
            .map(
              (network) =>
                `<option value="${network.key}" ${network.key === defaultNetwork ? "selected" : ""}>${network.name}</option>`
            )
            .join("")}
        </select>
        <button id="switchBtn" type="button">切换网络</button>
      </div>

      <div class="status-grid">
        <p><strong>钱包地址:</strong> <span id="walletAddress">未连接</span></p>
        <p><strong>钱包链 ID:</strong> <span id="walletChainId">-</span></p>
        <p><strong>目标链最新区块:</strong> <span id="blockNumber">-</span></p>
        <p><strong>状态:</strong> <span id="statusText">就绪</span></p>
      </div>

      <h2>Supported Networks</h2>
      <ul>
        ${networkList
          .map(
            (network) =>
              `<li><strong>${network.name}</strong> (chainId: ${network.chainId})<br />${network.rpcUrl}</li>`
          )
          .join("")}
      </ul>
    </section>
  </main>
`;

const connectBtn = document.querySelector<HTMLButtonElement>("#connectBtn")!;
const switchBtn = document.querySelector<HTMLButtonElement>("#switchBtn")!;
const networkSelect = document.querySelector<HTMLSelectElement>("#networkSelect")!;
const walletAddressEl = document.querySelector<HTMLSpanElement>("#walletAddress")!;
const walletChainIdEl = document.querySelector<HTMLSpanElement>("#walletChainId")!;
const blockNumberEl = document.querySelector<HTMLSpanElement>("#blockNumber")!;
const statusTextEl = document.querySelector<HTMLSpanElement>("#statusText")!;

if (
  !connectBtn ||
  !switchBtn ||
  !networkSelect ||
  !walletAddressEl ||
  !walletChainIdEl ||
  !blockNumberEl ||
  !statusTextEl
) {
  throw new Error("UI elements not found.");
}

function getSelectedNetwork(): NetworkName {
  return networkSelect.value as NetworkName;
}

function setStatus(text: string) {
  statusTextEl.textContent = text;
}

async function refreshBlockNumber(name: NetworkName) {
  const client = createNetworkPublicClient(name);
  const blockNumber = await client.getBlockNumber();
  blockNumberEl.textContent = blockNumber.toString();
}

connectBtn.addEventListener("click", async () => {
  try {
    setStatus("连接钱包中...");
    const network = getSelectedNetwork();
    const wallet = await connectWallet(network);
    walletAddressEl.textContent = wallet.address;
    walletChainIdEl.textContent = wallet.chainId.toString();
    await refreshBlockNumber(network);
    setStatus("钱包连接成功");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "连接失败");
  }
});

switchBtn.addEventListener("click", async () => {
  try {
    const network = getSelectedNetwork();
    setStatus(`切换到 ${network} 中...`);
    const chainId = await switchWalletChain(network);
    walletChainIdEl.textContent = chainId.toString();
    await refreshBlockNumber(network);
    setStatus("切链成功");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "切链失败");
  }
});

refreshBlockNumber(defaultNetwork).catch(() => {
  setStatus("默认 RPC 区块读取失败，请检查网络状态");
});
