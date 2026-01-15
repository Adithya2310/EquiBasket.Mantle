"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import {
  ArrowsRightLeftIcon,
  BoltIcon,
  CheckCircleIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  FireIcon,
  PlusCircleIcon,
} from "@heroicons/react/24/outline";
import { useBasketContext, useFormattedBasketData } from "~~/contexts/BasketContext";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { formatTokenAmount } from "~~/utils/formatNumber";

/**
 * Dashboard Page - Multi-Basket Portfolio View
 *
 * Shows:
 * - All user positions across baskets
 * - Vault health per basket
 * - Recent activity
 * - Vincent Automation status (if enabled)
 */

const Dashboard: NextPage = () => {
  const { address } = useAccount();
  const [selectedTimeframe, setSelectedTimeframe] = useState("24h");

  const { basketCount } = useBasketContext();

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

  // Get native MNT balance using wagmi useBalance
  const { data: nativeBalance } = useBalance({
    address: address,
  });

  const userMnt = nativeBalance?.value ? Number(formatEther(nativeBalance.value)) : 0;

  // Calculate portfolio value
  const collateralValueUSD = collateral * mntPrice;
  const debtValueUSD = debt * basketPrice;
  const netValue = collateralValueUSD - debtValueUSD + userMnt * mntPrice;

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-base-200 to-black py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Profile Header */}
          <div className="card-glass p-6 mb-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                  <span className="text-2xl font-bold">{address ? address.slice(2, 4).toUpperCase() : "??"}</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold mb-1">
                    {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Connect Wallet"}
                  </h1>
                  <p className="text-white/50">EquiBaskets Portfolio</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Link href="/create" className="btn bg-base-300 hover:bg-base-200 text-white gap-2">
                  <PlusCircleIcon className="w-5 h-5" />
                  Create Basket
                </Link>
                <Link href="/mint" className="btn btn-primary text-white gap-2">
                  <CubeIcon className="w-5 h-5" />
                  Mint
                </Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Portfolio & Positions */}
            <div className="lg:col-span-2 space-y-8">
              {/* Portfolio Value Card */}
              <div className="card-glass p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <p className="text-white/50 mb-2">Total Portfolio Value</p>
                    <h2 className="text-5xl font-bold mb-2">
                      ${netValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </h2>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-white/50">
                        {userMnt.toFixed(2)} MNT @ ${mntPrice.toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {["24h", "7d", "30d"].map(tf => (
                      <button
                        key={tf}
                        onClick={() => setSelectedTimeframe(tf)}
                        className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                          selectedTimeframe === tf
                            ? "bg-primary text-white"
                            : "bg-base-300 text-white/50 hover:text-white/70"
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-base-300/50 rounded-lg p-4">
                    <p className="text-sm text-white/50 mb-1">Active Baskets</p>
                    <p className="text-2xl font-bold">{Number(basketCount)}</p>
                  </div>
                  <div className="bg-base-300/50 rounded-lg p-4">
                    <p className="text-sm text-white/50 mb-1">Total Collateral</p>
                    <p className="text-2xl font-bold">${collateralValueUSD.toFixed(2)}</p>
                  </div>
                  <div className="bg-base-300/50 rounded-lg p-4">
                    <p className="text-sm text-white/50 mb-1">Total Debt</p>
                    <p className="text-2xl font-bold">${debtValueUSD.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* Current Basket Position */}
              {hasPosition && (
                <div className="card-glass p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-2xl font-bold">Current Position: {basketName}</h3>
                    <Link href="/mint" className="text-primary hover:underline text-sm">
                      Manage →
                    </Link>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-base-300/50 rounded-lg p-4">
                      <p className="text-sm text-white/50 mb-1">Collateral</p>
                      <p className="text-xl font-bold">{formatTokenAmount(collateral)} MNT</p>
                      <p className="text-xs text-white/40">${formatTokenAmount(collateralValueUSD, 2, 6)}</p>
                    </div>
                    <div className="bg-base-300/50 rounded-lg p-4">
                      <p className="text-sm text-white/50 mb-1">Debt</p>
                      <p className="text-xl font-bold">
                        {formatTokenAmount(debt)} {basketSymbol}
                      </p>
                      <p className="text-xs text-white/40">${formatTokenAmount(debtValueUSD, 2, 6)}</p>
                    </div>
                    <div className="bg-base-300/50 rounded-lg p-4">
                      <p className="text-sm text-white/50 mb-1">C-Ratio</p>
                      <p
                        className={`text-xl font-bold ${
                          collateralRatio === Infinity
                            ? "text-white"
                            : collateralRatio >= 500
                              ? "text-success"
                              : collateralRatio >= 150
                                ? "text-warning"
                                : "text-error"
                        }`}
                      >
                        {collateralRatio === Infinity ? "∞" : `${collateralRatio.toFixed(0)}%`}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg p-4 ${
                        isLiquidatable ? "bg-error/20 border border-error/30" : "bg-success/20 border border-success/30"
                      }`}
                    >
                      <p className="text-sm text-white/50 mb-1">Status</p>
                      <p
                        className={`text-xl font-bold flex items-center gap-2 ${
                          isLiquidatable ? "text-error" : "text-success"
                        }`}
                      >
                        {isLiquidatable ? (
                          <>
                            <ExclamationTriangleIcon className="w-5 h-5" />
                            At Risk
                          </>
                        ) : (
                          <>
                            <CheckCircleIcon className="w-5 h-5" />
                            Safe
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* No Position State */}
              {!hasPosition && address && (
                <div className="card-glass p-8 text-center">
                  <CubeIcon className="w-16 h-16 mx-auto mb-4 text-white/30" />
                  <h3 className="text-2xl font-bold mb-2">No Active Position</h3>
                  <p className="text-white/50 mb-6">
                    Start by creating a basket or minting tokens from an existing basket.
                  </p>
                  <div className="flex justify-center gap-4">
                    <Link href="/create" className="btn bg-base-300 hover:bg-base-200 text-white">
                      Create Basket
                    </Link>
                    <Link href="/mint" className="btn btn-primary text-white">
                      Mint Tokens
                    </Link>
                  </div>
                </div>
              )}

              {/* Basket Info */}
              {basketCount > 0n && (
                <div className="card-glass p-6">
                  <h3 className="text-2xl font-bold mb-6">Available Baskets</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <BasketCard basketId={1n} />
                    {basketCount > 1n && <BasketCard basketId={2n} />}
                    {basketCount > 2n && <BasketCard basketId={3n} />}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Vault Health & Automation */}
            <div className="lg:col-span-1 space-y-8">
              {/* Vault Health Gauge */}
              <div className="card-glass p-6">
                <h3 className="text-2xl font-bold mb-6">Vault Health</h3>

                {/* Collateral Ratio Gauge */}
                <div className="flex flex-col items-center mb-6">
                  <div className="relative w-48 h-48">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                      <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="20" />
                      <circle
                        cx="100"
                        cy="100"
                        r="80"
                        fill="none"
                        stroke={
                          collateralRatio === Infinity
                            ? "#6B7280"
                            : collateralRatio >= 500
                              ? "#10B981"
                              : collateralRatio >= 150
                                ? "#F59E0B"
                                : "#EF4444"
                        }
                        strokeWidth="20"
                        strokeDasharray={`${Math.min((collateralRatio === Infinity ? 100 : collateralRatio) / 10, 100) * 5.02} 502`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <p className="text-4xl font-bold">
                        {collateralRatio === Infinity ? "∞" : `${collateralRatio.toFixed(0)}%`}
                      </p>
                      <p
                        className={`text-sm font-medium ${
                          collateralRatio === Infinity
                            ? "text-white/50"
                            : collateralRatio >= 500
                              ? "text-success"
                              : collateralRatio >= 150
                                ? "text-warning"
                                : "text-error"
                        }`}
                      >
                        {!hasPosition
                          ? "No Position"
                          : collateralRatio >= 500
                            ? "Healthy"
                            : collateralRatio >= 150
                              ? "Caution"
                              : "Critical"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Vault Stats */}
                <div className="space-y-4">
                  <div className="bg-base-300/50 rounded-lg p-4">
                    <p className="text-sm text-white/50 mb-1">MNT Collateral</p>
                    <p className="text-2xl font-bold">{formatTokenAmount(collateral)} MNT</p>
                  </div>
                  <div className="bg-base-300/50 rounded-lg p-4">
                    <p className="text-sm text-white/50 mb-1">Minted {basketSymbol}</p>
                    <p className="text-2xl font-bold">{formatTokenAmount(debt)}</p>
                  </div>
                  <div className="bg-base-300/50 rounded-lg p-4">
                    <p className="text-sm text-white/50 mb-1">Liquidation Threshold</p>
                    <p className="text-2xl font-bold text-error">150%</p>
                  </div>
                </div>
              </div>

              {/* Vincent Automation Status */}
              <div className="card-glass p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <BoltIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Vincent Keeper</h3>
                    <p className="text-sm text-white/50">Automated Liquidation Protection</p>
                  </div>
                </div>

                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/70">Status</span>
                    <span className="flex items-center gap-2 text-sm text-primary font-medium">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                      Monitoring
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/70">Last Check</span>
                    <span className="text-sm text-white/50">Just now</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">Eligible for Liquidation</span>
                    <span className={`text-sm font-medium ${isLiquidatable ? "text-error" : "text-success"}`}>
                      {isLiquidatable ? "Yes" : "No"}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-white/40">
                  Vincent keeper monitors all positions and executes liquidations when necessary to maintain protocol
                  health.
                </p>
              </div>

              {/* Quick Actions */}
              <div className="card-glass p-6">
                <h3 className="text-xl font-bold mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <Link
                    href="/mint"
                    className="flex items-center gap-3 p-3 bg-base-300/50 rounded-lg hover:bg-base-300 transition-colors"
                  >
                    <PlusCircleIcon className="w-5 h-5 text-success" />
                    <span>Add Collateral</span>
                  </Link>
                  <Link
                    href="/mint"
                    className="flex items-center gap-3 p-3 bg-base-300/50 rounded-lg hover:bg-base-300 transition-colors"
                  >
                    <FireIcon className="w-5 h-5 text-error" />
                    <span>Burn & Withdraw</span>
                  </Link>
                  <Link
                    href="/trade"
                    className="flex items-center gap-3 p-3 bg-base-300/50 rounded-lg hover:bg-base-300 transition-colors"
                  >
                    <ArrowsRightLeftIcon className="w-5 h-5 text-primary" />
                    <span>Trade Baskets</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Basket Card Component
const BasketCard: React.FC<{ basketId: bigint }> = ({ basketId }) => {
  const { data: basketData } = useScaffoldReadContract({
    contractName: "BasketRegistry",
    functionName: "getBasket",
    args: [basketId],
  });

  const { data: basketPrice } = useScaffoldReadContract({
    contractName: "BasketOracle",
    functionName: "getBasketPrice",
    args: [basketId],
  });

  if (!basketData) {
    return (
      <div className="bg-base-300/50 rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-24 mb-2"></div>
        <div className="h-6 bg-white/10 rounded w-16"></div>
      </div>
    );
  }

  const [, assets, , active, name, symbol] = basketData;
  const price = basketPrice ? Number(formatEther(basketPrice)) : 0;

  return (
    <Link
      href="/mint"
      className="bg-base-300/50 rounded-lg p-4 hover:bg-base-300/70 transition-colors cursor-pointer block"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
          <CubeIcon className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h4 className="font-bold">{name}</h4>
          <p className="text-sm text-white/50">{symbol}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-2xl font-bold">${price.toFixed(2)}</p>
        <span
          className={`px-2 py-1 rounded text-xs ${active ? "bg-success/20 text-success" : "bg-error/20 text-error"}`}
        >
          {active ? "Active" : "Inactive"}
        </span>
      </div>
      <p className="text-xs text-white/40 mt-2">
        {(assets as string[]).slice(0, 3).join(", ")}
        {(assets as string[]).length > 3 ? "..." : ""}
      </p>
    </Link>
  );
};

export default Dashboard;
