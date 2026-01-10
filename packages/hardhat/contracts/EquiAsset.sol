// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EquiAsset is ERC20, Ownable {
    address public vault;

    constructor() ERC20("United States Core Consumer Price Index", "eCORECPIIndex") Ownable(msg.sender) {}

    modifier onlyVault() {
        require(msg.sender == vault, "Only Vault");
        _;
    }

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    // Called by Vault during mint
    function mint(address user, uint256 amount) external onlyVault {
        _mint(user, amount);
    }

    // Called by Vault during burn
    function burn(address user, uint256 amount) external onlyVault {
        _burn(user, amount);
    }
}