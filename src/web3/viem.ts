import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Chain,
  type EIP1193Provider,
  type Hex
} from "viem";
import { getAllNetworks, getNetwork, type NetworkName } from "../config/networks";
import {
  connectWithOnboard,
  getStoredProvider,
  switchOnboardChain
} from "./onboard";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export interface ConnectedWallet {
  address: Hex;
  chainId: number;
}

export function toViemChain(name: NetworkName): Chain {
  const network = getNetwork(name);

  return {
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [network.rpcUrl]
      },
      public: {
        http: [network.rpcUrl]
      }
    }
  };
}

export function getBrowserProvider(): EIP1193Provider {
  const onboardProvider = getStoredProvider();
  if (onboardProvider) return onboardProvider;

  if (!window.ethereum) {
    throw new Error("未检测到钱包，请先安装 MetaMask / Rabby 等 EVM 钱包。");
  }

  return window.ethereum;
}

export function createNetworkPublicClient(name: NetworkName) {
  const network = getNetwork(name);
  const chain = toViemChain(name);

  return createPublicClient({
    chain,
    transport: http(network.rpcUrl)
  });
}

export function createNetworkWalletClient(name: NetworkName) {
  const provider = getBrowserProvider();

  return createWalletClient({
    chain: toViemChain(name),
    transport: custom(provider)
  });
}

export async function connectWallet(preferredNetwork: NetworkName): Promise<ConnectedWallet> {
  return connectWithOnboard(preferredNetwork);
}

export async function switchWalletChain(targetNetwork: NetworkName): Promise<number> {
  await switchOnboardChain(targetNetwork);
  const walletClient = createNetworkWalletClient(targetNetwork);
  return walletClient.getChainId();
}

export function getSupportedChains() {
  return getAllNetworks().map((network) => ({
    ...network,
    chain: toViemChain(network.key)
  }));
}