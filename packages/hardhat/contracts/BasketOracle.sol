// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

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
 *      Asset prices are pulled from Pyth price feeds (configured per asset).
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
    
    /// @notice Mapping from asset identifier to Pyth price feed id
    mapping(string => bytes32) public assetPriceFeedIds;
    
    /// @notice List of all registered asset identifiers
    string[] public registeredAssets;
    
    /// @notice Mapping to check if an asset is registered
    mapping(string => bool) public isAssetRegistered;
    
    /// @notice MNT/USD price in 1e18 format
    /// @dev Used for calculating collateral value in the vault
    uint256 public mntUsdPrice;

    IPyth public pyth;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    /// @notice Emitted when an asset price feed is updated
    event AssetPriceFeedUpdated(string indexed assetId, bytes32 oldPriceFeedId, bytes32 newPriceFeedId);
    
    /// @notice Emitted when MNT/USD price is updated
    event MntPriceUpdated(uint256 oldPrice, uint256 newPrice);
    
    /// @notice Emitted when a new asset is registered
    event AssetRegistered(string assetId, bytes32 priceFeedId);
    
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

    /// @notice Thrown when a price feed id is missing or invalid
    error InvalidPriceFeedId(string assetId);

    /// @notice Thrown when insufficient fee is provided to update Pyth price feeds
    error InsufficientUpdateFee(uint256 requiredFee, uint256 providedFee);

    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    /**
     * @notice Initialize the BasketOracle with a registry reference
     * @param _basketRegistry Address of the BasketRegistry contract
     */
    constructor(address _basketRegistry) Ownable(msg.sender) {
        basketRegistry = BasketRegistry(_basketRegistry);
        
        // Initialize with Pyth price feed ids for supported assets
        _registerAssetWithPriceFeed("AAPL", 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688);
        _registerAssetWithPriceFeed("NVDA", 0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593);
        // _registerAssetWithPriceFeed("GOLD", 0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2);
        // _registerAssetWithPriceFeed("SILVER", 0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e);
        _registerAssetWithPriceFeed("GOLD", 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43);
        _registerAssetWithPriceFeed("SILVER", 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43);
        _registerAssetWithPriceFeed("HITACHI", 0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1);
        _registerAssetWithPriceFeed("MSFT", 0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1);
        _registerAssetWithPriceFeed("GOOGL", 0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6);
        _registerAssetWithPriceFeed("AMZN", 0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a);
        _registerAssetWithPriceFeed("TSLA", 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1);
        _registerAssetWithPriceFeed("BTC", 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43);
        
        // Initialize MNT price (example: $0.50)
        mntUsdPrice = 5 * 1e17; // 0.5 * 1e18

        pyth = IPyth(0x98046Bd286715D3B0BC227Dd7a956b83D8978603);
    }

    // ============================================================
    // ================== INTERNAL FUNCTIONS ======================
    // ============================================================
    
    /**
     * @notice Internal function to register an asset with its price feed
     * @param assetId Asset identifier
     * @param priceFeedId Pyth price feed identifier
     */
    function _registerAssetWithPriceFeed(string memory assetId, bytes32 priceFeedId) internal {
        assetPriceFeedIds[assetId] = priceFeedId;
        registeredAssets.push(assetId);
        isAssetRegistered[assetId] = true;
    }

    // ============================================================
    // =================== ADMIN FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Register a new asset with its price feed
     * @param assetId Asset identifier (e.g., "AAPL", "GOLD")
     * @param priceFeedId Pyth price feed identifier
     */
    function registerAsset(string calldata assetId, bytes32 priceFeedId) external onlyOwner {
        if (isAssetRegistered[assetId]) revert AssetAlreadyRegistered(assetId);
        if (priceFeedId == bytes32(0)) revert InvalidPriceFeedId(assetId);
        
        _registerAssetWithPriceFeed(assetId, priceFeedId);
        
        emit AssetRegistered(assetId, priceFeedId);
    }
    
    /**
    /**
     * @notice Update the price feed of an asset
     * @param assetId Asset identifier
     * @param priceFeedId New Pyth price feed identifier
     */
    function setAssetPriceFeed(string calldata assetId, bytes32 priceFeedId) external onlyOwner {
        if (priceFeedId == bytes32(0)) revert InvalidPriceFeedId(assetId);
        
        bytes32 oldPriceFeedId = assetPriceFeedIds[assetId];
        assetPriceFeedIds[assetId] = priceFeedId;
        
        // Auto-register if not already registered
        if (!isAssetRegistered[assetId]) {
            registeredAssets.push(assetId);
            isAssetRegistered[assetId] = true;
            emit AssetRegistered(assetId, priceFeedId);
        }
        
        emit AssetPriceFeedUpdated(assetId, oldPriceFeedId, priceFeedId);
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
     * @notice Batch update multiple asset price feeds
     * @param assetIds Array of asset identifiers
     * @param priceFeedIds Array of Pyth price feed identifiers
     */
    function batchSetAssetPriceFeeds(
        string[] calldata assetIds,
        bytes32[] calldata priceFeedIds
    ) external onlyOwner {
        require(assetIds.length == priceFeedIds.length, "Array length mismatch");
        
        for (uint256 i = 0; i < assetIds.length; i++) {
            if (priceFeedIds[i] == bytes32(0)) revert InvalidPriceFeedId(assetIds[i]);
            
            bytes32 oldPriceFeedId = assetPriceFeedIds[assetIds[i]];
            assetPriceFeedIds[assetIds[i]] = priceFeedIds[i];
            
            if (!isAssetRegistered[assetIds[i]]) {
                registeredAssets.push(assetIds[i]);
                isAssetRegistered[assetIds[i]] = true;
                emit AssetRegistered(assetIds[i], priceFeedIds[i]);
            }
            
            emit AssetPriceFeedUpdated(assetIds[i], oldPriceFeedId, priceFeedIds[i]);
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
            uint256 assetPrice = _getAssetPrice(assets[i]);
            
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
        price = _getAssetPrice(assetId);
    }

    /**
     * @notice Debug helper to inspect raw Pyth data and scaled price
     * @param assetId Asset identifier
     * @return scaledPrice Price scaled to 1e18
     * @return rawPrice Raw Pyth price
     * @return expo Pyth exponent
     * @return conf Confidence interval
     * @return publishTime Oracle publish time
     */
    function getAssetPriceDebug(string calldata assetId) external view returns (
        uint256 scaledPrice,
        int64 rawPrice,
        int32 expo,
        uint64 conf,
        uint publishTime
    ) {
        bytes32 priceFeedId = assetPriceFeedIds[assetId];
        if (priceFeedId == bytes32(0)) revert AssetPriceNotAvailable(assetId);

        PythStructs.Price memory priceInfo = pyth.getPriceNoOlderThan(priceFeedId, 60);
        rawPrice = priceInfo.price;
        expo = priceInfo.expo;
        conf = priceInfo.conf;
        publishTime = priceInfo.publishTime;

        if (rawPrice <= 0) revert AssetPriceNotAvailable(assetId);

        int32 power = expo + 18;
        int256 scaled;
        if (power >= 0) {
            scaled = int256(rawPrice) * (int256(10) ** uint256(uint32(power)));
        } else {
            scaled = int256(rawPrice) / (int256(10) ** uint256(uint32(-power)));
        }

        if (scaled <= 0) revert AssetPriceNotAvailable(assetId);
        scaledPrice = uint256(scaled);
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

    /**
     * @notice Calculate the fee required to update Pyth price feeds for given updates
     * @param priceUpdate Pyth price update data blob(s) fetched off-chain
     */
    function getPythUpdateFee(bytes[] calldata priceUpdate) external view returns (uint256) {
        return pyth.getUpdateFee(priceUpdate);
    }

    /**
     * @notice Push fresh Pyth price updates on-chain so subsequent reads succeed
     * @dev Callers must provide at least the required fee; any excess is refunded.
     * @param priceUpdate Encoded price update payload(s) from Pyth Hermes
     * @return feePaid The fee forwarded to Pyth
     */
    function updatePriceFeeds(bytes[] calldata priceUpdate) external payable returns (uint256 feePaid) {
        feePaid = pyth.getUpdateFee(priceUpdate);
        if (msg.value < feePaid) revert InsufficientUpdateFee(feePaid, msg.value);

        pyth.updatePriceFeeds{value: feePaid}(priceUpdate);

        if (msg.value > feePaid) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - feePaid}("");
            require(ok, "Refund failed");
        }
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
            if (assetPriceFeedIds[assets[i]] == bytes32(0)) {
                return (false, assets[i]);
            }
        }
        
        return (true, "");
    }

    // ============================================================
    // ================== INTERNAL VIEW HELPERS ===================
    // ============================================================

    /**
     * @notice Resolve a Pyth price feed into a 1e18 scaled USD price
     * @param assetId Asset identifier
     * @return price Price scaled to 1e18
     */
    function _getAssetPrice(string memory assetId) internal view returns (uint256 price) {
        bytes32 priceFeedId = assetPriceFeedIds[assetId];
        if (priceFeedId == bytes32(0)) revert AssetPriceNotAvailable(assetId);

        PythStructs.Price memory priceInfo = pyth.getPriceNoOlderThan(priceFeedId, 60);

        int256 rawPrice = int256(priceInfo.price);
        int32 expo = priceInfo.expo; // price = rawPrice * 10^expo

        if (rawPrice <= 0) revert AssetPriceNotAvailable(assetId);

        int32 power = expo + 18;
        int256 scaled;
        if (power >= 0) {
            scaled = rawPrice * (int256(10) ** uint256(uint32(power)));
        } else {
            scaled = rawPrice / (int256(10) ** uint256(uint32(-power)));
        }

        if (scaled <= 0) revert AssetPriceNotAvailable(assetId);
        price = uint256(scaled);
    }
}
