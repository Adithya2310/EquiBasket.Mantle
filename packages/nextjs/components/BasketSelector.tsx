"use client";

import React, { useEffect, useState } from "react";
import { ChevronDownIcon, CubeIcon } from "@heroicons/react/24/outline";
import { useBasketContext, useFormattedBasketData } from "~~/contexts/BasketContext";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

/**
 * BasketSelector Component
 *
 * Dropdown component for selecting baskets across the app.
 * As per UI Migration document: "Basket selector everywhere"
 */

interface BasketOption {
  id: bigint;
  name: string;
  symbol: string;
}

export const BasketSelector: React.FC = () => {
  const { selectedBasketId, setSelectedBasketId, basketCount } = useBasketContext();
  const { basketName, basketSymbol, basketPrice } = useFormattedBasketData();
  const [isOpen, setIsOpen] = useState(false);
  const [basketOptions, setBasketOptions] = useState<BasketOption[]>([]);

  // Fetch basket options based on count
  // Note: In production, use multicall or indexer. For hackathon, we'll fetch sequentially.
  useEffect(() => {
    const fetchBaskets = async () => {
      if (!basketCount || basketCount === 0n) {
        setBasketOptions([]);
        return;
      }

      const options: BasketOption[] = [];
      // For hackathon demo, we'll show sample baskets
      for (let i = 1n; i <= basketCount; i++) {
        options.push({
          id: i,
          name: `Basket ${i}`,
          symbol: `eBASKET${i}`,
        });
      }
      setBasketOptions(options);
    };

    fetchBaskets();
  }, [basketCount]);

  // Read selected basket name for display
  const { data: selectedBasketInfo } = useScaffoldReadContract({
    contractName: "BasketRegistry",
    functionName: "getBasket",
    args: [selectedBasketId ?? 0n],
  });

  const displayName = selectedBasketInfo ? selectedBasketInfo[4] : basketName;
  const displaySymbol = selectedBasketInfo ? selectedBasketInfo[5] : basketSymbol;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 bg-base-300/80 hover:bg-base-300 border border-white/10 rounded-xl px-4 py-3 transition-all duration-200 min-w-[200px]"
      >
        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <CubeIcon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-white truncate">{displayName}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">{displaySymbol}</span>
            {basketPrice > 0 && <span className="text-xs text-primary font-medium">${basketPrice.toFixed(2)}</span>}
          </div>
        </div>
        <ChevronDownIcon className={`w-5 h-5 text-white/50 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-base-200 border border-white/10 rounded-xl shadow-xl overflow-hidden">
            {basketOptions.length === 0 ? (
              <div className="p-4 text-center text-white/50 text-sm">No baskets available</div>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {basketOptions.map(basket => (
                  <BasketOptionItem
                    key={basket.id.toString()}
                    basketId={basket.id}
                    isSelected={selectedBasketId === basket.id}
                    onSelect={() => {
                      setSelectedBasketId(basket.id);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// Individual basket option with live data
const BasketOptionItem: React.FC<{
  basketId: bigint;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ basketId, isSelected, onSelect }) => {
  const { data: basketData } = useScaffoldReadContract({
    contractName: "BasketRegistry",
    functionName: "getBasket",
    args: [basketId],
  });

  const { data: price } = useScaffoldReadContract({
    contractName: "BasketOracle",
    functionName: "getBasketPrice",
    args: [basketId],
  });

  if (!basketData) {
    return (
      <div className="p-3 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-24"></div>
      </div>
    );
  }

  const [, , , active, name, symbol] = basketData;
  const formattedPrice = price ? Number(price) / 1e18 : 0;

  return (
    <button
      onClick={onSelect}
      disabled={!active}
      className={`w-full flex items-center gap-3 p-3 transition-colors ${
        isSelected ? "bg-primary/20 border-l-2 border-primary" : "hover:bg-white/5"
      } ${!active ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <CubeIcon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-sm font-medium text-white">{name}</p>
        <p className="text-xs text-white/50">{symbol}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-primary">${formattedPrice.toFixed(2)}</p>
        {!active && <p className="text-xs text-error">Inactive</p>}
      </div>
    </button>
  );
};

export default BasketSelector;
