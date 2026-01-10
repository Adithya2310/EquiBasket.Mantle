import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import { task } from "hardhat/config";
import generateTsAbis from "./scripts/generateTsAbis";
import * as fs from "fs";

// ============================================================
// ===================== ENVIRONMENT SETUP ====================
// ============================================================

/**
 * Deployer private key for deployment transactions.
 * Uses environment variable or falls back to Hardhat's default test account.
 * 
 * IMPORTANT: Never commit real private keys. Use .env file for production keys.
 */
const deployerPrivateKey =
  process.env.DEPLOYER_PRIVATE_KEY ??
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Mantle RPC URLs
 * - Testnet: https://rpc.sepolia.mantle.xyz (Mantle Sepolia)
 * - Mainnet: https://rpc.mantle.xyz
 */
const mantleTestnetRpc = process.env.MANTLE_TESTNET_RPC_URL ?? "https://rpc.sepolia.mantle.xyz";
const mantleMainnetRpc = process.env.MANTLE_MAINNET_RPC_URL ?? "https://rpc.mantle.xyz";

/**
 * Optional API keys for other networks (kept for flexibility)
 */
const providerApiKey = process.env.ALCHEMY_API_KEY || "oKxs-03sij-U_N0iOlrSsZFr29-IqbuF";
const etherscanApiKey = process.env.ETHERSCAN_V2_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";

/**
 * Mantlescan API key for contract verification on Mantle
 */
const mantlescanApiKey = process.env.MANTLESCAN_API_KEY || "";

// ============================================================
// ==================== HARDHAT CONFIG ========================
// ============================================================

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },

  /**
   * DEFAULT NETWORK: Mantle Sepolia Testnet
   * This ensures all commands (deploy, test in network mode) default to Mantle.
   * Use --network hardhat for local testing.
   */
  defaultNetwork: "mantleTestnet",

  namedAccounts: {
    deployer: {
      default: 0, // First account from the accounts array
    },
  },

  networks: {
    // ================== LOCAL DEVELOPMENT ==================
    hardhat: {
      // Local network for testing - no forking by default
      chainId: 31337,
      forking: {
        url: mantleMainnetRpc,
        enabled: process.env.MAINNET_FORKING_ENABLED === "true",
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },

    // ================== MANTLE NETWORKS ==================
    /**
     * Mantle Testnet (Sepolia)
     * Chain ID: 5003
     * Explorer: https://sepolia.mantlescan.xyz
     */
    mantleTestnet: {
      url: mantleTestnetRpc,
      chainId: 5003,
      accounts: [deployerPrivateKey],
      gasPrice: "auto",
    },

    /**
     * Mantle Mainnet
     * Chain ID: 5000
     * Explorer: https://mantlescan.xyz
     */
    mantleMainnet: {
      url: mantleMainnetRpc,
      chainId: 5000,
      accounts: [deployerPrivateKey],
      gasPrice: "auto",
    },

    // ================== ETHEREUM NETWORKS ==================
    mainnet: {
      url: "https://mainnet.rpc.buidlguidl.com",
      accounts: [deployerPrivateKey],
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },

    // ================== L2 NETWORKS ==================
    arbitrum: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    arbitrumSepolia: {
      url: `https://arb-sepolia.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    optimism: {
      url: `https://opt-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    optimismSepolia: {
      url: `https://opt-sepolia.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: [deployerPrivateKey],
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: [deployerPrivateKey],
    },

    // ================== OTHER NETWORKS ==================
    polygon: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    polygonAmoy: {
      url: `https://polygon-amoy.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
  },

  // ================== VERIFICATION CONFIG ==================
  etherscan: {
    apiKey: {
      // Mantle networks
      mantleTestnet: mantlescanApiKey,
      mantleMainnet: mantlescanApiKey,
      // Ethereum networks
      mainnet: etherscanApiKey,
      sepolia: etherscanApiKey,
      // L2 networks
      arbitrumOne: etherscanApiKey,
      arbitrumSepolia: etherscanApiKey,
      optimisticEthereum: etherscanApiKey,
      optimismSepolia: etherscanApiKey,
      base: etherscanApiKey,
      baseSepolia: etherscanApiKey,
    },
    customChains: [
      {
        network: "mantleTestnet",
        chainId: 5003,
        urls: {
          apiURL: "https://api-sepolia.mantlescan.xyz/api",
          browserURL: "https://sepolia.mantlescan.xyz",
        },
      },
      {
        network: "mantleMainnet",
        chainId: 5000,
        urls: {
          apiURL: "https://api.mantlescan.xyz/api",
          browserURL: "https://mantlescan.xyz",
        },
      },
    ],
  },

  // Configuration for etherscan-verify from hardhat-deploy plugin
  verify: {
    etherscan: {
      apiKey: mantlescanApiKey || etherscanApiKey,
    },
  },

  sourcify: {
    enabled: false,
  },

  // Gas reporter configuration
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    gasPrice: 21,
  },
};

// ============================================================
// ===================== CUSTOM TASKS =========================
// ============================================================

// Extend the deploy task to auto-generate TypeScript ABIs
task("deploy").setAction(async (args, hre, runSuper) => {
  await runSuper(args);
  if (fs.existsSync("./deployments")) {
    await generateTsAbis(hre);
  }
});

export default config;
