import * as chains from "viem/chains";

export type BaseConfig = {
  targetNetworks: readonly chains.Chain[];
  pollingInterval: number;
  alchemyApiKey: string;
  rpcOverrides?: Record<number, string>;
  walletConnectProjectId: string;
  onlyLocalBurnerWallet: boolean;
};

export type ScaffoldConfig = BaseConfig;

export const DEFAULT_ALCHEMY_API_KEY = "oKxs-03sij-U_N0iOlrSsZFr29-IqbuF";

// Define Mantle Sepolia Testnet chain
const mantleTestnet: chains.Chain = {
  id: 5003,
  name: "Mantle Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "MNT",
    symbol: "MNT",
  },
  rpcUrls: {
    public: { http: ["https://rpc.sepolia.mantle.xyz"] },
    default: { http: ["https://rpc.sepolia.mantle.xyz"] },
  },
  blockExplorers: {
    default: { name: "Mantlescan", url: "https://sepolia.mantlescan.xyz" },
  },
  testnet: true,
};

// Define Mantle Mainnet chain
const mantleMainnet: chains.Chain = {
  id: 5000,
  name: "Mantle",
  nativeCurrency: {
    decimals: 18,
    name: "MNT",
    symbol: "MNT",
  },
  rpcUrls: {
    public: { http: ["https://rpc.mantle.xyz"] },
    default: { http: ["https://rpc.mantle.xyz"] },
  },
  blockExplorers: {
    default: { name: "Mantlescan", url: "https://mantlescan.xyz" },
  },
  testnet: false,
};

const scaffoldConfig = {
  // The networks on which your DApp is live
  // Default to Mantle Testnet for EquiBaskets
  targetNetworks: [mantleTestnet, mantleMainnet, chains.hardhat],

  // The interval at which your front-end polls the RPC servers for new data
  pollingInterval: 30000,

  // Alchemy API key (for other networks)
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || DEFAULT_ALCHEMY_API_KEY,

  // RPC overrides - can use Mantle-specific RPCs
  rpcOverrides: {
    [mantleTestnet.id]: process.env.NEXT_PUBLIC_MANTLE_TESTNET_RPC_URL || "https://rpc.sepolia.mantle.xyz",
    [mantleMainnet.id]: process.env.NEXT_PUBLIC_MANTLE_MAINNET_RPC_URL || "https://rpc.mantle.xyz",
  },

  // WalletConnect project ID
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",

  onlyLocalBurnerWallet: false,
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
