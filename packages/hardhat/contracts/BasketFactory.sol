// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BasketRegistry.sol";
import "./BasketVault.sol";
import "./EquiBasketToken.sol";

/**
 * @title BasketFactory
 * @notice Factory for creating complete basket setups in a single transaction
 * @dev This factory handles the complete lifecycle of basket creation:
 *      1. Creates the basket in BasketRegistry
 *      2. Deploys an EquiBasketToken for the basket
 *      3. Sets the vault as the token minter
 *      4. Registers the token in the BasketVault
 * 
 *      This ensures users never encounter "BasketTokenNotRegistered" errors
 *      because the token is always created and registered atomically.
 */
contract BasketFactory is Ownable {
    // ============================================================
    // ========================== STATE ===========================
    // ============================================================
    
    /// @notice Reference to the BasketRegistry
    BasketRegistry public immutable basketRegistry;
    
    /// @notice Reference to the BasketVault
    BasketVault public basketVault;
    
    /// @notice Mapping from basketId to its token address
    mapping(uint256 => address) public basketTokens;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    event BasketCreatedWithToken(
        uint256 indexed basketId,
        address indexed creator,
        address tokenAddress,
        string name,
        string symbol
    );
    
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    
    // ============================================================
    // ========================= ERRORS ===========================
    // ============================================================
    
    error VaultNotSet();
    error ZeroAddress();
    
    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    /**
     * @notice Deploy the factory with required dependencies
     * @param _basketRegistry Address of the BasketRegistry
     * @param _basketVault Address of the BasketVault (can be set later)
     */
    constructor(
        address _basketRegistry,
        address _basketVault
    ) Ownable(msg.sender) {
        if (_basketRegistry == address(0)) revert ZeroAddress();
        
        basketRegistry = BasketRegistry(_basketRegistry);
        
        if (_basketVault != address(0)) {
            basketVault = BasketVault(payable(_basketVault));
        }
    }
    
    // ============================================================
    // =================== ADMIN FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Set or update the vault address
     * @param _vault Address of the BasketVault
     */
    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        
        address oldVault = address(basketVault);
        basketVault = BasketVault(payable(_vault));
        
        emit VaultUpdated(oldVault, _vault);
    }
    
    // ============================================================
    // ================= FACTORY FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Create a complete basket with token in a single transaction
     * @dev This function:
     *      1. Creates the basket in registry
     *      2. Deploys a new EquiBasketToken
     *      3. Sets vault as the token minter
     *      4. Registers token in vault
     * 
     * @param assets Array of asset identifiers (e.g., ["AAPL", "NVDA"])
     * @param weights Array of weights in basis points (must sum to 10000)
     * @param name Human-readable name for the basket
     * @param symbol Token symbol for the basket
     * @return basketId The unique ID assigned to the new basket
     * @return tokenAddress The address of the deployed EquiBasketToken
     */
    function createBasketWithToken(
        string[] calldata assets,
        uint256[] calldata weights,
        string calldata name,
        string calldata symbol
    ) external returns (uint256 basketId, address tokenAddress) {
        if (address(basketVault) == address(0)) revert VaultNotSet();
        
        // Step 1: Create basket in registry
        basketId = basketRegistry.createBasket(assets, weights, name, symbol);
        
        // Step 2: Deploy EquiBasketToken
        EquiBasketToken token = new EquiBasketToken(
            basketId,
            name,
            symbol,
            address(this) // Factory is initial owner
        );
        tokenAddress = address(token);
        
        // Store for reference
        basketTokens[basketId] = tokenAddress;
        
        // Step 3: Set vault as minter in token
        token.setVault(address(basketVault));
        
        // Step 4: Register token in vault
        basketVault.registerBasketToken(basketId, tokenAddress);
        
        // Step 5: Transfer token ownership to the basket creator
        token.transferOwnership(msg.sender);
        
        emit BasketCreatedWithToken(basketId, msg.sender, tokenAddress, name, symbol);
    }
    
    // ============================================================
    // ===================== VIEW FUNCTIONS =======================
    // ============================================================
    
    /**
     * @notice Get the token address for a basket
     * @param basketId The basket ID
     * @return The token address (zero if not created via factory)
     */
    function getBasketToken(uint256 basketId) external view returns (address) {
        return basketTokens[basketId];
    }
}
