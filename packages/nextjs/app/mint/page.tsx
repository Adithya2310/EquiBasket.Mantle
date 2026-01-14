"use client";

import { useMemo, useState } from "react";
import type { NextPage } from "next";
import { formatEther, parseEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import { ArrowPathIcon, FireIcon, PlusCircleIcon } from "@heroicons/react/24/outline";
import { BasketSelector } from "~~/components/BasketSelector";
import { useBasketContext, useFormattedBasketData } from "~~/contexts/BasketContext";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { formatTokenAmount } from "~~/utils/formatNumber";
import { notification } from "~~/utils/scaffold-eth";

/**
 * Mint & Burn Page - Vault Integration
 *
 * As per UI Migration document Section 4️⃣:
 * 1. User selects a basket
 * 2. UI fetches BasketOracle.getBasketPrice() and BasketVault.getUserPosition()
 * 3. UI computes required collateral (client-side preview)
 * 4. On submit: depositCollateral() + mintBasket()
 *
 * Vault Health Panel displays:
 * - Total MNT collateral
 * - Basket debt value
 * - Collateral ratio (CR)
 * - Liquidation threshold marker
 */

const MintBurn: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const [activeTab, setActiveTab] = useState<"mint" | "burn">("mint");
  const [mintAmount, setMintAmount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Basket context
  const { selectedBasketId, refreshUserPosition, refreshPrices } = useBasketContext();

  const {
    basketName,
    basketSymbol,
    basketPrice,
    mntPrice,
    collateral,
    debt,
    collateralRatio,
    isLiquidatable,
    hasPosition,
  } = useFormattedBasketData();

  // Get vault address
  const { data: vaultInfo } = useDeployedContractInfo({ contractName: "BasketVault" as const });
  const vaultAddress = vaultInfo?.address;

  // Get native MNT balance using wagmi useBalance
  const { data: nativeBalance, refetch: refetchMntBalance } = useBalance({
    address: connectedAddress,
  });

  // Note: basketTokens mapping can be used for future token-specific operations

  // Write contracts
  const { writeContractAsync: writeVaultAsync } = useScaffoldWriteContract({ contractName: "BasketVault" });

  // Collateral ratio constants from contract
  const COLLATERAL_RATIO = 500; // 500%
  // Liquidation threshold is 150%

  // Calculate collateral required for minting - memoized for reactivity
  const collateralRequired = useMemo(() => {
    if (!mintAmount || basketPrice === 0 || mntPrice === 0) return "0";
    try {
      const mintAmountNum = parseFloat(mintAmount);
      if (isNaN(mintAmountNum) || mintAmountNum <= 0) return "0";

      const requiredUSD = mintAmountNum * basketPrice * (COLLATERAL_RATIO / 100);
      const requiredMNT = requiredUSD / mntPrice;
      return requiredMNT.toFixed(4);
    } catch {
      return "0";
    }
  }, [mintAmount, basketPrice, mntPrice]);

  // Calculate MNT to release when burning
  const calculateRedemption = (amountToBurn: string): string => {
    if (!amountToBurn || basketPrice === 0 || mntPrice === 0) return "0";
    try {
      const burnAmountNum = parseFloat(amountToBurn);
      const valueUSD = burnAmountNum * basketPrice * (COLLATERAL_RATIO / 100);
      const mntToRelease = valueUSD / mntPrice;
      return mntToRelease.toFixed(4);
    } catch {
      return "0";
    }
  };

  // Handle mint with NATIVE MNT
  const handleMint = async () => {
    if (!mintAmount || parseFloat(mintAmount) <= 0) {
      notification.error("Please enter a valid mint amount");
      return;
    }

    if (!connectedAddress) {
      notification.error("Please connect your wallet");
      return;
    }

    if (!vaultAddress) {
      notification.error("Vault address not found");
      return;
    }

    if (!selectedBasketId) {
      notification.error("Please select a basket");
      return;
    }

    setIsProcessing(true);

    try {
      const amountToMint = parseEther(mintAmount);
      const collateralWei = parseEther(collateralRequired);

      // Step 1: Deposit native MNT as collateral (via msg.value)
      // IMPORTANT: Wait for 1 block confirmation before minting to ensure collateral is recorded
      notification.info("Step 1/2: Depositing native MNT collateral...");
      await writeVaultAsync(
        {
          functionName: "depositCollateral",
          args: [selectedBasketId],
          value: collateralWei, // Send native MNT
        },
        { blockConfirmations: 1 }, // Wait for transaction to be mined
      );

      // Step 2: Mint basket tokens (now collateral should be on-chain)
      notification.info("Step 2/2: Minting basket tokens...");
      await writeVaultAsync({
        functionName: "mintBasket",
        args: [selectedBasketId, amountToMint],
      });

      notification.success(`Successfully minted ${mintAmount} ${basketSymbol} !`);
      setMintAmount("");

      // Refresh data
      refreshUserPosition();
      refetchMntBalance();
    } catch (error: any) {
      console.error("Error minting:", error);
      notification.error(error?.message || "Failed to mint basket tokens");
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle burn
  const handleBurn = async () => {
    if (!burnAmount || parseFloat(burnAmount) <= 0) {
      notification.error("Please enter a valid burn amount");
      return;
    }

    if (!connectedAddress) {
      notification.error("Please connect your wallet");
      return;
    }

    if (!selectedBasketId) {
      notification.error("Please select a basket");
      return;
    }

    setIsProcessing(true);

    try {
      const amountToBurn = parseEther(burnAmount);

      notification.info("Burning basket tokens...");

      await writeVaultAsync({
        functionName: "burnBasket",
        args: [selectedBasketId, amountToBurn],
      });

      notification.success(`Successfully burned ${burnAmount} ${basketSymbol} !`);
      setBurnAmount("");

      // Refresh data
      refreshUserPosition();
      refetchMntBalance();
    } catch (error: any) {
      console.error("Error burning:", error);
      notification.error(error?.message || "Failed to burn basket tokens");
    } finally {
      setIsProcessing(false);
    }
  };

  // Format balances (using native MNT balance from wagmi useBalance)
  const userMntBalance = nativeBalance?.value ? formatTokenAmount(Number(formatEther(nativeBalance.value))) : "0";

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-base-200 to-black py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-bold mb-4">
              Mint & Burn <span className="gradient-text">Basket Tokens</span>
            </h1>
            <p className="text-xl text-white/70">Create or redeem synthetic basket assets backed by MNT collateral</p>
          </div>

          {/* Basket Selector */}
          <div className="flex justify-center mb-8">
            <BasketSelector />
          </div>

          {!connectedAddress && (
            <div className="card-glass p-8 text-center mb-8">
              <p className="text-xl text-white/70">Please connect your wallet to continue</p>
            </div>
          )}

          {connectedAddress && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Main Panel */}
              <div className="lg:col-span-2">
                <div className="card-glass p-8">
                  {/* Basket Info */}
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                      <label className="block text-sm font-medium text-white/70">Selected Basket: {basketName}</label>
                      <button
                        onClick={() => {
                          refreshPrices();
                          refreshUserPosition();
                        }}
                        className="text-primary hover:text-primary/80 transition-colors"
                      >
                        <ArrowPathIcon className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-base-300/50 rounded-lg p-4">
                        <p className="text-sm text-white/50 mb-1">Basket Price</p>
                        <p className="text-2xl font-bold text-primary">${basketPrice.toFixed(2)}</p>
                      </div>
                      <div className="bg-base-300/50 rounded-lg p-4">
                        <p className="text-sm text-white/50 mb-1">MNT Price</p>
                        <p className="text-2xl font-bold text-primary">${mntPrice.toFixed(4)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-2 mb-8 border-b border-white/10">
                    <button
                      onClick={() => setActiveTab("mint")}
                      className={`flex items - center gap - 2 px - 6 py - 3 font - semibold transition - colors ${activeTab === "mint"
                        ? "text-primary border-b-2 border-primary"
                        : "text-white/50 hover:text-white/70"
                        } `}
                      disabled={isProcessing}
                    >
                      <PlusCircleIcon className="w-5 h-5" />
                      Mint
                    </button>
                    <button
                      onClick={() => setActiveTab("burn")}
                      className={`flex items - center gap - 2 px - 6 py - 3 font - semibold transition - colors ${activeTab === "burn"
                        ? "text-primary border-b-2 border-primary"
                        : "text-white/50 hover:text-white/70"
                        } `}
                      disabled={isProcessing}
                    >
                      <FireIcon className="w-5 h-5" />
                      Burn
                    </button>
                  </div>

                  {/* Mint Tab */}
                  {activeTab === "mint" && (
                    <div className="space-y-6">
                      {/* Debug Panel - Remove in production */}
                      {process.env.NODE_ENV === "development" && (
                        <div className="bg-base-300/30 border border-white/10 rounded-lg p-3">
                          <p className="text-xs text-white/50 font-mono">
                            Debug: basketPrice={basketPrice.toFixed(2)} | mntPrice={mntPrice.toFixed(4)} |
                            collateralRequired={collateralRequired}
                          </p>
                        </div>
                      )}

                      <div className="bg-info/10 border border-info/30 rounded-lg p-4 mb-4">
                        <p className="text-sm text-info">
                          ℹ️ Minting will: (1) Deposit native MNT collateral, (2) Mint {basketSymbol}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-3">
                          Amount of {basketSymbol} to Mint
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            value={mintAmount}
                            onChange={e => setMintAmount(e.target.value)}
                            placeholder="0.00"
                            step="0.01"
                            disabled={isProcessing}
                            className="w-full bg-base-300 border border-white/20 rounded-lg px-4 py-4 text-white text-xl focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 font-medium">
                            {basketSymbol}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-3">MNT Collateral Required</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={collateralRequired}
                            readOnly
                            placeholder={basketPrice === 0 || mntPrice === 0 ? "Loading prices..." : "0"}
                            className="w-full bg-base-300/50 border border-white/10 rounded-lg px-4 py-4 text-white text-xl cursor-not-allowed"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 font-medium">
                            MNT
                          </span>
                        </div>
                        <p className="text-xs text-white/50 mt-2">
                          At 500% collateral ratio (5x overcollateralized) | Your MNT Balance: {userMntBalance}
                        </p>
                      </div>

                      <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                        <p className="text-sm text-warning">
                          ⚠️ Collateral ratio must remain above 500% initially and above 150% to avoid liquidation
                        </p>
                      </div>

                      <button
                        onClick={handleMint}
                        disabled={isProcessing || !mintAmount || parseFloat(mintAmount) <= 0 || !selectedBasketId}
                        className="w-full btn btn-primary text-white py-4 text-lg rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? "Processing..." : `Mint ${basketSymbol} `}
                      </button>
                    </div>
                  )}

                  {/* Burn Tab */}
                  {activeTab === "burn" && (
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-3">
                          Amount of {basketSymbol} to Burn
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            value={burnAmount}
                            onChange={e => setBurnAmount(e.target.value)}
                            placeholder="0.00"
                            step="0.01"
                            disabled={isProcessing}
                            className="w-full bg-base-300 border border-white/20 rounded-lg px-4 py-4 text-white text-xl focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 font-medium">
                            {basketSymbol}
                          </span>
                        </div>
                        <p className="text-xs text-white/50 mt-2">
                          Current Debt: {formatTokenAmount(debt)} {basketSymbol}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-3">MNT to Release</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={calculateRedemption(burnAmount)}
                            readOnly
                            className="w-full bg-base-300/50 border border-white/10 rounded-lg px-4 py-4 text-white text-xl cursor-not-allowed"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 font-medium">
                            MNT
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={handleBurn}
                        disabled={isProcessing || !burnAmount || parseFloat(burnAmount) <= 0 || !selectedBasketId}
                        className="w-full btn btn-primary text-white py-4 text-lg rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? "Processing..." : `Burn ${basketSymbol} `}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Vault Summary Sidebar */}
              <div className="lg:col-span-1">
                <div className="card-glass p-6 sticky top-24">
                  <h3 className="text-2xl font-bold mb-6">My Vault</h3>

                  <div className="space-y-6">
                    <div>
                      <p className="text-sm text-white/50 mb-2">Total Collateral</p>
                      <p className="text-3xl font-bold">
                        {formatTokenAmount(collateral)} <span className="text-lg text-white/50">MNT</span>
                      </p>
                      <p className="text-xs text-white/40">≈ ${formatTokenAmount(collateral * mntPrice, 2, 6)} USD</p>
                    </div>

                    <div>
                      <p className="text-sm text-white/50 mb-2">Minted {basketSymbol}</p>
                      <p className="text-3xl font-bold">
                        {formatTokenAmount(debt)} <span className="text-lg text-white/50">{basketSymbol}</span>
                      </p>
                      <p className="text-xs text-white/40">≈ ${formatTokenAmount(debt * basketPrice, 2, 6)} USD</p>
                    </div>

                    <div className="pt-4 border-t border-white/10">
                      <div className="flex justify-between items-center mb-3">
                        <p className="text-sm text-white/50">Current C-Ratio</p>
                        <p
                          className={`text-2xl font-bold ${collateralRatio === Infinity
                            ? "text-white"
                            : collateralRatio >= 500
                              ? "text-success"
                              : collateralRatio >= 150
                                ? "text-warning"
                                : "text-error"
                            }`}
                        >
                          {collateralRatio === Infinity ? "∞" : `${collateralRatio.toFixed(2)}%`}
                        </p>
                      </div>

                      {/* Progress Bar */}
                      {hasPosition && collateralRatio !== Infinity && (
                        <>
                          <div className="relative h-3 bg-base-300 rounded-full overflow-hidden">
                            <div className="absolute inset-0 flex">
                              <div className="w-[60%] bg-gradient-to-r from-success to-success"></div>
                              <div className="w-[25%] bg-gradient-to-r from-warning to-warning"></div>
                              <div className="w-[15%] bg-gradient-to-r from-error to-error"></div>
                            </div>
                            {collateralRatio < 1000 && (
                              <div
                                className="absolute top-0 left-0 h-full bg-white rounded-full"
                                style={{ width: "2px", left: `${Math.min(collateralRatio / 10, 100)}% ` }}
                              ></div>
                            )}
                          </div>

                          <div className="flex justify-between mt-2 text-xs text-white/50">
                            <span>150%</span>
                            <span className="text-error">Liquidation</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Liquidation Status */}
                    <div
                      className={`${isLiquidatable ? "bg-error/10 border-error/30" : "bg-success/10 border-success/30"
                        } border rounded - lg p - 4`}
                    >
                      <p className={`text - sm font - medium ${isLiquidatable ? "text-error" : "text-success"} `}>
                        {isLiquidatable
                          ? "⚠️ Position Liquidatable"
                          : hasPosition
                            ? "✓ Position Safe"
                            : "No Active Position"}
                      </p>
                    </div>

                    {/* MNT Balance */}
                    <div className="pt-4 border-t border-white/10">
                      <p className="text-sm text-white/50 mb-2">Wallet Balance</p>
                      <p className="text-xl font-bold">
                        {userMntBalance} <span className="text-sm text-white/50">MNT</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MintBurn;
