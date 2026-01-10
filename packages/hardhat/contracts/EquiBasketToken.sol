// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EquiBasketToken
 * @notice ERC20 token representing ownership of a basket-based synthetic asset
 * @dev Each basket has its own EquiBasketToken deployed when the basket is created.
 *      Unlike single-asset tokens, this token:
 *      - Stores the basketId it represents
 *      - Has name and symbol derived from basket metadata
 *      - Is only mintable/burnable by the authorized vault
 * 
 *      The token is a 1:1 representation of debt owed for a basket.
 *      When a user mints basket tokens, they take on a debt position.
 *      When they burn, they repay that debt.
 */
contract EquiBasketToken is ERC20, Ownable {
    // ============================================================
    // ========================== STATE ===========================
    // ============================================================
    
    /// @notice The basket ID this token represents
    uint256 public immutable basketId;
    
    /// @notice Address of the vault authorized to mint/burn
    address public vault;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    /// @notice Emitted when the vault address is updated
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    
    // ============================================================
    // ========================= ERRORS ===========================
    // ============================================================
    
    /// @notice Thrown when caller is not the vault
    error OnlyVault();
    
    /// @notice Thrown when vault address is zero
    error ZeroVaultAddress();
    
    // ============================================================
    // ======================== MODIFIERS =========================
    // ============================================================
    
    /**
     * @notice Ensures caller is the authorized vault
     */
    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    /**
     * @notice Deploy a new basket token
     * @param _basketId The basket ID this token represents
     * @param _name Token name (e.g., "EquiBasket Tech Giants")
     * @param _symbol Token symbol (e.g., "eTECH")
     * @param _owner The owner of this token contract (usually the deployer/factory)
     */
    constructor(
        uint256 _basketId,
        string memory _name,
        string memory _symbol,
        address _owner
    ) ERC20(_name, _symbol) Ownable(_owner) {
        basketId = _basketId;
    }

    // ============================================================
    // =================== ADMIN FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Set the vault address that can mint/burn tokens
     * @dev Only callable by owner. This links the token to its vault.
     * @param _vault Address of the BasketVault contract
     */
    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroVaultAddress();
        
        address oldVault = vault;
        vault = _vault;
        
        emit VaultUpdated(oldVault, _vault);
    }

    // ============================================================
    // ================== VAULT-ONLY FUNCTIONS ====================
    // ============================================================
    
    /**
     * @notice Mint tokens to user when they take a debt position
     * @dev Only callable by the vault during minting operations
     * @param user The user receiving the tokens
     * @param amount Amount of tokens to mint (in 18 decimals)
     */
    function mint(address user, uint256 amount) external onlyVault {
        _mint(user, amount);
    }
    
    /**
     * @notice Burn tokens from user when they repay debt
     * @dev Only callable by the vault during burning operations
     * @param user The user whose tokens are burned
     * @param amount Amount of tokens to burn (in 18 decimals)
     */
    function burn(address user, uint256 amount) external onlyVault {
        _burn(user, amount);
    }
}
