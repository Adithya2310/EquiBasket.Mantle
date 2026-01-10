// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockOracle
 * @notice Simple mock oracle for testing single-asset price feeds
 * @dev Used in legacy tests. For basket pricing, use BasketOracle instead.
 *      Price is stored in 1e18 format (e.g., $100 = 100 * 1e18)
 */
contract MockOracle {
    uint256 private _price;

    /**
     * @notice Set the mock price
     * @param newPrice Price in 1e18 format
     */
    function setPrice(uint256 newPrice) external {
        _price = newPrice;
    }

    /**
     * @notice Get the current price
     * @return Price in 1e18 format
     */
    function getPrice() external view returns (uint256) {
        return _price;
    }
}
