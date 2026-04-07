export type NetworkName = "eth" | "arbitrum" | "base" | "hyperevm";

export interface NetworkConfig {
  key: NetworkName;
  name: string;
  chainId: number;
  rpcUrl: string;
}

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  eth: {
    key: "eth",
    name: "Ethereum Mainnet",
    chainId: 1,
    rpcUrl: "https://rpc.ankr.com/eth"
  },
  arbitrum: {
    key: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc"
  },
  base: {
    key: "base",
    name: "Base Mainnet",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org"
  },
  hyperevm: {
    key: "hyperevm",
    name: "HyperEVM Mainnet",
    chainId: 999,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm"
  }
};

export function getNetwork(name: NetworkName): NetworkConfig {
  return NETWORKS[name];
}

export function getAllNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS);
}
