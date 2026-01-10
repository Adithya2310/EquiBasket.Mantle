// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockMNT
 * @notice Mock MNT token for testing purposes
 * @dev Simulates MNT (Mantle native token) with 18 decimals
 *      Used as collateral in the EquiBaskets system
 */
contract MockMNT is ERC20 {
    constructor() ERC20("Mock Mantle Token", "MNT") {}

    /**
     * @notice Mint tokens to an address (for testing only)
     * @param to Recipient address
     * @param amount Amount to mint (in 18 decimals)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an address (for testing only)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
