"use client";

import React, { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

/**
 * Basket Context - Global state management for EquiBaskets
 *
 * As per UI Migration document Section 1️⃣:
 * This context stores:
 * - basketId
 * - basketName
 * - basketComposition
 * - basketPrice
 * - userPosition (collateral, debt, CR)
 *
 * Shared across: Mint & Burn, Trade, Vault views
 */

// Types for basket data
export interface BasketComposition {
  assets: string[];
  weights: bigint[];
}

export interface Basket {
  id: bigint;
  creator: string;
  name: string;
  symbol: string;
  assets: string[];
  weights: bigint[];
  active: boolean;
}

export interface UserPosition {
  collateral: bigint;
  debt: bigint;
  collateralRatio: bigint;
  isLiquidatable: boolean;
}

export interface BasketContextType {
  // Selected basket
  selectedBasketId: bigint | null;
  setSelectedBasketId: (id: bigint | null) => void;

  // Basket data
  selectedBasket: Basket | null;
  basketPrice: bigint | null;
  mntPrice: bigint | null;

  // User position for selected basket
  userPosition: UserPosition | null;

  // All available baskets
  baskets: Basket[];
  basketCount: bigint;

  // Loading states
  isLoading: boolean;

  // Refresh functions
  refreshBaskets: () => void;
  refreshUserPosition: () => void;
  refreshPrices: () => void;
}

const BasketContext = createContext<BasketContextType | undefined>(undefined);

export const useBasketContext = () => {
  const context = useContext(BasketContext);
  if (!context) {
    throw new Error("useBasketContext must be used within a BasketProvider");
  }
  return context;
};

interface BasketProviderProps {
  children: ReactNode;
}

export const BasketProvider: React.FC<BasketProviderProps> = ({ children }) => {
  const { address: connectedAddress } = useAccount();

  // State - default to basket 1 which has registered token
  const [selectedBasketId, setSelectedBasketId] = useState<bigint | null>(1n);
  const [selectedBasket, setSelectedBasket] = useState<Basket | null>(null);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Read basket count from registry
  const { data: basketCount, refetch: refetchBasketCount } = useScaffoldReadContract({
    contractName: "BasketRegistry",
    functionName: "basketCount",
  });

  // Read basket price from oracle
  const { data: basketPrice, refetch: refetchBasketPrice } = useScaffoldReadContract({
    contractName: "BasketOracle",
    functionName: "getBasketPrice",
    args: [selectedBasketId ?? 0n],
  });

  // Read MNT price from oracle
  const { data: mntPrice, refetch: refetchMntPrice } = useScaffoldReadContract({
    contractName: "BasketOracle",
    functionName: "mntUsdPrice",
  });

  // Read user collateral for selected basket
  const { data: userCollateral, refetch: refetchCollateral } = useScaffoldReadContract({
    contractName: "BasketVault",
    functionName: "userCollateral",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000", selectedBasketId ?? 0n],
  });

  // Read user debt for selected basket
  const { data: userDebt, refetch: refetchDebt } = useScaffoldReadContract({
    contractName: "BasketVault",
    functionName: "userDebt",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000", selectedBasketId ?? 0n],
  });

  // Read collateral ratio
  const { data: collateralRatio, refetch: refetchCR } = useScaffoldReadContract({
    contractName: "BasketVault",
    functionName: "getCollateralRatio",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000", selectedBasketId ?? 0n],
  });

  // Read liquidation status
  const { data: isLiquidatable, refetch: refetchLiquidatable } = useScaffoldReadContract({
    contractName: "BasketVault",
    functionName: "isLiquidatable",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000", selectedBasketId ?? 0n],
  });

  // Read selected basket data
  const { data: selectedBasketData } = useScaffoldReadContract({
    contractName: "BasketRegistry",
    functionName: "getBasket",
    args: [selectedBasketId ?? 0n],
  });

  // Construct user position object
  const userPosition: UserPosition | null =
    userCollateral !== undefined &&
    userDebt !== undefined &&
    collateralRatio !== undefined &&
    isLiquidatable !== undefined
      ? {
          collateral: userCollateral,
          debt: userDebt,
          collateralRatio: collateralRatio,
          isLiquidatable: isLiquidatable,
        }
      : null;

  // Update selected basket when data changes
  useEffect(() => {
    if (selectedBasketData && selectedBasketId) {
      const [creator, assets, weights, active, name, symbol] = selectedBasketData;
      setSelectedBasket({
        id: selectedBasketId,
        creator,
        name,
        symbol,
        assets: assets as string[],
        weights: weights as bigint[],
        active,
      });
    } else {
      setSelectedBasket(null);
    }
  }, [selectedBasketData, selectedBasketId]);

  // Fetch all baskets when count changes
  const fetchAllBaskets = useCallback(async () => {
    if (!basketCount || basketCount === 0n) {
      setBaskets([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    // Note: In a production app, you'd batch these calls
    // For hackathon, we'll iterate through baskets
    // This would typically be done via multicall or an indexer
    setIsLoading(false);
  }, [basketCount]);

  useEffect(() => {
    fetchAllBaskets();
  }, [fetchAllBaskets]);

  // Auto-select first basket if none selected
  useEffect(() => {
    if (basketCount && basketCount > 0n && !selectedBasketId) {
      setSelectedBasketId(1n);
    }
  }, [basketCount, selectedBasketId]);

  // Refresh functions
  const refreshBaskets = useCallback(() => {
    refetchBasketCount();
    fetchAllBaskets();
  }, [refetchBasketCount, fetchAllBaskets]);

  const refreshUserPosition = useCallback(() => {
    refetchCollateral();
    refetchDebt();
    refetchCR();
    refetchLiquidatable();
  }, [refetchCollateral, refetchDebt, refetchCR, refetchLiquidatable]);

  const refreshPrices = useCallback(() => {
    refetchBasketPrice();
    refetchMntPrice();
  }, [refetchBasketPrice, refetchMntPrice]);

  const value: BasketContextType = {
    selectedBasketId,
    setSelectedBasketId,
    selectedBasket,
    basketPrice: basketPrice ?? null,
    mntPrice: mntPrice ?? null,
    userPosition,
    baskets,
    basketCount: basketCount ?? 0n,
    isLoading,
    refreshBaskets,
    refreshUserPosition,
    refreshPrices,
  };

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
};

// Hook for formatted basket data
export const useFormattedBasketData = () => {
  const { selectedBasket, basketPrice, mntPrice, userPosition } = useBasketContext();

  const formattedBasketPrice = basketPrice ? Number(formatEther(basketPrice)) : 0;
  const formattedMntPrice = mntPrice ? Number(formatEther(mntPrice)) : 0;

  const formattedCollateral = userPosition ? Number(formatEther(userPosition.collateral)) : 0;
  const formattedDebt = userPosition ? Number(formatEther(userPosition.debt)) : 0;

  // CR is returned as 1e18 scaled (e.g., 5e18 = 500%)
  // When debt is 0, contract returns type(uint256).max = 2^256-1
  // Use BigInt literal to avoid precision loss
  const MAX_UINT256 = 2n ** 256n - 1n;
  const isMaxRatio = userPosition?.collateralRatio === MAX_UINT256;

  const formattedCR = !userPosition || isMaxRatio ? Infinity : Number(userPosition.collateralRatio) / 1e16; // Convert to percentage

  return {
    basketName: selectedBasket?.name ?? "Select a Basket",
    basketSymbol: selectedBasket?.symbol ?? "---",
    basketPrice: formattedBasketPrice,
    mntPrice: formattedMntPrice,
    collateral: formattedCollateral,
    debt: formattedDebt,
    collateralRatio: formattedCR,
    isLiquidatable: userPosition?.isLiquidatable ?? false,
    hasPosition: (userPosition?.collateral ?? 0n) > 0n || (userPosition?.debt ?? 0n) > 0n,
  };
};
