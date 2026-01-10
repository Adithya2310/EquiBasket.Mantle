// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BasketRegistry.sol";
import "./BasketOracle.sol";
import "./EquiBasketToken.sol";

/**
 * @title BasketVault
 * @notice Vault for managing basket-scoped collateral positions
 * @dev This vault manages collateral positions on a per-user, per-basket basis.
 *      Key differences from single-asset vaults:
 *      - State is (user → basketId → position) scoped
 *      - A user can have multiple baskets with different risk profiles
 *      - Each (user, basketId) pair is an independent position
 *      - Uses MNT as collateral instead of PYUSD
 * 
 *      COLLATERAL FLOW:
 *      1. User deposits MNT collateral for a specific basket
 *      2. User can mint basket tokens if they have sufficient collateral
 *      3. When minting, debt is created and tracked per (user, basketId)
 *      4. When burning, debt is repaid and collateral is freed
 * 
 *      COLLATERAL RATIO:
 *      - Minimum collateral ratio for minting: 500% (COLLATERAL_RATIO)
 *      - Liquidation threshold: 150% (LIQUIDATION_THRESHOLD)
 *      - Ratio = (collateral value in USD) / (debt value in USD) * 100
 */
contract BasketVaultERC20 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // ======================= CONSTANTS ==========================
    // ============================================================
    
    /// @notice Required collateral ratio for minting (500%)
    uint256 public constant COLLATERAL_RATIO = 500;
    
    /// @notice Liquidation threshold (150%)
    uint256 public constant LIQUIDATION_THRESHOLD = 150;
    
    /// @notice Decimal precision for calculations (1e18)
    uint256 public constant PRECISION = 1e18;
    
    /// @notice Liquidation penalty in basis points (10% = 1000 bp)
    uint256 public constant LIQUIDATION_PENALTY = 1000;

    // ============================================================
    // ========================== STATE ===========================
    // ============================================================
    
    /// @notice MNT token used as collateral
    IERC20 public immutable mnt;
    
    /// @notice Reference to the basket oracle for pricing
    BasketOracle public basketOracle;
    
    /// @notice Reference to the basket registry
    BasketRegistry public immutable basketRegistry;
    
    /// @notice Mapping from basketId to its token contract
    mapping(uint256 => EquiBasketToken) public basketTokens;
    
    /// @notice User collateral per basket: user => basketId => collateral amount (in MNT, 18 decimals)
    mapping(address => mapping(uint256 => uint256)) public userCollateral;
    
    /// @notice User debt per basket: user => basketId => debt amount (in basket tokens, 18 decimals)
    mapping(address => mapping(uint256 => uint256)) public userDebt;
    
    /// @notice Authorized liquidator address (Vincent bot)
    address public liquidator;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    /// @notice Emitted when collateral is deposited
    event CollateralDeposited(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 newTotalCollateral
    );
    
    /// @notice Emitted when collateral is withdrawn
    event CollateralWithdrawn(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 newTotalCollateral
    );
    
    /// @notice Emitted when basket tokens are minted
    event BasketMinted(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 newDebt
    );
    
    /// @notice Emitted when basket tokens are burned
    event BasketBurned(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 remainingDebt
    );
    
    /// @notice Emitted when a position is liquidated
    event Liquidated(
        address indexed user,
        uint256 indexed basketId,
        address indexed liquidatorAddress,
        uint256 debtRepaid,
        uint256 collateralSeized
    );
    
    /// @notice Emitted when a basket token is registered
    event BasketTokenRegistered(uint256 indexed basketId, address tokenAddress);
    
    /// @notice Emitted when the oracle is updated
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    
    /// @notice Emitted when the liquidator is updated
    event LiquidatorUpdated(address indexed oldLiquidator, address indexed newLiquidator);
    
    // ============================================================
    // ========================= ERRORS ===========================
    // ============================================================
    
    error InvalidAmount();
    error BasketDoesNotExist();
    error BasketNotActive();
    error InsufficientCollateral();
    error InsufficientDebt();
    error PositionNotLiquidatable();
    error NoDebtToLiquidate();
    error BasketTokenNotRegistered();
    error BasketTokenAlreadyRegistered();
    error ZeroAddress();
    error NotAuthorizedLiquidator();
    error CollateralRatioTooLow();

    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    /**
     * @notice Initialize the vault with dependencies
     * @param _mnt Address of the MNT token
     * @param _basketRegistry Address of the BasketRegistry
     * @param _basketOracle Address of the BasketOracle
     */
    constructor(
        address _mnt,
        address _basketRegistry,
        address _basketOracle
    ) Ownable(msg.sender) {
        if (_mnt == address(0)) revert ZeroAddress();
        if (_basketRegistry == address(0)) revert ZeroAddress();
        if (_basketOracle == address(0)) revert ZeroAddress();
        
        mnt = IERC20(_mnt);
        basketRegistry = BasketRegistry(_basketRegistry);
        basketOracle = BasketOracle(_basketOracle);
    }

    // ============================================================
    // =================== ADMIN FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Register a basket token for a basket
     * @param basketId The basket ID
     * @param tokenAddress Address of the EquiBasketToken
     */
    function registerBasketToken(uint256 basketId, address tokenAddress) external onlyOwner {
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        if (address(basketTokens[basketId]) != address(0)) revert BasketTokenAlreadyRegistered();
        if (tokenAddress == address(0)) revert ZeroAddress();
        
        basketTokens[basketId] = EquiBasketToken(tokenAddress);
        
        emit BasketTokenRegistered(basketId, tokenAddress);
    }
    
    /**
     * @notice Update the oracle address
     * @param _newOracle Address of the new oracle
     */
    function setOracle(address _newOracle) external onlyOwner {
        if (_newOracle == address(0)) revert ZeroAddress();
        
        address oldOracle = address(basketOracle);
        basketOracle = BasketOracle(_newOracle);
        
        emit OracleUpdated(oldOracle, _newOracle);
    }
    
    /**
     * @notice Set the authorized liquidator address (Vincent bot)
     * @param _liquidator Address authorized to call liquidate
     */
    function setLiquidator(address _liquidator) external onlyOwner {
        address oldLiquidator = liquidator;
        liquidator = _liquidator;
        
        emit LiquidatorUpdated(oldLiquidator, _liquidator);
    }

    // ============================================================
    // ================= COLLATERAL FUNCTIONS =====================
    // ============================================================
    
    /**
     * @notice Deposit MNT collateral for a specific basket
     * @param basketId The basket to deposit collateral for
     * @param amount Amount of MNT to deposit (18 decimals)
     */
    function depositCollateral(uint256 basketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        
        // Transfer MNT from user to vault
        mnt.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update user's collateral balance for this basket
        userCollateral[msg.sender][basketId] += amount;
        
        emit CollateralDeposited(
            msg.sender,
            basketId,
            amount,
            userCollateral[msg.sender][basketId]
        );
    }
    
    /**
     * @notice Withdraw MNT collateral from a specific basket
     * @dev Can only withdraw excess collateral that maintains required ratio
     * @param basketId The basket to withdraw collateral from
     * @param amount Amount of MNT to withdraw (18 decimals)
     */
    function withdrawCollateral(uint256 basketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > userCollateral[msg.sender][basketId]) revert InsufficientCollateral();
        
        // Calculate new collateral after withdrawal
        uint256 newCollateral = userCollateral[msg.sender][basketId] - amount;
        
        // Check if user has debt - if so, ensure collateral ratio stays above threshold
        uint256 debt = userDebt[msg.sender][basketId];
        if (debt > 0) {
            uint256 newCollateralValue = basketOracle.getMntValue(newCollateral);
            uint256 debtValue = _getDebtValue(basketId, debt);
            
            // Require at least COLLATERAL_RATIO (500%) after withdrawal
            uint256 requiredCollateralValue = (debtValue * COLLATERAL_RATIO) / 100;
            if (newCollateralValue < requiredCollateralValue) revert InsufficientCollateral();
        }
        
        // Update collateral and transfer
        userCollateral[msg.sender][basketId] = newCollateral;
        mnt.safeTransfer(msg.sender, amount);
        
        emit CollateralWithdrawn(msg.sender, basketId, amount, newCollateral);
    }

    // ============================================================
    // =================== MINTING FUNCTIONS ======================
    // ============================================================
    
    /**
     * @notice Mint basket tokens by taking on debt
     * @dev Requires sufficient collateral to maintain COLLATERAL_RATIO
     * @param basketId The basket to mint
     * @param amount Amount of basket tokens to mint (18 decimals)
     */
    function mintBasket(uint256 basketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        if (!basketRegistry.isBasketActive(basketId)) revert BasketNotActive();
        if (address(basketTokens[basketId]) == address(0)) revert BasketTokenNotRegistered();
        
        // Calculate new debt after minting
        uint256 newDebt = userDebt[msg.sender][basketId] + amount;
        
        // Calculate required collateral value
        uint256 newDebtValue = _getDebtValue(basketId, newDebt);
        uint256 requiredCollateralValue = (newDebtValue * COLLATERAL_RATIO) / 100;
        
        // Get user's collateral value
        uint256 collateralValue = basketOracle.getMntValue(userCollateral[msg.sender][basketId]);
        
        if (collateralValue < requiredCollateralValue) revert InsufficientCollateral();
        
        // Update debt and mint tokens
        userDebt[msg.sender][basketId] = newDebt;
        basketTokens[basketId].mint(msg.sender, amount);
        
        emit BasketMinted(msg.sender, basketId, amount, newDebt);
    }
    
    /**
     * @notice Burn basket tokens to repay debt and free collateral
     * @param basketId The basket to burn
     * @param amount Amount of basket tokens to burn (18 decimals)
     */
    function burnBasket(uint256 basketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > userDebt[msg.sender][basketId]) revert InsufficientDebt();
        if (address(basketTokens[basketId]) == address(0)) revert BasketTokenNotRegistered();
        
        // Calculate collateral to release
        // Release proportional collateral based on debt repaid
        uint256 currentDebt = userDebt[msg.sender][basketId];
        uint256 currentCollateral = userCollateral[msg.sender][basketId];
        
        // Proportional collateral release: (amount / currentDebt) * currentCollateral
        uint256 collateralToRelease = (amount * currentCollateral) / currentDebt;
        
        // Update debt
        userDebt[msg.sender][basketId] -= amount;
        
        // Release collateral if debt is fully repaid
        if (userDebt[msg.sender][basketId] == 0) {
            collateralToRelease = currentCollateral;
            userCollateral[msg.sender][basketId] = 0;
        } else {
            userCollateral[msg.sender][basketId] -= collateralToRelease;
        }
        
        // Burn tokens and transfer collateral
        basketTokens[basketId].burn(msg.sender, amount);
        mnt.safeTransfer(msg.sender, collateralToRelease);
        
        emit BasketBurned(msg.sender, basketId, amount, userDebt[msg.sender][basketId]);
    }

    // ============================================================
    // ================= LIQUIDATION FUNCTIONS ====================
    // ============================================================
    
    /**
     * @notice Check if a user's basket position is liquidatable
     * @param user The user address
     * @param basketId The basket ID
     * @return True if the position can be liquidated
     */
    function isLiquidatable(address user, uint256 basketId) public view returns (bool) {
        uint256 debt = userDebt[user][basketId];
        if (debt == 0) return false;
        
        uint256 ratio = getCollateralRatio(user, basketId);
        // Liquidatable if ratio is below LIQUIDATION_THRESHOLD (150%)
        // Ratio is in percentage * PRECISION, threshold is raw percentage
        return ratio < (LIQUIDATION_THRESHOLD * PRECISION / 100);
    }
    
    /**
     * @notice Liquidate an undercollateralized position
     * @dev Basket-scoped liquidation - only liquidates the specific basket position.
     *      One basket failing does NOT affect other baskets owned by the user.
     *      
     *      Liquidation flow:
     *      1. Liquidator pays the debt value in MNT
     *      2. Liquidator receives user's collateral + liquidation bonus
     *      3. User's debt is cleared for this basket
     * 
     * @param user The user whose position to liquidate
     * @param basketId The basket position to liquidate
     */
    function liquidate(address user, uint256 basketId) external nonReentrant {
        // Optional: Restrict to authorized liquidator (Vincent bot)
        // Commenting this out allows anyone to liquidate for decentralization
        // if (liquidator != address(0) && msg.sender != liquidator) revert NotAuthorizedLiquidator();
        
        if (!isLiquidatable(user, basketId)) revert PositionNotLiquidatable();
        
        uint256 debt = userDebt[user][basketId];
        if (debt == 0) revert NoDebtToLiquidate();
        if (address(basketTokens[basketId]) == address(0)) revert BasketTokenNotRegistered();
        
        // Get debt value in USD
        uint256 debtValue = _getDebtValue(basketId, debt);
        
        // Seize all collateral (including any penalty/bonus implicit in CR < 150%)
        uint256 collateralToSeize = userCollateral[user][basketId];
        
        // Convert debt value to MNT that liquidator needs to pay
        uint256 mntToPayForDebt = basketOracle.getMntFromUsdValue(debtValue);
        
        // Transfer MNT from liquidator to vault
        mnt.safeTransferFrom(msg.sender, address(this), mntToPayForDebt);
        
        // Transfer seized collateral to liquidator
        mnt.safeTransfer(msg.sender, collateralToSeize);
        
        // Clear user's position
        userCollateral[user][basketId] = 0;
        userDebt[user][basketId] = 0;
        
        // Note: We don't burn the basket tokens here because they're in circulation
        // The liquidator is essentially taking over the synthetic position
        
        emit Liquidated(user, basketId, msg.sender, debt, collateralToSeize);
    }
    
    /**
     * @notice Partial liquidation of a basket position
     * @param user The user whose position to partially liquidate
     * @param basketId The basket position
     * @param debtToRepay Amount of debt to repay (in basket tokens)
     */
    function partialLiquidate(
        address user,
        uint256 basketId,
        uint256 debtToRepay
    ) external nonReentrant {
        if (!isLiquidatable(user, basketId)) revert PositionNotLiquidatable();
        
        uint256 currentDebt = userDebt[user][basketId];
        if (currentDebt == 0) revert NoDebtToLiquidate();
        if (debtToRepay > currentDebt) debtToRepay = currentDebt;
        if (address(basketTokens[basketId]) == address(0)) revert BasketTokenNotRegistered();
        
        // Calculate proportional collateral to seize (with 10% liquidation penalty)
        uint256 currentCollateral = userCollateral[user][basketId];
        uint256 proportionalCollateral = (debtToRepay * currentCollateral) / currentDebt;
        
        // Add liquidation penalty (10% more collateral)
        uint256 collateralWithPenalty = proportionalCollateral + 
            (proportionalCollateral * LIQUIDATION_PENALTY) / 10000;
        
        // Cap at total collateral
        if (collateralWithPenalty > currentCollateral) {
            collateralWithPenalty = currentCollateral;
        }
        
        // Get debt value to pay
        uint256 debtValueToRepay = _getDebtValue(basketId, debtToRepay);
        uint256 mntToPayForDebt = basketOracle.getMntFromUsdValue(debtValueToRepay);
        
        // Transfer MNT from liquidator
        mnt.safeTransferFrom(msg.sender, address(this), mntToPayForDebt);
        
        // Transfer seized collateral to liquidator
        mnt.safeTransfer(msg.sender, collateralWithPenalty);
        
        // Update user's position
        userCollateral[user][basketId] -= collateralWithPenalty;
        userDebt[user][basketId] -= debtToRepay;
        
        emit Liquidated(user, basketId, msg.sender, debtToRepay, collateralWithPenalty);
    }

    // ============================================================
    // ==================== VIEW FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Get the collateral ratio for a user's basket position
     * @dev Returns the ratio as a percentage with PRECISION decimals
     *      e.g., 500% = 5 * PRECISION = 5e18
     * @param user The user address
     * @param basketId The basket ID
     * @return ratio The collateral ratio (percentage * PRECISION)
     */
    function getCollateralRatio(address user, uint256 basketId) public view returns (uint256 ratio) {
        uint256 debt = userDebt[user][basketId];
        if (debt == 0) return type(uint256).max; // Infinite ratio if no debt
        
        uint256 collateral = userCollateral[user][basketId];
        if (collateral == 0) return 0;
        
        uint256 collateralValue = basketOracle.getMntValue(collateral);
        uint256 debtValue = _getDebtValue(basketId, debt);
        
        // ratio = (collateralValue / debtValue) * PRECISION
        // Express as percentage * PRECISION / 100
        ratio = (collateralValue * PRECISION) / debtValue;
    }
    
    /**
     * @notice Get a user's complete position for a basket
     * @param user The user address
     * @param basketId The basket ID
     * @return collateral Amount of MNT collateral
     * @return debt Amount of basket token debt
     * @return collateralRatio Current collateral ratio
     * @return liquidatable Whether the position is liquidatable
     */
    function getUserPosition(address user, uint256 basketId) external view returns (
        uint256 collateral,
        uint256 debt,
        uint256 collateralRatio,
        bool liquidatable
    ) {
        collateral = userCollateral[user][basketId];
        debt = userDebt[user][basketId];
        collateralRatio = getCollateralRatio(user, basketId);
        liquidatable = isLiquidatable(user, basketId);
    }
    
    /**
     * @notice Get the maximum amount of basket tokens a user can mint
     * @param user The user address
     * @param basketId The basket ID
     * @return maxMint Maximum mintable amount
     */
    function getMaxMintable(address user, uint256 basketId) external view returns (uint256 maxMint) {
        uint256 collateral = userCollateral[user][basketId];
        if (collateral == 0) return 0;
        
        uint256 collateralValue = basketOracle.getMntValue(collateral);
        uint256 currentDebt = userDebt[user][basketId];
        uint256 currentDebtValue = currentDebt > 0 ? _getDebtValue(basketId, currentDebt) : 0;
        
        // Max debt value at COLLATERAL_RATIO
        uint256 maxDebtValue = (collateralValue * 100) / COLLATERAL_RATIO;
        
        if (maxDebtValue <= currentDebtValue) return 0;
        
        // Convert additional debt value to basket tokens
        uint256 additionalDebtValue = maxDebtValue - currentDebtValue;
        uint256 basketPrice = basketOracle.getBasketPrice(basketId);
        
        maxMint = (additionalDebtValue * PRECISION) / basketPrice;
    }
    
    /**
     * @notice Get the basket token address for a basket
     * @param basketId The basket ID
     * @return The token address
     */
    function getBasketToken(uint256 basketId) external view returns (address) {
        return address(basketTokens[basketId]);
    }

    // ============================================================
    // ================= INTERNAL FUNCTIONS =======================
    // ============================================================
    
    /**
     * @notice Calculate the USD value of debt for a basket
     * @param basketId The basket ID
     * @param debtAmount Amount of basket tokens (18 decimals)
     * @return The USD value (18 decimals)
     */
    function _getDebtValue(uint256 basketId, uint256 debtAmount) internal view returns (uint256) {
        uint256 basketPrice = basketOracle.getBasketPrice(basketId);
        // debtValue = debtAmount * basketPrice / PRECISION
        return (debtAmount * basketPrice) / PRECISION;
    }
}
