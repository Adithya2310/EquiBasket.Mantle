// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./EquiAsset.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PythOracle.sol";

contract EquiVault is Ownable {
    IERC20 public pyUSD;               // Collateral token
    EquiAsset public equiAsset;        // Synthetic asset (eCORECPIIndex)
    PythOracle public oracle;          // Mock price oracle

    uint256 public constant COLLATERAL_RATIO = 500; // 500%
    uint256 public constant LIQUIDATION_THRESHOLD = 150; // 150%
    uint256 public constant ASSET_DECIMAL = 1e18;
    uint256 public constant USD_DECIMAL = 1e6;             

    mapping(address => uint256) public userCollateral;
    mapping(address => uint256) public userDebt;

    event CollateralDeposited(address indexed user, uint256 amount);
    event EquiAssetMinted(address indexed user, uint256 amount);
    event EquiAssetBurned(address indexed user, uint256 amount);
    event Liquidated(address indexed user, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized);

    constructor(address _pyUSD, address _oracle) Ownable(msg.sender) {
        pyUSD = IERC20(_pyUSD);
        oracle = PythOracle(_oracle);
    }

    // Link EquiAsset contract after deployment
    function setEquiAsset(address _asset) external onlyOwner {
        equiAsset = EquiAsset(_asset);
    }

    // --------------------------
    // 1. Deposit Collateral
    // --------------------------
    function depositCollateral(uint256 amountPYUSD) external {
        require(amountPYUSD > 0, "Invalid amount");
        pyUSD.transferFrom(msg.sender, address(this), amountPYUSD);

        uint256 normalizedAmount = amountPYUSD * 1e12;

        userCollateral[msg.sender] += normalizedAmount;
        emit CollateralDeposited(msg.sender, normalizedAmount);
    }

    // --------------------------
    // 2. Mint EquiAsset (eCORECPIIndex)
    // --------------------------
    function mintEquiAsset(uint256 amountToMint) external {
        require(amountToMint > 0, "Invalid mint amount");

        uint256 assetPrice = oracle.getPrice(); // In USD, e.g., 100 * 1e18
        uint256 totalDebtAfter = userDebt[msg.sender] + amountToMint;
        uint256 requiredCollateral = (totalDebtAfter * assetPrice * COLLATERAL_RATIO) / (100 * ASSET_DECIMAL);

        require(
            userCollateral[msg.sender] >= requiredCollateral,
            "Not enough collateral"
        );

        userDebt[msg.sender] += amountToMint; // Store in EquiAsset terms
        equiAsset.mint(msg.sender, amountToMint);
        emit EquiAssetMinted(msg.sender, amountToMint);
    }

    // --------------------------
    // 3. Burn EquiAsset (Repay)
    // --------------------------
    function burnEquiAsset(uint256 amountToBurn) external {
        require(amountToBurn > 0, "Invalid burn amount");
        require(userDebt[msg.sender] >= amountToBurn, "Debt is lesser than the burn amount");

        uint256 assetPrice = oracle.getPrice();
        equiAsset.burn(msg.sender, amountToBurn);
        userDebt[msg.sender] -= amountToBurn;

        // Allow user to withdraw equivalent PYUSD
        uint256 repayValue = (amountToBurn * assetPrice) / ASSET_DECIMAL;
        uint256 collateralReleased = (repayValue * COLLATERAL_RATIO) / 100;
        userCollateral[msg.sender] -= collateralReleased;

        // denormalized the pyUSD collateral
        uint256 denormalizedCollateralReleased = collateralReleased/1e12;
        pyUSD.transfer(msg.sender, denormalizedCollateralReleased);
        emit EquiAssetBurned(msg.sender, amountToBurn);
    }

    // --------------------------
    // 4. Get Collateral Ratio (FIXED)
    // --------------------------
    function getCollateralRatio(address user) public view returns (uint256) {
        if (userDebt[user] == 0) return type(uint256).max; // Infinite ratio if no debt

        uint256 assetPrice = oracle.getPrice();
        uint256 debtValue = (userDebt[user] * assetPrice) / ASSET_DECIMAL;

        // Return ratio scaled to 1e18 (e.g., 5e18 = 500%, 1.5e18 = 150%)
        return (userCollateral[user] * 1e18) / debtValue;
    }

    // --------------------------
    // 5. Mock Liquidation Check (VERIFIED)
    // --------------------------
    function isLiquidatable(address user) public view returns (bool) {
        if (userDebt[user] == 0) return false;
        uint256 ratio = getCollateralRatio(user);
        return ratio < (LIQUIDATION_THRESHOLD * 1e16); // 150% = 1.5 * 1e18
    }

    // --------------------------
    // 6. LIQUIDATION FUNCTION
    // --------------------------
    function liquidate(address user) external {
        require(isLiquidatable(user), "User is not liquidatable");
        require(userDebt[user] > 0, "No debt to liquidate");

        uint256 assetPrice = oracle.getPrice();
        uint256 debtAmount = userDebt[user];
        uint256 debtValueInUSD = (debtAmount * assetPrice) / ASSET_DECIMAL; // in USD (1e18)
        uint256 debtValueInPYUSD = debtValueInUSD / 1e12; // normalize from 18→6 decimals

        // 🔹 Step 1: Liquidator deposits PYUSD equivalent to the oracle value of user's debt
        pyUSD.transferFrom(msg.sender, address(this), debtValueInPYUSD);

        // 🔹 Step 2: Seize Alice's collateral (entire amount)
        uint256 collateralToSeize = userCollateral[user];
        uint256 collateralToSeizeDenorm = collateralToSeize / 1e12; // convert 18→6 decimals

        require(collateralToSeizeDenorm > 0, "No collateral");

        // Transfer Alice's collateral to the liquidator
        pyUSD.transfer(msg.sender, collateralToSeizeDenorm);

        // 🔹 Step 3: Clear Alice's debt
        userCollateral[user] = 0;
        userDebt[user] = 0;

        emit Liquidated(user, msg.sender, debtAmount, collateralToSeize);
    }



    // --------------------------
    // 7. View Functions
    // --------------------------
    
    /**
     * @notice Get user's position details
     */
    function getUserPosition(address user) external view returns (
        uint256 collateral,
        uint256 debt,
        uint256 collateralRatio,
        bool liquidatable
    ) {
        collateral = userCollateral[user];
        debt = userDebt[user];
        collateralRatio = getCollateralRatio(user);
        liquidatable = isLiquidatable(user);
    }
}