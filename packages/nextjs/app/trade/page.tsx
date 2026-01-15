"use client";

import { useState } from "react";
import { HermesClient } from "@pythnetwork/hermes-client";
import type { NextPage } from "next";
import { formatEther, parseEther } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract } from "wagmi";
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { BasketSelector } from "~~/components/BasketSelector";
import { useBasketContext, useFormattedBasketData } from "~~/contexts/BasketContext";
import deployedContracts from "~~/contracts/deployedContracts";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { formatTokenAmount } from "~~/utils/formatNumber";
import { notification } from "~~/utils/scaffold-eth";

/**
 * Trade Page - Liquidity Pool Integration
 *
 * UPDATED: Now uses basket-specific pools from BasketFactory
 * - Each basket has its own unique pool deployed by BasketFactory
 * - Pool address: BasketFactory.basketPools(basketId)
 * - Token address: BasketFactory.basketTokens(basketId)
 *
 * Notes:
 * - Charts are oracle-driven (not AMM-driven)
 * - Pool pricing must never diverge from oracle price
 * - Uses NATIVE MNT (msg.value) for swaps
 */

const timeframes = ["1H", "4H", "1D", "1W", "1M"];

type Order = { date: string; basket: string; type: "Buy" | "Sell"; amount: string; price: string };
const orderHistory: Order[] = [];

// Get the chain ID from deployed contracts and pool ABI
const chainId = Object.keys(deployedContracts)[0] as unknown as keyof typeof deployedContracts;
const chainContracts = deployedContracts[chainId] as any;
const poolAbi = chainContracts?.BasketLiquidityPool?.abi || [];

