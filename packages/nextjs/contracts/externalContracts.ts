import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

const PYUSD_ABI = [
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const externalContracts = {
  31337: {
    // Local network
    PYUSD: {
      address: "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9",
      abi: PYUSD_ABI,
    },
  },
  11155111: {
    // Sepolia
    PYUSD: {
      address: "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9",
      abi: PYUSD_ABI,
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
