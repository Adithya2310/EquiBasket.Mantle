import { expect } from "chai";
import { ethers, network } from "hardhat";
import { HermesClient } from "@pythnetwork/hermes-client";
import { BasketOracle } from "../typechain-types";

// Pyth Mantle Sepolia address baked into BasketOracle
const PYTH_ADDRESS = "0x98046Bd286715D3B0BC227Dd7a956b83D8978603";
const BTC_FEED_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

describe("BasketOracle Pyth debug helper (integration)", function () {
  let oracle: BasketOracle;

  beforeEach(async function () {
    // This test is meant to run against Mantle Sepolia (or a fork). Skip on local hardhat.
    if (network.name === "hardhat") {
      this.skip();
    }

    const [deployer] = await ethers.getSigners();

    // Deploy BasketOracle (constructor wires to the hardcoded Pyth address above)
    const BasketOracleFactory = await ethers.getContractFactory("BasketOracle");
    oracle = (await BasketOracleFactory.deploy(deployer.address)) as BasketOracle;

    // Sanity check it points to expected Pyth address
    const pythAddress = await oracle.pyth();
    expect(pythAddress).to.equal(PYTH_ADDRESS);
  });

  it("pulls live Pyth data and exposes it via getAssetPriceDebug", async function () {
    if (network.name === "hardhat") {
      this.skip();
    }

    const hermes = new HermesClient("https://hermes.pyth.network");
    const priceUpdates = await hermes.getLatestPriceUpdates([BTC_FEED_ID], {
      encoding: "hex",
      ignoreInvalidPriceIds: false,
    });
    const updatePayloads = priceUpdates.binary.data.map(
      d => (d.startsWith("0x") || d.startsWith("0X") ? d : `0x${d}`) as `0x${string}`,
    );

    const fee = await oracle.getPythUpdateFee(updatePayloads);
    const tx = await oracle.updatePriceFeeds(updatePayloads, { value: fee });
    await tx.wait();

    const [scaledPrice, rawPrice, expo, conf, publishTime] = await oracle.getAssetPriceDebug("BTC");

    expect(typeof rawPrice).to.equal("bigint");
    expect(rawPrice).to.not.equal(0n);
    expect(scaledPrice).to.be.gt(0n);
    expect(publishTime).to.be.gt(0n);
    // Basic scale sanity: expo + 18 adjustment handled in helper
    expect(typeof expo).to.equal("bigint");
    expect(typeof conf).to.equal("bigint");
    expect(conf).to.be.gt(0n);
  });
});
