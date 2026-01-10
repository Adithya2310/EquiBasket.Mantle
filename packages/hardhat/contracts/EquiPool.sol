// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PythOracle.sol";


contract EquiPool is Ownable {
    IERC20 public pyUSD;        // PYUSD stablecoin (6 decimals)
    IERC20 public equiAsset;    // EquiAsset (18 decimals)
    PythOracle public oracle;   // Oracle providing price of 1 EquiAsset in USD

    uint256 public constant USD_DECIMALS = 1e6;  // PYUSD decimals
    uint256 public constant ASSET_DECIMALS = 1e18; // EquiAsset decimals

    uint256 public pyUSDBalance;
    uint256 public assetBalance;

    constructor(address _pyUSD, address _equiAsset, address _oracle) Ownable(msg.sender) {
        pyUSD = IERC20(_pyUSD);
        equiAsset = IERC20(_equiAsset);
        oracle = PythOracle(_oracle);
    }

    // -----------------------
    // 1️⃣ Add Liquidity
    // -----------------------
    function addLiquidity(uint256 amountPYUSD, uint256 amountAsset) external {
        require(amountPYUSD > 0 && amountAsset > 0, "Invalid liquidity amounts");

        pyUSD.transferFrom(msg.sender, address(this), amountPYUSD);
        equiAsset.transferFrom(msg.sender, address(this), amountAsset);

        pyUSDBalance += amountPYUSD;
        assetBalance += amountAsset;
    }

    // -----------------------
    // 2️⃣ Remove Liquidity
    // -----------------------
    function removeLiquidity(uint256 pyUSDOut, uint256 assetOut) external onlyOwner {
        require(pyUSDOut <= pyUSDBalance && assetOut <= assetBalance, "Invalid withdrawal");

        pyUSDBalance -= pyUSDOut;
        assetBalance -= assetOut;

        pyUSD.transfer(msg.sender, pyUSDOut);
        equiAsset.transfer(msg.sender, assetOut);
    }

    // -----------------------
    // 3️⃣ Swap PYUSD → eAsset using Oracle price
    // -----------------------
    function swapPYUSDForAsset(uint256 amountPYUSDIn) external {
        require(amountPYUSDIn > 0, "Invalid amount");

        uint256 price = oracle.getPrice(); // 1 eCORECPIIndex price in USD (1e18)
        // Correct conversion
        uint256 assetOut = (amountPYUSDIn * ASSET_DECIMALS * 1e18) / price / USD_DECIMALS;

        require(assetOut <= assetBalance, "Insufficient pool liquidity");

        pyUSD.transferFrom(msg.sender, address(this), amountPYUSDIn);
        equiAsset.transfer(msg.sender, assetOut);

        pyUSDBalance += amountPYUSDIn;
        assetBalance -= assetOut;
    }


    // -----------------------
    // 4️⃣ Swap eAsset → PYUSD using Oracle price
    // -----------------------
    function swapAssetForPYUSD(uint256 amountAssetIn) external {
        require(amountAssetIn > 0, "Invalid amount");

        uint256 price = oracle.getPrice(); // 1 eCORECPIIndex price in USD (1e18)
        // Convert eAsset (18 decimals) → USD → PYUSD (6 decimals)
        uint256 pyUSDOut = (amountAssetIn * price * USD_DECIMALS) / (ASSET_DECIMALS * 1e18);

        require(pyUSDOut <= pyUSDBalance, "Insufficient pool liquidity");

        equiAsset.transferFrom(msg.sender, address(this), amountAssetIn);
        pyUSD.transfer(msg.sender, pyUSDOut);

        assetBalance += amountAssetIn;
        pyUSDBalance -= pyUSDOut;
    }


    // -----------------------
    // 5️⃣ View Helpers
    // -----------------------
    function getReserves() external view returns (uint256, uint256) {
        return (pyUSDBalance, assetBalance);
    }

    function getOraclePrice() external view returns (uint256) {
        return oracle.getPrice();
    }
}