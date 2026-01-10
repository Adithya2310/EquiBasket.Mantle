// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BasketRegistry.sol";

/**
 * @title BasketOracle
 * @notice Oracle for computing basket prices from individual asset prices
 * @dev This is the CORE INNOVATION of EquiBaskets.
 *      Unlike single-asset oracles that just return a price, this oracle
 *      COMPUTES FINANCIAL MEANING by:
 *      1. Reading basket composition from BasketRegistry
 *      2. Fetching price for each underlying asset
 *      3. Computing weighted average basket price
 * 
 *      For the hackathon, asset prices are hardcoded on-chain in USD format.
 *      This module is intentionally designed to be replaced later with a
 *      real oracle integration (e.g., Pyth, Chainlink).
 * 
 *      All prices are stored and returned in 1e18 format.
 *      For example, $100 = 100 * 1e18 = 100000000000000000000
 * 
 *      The MNT/USD price is also stored here for collateral valuation.
 */
contract BasketOracle is Ownable {
    // ============================================================
    // ========================== STATE ===========================
    // ============================================================
    
    /// @notice Reference to the BasketRegistry for reading composition
    BasketRegistry public immutable basketRegistry;
    
    /// @notice Mapping from asset identifier to USD price (1e18 format)
    mapping(string => uint256) public assetPrices;
    
    /// @notice List of all registered asset identifiers
    string[] public registeredAssets;
    
    /// @notice Mapping to check if an asset is registered
    mapping(string => bool) public isAssetRegistered;
    
    /// @notice MNT/USD price in 1e18 format
    /// @dev Used for calculating collateral value in the vault
    uint256 public mntUsdPrice;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    /// @notice Emitted when an asset price is updated
    event AssetPriceUpdated(string indexed assetId, uint256 oldPrice, uint256 newPrice);
    
    /// @notice Emitted when MNT/USD price is updated
    event MntPriceUpdated(uint256 oldPrice, uint256 newPrice);
    
    /// @notice Emitted when a new asset is registered
    event AssetRegistered(string assetId, uint256 initialPrice);
    
    // ============================================================
    // ========================= ERRORS ===========================
    // ============================================================
    
    /// @notice Thrown when basket doesn't exist
    error BasketDoesNotExist();
    
    /// @notice Thrown when asset price is not available
    error AssetPriceNotAvailable(string assetId);
    
    /// @notice Thrown when MNT price is not set
    error MntPriceNotSet();
    
    /// @notice Thrown when price is zero
    error ZeroPrice();
    
    /// @notice Thrown when asset is already registered
    error AssetAlreadyRegistered(string assetId);

    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    /**
     * @notice Initialize the BasketOracle with a registry reference
     * @param _basketRegistry Address of the BasketRegistry contract
     */
    constructor(address _basketRegistry) Ownable(msg.sender) {
        basketRegistry = BasketRegistry(_basketRegistry);
        
        // Initialize with default prices for common assets (in 1e18 format)
        // These represent example assets that might be in baskets
        _registerAssetWithPrice("AAPL", 175 * 1e18);    // Apple Inc. at $175
        _registerAssetWithPrice("NVDA", 490 * 1e18);    // NVIDIA at $490
        _registerAssetWithPrice("GOLD", 2050 * 1e18);   // Gold per oz at $2050
        _registerAssetWithPrice("SILVER", 24 * 1e18);   // Silver per oz at $24
        _registerAssetWithPrice("HITACHI", 92 * 1e18);  // Hitachi at $92
        _registerAssetWithPrice("MSFT", 380 * 1e18);    // Microsoft at $380
        _registerAssetWithPrice("GOOGL", 140 * 1e18);   // Alphabet at $140
        _registerAssetWithPrice("AMZN", 155 * 1e18);    // Amazon at $155
        _registerAssetWithPrice("TSLA", 250 * 1e18);    // Tesla at $250
        _registerAssetWithPrice("BTC", 42000 * 1e18);   // Bitcoin at $42000
        
        // Initialize MNT price (example: $0.50)
        mntUsdPrice = 5 * 1e17; // 0.5 * 1e18
    }

    // ============================================================
    // ================== INTERNAL FUNCTIONS ======================
    // ============================================================
    
    /**
     * @notice Internal function to register an asset with initial price
     * @param assetId Asset identifier
     * @param price Initial price in 1e18 format
     */
    function _registerAssetWithPrice(string memory assetId, uint256 price) internal {
        assetPrices[assetId] = price;
        registeredAssets.push(assetId);
        isAssetRegistered[assetId] = true;
    }

    // ============================================================
    // =================== ADMIN FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Register a new asset with initial price
     * @param assetId Asset identifier (e.g., "AAPL", "GOLD")
     * @param price Initial price in 1e18 format
     */
    function registerAsset(string calldata assetId, uint256 price) external onlyOwner {
        if (isAssetRegistered[assetId]) revert AssetAlreadyRegistered(assetId);
        if (price == 0) revert ZeroPrice();
        
        _registerAssetWithPrice(assetId, price);
        
        emit AssetRegistered(assetId, price);
    }
    
    /**
     * @notice Update the price of an asset
     * @param assetId Asset identifier
     * @param newPrice New price in 1e18 format
     */
    function setAssetPrice(string calldata assetId, uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroPrice();
        
        uint256 oldPrice = assetPrices[assetId];
        assetPrices[assetId] = newPrice;
        
        // Auto-register if not already registered
        if (!isAssetRegistered[assetId]) {
            registeredAssets.push(assetId);
            isAssetRegistered[assetId] = true;
            emit AssetRegistered(assetId, newPrice);
        }
        
        emit AssetPriceUpdated(assetId, oldPrice, newPrice);
    }
    
    /**
     * @notice Update MNT/USD price
     * @param newPrice New MNT/USD price in 1e18 format
     */
    function setMntPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroPrice();
        
        uint256 oldPrice = mntUsdPrice;
        mntUsdPrice = newPrice;
        
        emit MntPriceUpdated(oldPrice, newPrice);
    }
    
    /**
     * @notice Batch update multiple asset prices
     * @param assetIds Array of asset identifiers
     * @param prices Array of new prices in 1e18 format
     */
    function batchSetAssetPrices(
        string[] calldata assetIds,
        uint256[] calldata prices
    ) external onlyOwner {
        require(assetIds.length == prices.length, "Array length mismatch");
        
        for (uint256 i = 0; i < assetIds.length; i++) {
            if (prices[i] == 0) revert ZeroPrice();
            
            uint256 oldPrice = assetPrices[assetIds[i]];
            assetPrices[assetIds[i]] = prices[i];
            
            if (!isAssetRegistered[assetIds[i]]) {
                registeredAssets.push(assetIds[i]);
                isAssetRegistered[assetIds[i]] = true;
                emit AssetRegistered(assetIds[i], prices[i]);
            }
            
            emit AssetPriceUpdated(assetIds[i], oldPrice, prices[i]);
        }
    }

    // ============================================================
    // ================= CORE PRICING FUNCTIONS ===================
    // ============================================================
    
    /**
     * @notice Get the weighted price of a basket
     * @dev This is the CORE function of EquiBaskets oracle.
     *      It computes the basket price by:
     *      1. Reading composition from BasketRegistry
     *      2. Fetching price for each asset
     *      3. Computing weighted average: sum(price[i] * weight[i]) / 10000
     * @param basketId The basket ID to get price for
     * @return price Basket price in 1e18 USD format
     */
    function getBasketPrice(uint256 basketId) external view returns (uint256 price) {
        // Verify basket exists
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        
        // Get basket composition
        (string[] memory assets, uint256[] memory weights) = basketRegistry.getBasketComposition(basketId);
        
        // Calculate weighted price
        // Sum of (asset_price * weight) / 10000
        // Using 1e18 precision throughout
        uint256 weightedSum = 0;
        
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 assetPrice = assetPrices[assets[i]];
            if (assetPrice == 0) revert AssetPriceNotAvailable(assets[i]);
            
            // Accumulate weighted price
            // assetPrice is in 1e18, weight is in basis points (0-10000)
            weightedSum += assetPrice * weights[i];
        }
        
        // Divide by 10000 to get final price in 1e18 format
        price = weightedSum / 10000;
    }
    
    /**
     * @notice Get individual asset price
     * @param assetId Asset identifier
     * @return price Asset price in 1e18 USD format
     */
    function getAssetPrice(string calldata assetId) external view returns (uint256 price) {
        price = assetPrices[assetId];
        if (price == 0) revert AssetPriceNotAvailable(assetId);
    }
    
    /**
     * @notice Get MNT to USD value
     * @param mntAmount Amount of MNT tokens (in 1e18)
     * @return usdValue USD value in 1e18 format
     */
    function getMntValue(uint256 mntAmount) external view returns (uint256 usdValue) {
        if (mntUsdPrice == 0) revert MntPriceNotSet();
        // Both mntAmount and mntUsdPrice are in 1e18
        // Result needs to be in 1e18, so divide by 1e18
        usdValue = (mntAmount * mntUsdPrice) / 1e18;
    }
    
    /**
     * @notice Get the MNT amount equivalent to a USD value
     * @param usdValue USD value in 1e18 format
     * @return mntAmount MNT amount in 1e18 format
     */
    function getMntFromUsdValue(uint256 usdValue) external view returns (uint256 mntAmount) {
        if (mntUsdPrice == 0) revert MntPriceNotSet();
        // Inverse of getMntValue
        mntAmount = (usdValue * 1e18) / mntUsdPrice;
    }

    // ============================================================
    // ==================== VIEW FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Get all registered asset identifiers
     * @return Array of asset identifier strings
     */
    function getAllRegisteredAssets() external view returns (string[] memory) {
        return registeredAssets;
    }
    
    /**
     * @notice Get the number of registered assets
     * @return Count of registered assets
     */
    function getRegisteredAssetCount() external view returns (uint256) {
        return registeredAssets.length;
    }
    
    /**
     * @notice Check if a basket has all required asset prices
     * @param basketId The basket ID to check
     * @return valid True if all asset prices are available
     * @return missingAsset The first missing asset (if any)
     */
    function validateBasketPrices(uint256 basketId) external view returns (
        bool valid,
        string memory missingAsset
    ) {
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        
        (string[] memory assets, ) = basketRegistry.getBasketComposition(basketId);
        
        for (uint256 i = 0; i < assets.length; i++) {
            if (assetPrices[assets[i]] == 0) {
                return (false, assets[i]);
            }
        }
        
        return (true, "");
    }
}
