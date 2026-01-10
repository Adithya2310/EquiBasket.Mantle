"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { CheckCircleIcon, CubeIcon, ExclamationTriangleIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

/**
 * Create Basket Page - Fund Creator Integration
 *
 * As per UI Migration document Section 2️⃣:
 * - Basket Name: Metadata stored on-chain
 * - Asset Selection: BasketFactory.createBasketWithToken()
 * - Weight Assignment: Stored on-chain (basis points)
 * - Create Basket Button: Creates basket + deploys token + registers automatically!
 *
 * Using BasketFactory ensures the token is created and registered in a single transaction.
 */

// Available assets that can be added to baskets
const AVAILABLE_ASSETS = [
  { symbol: "AAPL", name: "Apple Inc.", category: "Tech" },
  { symbol: "NVDA", name: "NVIDIA Corporation", category: "Tech" },
  { symbol: "MSFT", name: "Microsoft Corporation", category: "Tech" },
  { symbol: "GOOGL", name: "Alphabet Inc.", category: "Tech" },
  { symbol: "AMZN", name: "Amazon.com Inc.", category: "Tech" },
  { symbol: "TSLA", name: "Tesla Inc.", category: "Tech" },
  { symbol: "META", name: "Meta Platforms", category: "Tech" },
  { symbol: "GOLD", name: "Gold", category: "Commodity" },
  { symbol: "SILVER", name: "Silver", category: "Commodity" },
  { symbol: "OIL", name: "Crude Oil", category: "Commodity" },
];

interface BasketAsset {
  symbol: string;
  name: string;
  weight: number; // Percentage (0-100)
}

