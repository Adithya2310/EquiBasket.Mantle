// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

contract PythOracle {
    IPyth pyth;
    bytes32 priceId;

    constructor(address _pyth, bytes32 _priceId) {
        pyth = IPyth(_pyth);
        priceId = _priceId;
    }

    // Get the current price scaled to 1e18
    function getPrice() public view returns (uint256) {
        PythStructs.Price memory priceInfo = pyth.getPriceNoOlderThan(priceId, 300);

        // Convert Pyth price (price, expo) to 1e18-scaled uint256
        int256 price = int256(priceInfo.price);
        int32 expo = priceInfo.expo; // price is price * 10^expo

        require(price > 0, "Negative price");

        // We want: scaled = price * 10^(expo + 18)
        int32 power = expo + 18; // can be negative or positive
        int256 scaled;
        if (power >= 0) {
            scaled = price * (int256(10) ** uint256(uint32(power)));
        } else {
            scaled = price / (int256(10) ** uint256(uint32(-power)));
        }

        require(scaled > 0, "Scaled price <= 0");
        return uint256(scaled);
    }

    // Update the price feed. Any excess msg.value is refunded back to the caller.
    function updatePrice(bytes[] memory pythPriceUpdate) public payable {
        uint256 updateFee = pyth.getUpdateFee(pythPriceUpdate);
        require(msg.value >= updateFee, "Insufficient fee");
        pyth.updatePriceFeeds{value: updateFee}(pythPriceUpdate);
        if (msg.value > updateFee) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - updateFee}("");
            require(ok, "Refund failed");
        }
    }

    // Update the price feed and get the updated price (1e18-scaled)
    function UpdateAndGetPrice(bytes[] memory pythPriceUpdate) public payable returns (uint256) {
        updatePrice(pythPriceUpdate);
        return getPrice();
    }

    // Expose the price feed id
    function getPriceId() external view returns (bytes32) {
        return priceId;
    }

    // Helper to compute the update fee for a given update payload
    function getUpdateFee(bytes[] memory pythPriceUpdate) external view returns (uint256) {
        return pyth.getUpdateFee(pythPriceUpdate);
    }
}
