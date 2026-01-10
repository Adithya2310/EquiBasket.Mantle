// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockPyUSD
 * @notice Mock PYUSD stablecoin for legacy testing
 * @dev Uses 6 decimals like the real PYUSD
 *      DEPRECATED: Kept for backward compatibility with legacy tests
 */
contract MockPyUSD is ERC20 {
    constructor() ERC20("Mock PYUSD", "PYUSD") {}

    /**
     * @notice Returns the number of decimals (6 for PYUSD)
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Mint tokens to an address (for testing only)
     * @param to Recipient address
     * @param amount Amount to mint (in 6 decimals)
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
