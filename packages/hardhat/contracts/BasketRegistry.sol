// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BasketRegistry
 * @notice Registry for basket-based synthetic assets
 * @dev This contract is the canonical on-chain source of truth for basket composition.
 *      It stores basket metadata including:
 *      - Asset composition (list of asset identifiers)
 *      - Weights (in basis points, must sum to 10000)
 *      - Creator address (fund creator role)
 *      - Activation state
 * 
 *      IMPORTANT: This contract is pure metadata storage.
 *      No pricing logic should exist here - that belongs in BasketOracle.
 * 
 *      The basketId is a unique identifier assigned sequentially to each basket.
 *      Asset identifiers are strings (e.g., "AAPL", "GOLD", "NVDA") that are used
 *      by the BasketOracle to look up prices.
 */
contract BasketRegistry is Ownable {
    // ============================================================
    // ====================== DATA STRUCTURES =====================
    // ============================================================
    
    /**
     * @notice Represents a basket of synthetic assets
     * @param creator Address of the fund creator who created this basket
     * @param assets List of asset identifiers (e.g., ["AAPL", "NVDA", "GOLD"])
     * @param weights Weight of each asset in basis points (must sum to 10000)
     * @param active Whether this basket is active for minting/trading
     * @param name Human-readable name for the basket
     * @param symbol Token symbol for the basket token
     */
    struct Basket {
        address creator;
        string[] assets;
        uint256[] weights;
        bool active;
        string name;
        string symbol;
    }

    // ============================================================
    // ========================== STATE ===========================
    // ============================================================
    
    /// @notice Counter for generating unique basket IDs
    uint256 public basketCount;
    
    /// @notice Mapping from basket ID to basket data
    mapping(uint256 => Basket) private baskets;
    
    /// @notice Mapping from basket creator to list of their basket IDs
    mapping(address => uint256[]) public creatorBaskets;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    /// @notice Emitted when a new basket is created
    /// @dev Full basket details can be queried via getBasket(basketId)
    event BasketCreated(
        uint256 indexed basketId,
        address indexed creator,
        uint256 assetCount
    );
    
    /// @notice Emitted when a basket's active state changes
    event BasketActiveStateChanged(uint256 indexed basketId, bool active);
    
    // ============================================================
    // ========================= ERRORS ===========================
    // ============================================================
    
    /// @notice Thrown when assets and weights arrays have different lengths
    error ArrayLengthMismatch();
    
    /// @notice Thrown when assets array is empty
    error EmptyAssetsArray();
    
    /// @notice Thrown when weights don't sum to 10000 basis points
    error InvalidWeightsSum();
    
    /// @notice Thrown when a weight is zero
    error ZeroWeight();
    
    /// @notice Thrown when basket doesn't exist
    error BasketDoesNotExist();
    
    /// @notice Thrown when caller is not the basket creator
    error NotBasketCreator();

    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    constructor() Ownable(msg.sender) {
        // BasketRegistry starts with basketCount = 0
        // First basket created will have basketId = 1
    }

    // ============================================================
    // =================== EXTERNAL FUNCTIONS =====================
    // ============================================================
    
    /**
     * @notice Create a new basket with specified assets and weights
     * @dev Only callable by anyone (fund creator role).
     *      Weights must sum to 10000 basis points (100%).
     *      Each weight must be non-zero.
     * @param assets Array of asset identifiers
     * @param weights Array of weights in basis points
     * @param name Human-readable name for the basket
     * @param symbol Token symbol for the basket
     * @return basketId The unique ID assigned to the new basket
     */
    function createBasket(
        string[] calldata assets,
        uint256[] calldata weights,
        string calldata name,
        string calldata symbol
    ) external returns (uint256 basketId) {
        // Validate inputs
        uint256 assetLen = assets.length;
        if (assetLen == 0) revert EmptyAssetsArray();
        if (assetLen != weights.length) revert ArrayLengthMismatch();
        
        // Validate weights sum to 10000 basis points
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < assetLen;) {
            if (weights[i] == 0) revert ZeroWeight();
            totalWeight += weights[i];
            unchecked { ++i; }
        }
        if (totalWeight != 10000) revert InvalidWeightsSum();
        
        // Generate new basket ID (starts from 1)
        basketId = ++basketCount;
        
        // Create the basket - store directly to avoid extra local vars
        Basket storage b = baskets[basketId];
        b.creator = msg.sender;
        b.active = true;
        b.name = name;
        b.symbol = symbol;
        
        // Copy assets and weights to storage
        for (uint256 i = 0; i < assetLen;) {
            b.assets.push(assets[i]);
            b.weights.push(weights[i]);
            unchecked { ++i; }
        }
        
        // Track creator's baskets
        creatorBaskets[msg.sender].push(basketId);
        
        emit BasketCreated(basketId, msg.sender, assetLen);
    }
    
    /**
     * @notice Deactivate a basket (only creator or owner)
     * @param basketId The basket to deactivate
     */
    function deactivateBasket(uint256 basketId) external {
        Basket storage basket = baskets[basketId];
        if (basket.creator == address(0)) revert BasketDoesNotExist();
        if (msg.sender != basket.creator && msg.sender != owner()) {
            revert NotBasketCreator();
        }
        
        basket.active = false;
        emit BasketActiveStateChanged(basketId, false);
    }
    
    /**
     * @notice Reactivate a basket (only creator or owner)
     * @param basketId The basket to reactivate
     */
    function reactivateBasket(uint256 basketId) external {
        Basket storage basket = baskets[basketId];
        if (basket.creator == address(0)) revert BasketDoesNotExist();
        if (msg.sender != basket.creator && msg.sender != owner()) {
            revert NotBasketCreator();
        }
        
        basket.active = true;
        emit BasketActiveStateChanged(basketId, true);
    }

    // ============================================================
    // ==================== VIEW FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Get complete basket data by ID
     * @param basketId The basket ID to query
     * @return creator The creator address
     * @return assets Array of asset identifiers
     * @return weights Array of weights in basis points
     * @return active Whether the basket is active
     * @return name Basket name
     * @return symbol Basket symbol
     */
    function getBasket(uint256 basketId) external view returns (
        address creator,
        string[] memory assets,
        uint256[] memory weights,
        bool active,
        string memory name,
        string memory symbol
    ) {
        Basket storage basket = baskets[basketId];
        if (basket.creator == address(0)) revert BasketDoesNotExist();
        
        return (
            basket.creator,
            basket.assets,
            basket.weights,
            basket.active,
            basket.name,
            basket.symbol
        );
    }
    
    /**
     * @notice Check if a basket is active
     * @param basketId The basket ID to check
     * @return True if active, false otherwise
     */
    function isBasketActive(uint256 basketId) external view returns (bool) {
        Basket storage basket = baskets[basketId];
        if (basket.creator == address(0)) revert BasketDoesNotExist();
        return basket.active;
    }
    
    /**
     * @notice Get basket composition (assets and weights only)
     * @param basketId The basket ID to query
     * @return assets Array of asset identifiers
     * @return weights Array of weights in basis points
     */
    function getBasketComposition(uint256 basketId) external view returns (
        string[] memory assets,
        uint256[] memory weights
    ) {
        Basket storage basket = baskets[basketId];
        if (basket.creator == address(0)) revert BasketDoesNotExist();
        return (basket.assets, basket.weights);
    }
    
    /**
     * @notice Get the number of assets in a basket
     * @param basketId The basket ID to query
     * @return Number of assets
     */
    function getBasketAssetCount(uint256 basketId) external view returns (uint256) {
        Basket storage basket = baskets[basketId];
        if (basket.creator == address(0)) revert BasketDoesNotExist();
        return basket.assets.length;
    }
    
    /**
     * @notice Get all basket IDs created by a specific address
     * @param creator The creator address to query
     * @return Array of basket IDs
     */
    function getBasketsByCreator(address creator) external view returns (uint256[] memory) {
        return creatorBaskets[creator];
    }
    
    /**
     * @notice Check if a basket exists
     * @param basketId The basket ID to check
     * @return True if exists, false otherwise
     */
    function basketExists(uint256 basketId) external view returns (bool) {
        return baskets[basketId].creator != address(0);
    }
}
