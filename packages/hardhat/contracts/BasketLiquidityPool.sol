// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BasketOracle.sol";
import "./EquiBasketToken.sol";

/**
 * @title BasketLiquidityPool
 * @notice Liquidity pool for trading NATIVE MNT ↔ BasketToken pairs
 * @dev This pool uses oracle-based pricing instead of AMM math.
 *      Uses NATIVE MNT (msg.value) instead of ERC20 MNT for simplicity.
 *      Key characteristics:
 *      - Each pool handles one basket token paired with native MNT
 *      - Swaps are priced using BasketOracle.getBasketPrice()
 *      - No slippage from pool ratio changes (oracle-priced)
 *      - Liquidity providers deposit both native MNT and basket tokens
 */
contract BasketLiquidityPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // ========================== STATE ===========================
    // ============================================================
    
    /// @notice Basket token for this pool
    EquiBasketToken public immutable basketToken;
    
    /// @notice Oracle for pricing
    BasketOracle public immutable oracle;
    
    /// @notice Basket ID this pool trades
    uint256 public immutable basketId;
    
    /// @notice MNT balance in the pool (native MNT)
    uint256 public mntBalance;
    
    /// @notice Basket token balance in the pool
    uint256 public basketTokenBalance;
    
    /// @notice Swap fee in basis points (e.g., 30 = 0.30%)
    uint256 public swapFeeBps;
    
    /// @notice Accumulated fees in MNT
    uint256 public accumulatedFeesMnt;
    
    /// @notice Accumulated fees in basket tokens
    uint256 public accumulatedFeesBasket;
    
    /// @notice Liquidity provider shares: address => share amount
    mapping(address => uint256) public lpShares;
    
    /// @notice Total LP shares
    uint256 public totalShares;
    
    // ============================================================
    // ========================= EVENTS ===========================
    // ============================================================
    
    /// @notice Emitted when liquidity is added
    event LiquidityAdded(
        address indexed provider,
        uint256 mntAmount,
        uint256 basketAmount,
        uint256 sharesReceived
    );
    
    /// @notice Emitted when liquidity is removed
    event LiquidityRemoved(
        address indexed provider,
        uint256 mntAmount,
        uint256 basketAmount,
        uint256 sharesBurned
    );
    
    /// @notice Emitted when a swap occurs
    event Swap(
        address indexed user,
        bool mntToBasket,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    
    /// @notice Emitted when fees are collected by owner
    event FeesCollected(uint256 mntFees, uint256 basketFees);
    
    // ============================================================
    // ========================= ERRORS ===========================
    // ============================================================
    
    error InvalidAmount();
    error InsufficientLiquidity();
    error InvalidShares();
    error ZeroAddress();
    error InsufficientPoolMnt();
    error InsufficientPoolBasket();
    error FeeTooHigh();
    error TransferFailed();

    // ============================================================
    // ====================== CONSTRUCTOR =========================
    // ============================================================
    
    /**
     * @notice Initialize the liquidity pool
     * @param _basketToken Address of the basket token
     * @param _oracle Address of the basket oracle
     * @param _basketId The basket ID this pool trades
     * @param _swapFeeBps Swap fee in basis points (e.g., 30 = 0.30%)
     */
    constructor(
        address _basketToken,
        address _oracle,
        uint256 _basketId,
        uint256 _swapFeeBps
    ) Ownable(msg.sender) {
        if (_basketToken == address(0)) revert ZeroAddress();
        if (_oracle == address(0)) revert ZeroAddress();
        if (_swapFeeBps > 1000) revert FeeTooHigh(); // Max 10% fee
        
        basketToken = EquiBasketToken(_basketToken);
        oracle = BasketOracle(_oracle);
        basketId = _basketId;
        swapFeeBps = _swapFeeBps;
    }

    // ============================================================
    // =================== ADMIN FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Set the swap fee
     * @param _newFeeBps New fee in basis points
     */
    function setSwapFee(uint256 _newFeeBps) external onlyOwner {
        if (_newFeeBps > 1000) revert FeeTooHigh();
        swapFeeBps = _newFeeBps;
    }
    
    /**
     * @notice Collect accumulated fees
     */
    function collectFees() external onlyOwner {
        uint256 mntFees = accumulatedFeesMnt;
        uint256 basketFees = accumulatedFeesBasket;
        
        accumulatedFeesMnt = 0;
        accumulatedFeesBasket = 0;
        
        if (mntFees > 0) {
            (bool success, ) = payable(owner()).call{value: mntFees}("");
            if (!success) revert TransferFailed();
        }
        if (basketFees > 0) {
            IERC20(address(basketToken)).safeTransfer(owner(), basketFees);
        }
        
        emit FeesCollected(mntFees, basketFees);
    }

    // ============================================================
    // ================= LIQUIDITY FUNCTIONS ======================
    // ============================================================
    
    /**
     * @notice Add liquidity to the pool
     * @dev Send native MNT via msg.value, basket tokens via approval
     * @param amountBasket Amount of basket tokens to deposit
     * @return shares LP shares received
     */
    function addLiquidity(
        uint256 amountBasket
    ) external payable nonReentrant returns (uint256 shares) {
        uint256 amountMnt = msg.value;
        if (amountMnt == 0 && amountBasket == 0) revert InvalidAmount();
        
        // Transfer basket tokens to pool (if any)
        if (amountBasket > 0) {
            IERC20(address(basketToken)).safeTransferFrom(msg.sender, address(this), amountBasket);
            basketTokenBalance += amountBasket;
        }
        
        // MNT is already received via msg.value
        if (amountMnt > 0) {
            mntBalance += amountMnt;
        }
        
        // Calculate shares
        if (totalShares == 0) {
            // First liquidity provider gets shares equal to geometric mean
            // Using simple sum for initial shares
            shares = amountMnt + amountBasket;
        } else {
            // Proportional shares based on value added
            uint256 mntValue = oracle.getMntValue(amountMnt);
            uint256 basketPrice = oracle.getBasketPrice(basketId);
            uint256 basketValue = (amountBasket * basketPrice) / 1e18;
            uint256 totalValue = mntValue + basketValue;
            
            // Existing pool value
            uint256 existingMntValue = oracle.getMntValue(mntBalance - amountMnt);
            uint256 existingBasketValue = ((basketTokenBalance - amountBasket) * basketPrice) / 1e18;
            uint256 existingValue = existingMntValue + existingBasketValue;
            
            if (existingValue > 0) {
                shares = (totalValue * totalShares) / existingValue;
            } else {
                shares = totalValue;
            }
        }
        
        lpShares[msg.sender] += shares;
        totalShares += shares;
        
        emit LiquidityAdded(msg.sender, amountMnt, amountBasket, shares);
    }
    
    /**
     * @notice Remove liquidity from the pool
     * @param sharesToBurn Amount of LP shares to burn
     * @return mntOut MNT received
     * @return basketOut Basket tokens received
     */
    function removeLiquidity(uint256 sharesToBurn) external nonReentrant returns (
        uint256 mntOut,
        uint256 basketOut
    ) {
        if (sharesToBurn == 0) revert InvalidAmount();
        if (sharesToBurn > lpShares[msg.sender]) revert InvalidShares();
        
        // Calculate proportional amounts
        mntOut = (sharesToBurn * mntBalance) / totalShares;
        basketOut = (sharesToBurn * basketTokenBalance) / totalShares;
        
        // Update state
        lpShares[msg.sender] -= sharesToBurn;
        totalShares -= sharesToBurn;
        mntBalance -= mntOut;
        basketTokenBalance -= basketOut;
        
        // Transfer native MNT
        if (mntOut > 0) {
            (bool success, ) = payable(msg.sender).call{value: mntOut}("");
            if (!success) revert TransferFailed();
        }
        // Transfer basket tokens
        if (basketOut > 0) {
            IERC20(address(basketToken)).safeTransfer(msg.sender, basketOut);
        }
        
        emit LiquidityRemoved(msg.sender, mntOut, basketOut, sharesToBurn);
    }

    // ============================================================
    // ==================== SWAP FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Swap native MNT for basket tokens using oracle price
     * @dev Send MNT via msg.value
     * @return amountBasketOut Basket tokens received
     */
    function swapMntForBasket() external payable nonReentrant returns (uint256 amountBasketOut) {
        uint256 amountMntIn = msg.value;
        if (amountMntIn == 0) revert InvalidAmount();
        
        // Get oracle prices
        uint256 basketPrice = oracle.getBasketPrice(basketId);
        uint256 mntValue = oracle.getMntValue(amountMntIn);
        
        // Calculate basket tokens out (before fee)
        // basketOut = mntValue / basketPrice * 1e18
        uint256 grossBasketOut = (mntValue * 1e18) / basketPrice;
        
        // Apply fee
        uint256 fee = (grossBasketOut * swapFeeBps) / 10000;
        amountBasketOut = grossBasketOut - fee;
        
        if (amountBasketOut > basketTokenBalance) revert InsufficientPoolBasket();
        
        // Update balances
        mntBalance += amountMntIn;
        basketTokenBalance -= amountBasketOut;
        
        // Transfer basket tokens out
        IERC20(address(basketToken)).safeTransfer(msg.sender, amountBasketOut);
        
        // Accumulate fee
        accumulatedFeesBasket += fee;
        
        emit Swap(msg.sender, true, amountMntIn, amountBasketOut, fee);
    }
    
    /**
     * @notice Swap basket tokens for native MNT using oracle price
     * @param amountBasketIn Amount of basket tokens to sell
     * @return amountMntOut MNT received
     */
    function swapBasketForMnt(uint256 amountBasketIn) external nonReentrant returns (uint256 amountMntOut) {
        if (amountBasketIn == 0) revert InvalidAmount();
        
        // Get oracle prices
        uint256 basketPrice = oracle.getBasketPrice(basketId);
        uint256 mntPrice = oracle.mntUsdPrice();
        
        // Calculate USD value of basket tokens
        uint256 basketUsdValue = (amountBasketIn * basketPrice) / 1e18;
        
        // Calculate MNT out (before fee)
        uint256 grossMntOut = (basketUsdValue * 1e18) / mntPrice;
        
        // Apply fee
        uint256 fee = (grossMntOut * swapFeeBps) / 10000;
        amountMntOut = grossMntOut - fee;
        
        if (amountMntOut > mntBalance) revert InsufficientPoolMnt();
        
        // Transfer basket tokens in
        IERC20(address(basketToken)).safeTransferFrom(msg.sender, address(this), amountBasketIn);
        basketTokenBalance += amountBasketIn;
        
        // Transfer native MNT out
        mntBalance -= amountMntOut;
        (bool success, ) = payable(msg.sender).call{value: amountMntOut}("");
        if (!success) revert TransferFailed();
        
        // Accumulate fee
        accumulatedFeesMnt += fee;
        
        emit Swap(msg.sender, false, amountBasketIn, amountMntOut, fee);
    }

    // ============================================================
    // ==================== VIEW FUNCTIONS ========================
    // ============================================================
    
    /**
     * @notice Get pool reserves
     * @return mntReserve MNT balance
     * @return basketReserve Basket token balance
     */
    function getReserves() external view returns (uint256 mntReserve, uint256 basketReserve) {
        return (mntBalance, basketTokenBalance);
    }
    
    /**
     * @notice Get the current basket price from oracle
     * @return Basket price in USD (1e18 format)
     */
    function getOracleBasketPrice() external view returns (uint256) {
        return oracle.getBasketPrice(basketId);
    }
    
    /**
     * @notice Get the current MNT price from oracle
     * @return MNT/USD price in 1e18 format
     */
    function getOracleMntPrice() external view returns (uint256) {
        return oracle.mntUsdPrice();
    }
    
    /**
     * @notice Preview swap MNT for basket tokens
     * @param amountMntIn Amount of MNT to sell
     * @return amountBasketOut Expected basket tokens
     * @return fee Fee in basket tokens
     */
    function previewSwapMntForBasket(uint256 amountMntIn) external view returns (
        uint256 amountBasketOut,
        uint256 fee
    ) {
        uint256 basketPrice = oracle.getBasketPrice(basketId);
        uint256 mntValue = oracle.getMntValue(amountMntIn);
        
        uint256 grossBasketOut = (mntValue * 1e18) / basketPrice;
        fee = (grossBasketOut * swapFeeBps) / 10000;
        amountBasketOut = grossBasketOut - fee;
    }
    
    /**
     * @notice Preview swap basket tokens for MNT
     * @param amountBasketIn Amount of basket tokens to sell
     * @return amountMntOut Expected MNT
     * @return fee Fee in MNT
     */
    function previewSwapBasketForMnt(uint256 amountBasketIn) external view returns (
        uint256 amountMntOut,
        uint256 fee
    ) {
        uint256 basketPrice = oracle.getBasketPrice(basketId);
        uint256 mntPrice = oracle.mntUsdPrice();
        
        uint256 basketUsdValue = (amountBasketIn * basketPrice) / 1e18;
        uint256 grossMntOut = (basketUsdValue * 1e18) / mntPrice;
        
        fee = (grossMntOut * swapFeeBps) / 10000;
        amountMntOut = grossMntOut - fee;
    }
    
    /**
     * @notice Get LP share balance
     * @param account Address to query
     * @return Share balance
     */
    function getShares(address account) external view returns (uint256) {
        return lpShares[account];
    }
    
    // Allow receiving native MNT
    receive() external payable {}
}