const CreateBasket: NextPage = () => {
  const { address: connectedAddress } = useAccount();

  // Form state
  const [basketName, setBasketName] = useState("");
  const [basketSymbol, setBasketSymbol] = useState("");
  const [selectedAssets, setSelectedAssets] = useState<BasketAsset[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // Write contract - Use BasketFactory for auto token creation
  const { writeContractAsync: writeFactoryAsync } = useScaffoldWriteContract({
    contractName: "BasketFactory",
  });

  // Calculate total weight
  const totalWeight = selectedAssets.reduce((sum, asset) => sum + asset.weight, 0);
  const isValidWeights = totalWeight === 100;

  // Add asset to basket
  const handleAddAsset = (asset: (typeof AVAILABLE_ASSETS)[0]) => {
    if (selectedAssets.find(a => a.symbol === asset.symbol)) {
      notification.error("Asset already added");
      return;
    }

    setSelectedAssets([...selectedAssets, { symbol: asset.symbol, name: asset.name, weight: 0 }]);
  };

  // Remove asset from basket
  const handleRemoveAsset = (symbol: string) => {
    setSelectedAssets(selectedAssets.filter(a => a.symbol !== symbol));
  };

  // Update asset weight
  const handleUpdateWeight = (symbol: string, weight: number) => {
    setSelectedAssets(
      selectedAssets.map(a => (a.symbol === symbol ? { ...a, weight: Math.min(100, Math.max(0, weight)) } : a)),
    );
  };

  // Distribute weights equally
  const handleDistributeEqually = () => {
    if (selectedAssets.length === 0) return;
    const equalWeight = Math.floor(100 / selectedAssets.length);
    const remainder = 100 - equalWeight * selectedAssets.length;

    setSelectedAssets(
      selectedAssets.map((a, i) => ({
        ...a,
        weight: equalWeight + (i === 0 ? remainder : 0),
      })),
    );
  };

  // Create basket with automatic token creation
  const handleCreateBasket = async () => {
    // Validation
    if (!connectedAddress) {
      notification.error("Please connect your wallet");
      return;
    }

    if (!basketName.trim()) {
      notification.error("Please enter a basket name");
      return;
    }

    if (!basketSymbol.trim()) {
      notification.error("Please enter a basket symbol");
      return;
    }

    if (selectedAssets.length === 0) {
      notification.error("Please add at least one asset");
      return;
    }

    if (!isValidWeights) {
      notification.error("Weights must sum to exactly 100%");
      return;
    }

    setIsCreating(true);

    try {
      // Convert weights from percentage to basis points (100% = 10000)
      const assets = selectedAssets.map(a => a.symbol);
      const weights = selectedAssets.map(a => BigInt(a.weight * 100)); // 1% = 100 basis points

      notification.info("Creating basket with token... (this deploys and registers automatically!)");

      // Use BasketFactory which creates basket + deploys token + registers in one transaction
      await writeFactoryAsync({
        functionName: "createBasketWithToken",
        args: [assets, weights, basketName.trim(), basketSymbol.trim().toUpperCase()],
      } as any);

      notification.success(`Basket "${basketName}" created with token deployed and registered!`);

      // Reset form
      setBasketName("");
      setBasketSymbol("");
      setSelectedAssets([]);
    } catch (error: any) {
      console.error("Error creating basket:", error);
      notification.error(error?.message || "Failed to create basket");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-base-200 to-black py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2 mb-6">
              <CubeIcon className="w-4 h-4 text-primary" />
              <span className="text-sm text-primary font-medium">Fund Creator</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold mb-4">
              Create Your <span className="gradient-text">Basket</span>
            </h1>
            <p className="text-xl text-white/70">
              Build a custom basket of synthetic assets with your own composition and weights.
            </p>
          </div>

          {!connectedAddress ? (
            <div className="card-glass p-8 text-center">
              <p className="text-xl text-white/70">Please connect your wallet to create a basket</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Panel - Basket Details */}
              <div className="space-y-6">
                <div className="card-glass p-6">
                  <h2 className="text-xl font-bold mb-6">Basket Details</h2>

                  {/* Basket Name */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">Basket Name</label>
                    <input
                      type="text"
                      value={basketName}
                      onChange={e => setBasketName(e.target.value)}
                      placeholder="e.g., Tech Giants Basket"
                      className="w-full bg-base-300 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>

                  {/* Basket Symbol */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-white/70 mb-2">Basket Symbol</label>
                    <input
                      type="text"
                      value={basketSymbol}
                      onChange={e => setBasketSymbol(e.target.value.toUpperCase().slice(0, 10))}
                      placeholder="e.g., eTECH"
                      className="w-full bg-base-300 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                    />
                    <p className="text-xs text-white/50 mt-1">
                      This will be the token symbol for your basket (e.g., eTECH, eCOMM)
                    </p>
                  </div>
                </div>

                {/* Available Assets */}
                <div className="card-glass p-6">
                  <h2 className="text-xl font-bold mb-4">Available Assets</h2>
                  <p className="text-sm text-white/50 mb-4">Click to add assets to your basket</p>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {AVAILABLE_ASSETS.map(asset => {
                      const isAdded = selectedAssets.find(a => a.symbol === asset.symbol);
                      return (
                        <button
                          key={asset.symbol}
                          onClick={() => handleAddAsset(asset)}
                          disabled={!!isAdded}
                          className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                            isAdded
                              ? "bg-primary/10 border border-primary/30 cursor-not-allowed"
                              : "bg-base-300/50 hover:bg-base-300 border border-transparent"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                              <span className="text-xs font-bold text-primary">{asset.symbol.slice(0, 2)}</span>
                            </div>
                            <div className="text-left">
                              <p className="font-medium text-white">{asset.symbol}</p>
                              <p className="text-xs text-white/50">{asset.name}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-white/40 px-2 py-1 bg-white/5 rounded">{asset.category}</span>
                            {isAdded ? (
                              <CheckCircleIcon className="w-5 h-5 text-primary" />
                            ) : (
                              <PlusIcon className="w-5 h-5 text-white/50" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Panel - Composition */}
              <div className="space-y-6">
                <div className="card-glass p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">Basket Composition</h2>
                    {selectedAssets.length > 0 && (
                      <button onClick={handleDistributeEqually} className="text-sm text-primary hover:underline">
                        Distribute Equally
                      </button>
                    )}
                  </div>

                  {selectedAssets.length === 0 ? (
                    <div className="text-center py-12 text-white/50">
                      <CubeIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No assets added yet</p>
                      <p className="text-sm">Click assets on the left to add them</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedAssets.map(asset => (
                        <div key={asset.symbol} className="flex items-center gap-4 bg-base-300/50 rounded-lg p-4">
                          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                            <span className="text-sm font-bold text-primary">{asset.symbol.slice(0, 2)}</span>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium">{asset.symbol}</p>
                            <p className="text-xs text-white/50">{asset.name}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={asset.weight}
                              onChange={e => handleUpdateWeight(asset.symbol, parseInt(e.target.value) || 0)}
                              min={0}
                              max={100}
                              className="w-20 bg-base-300 border border-white/20 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:border-primary"
                            />
                            <span className="text-white/50">%</span>
                          </div>
                          <button
                            onClick={() => handleRemoveAsset(asset.symbol)}
                            className="p-2 hover:bg-error/20 rounded-lg transition-colors"
                          >
                            <TrashIcon className="w-5 h-5 text-error" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Weight Summary */}
                  {selectedAssets.length > 0 && (
                    <div
                      className={`mt-6 p-4 rounded-lg ${
                        isValidWeights
                          ? "bg-success/10 border border-success/30"
                          : "bg-warning/10 border border-warning/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Total Weight</span>
                        <span className={`text-xl font-bold ${isValidWeights ? "text-success" : "text-warning"}`}>
                          {totalWeight}%
                        </span>
                      </div>
                      {!isValidWeights && (
                        <p className="text-sm text-warning mt-2 flex items-center gap-2">
                          <ExclamationTriangleIcon className="w-4 h-4" />
                          Weights must sum to exactly 100%
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Create Button */}
                <button
                  onClick={handleCreateBasket}
                  disabled={
                    isCreating ||
                    !basketName.trim() ||
                    !basketSymbol.trim() ||
                    selectedAssets.length === 0 ||
                    !isValidWeights
                  }
                  className="w-full btn btn-primary text-white py-4 text-lg rounded-lg disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/30"
                >
                  {isCreating ? (
                    <span className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating Basket...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <CubeIcon className="w-5 h-5" />
                      Create Basket
                    </span>
                  )}
                </button>

                {/* Info Note */}
                <div className="p-4 bg-success/10 border border-success/30 rounded-lg">
                  <p className="text-sm text-white/70">
                    <span className="font-medium text-success">✨ Auto Token:</span> When you create a basket, the
                    basket token is automatically deployed and registered. You can start minting immediately!
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateBasket;
