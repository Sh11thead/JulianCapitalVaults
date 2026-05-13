import Onboard, { type OnboardAPI } from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";
import { type EIP1193Provider } from "viem";
import { getAllNetworks, getNetwork, type NetworkName } from "../config/networks";

// ── Lazy-init singleton ──────────────────────────────────────────────────────
let _onboard: OnboardAPI | null = null;
let _provider: EIP1193Provider | null = null;

function getOnboard(): OnboardAPI {
  if (_onboard) return _onboard;

  const injected = injectedModule();

  _onboard = Onboard({
    wallets: [injected],

    chains: getAllNetworks().map((n) => ({
      id: `0x${n.chainId.toString(16)}`,
      token: "ETH",
      label: n.name,
      rpcUrl: n.rpcUrl,
    })),

    appMetadata: {
      name: "Julian Capital Nest",
      description: "On-chain yield nests curated by Julian Capital.",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <rect width="32" height="32" fill="#050507"/>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
          font-family="monospace" font-size="14" font-weight="700" fill="#ff4d00">JC</text>
      </svg>`,
    },

    // Dark pixel theme matching the site
    theme: {
      "--w3o-background-color":        "#050507",
      "--w3o-foreground-color":        "#0d0d14",
      "--w3o-text-color":              "#e8e8e0",
      "--w3o-border-color":            "#18181f",
      "--w3o-action-color":            "#ff4d00",
      "--w3o-border-radius":           "0px",
      "--w3o-font-family":             "'Space Mono', 'Courier New', monospace",
    },

    connect: {
      autoConnectLastWallet: true,
      removeWhereIsMyWalletWarning: true,
    },

    accountCenter: {
      desktop: { enabled: false },
      mobile:  { enabled: false },
    },
  });

  return _onboard;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getStoredProvider(): EIP1193Provider | null {
  // Also check if onboard already has a connected wallet (e.g. auto-reconnect)
  if (_provider) return _provider;
  if (!_onboard) return null;
  const wallets = _onboard.state.get().wallets;
  if (wallets[0]?.provider) {
    _provider = wallets[0].provider as unknown as EIP1193Provider;
    return _provider;
  }
  return null;
}

export async function connectWithOnboard(
  preferredNetwork: NetworkName
): Promise<{ address: `0x${string}`; chainId: number }> {
  const onboard = getOnboard();
  const wallets = await onboard.connectWallet();

  if (!wallets[0]) throw new Error("Wallet connection cancelled.");

  const wallet = wallets[0];
  _provider = wallet.provider as unknown as EIP1193Provider;

  const address = wallet.accounts[0]?.address as `0x${string}`;
  if (!address) throw new Error("No account found.");

  // Switch to preferred chain
  const preferredChainId = getNetwork(preferredNetwork).chainId;
  await onboard.setChain({ chainId: `0x${preferredChainId.toString(16)}` });

  const chainId = parseInt(wallet.chains[0]?.id ?? "0x1", 16);
  return { address, chainId };
}

export async function switchOnboardChain(network: NetworkName): Promise<void> {
  const onboard = getOnboard();
  const chainId = getNetwork(network).chainId;
  await onboard.setChain({ chainId: `0x${chainId.toString(16)}` });
}

// Kick off auto-reconnect on page load (silently, no modal)
export function initOnboard(): void {
  getOnboard();
}
