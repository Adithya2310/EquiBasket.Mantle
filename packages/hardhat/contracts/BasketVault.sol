// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BasketRegistry.sol";
import "./BasketOracle.sol";
import "./EquiBasketToken.sol";

/**
 * @title BasketVault
 * @notice Vault for managing basket-scoped collateral positions using NATIVE MNT
 * @dev This version uses native MNT (msg.value) instead of ERC20 MockMNT
 *      On Mantle, MNT is the native gas token similar to ETH on Ethereum.
 *      
 *      Key features:
 *      - State is (user → basketId → position) scoped
 *      - A user can have multiple baskets with different risk profiles
 *      - Each (user, basketId) pair is an independent position
 *      - Uses NATIVE MNT (msg.value) as collateral
 * 
 *      COLLATERAL FLOW:
 *      1. User deposits native MNT collateral via msg.value
 *      2. User can mint basket tokens if they have sufficient collateral
 *      3. When minting, debt is created and tracked per (user, basketId)
 *      4. When burning, debt is repaid and collateral is freed
 */
contract BasketVault is Ownable, ReentrancyGuard {
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
    
    /// @notice Authorized factory that can register basket tokens
    address public authorizedFactory;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    event CollateralDeposited(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 newTotalCollateral
    );
    
    event CollateralWithdrawn(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 newTotalCollateral
    );
    
    event BasketMinted(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 newTotalDebt
    );
    
    event BasketBurned(
        address indexed user,
        uint256 indexed basketId,
        uint256 amount,
        uint256 newTotalDebt
    );
    
    event Liquidated(
        address indexed user,
        uint256 indexed basketId,
        address indexed liquidator,
        uint256 debtRepaid,
        uint256 collateralSeized
    );
    
    event BasketTokenRegistered(uint256 indexed basketId, address tokenAddress);
    event OracleUpdated(address oldOracle, address newOracle);
    event LiquidatorUpdated(address oldLiquidator, address newLiquidator);
    event FactoryUpdated(address factory);
    
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
    error TransferFailed();

    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    /**
     * @notice Initialize the vault with dependencies
     * @param _basketRegistry Address of the BasketRegistry
     * @param _basketOracle Address of the BasketOracle
     */
    constructor(
        address _basketRegistry,
        address _basketOracle
    ) Ownable(msg.sender) {
        if (_basketRegistry == address(0)) revert ZeroAddress();
        if (_basketOracle == address(0)) revert ZeroAddress();
        
        basketRegistry = BasketRegistry(_basketRegistry);
        basketOracle = BasketOracle(_basketOracle);
    }

    // ============================================================
    // =================== ADMIN FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Register a basket token for a basket
     */
    function registerBasketToken(uint256 basketId, address tokenAddress) external {
        // Allow owner OR authorized factory to register tokens
        if (msg.sender != owner() && msg.sender != authorizedFactory) {
            revert OwnableUnauthorizedAccount(msg.sender);
        }
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        if (address(basketTokens[basketId]) != address(0)) revert BasketTokenAlreadyRegistered();
        if (tokenAddress == address(0)) revert ZeroAddress();
        
        basketTokens[basketId] = EquiBasketToken(tokenAddress);
        emit BasketTokenRegistered(basketId, tokenAddress);
    }
    
    /**
     * @notice Set the authorized factory address
     * @param _factory Address of the BasketFactory contract
     */
    function setAuthorizedFactory(address _factory) external onlyOwner {
        authorizedFactory = _factory;
        emit FactoryUpdated(_factory);
    }
    
    function setOracle(address _newOracle) external onlyOwner {
        if (_newOracle == address(0)) revert ZeroAddress();
        address oldOracle = address(basketOracle);
        basketOracle = BasketOracle(_newOracle);
        emit OracleUpdated(oldOracle, _newOracle);
    }
    
    function setLiquidator(address _liquidator) external onlyOwner {
        address oldLiquidator = liquidator;
        liquidator = _liquidator;
        emit LiquidatorUpdated(oldLiquidator, _liquidator);
    }

    // ============================================================
    // ================= COLLATERAL FUNCTIONS =====================
    // ============================================================
    
    /**
     * @notice Deposit native MNT collateral for a specific basket
     * @dev Send MNT via msg.value
     * @param basketId The basket to deposit collateral for
     */
    function depositCollateral(uint256 basketId) external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        
        // Update user's collateral balance for this basket
        userCollateral[msg.sender][basketId] += msg.value;
        
        emit CollateralDeposited(
            msg.sender,
            basketId,
            msg.value,
            userCollateral[msg.sender][basketId]
        );
    }
    
    /**
     * @notice Withdraw native MNT collateral from a specific basket
     * @dev Can only withdraw excess collateral that maintains required ratio
     */
    function withdrawCollateral(uint256 basketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > userCollateral[msg.sender][basketId]) revert InsufficientCollateral();
        
        uint256 newCollateral = userCollateral[msg.sender][basketId] - amount;
        
        // Check if user has debt - if so, ensure collateral ratio stays above threshold
        uint256 debt = userDebt[msg.sender][basketId];
        if (debt > 0) {
            uint256 newCollateralValue = basketOracle.getMntValue(newCollateral);
            uint256 debtValue = _getDebtValue(basketId, debt);
            
            uint256 requiredCollateralValue = (debtValue * COLLATERAL_RATIO) / 100;
            if (newCollateralValue < requiredCollateralValue) revert InsufficientCollateral();
        }
        
        // Update collateral
        userCollateral[msg.sender][basketId] = newCollateral;
        
        // Transfer native MNT to user
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit CollateralWithdrawn(msg.sender, basketId, amount, newCollateral);
    }

    // ============================================================
    // =================== MINTING FUNCTIONS ======================
    // ============================================================
    
    /**
     * @notice Mint basket tokens by taking on debt
     * @dev Requires sufficient collateral to maintain COLLATERAL_RATIO
     */
    function mintBasket(uint256 basketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (!basketRegistry.basketExists(basketId)) revert BasketDoesNotExist();
        if (!basketRegistry.isBasketActive(basketId)) revert BasketNotActive();
        if (address(basketTokens[basketId]) == address(0)) revert BasketTokenNotRegistered();
        
        uint256 newDebt = userDebt[msg.sender][basketId] + amount;
        uint256 newDebtValue = _getDebtValue(basketId, newDebt);
        uint256 requiredCollateralValue = (newDebtValue * COLLATERAL_RATIO) / 100;
        
        uint256 collateralValue = basketOracle.getMntValue(userCollateral[msg.sender][basketId]);
        
        if (collateralValue < requiredCollateralValue) revert InsufficientCollateral();
        
        userDebt[msg.sender][basketId] = newDebt;
        basketTokens[basketId].mint(msg.sender, amount);
        
        emit BasketMinted(msg.sender, basketId, amount, newDebt);
    }
    
    /**
     * @notice Burn basket tokens to repay debt and free collateral
     */
    function burnBasket(uint256 basketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > userDebt[msg.sender][basketId]) revert InsufficientDebt();
        if (address(basketTokens[basketId]) == address(0)) revert BasketTokenNotRegistered();
        
        uint256 currentDebt = userDebt[msg.sender][basketId];
        uint256 currentCollateral = userCollateral[msg.sender][basketId];
        
        uint256 collateralToRelease = (amount * currentCollateral) / currentDebt;
        
        userDebt[msg.sender][basketId] -= amount;
        
        if (userDebt[msg.sender][basketId] == 0) {
            collateralToRelease = currentCollateral;
            userCollateral[msg.sender][basketId] = 0;
        } else {
            userCollateral[msg.sender][basketId] -= collateralToRelease;
        }
        
        basketTokens[basketId].burn(msg.sender, amount);
        
        // Transfer native MNT
        (bool success, ) = payable(msg.sender).call{value: collateralToRelease}("");
        if (!success) revert TransferFailed();
        
        emit BasketBurned(msg.sender, basketId, amount, userDebt[msg.sender][basketId]);
    }

    // ============================================================
    // ================= LIQUIDATION FUNCTIONS ====================
    // ============================================================
    
    function isLiquidatable(address user, uint256 basketId) public view returns (bool) {
        uint256 debt = userDebt[user][basketId];
        if (debt == 0) return false;
        
        uint256 ratio = getCollateralRatio(user, basketId);
        return ratio < (LIQUIDATION_THRESHOLD * PRECISION / 100);
    }
    
    function liquidate(address user, uint256 basketId) external payable nonReentrant {
        if (!isLiquidatable(user, basketId)) revert PositionNotLiquidatable();
        
        uint256 debt = userDebt[user][basketId];
        if (debt == 0) revert NoDebtToLiquidate();
        if (address(basketTokens[basketId]) == address(0)) revert BasketTokenNotRegistered();
        
        uint256 debtValue = _getDebtValue(basketId, debt);
        uint256 collateralToSeize = userCollateral[user][basketId];
        
        // Convert debt value to MNT that liquidator needs to pay
        uint256 mntToPayForDebt = basketOracle.getMntFromUsdValue(debtValue);
        
        // Require liquidator sends enough MNT
        if (msg.value < mntToPayForDebt) revert InvalidAmount();
        
        // Clear user's position
        userCollateral[user][basketId] = 0;
        userDebt[user][basketId] = 0;
        
        // Transfer seized collateral to liquidator
        (bool success, ) = payable(msg.sender).call{value: collateralToSeize}("");
        if (!success) revert TransferFailed();
        
        // Refund excess MNT
        if (msg.value > mntToPayForDebt) {
            (success, ) = payable(msg.sender).call{value: msg.value - mntToPayForDebt}("");
            if (!success) revert TransferFailed();
        }
        
        emit Liquidated(user, basketId, msg.sender, debt, collateralToSeize);
    }

    // ============================================================
    // ===================== VIEW FUNCTIONS =======================
    // ============================================================
    
    function getCollateralRatio(address user, uint256 basketId) public view returns (uint256) {
        uint256 debt = userDebt[user][basketId];
        if (debt == 0) return type(uint256).max;
        
        uint256 collateralValue = basketOracle.getMntValue(userCollateral[user][basketId]);
        uint256 debtValue = _getDebtValue(basketId, debt);
        
        if (debtValue == 0) return type(uint256).max;
        
        return (collateralValue * PRECISION) / debtValue;
    }
    
    function getMaxMintable(address user, uint256 basketId) external view returns (uint256) {
        uint256 collateralValue = basketOracle.getMntValue(userCollateral[user][basketId]);
        uint256 currentDebtValue = _getDebtValue(basketId, userDebt[user][basketId]);
        
        uint256 maxDebtValue = (collateralValue * 100) / COLLATERAL_RATIO;
        
        if (maxDebtValue <= currentDebtValue) return 0;
        
        uint256 availableDebtValue = maxDebtValue - currentDebtValue;
        
        uint256 basketPrice = basketOracle.getBasketPrice(basketId);
        if (basketPrice == 0) return 0;
        
        return (availableDebtValue * PRECISION) / basketPrice;
    }
    
    struct UserPositionView {
        uint256 collateral;
        uint256 debt;
        uint256 collateralRatio;
        bool liquidatable;
    }
    
    function getUserPosition(address user, uint256 basketId) external view returns (UserPositionView memory) {
        return UserPositionView({
            collateral: userCollateral[user][basketId],
            debt: userDebt[user][basketId],
            collateralRatio: getCollateralRatio(user, basketId),
            liquidatable: isLiquidatable(user, basketId)
        });
    }
    
    // ============================================================
    // ================= INTERNAL FUNCTIONS =======================
    // ============================================================
    
    function _getDebtValue(uint256 basketId, uint256 debtAmount) internal view returns (uint256) {
        if (debtAmount == 0) return 0;
        uint256 basketPrice = basketOracle.getBasketPrice(basketId);
        return (debtAmount * basketPrice) / PRECISION;
    }
    
    // Allow receiving native MNT
    receive() external payable {}
}
