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

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export interface ConnectedWallet {
  address: Hex;
  chainId: number;
}

function toViemChain(name: NetworkName): Chain {
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

export async function connectWallet(preferredNetwork: NetworkName): Promise<ConnectedWallet> {
  const provider = getBrowserProvider();
  const walletClient = createWalletClient({
    chain: toViemChain(preferredNetwork),
    transport: custom(provider)
  });

  const [address] = await walletClient.requestAddresses();
  const chainId = await walletClient.getChainId();

  return {
    address,
    chainId
  };
}

export async function switchWalletChain(targetNetwork: NetworkName): Promise<number> {
  const provider = getBrowserProvider();
  const chain = toViemChain(targetNetwork);
  const walletClient = createWalletClient({
    chain,
    transport: custom(provider)
  });

  try {
    await walletClient.switchChain({ id: chain.id });
  } catch {
    await walletClient.addChain({ chain });
    await walletClient.switchChain({ id: chain.id });
  }

  return walletClient.getChainId();
}

export function getSupportedChains() {
  return getAllNetworks().map((network) => ({
    ...network,
    chain: toViemChain(network.key)
  }));
}