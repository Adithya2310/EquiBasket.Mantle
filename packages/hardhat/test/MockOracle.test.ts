import { expect } from "chai";
import { ethers } from "hardhat";
import type { MockOracle } from "../typechain-types/contracts/MockOracle";

describe("MockOracle unit test", function () {
  let oracle: MockOracle;

  beforeEach(async function () {
    const MockOracleFactory = await ethers.getContractFactory("MockOracle");
    oracle = (await MockOracleFactory.deploy()) as MockOracle;
    await oracle.waitForDeployment();
  });

  it("Should set and get price correctly", async function () {
    const newPrice = ethers.parseUnits("123.45", 18);
    await oracle.setPrice(newPrice);
    expect(await oracle.getPrice()).to.equal(newPrice);
  });
});