const Trade: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient();
  const [activeTimeframe, setActiveTimeframe] = useState("4H");
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showLiquidityModal, setShowLiquidityModal] = useState(false);
  const [liquidityMnt, setLiquidityMnt] = useState("");
  const [liquidityBasket, setLiquidityBasket] = useState("");
  const [isSwapping, setIsSwapping] = useState(false);
  const [isAddingLiquidity, setIsAddingLiquidity] = useState(false);
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);

  // Basket context
  const { selectedBasketId, selectedBasket, refreshPrices } = useBasketContext();

  const { basketSymbol, basketPrice, mntPrice } = useFormattedBasketData();

  // ========================================================
  // Get basket-specific pool and token addresses from factory
  // ========================================================

  // Read pool address from BasketFactory
  const { data: poolAddress } = useScaffoldReadContract({
    contractName: "BasketFactory",
    functionName: "basketPools",
    args: [selectedBasketId ?? 0n],
  });

  // Read token address from BasketFactory
  const { data: tokenAddress } = useScaffoldReadContract({
    contractName: "BasketFactory",
    functionName: "basketTokens",
    args: [selectedBasketId ?? 0n],
  });

  // Check if pool exists for this basket
  const isPoolAvailable = poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000";

  // ========================================================
  // Get BasketOracle contract info for Pyth price updates
  // ========================================================
  const { data: basketOracleInfo } = useDeployedContractInfo("BasketOracle");
  const { writeContractAsync: writeOracleAsync } = useScaffoldWriteContract({ contractName: "BasketOracle" });

  // ========================================================
  // Read from dynamic pool address
  // ========================================================

  // Read pool reserves using dynamic pool address
  const { data: reservesData, refetch: refetchReserves } = useReadContract({
    address: poolAddress as `0x${string}`,
    abi: poolAbi,
    functionName: "getReserves",
    query: { enabled: !!isPoolAvailable },
  });

  // Read user native MNT balance using wagmi useBalance
  const { data: nativeBalance, refetch: refetchMntBalance } = useBalance({
    address: connectedAddress,
  });

  // Parse values - reservesData returns [mntReserve, basketReserve]
  const reserves = reservesData as [bigint, bigint] | undefined;
  const mntReserveNum = reserves?.[0] ? Number(formatEther(reserves[0])) : 0;
  const basketReserveNum = reserves?.[1] ? Number(formatEther(reserves[1])) : 0;
  const userMnt = nativeBalance?.value ? Number(formatEther(nativeBalance.value)) : 0;

  // Calculate estimated output based on oracle price
  const calculateEstimated = (inputAmount: string) => {
    const inputNum = parseFloat(inputAmount) || 0;
    if (basketPrice === 0 || mntPrice === 0) return "0";

    if (activeTab === "buy") {
      // Buying basket tokens with MNT
      // MNT amount * MNT price / basket price = basket tokens
      const usdValue = inputNum * mntPrice;
      const basketAmount = usdValue / basketPrice;
      return basketAmount.toFixed(6);
    } else {
      // Selling basket tokens for MNT
      // Basket amount * basket price / MNT price = MNT
      const usdValue = inputNum * basketPrice;
      const mntAmount = usdValue / mntPrice;
      return mntAmount.toFixed(4);
    }
  };

  // Check liquidity
  const hasEnoughLiquidity = () => {
    if (activeTab === "buy") {
      const basketOut = parseFloat(calculateEstimated(amount));
      return basketOut <= basketReserveNum;
    } else {
      const mntOut = parseFloat(calculateEstimated(amount));
      return mntOut <= mntReserveNum;
    }
  };

  // Handle swap - uses native MNT for buy, basket tokens for sell
  const handleSwap = async () => {
    if (!amount || isSwapping || !poolAddress || !selectedBasketId || !isPoolAvailable) return;

    try {
      setIsSwapping(true);

      const { writeContract, waitForTransactionReceipt } = await import("wagmi/actions");
      const config = await import("~~/services/web3/wagmiConfig").then(m => m.wagmiConfig);

      if (activeTab === "buy") {
        // Swap native MNT for Basket Tokens
        const mntAmount = parseEther(amount);

        notification.info("Executing swap...");
        const hash = await writeContract(config, {
          address: poolAddress as `0x${string}`,
          abi: poolAbi,
          functionName: "swapMntForBasket",
          args: [],
          value: mntAmount,
        });

        // Wait for transaction confirmation
        notification.info("Waiting for confirmation...");
        await waitForTransactionReceipt(config, { hash });

        notification.success(`Successfully bought ${basketSymbol}!`);
      } else {
        // Swap Basket Tokens for native MNT
        const basketAmount = parseEther(amount);

        // Step 1: Approve basket tokens to pool
        if (!tokenAddress) {
          notification.error("Token address not found");
          return;
        }

        notification.info("Approving tokens...");
        const approveHash = await writeContract(config, {
          address: tokenAddress as `0x${string}`,
          abi: [
            {
              name: "approve",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "spender", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              outputs: [{ type: "bool" }],
            },
          ],
          functionName: "approve",
          args: [poolAddress, basketAmount],
        });
        await waitForTransactionReceipt(config, { hash: approveHash });

        // Step 2: Execute swap
        notification.info("Executing swap...");
        const swapHash = await writeContract(config, {
          address: poolAddress as `0x${string}`,
          abi: poolAbi,
          functionName: "swapBasketForMnt",
          args: [basketAmount],
        });

        // Wait for transaction confirmation
        notification.info("Waiting for confirmation...");
        await waitForTransactionReceipt(config, { hash: swapHash });

        notification.success(`Successfully sold ${basketSymbol}!`);
      }

      setAmount("");

      // Refetch balances after transaction is confirmed
      await refetchMntBalance();
      await refetchReserves();
      refreshPrices();
    } catch (error: any) {
      console.error("Error swapping:", error);
      notification.error(error?.message || "Swap failed");
    } finally {
      setIsSwapping(false);
    }
  };

  // Handle add liquidity - uses native MNT via msg.value
  const handleAddLiquidity = async () => {
    if (!liquidityMnt || !liquidityBasket || !poolAddress || !selectedBasketId || !isPoolAvailable) return;
    if (!tokenAddress) {
      notification.error("Basket token address not found");
      return;
    }

    try {
      setIsAddingLiquidity(true);
      const mntAmount = parseEther(liquidityMnt);
      const basketAmount = parseEther(liquidityBasket);

      const { writeContract } = await import("wagmi/actions");
      const config = await import("~~/services/web3/wagmiConfig").then(m => m.wagmiConfig);

      // Step 1: Approve basket tokens to pool
      notification.info("Approving basket tokens...");
      await writeContract(config, {
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            name: "approve",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ type: "bool" }],
          },
        ],
        functionName: "approve",
        args: [poolAddress, basketAmount],
      });

      // Step 2: Add liquidity
      notification.info("Adding liquidity...");
      await writeContract(config, {
        address: poolAddress as `0x${string}`,
        abi: poolAbi,
        functionName: "addLiquidity",
        args: [basketAmount],
        value: mntAmount,
      });

      notification.success("Liquidity added successfully!");
      setShowLiquidityModal(false);
      setLiquidityMnt("");
      setLiquidityBasket("");
      refetchMntBalance();
      refetchReserves();
    } catch (error: any) {
      console.error("Error adding liquidity:", error);
      notification.error(error?.message || "Failed to add liquidity");
    } finally {
      setIsAddingLiquidity(false);
    }
  };

  const filteredOrders = orderHistory.filter(
    order =>
      order.basket.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.date.includes(searchQuery) ||
      order.type.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleUpdatePythPrices = async () => {
    if (!selectedBasket?.assets?.length) {
      notification.error("Select a basket to update its Pyth feeds.");
      return;
    }
    if (!basketOracleInfo?.address || !basketOracleInfo?.abi || !publicClient) {
      notification.error("BasketOracle details unavailable.");
      return;
    }

    try {
      setIsUpdatingPrices(true);
      // Fetch feed ids for current basket assets from the oracle
      const feedIds = await Promise.all(
        selectedBasket.assets.map(
          asset =>
            publicClient.readContract({
              address: basketOracleInfo.address as `0x${string}`,
              abi: basketOracleInfo.abi,
              functionName: "assetPriceFeedIds",
              args: [asset],
            }) as Promise<`0x${string}`>,
        ),
      );

      const validFeedIds = feedIds.filter(
        id => id !== "0x0000000000000000000000000000000000000000000000000000000000000000",
      );

      if (validFeedIds.length === 0) {
        notification.error("No Pyth feeds configured for this basket.");
        return;
      }

      const connection = new HermesClient("https://hermes.pyth.network");
      const priceUpdates = await connection.getLatestPriceUpdates(validFeedIds, {
        encoding: "hex",
        ignoreInvalidPriceIds: true,
      });
      const updatePayloads = priceUpdates.binary.data.map(
        d => (d.startsWith("0x") || d.startsWith("0X") ? d : `0x${d}`) as `0x${string}`,
      );

      const requiredFee = (await publicClient.readContract({
        address: basketOracleInfo.address as `0x${string}`,
        abi: basketOracleInfo.abi,
        functionName: "getPythUpdateFee",
        args: [updatePayloads],
      })) as bigint;

      notification.info("Submitting price update to Pyth...");
      await writeOracleAsync({
        functionName: "updatePriceFeeds",
        args: [updatePayloads],
        value: requiredFee,
      });

      notification.success("Pyth price feeds updated");
      refreshPrices();
    } catch (error: any) {
      console.error("Error updating Pyth prices:", error);
      notification.error(error?.shortMessage || error?.message || "Failed to update Pyth prices");
    } finally {
      setIsUpdatingPrices(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-base-200 to-black py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Basket Header */}
          <div className="card-glass p-6 mb-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-4 mb-2">
                  <BasketSelector />
                  <button
                    onClick={() => {
                      refreshPrices();
                      refetchReserves();
                    }}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <ArrowPathIcon className="w-5 h-5 text-white/50" />
                  </button>
                  <button
                    onClick={handleUpdatePythPrices}
                    disabled={isUpdatingPrices || !selectedBasket?.assets?.length}
                    className="px-3 py-2 rounded-lg border border-white/20 text-white text-sm hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isUpdatingPrices ? "Updating feeds..." : "Push Pyth Update"}
                  </button>
                </div>
                <p className="text-white/50 text-sm">
                  {selectedBasket?.assets?.join(", ") || "Select a basket to trade"}
                </p>
              </div>
              <div className="text-left md:text-right">
                <p className="text-4xl font-bold mb-1">${basketPrice.toFixed(2)}</p>
                <p className="text-sm text-white/50">Oracle Price</p>
              </div>
              <button
                onClick={() => setShowLiquidityModal(true)}
                disabled={!isPoolAvailable}
                className="btn btn-primary gap-2 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlusIcon className="w-5 h-5" />
                Add Liquidity
              </button>
            </div>

            {/* Pool Not Available Warning */}
            {!isPoolAvailable && selectedBasketId && (
              <div className="mt-4 p-4 bg-warning/10 border border-warning/30 rounded-lg flex items-start gap-3">
                <ExclamationTriangleIcon className="w-6 h-6 text-warning flex-shrink-0" />
                <div>
                  <p className="text-sm text-warning font-medium">No Liquidity Pool for this Basket</p>
                  <p className="text-xs text-white/50 mt-1">
                    This basket doesn&apos;t have a liquidity pool yet. A pool is created when the basket is created via
                    BasketFactory.
                  </p>
                </div>
              </div>
            )}

            {/* Pool Stats */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
              <div>
                <p className="text-sm text-white/50 mb-1">MNT Reserve</p>
                <p className="text-xl font-bold">
                  {mntReserveNum.toLocaleString(undefined, { maximumFractionDigits: 2 })} MNT
                </p>
              </div>
              <div>
                <p className="text-sm text-white/50 mb-1">{basketSymbol} Reserve</p>
                <p className="text-xl font-bold">
                  {basketReserveNum.toLocaleString(undefined, { maximumFractionDigits: 4 })} {basketSymbol}
                </p>
              </div>
              <div>
                <p className="text-sm text-white/50 mb-1">MNT Price</p>
                <p className="text-xl font-bold">${mntPrice.toFixed(4)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart Panel */}
            <div className="lg:col-span-2">
              <div className="card-glass p-6 mb-6">
                {/* Timeframe Selector */}
                <div className="flex gap-2 mb-6">
                  {timeframes.map(tf => (
                    <button
                      key={tf}
                      onClick={() => setActiveTimeframe(tf)}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        activeTimeframe === tf
                          ? "bg-primary text-white"
                          : "bg-base-300 text-white/50 hover:text-white/70"
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* Price Chart Placeholder */}
                <div className="relative h-96 bg-base-300/30 rounded-lg overflow-hidden">
                  <svg className="w-full h-full" viewBox="0 0 800 400" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M 0 300 Q 100 250 200 280 T 400 200 T 600 150 T 800 180"
                      fill="url(#chartGradient)"
                      stroke="none"
                    />
                    <path
                      d="M 0 300 Q 100 250 200 280 T 400 200 T 600 150 T 800 180"
                      fill="none"
                      stroke="#3B82F6"
                      strokeWidth="3"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-4xl font-bold text-white mb-2">${basketPrice.toFixed(2)}</p>
                      <p className="text-sm text-white/50">Oracle Price for {basketSymbol}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Buy/Sell Panel */}
            <div className="lg:col-span-1">
              <div className="card-glass p-6 sticky top-24">
                {/* Tabs */}
                <div className="grid grid-cols-2 gap-2 mb-6">
                  <button
                    onClick={() => setActiveTab("buy")}
                    className={`py-3 rounded-lg font-semibold transition-colors ${
                      activeTab === "buy" ? "bg-success text-white" : "bg-base-300 text-white/50 hover:text-white/70"
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setActiveTab("sell")}
                    className={`py-3 rounded-lg font-semibold transition-colors ${
                      activeTab === "sell" ? "bg-error text-white" : "bg-base-300 text-white/50 hover:text-white/70"
                    }`}
                  >
                    Sell
                  </button>
                </div>

                {/* Amount Input */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {activeTab === "buy" ? "MNT Amount" : `${basketSymbol} Amount`}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-base-300 border border-white/20 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-primary transition-colors"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 font-medium">
                      {activeTab === "buy" ? "MNT" : basketSymbol}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 mt-2">Available: {formatTokenAmount(userMnt)} MNT</p>
                </div>

                {/* Swap Icon */}
                <div className="flex justify-center my-4">
                  <div className="p-2 bg-base-300 rounded-full">
                    <ArrowsRightLeftIcon className="w-5 h-5 text-white/50 rotate-90" />
                  </div>
                </div>

                {/* Liquidity Warning */}
                {amount && !hasEnoughLiquidity() && (
                  <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg flex items-start gap-2">
                    <ExclamationTriangleIcon className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-error font-medium mb-2">Insufficient Pool Liquidity</p>
                      <button
                        onClick={() => setShowLiquidityModal(true)}
                        className="text-xs text-error underline hover:no-underline"
                      >
                        Add liquidity to enable this swap
                      </button>
                    </div>
                  </div>
                )}

                {/* Estimated Receive */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-white/70 mb-2">You will receive</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={calculateEstimated(amount)}
                      readOnly
                      className="w-full bg-base-300/50 border border-white/10 rounded-lg px-4 py-3 text-white text-lg cursor-not-allowed"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 font-medium">
                      {activeTab === "buy" ? basketSymbol : "MNT"}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 mt-2">Fee: 0.3% • Oracle-priced swap</p>
                </div>

                {/* Action Button */}
                <button
                  onClick={handleSwap}
                  disabled={!isPoolAvailable || !amount || !hasEnoughLiquidity() || isSwapping || !selectedBasketId}
                  className={`w-full py-4 rounded-lg font-semibold text-white text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    activeTab === "buy"
                      ? "bg-success hover:bg-success/90 shadow-lg shadow-success/30"
                      : "bg-error hover:bg-error/90 shadow-lg shadow-error/30"
                  }`}
                >
                  {!isPoolAvailable
                    ? "Pool Not Available"
                    : isSwapping
                      ? "Processing..."
                      : `${activeTab === "buy" ? "Buy" : "Sell"} ${basketSymbol}`}
                </button>
              </div>
            </div>
          </div>

          {/* Order History */}
          <div className="card-glass p-6 mt-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 className="text-2xl font-bold">Trade History</h2>
              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search trades"
                  className="w-full bg-base-300 border border-white/20 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                />
                <MagnifyingGlassIcon className="w-5 h-5 text-white/50 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Basket</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Type</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Amount</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-white/50">
                        No trade history yet
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order, index) => (
                      <tr key={index} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-4 px-4 text-white/70">{order.date}</td>
                        <td className="py-4 px-4 font-semibold">{order.basket}</td>
                        <td className="py-4 px-4">
                          <span
                            className={`px-3 py-1 rounded-full text-sm font-medium ${
                              order.type === "Buy" ? "bg-success/20 text-success" : "bg-error/20 text-error"
                            }`}
                          >
                            {order.type}
                          </span>
                        </td>
                        <td className="py-4 px-4">{order.amount}</td>
                        <td className="py-4 px-4 font-semibold">{order.price}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Liquidity Modal */}
          {showLiquidityModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="card-glass p-6 max-w-md w-full">
                <h2 className="text-2xl font-bold mb-6">Add Liquidity</h2>
                <p className="text-sm text-white/50 mb-4">Add liquidity to the {basketSymbol} pool</p>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">MNT Amount</label>
                    <input
                      type="number"
                      value={liquidityMnt}
                      onChange={e => setLiquidityMnt(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-base-300 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                    />
                    <p className="text-xs text-white/50 mt-1">Available: {formatTokenAmount(userMnt)} MNT</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">{basketSymbol} Amount</label>
                    <input
                      type="number"
                      value={liquidityBasket}
                      onChange={e => setLiquidityBasket(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-base-300 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>

                  <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg">
                    <p className="text-sm text-white/70">
                      <span className="font-medium">Note:</span> The pool uses oracle pricing for swaps, so any ratio is
                      accepted.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowLiquidityModal(false);
                      setLiquidityMnt("");
                      setLiquidityBasket("");
                    }}
                    className="flex-1 py-3 rounded-lg font-semibold bg-base-300 text-white hover:bg-base-300/70 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddLiquidity}
                    disabled={!liquidityMnt || !liquidityBasket || isAddingLiquidity}
                    className="flex-1 py-3 rounded-lg font-semibold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAddingLiquidity ? "Processing..." : "Add Liquidity"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Trade;
