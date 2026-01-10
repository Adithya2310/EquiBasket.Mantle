import { expect } from "chai";
import { ethers } from "hardhat";
import type { EquiVault } from "../typechain-types/contracts/EquiVault";
import type { EquiAsset } from "../typechain-types/contracts/EquiAsset";
import type { MockOracle } from "../typechain-types/contracts/mocks/MockOracle";
import type { Contract } from "ethers";

describe("EquiVault full integration test", function () {
  let user: any;
  let pyUSD: Contract, oracle: MockOracle, equiAsset: EquiAsset, vault: EquiVault;

  beforeEach(async function () {
    [user] = await ethers.getSigners();

    // Deploy mock stablecoin (6 decimals)
    const MockPyUSD = await ethers.getContractFactory("MockPyUSD");
    // const initialSupply = ethers.parseUnits("1000000", 6); // 1,000,000 pyUSD
    pyUSD = (await MockPyUSD.deploy()) as unknown as Contract;
    await pyUSD.waitForDeployment();

    // Deploy oracle and set price = 100 * 1e18 (e.g. $100)
    const MockOracleF = await ethers.getContractFactory("MockOracle");
    oracle = (await MockOracleF.deploy()) as unknown as MockOracle;
    await oracle.waitForDeployment();
    await oracle.setPrice(ethers.parseUnits("100", 18));

    // Deploy EquiAsset
    const EquiAssetF = await ethers.getContractFactory("EquiAsset");
    equiAsset = (await EquiAssetF.deploy()) as unknown as EquiAsset;
    await equiAsset.waitForDeployment();

    // Deploy Vault
    const EquiVaultF = await ethers.getContractFactory("EquiVault");
    const pyUSDAddress = await pyUSD.getAddress();
    const oracleAddress = await oracle.getAddress();
    vault = (await EquiVaultF.deploy(pyUSDAddress, oracleAddress)) as unknown as EquiVault;
    await vault.waitForDeployment();

    // Connect vault <-> asset
    const assetAddress = await equiAsset.getAddress();
    const vaultAddress = await vault.getAddress();
    await vault.setEquiAsset(assetAddress);
    await equiAsset.setVault(vaultAddress);

    // Give user 100 pyUSD
    const userAmount = ethers.parseUnits("100", 6);
    await (pyUSD as any).mint(user.address, userAmount);
  });

  it("User can deposit pyUSD and vault tracks normalized collateral", async function () {
    const amount = ethers.parseUnits("100", 6); // 100 pyUSD
    await (pyUSD as any).connect(user).approve(vault, amount);
    await expect(vault.connect(user).depositCollateral(amount)).to.not.be.reverted;

    const stored = await vault.userCollateral(user.address);
    expect(stored).to.equal(ethers.parseUnits("100", 18)); // normalized to 18 decimals
  });

  it("User cannot mint more than collateral allows", async function () {
    const amount = ethers.parseUnits("100", 6);
    await (pyUSD as any).connect(user).approve(vault, amount);
    await vault.connect(user).depositCollateral(amount);

    const tooMuch = ethers.parseUnits("1", 18); // 1 eCORECPIIndex
    await expect(vault.connect(user).mintEquiAsset(tooMuch)).to.be.revertedWith("Not enough collateral");
  });

  it("User can mint within limits and burn successfully", async function () {
    const amount = ethers.parseUnits("100", 6);
    await (pyUSD as any).connect(user).approve(vault, amount);
    await vault.connect(user).depositCollateral(amount);

    const ratioBefore = await vault.getCollateralRatio(user.address);
    expect(ratioBefore).to.be.gt(0);

    const mintAmount = ethers.parseUnits("0.1", 18);
    await expect(vault.connect(user).mintEquiAsset(mintAmount)).to.not.be.reverted;

    const ratioAfter = await vault.getCollateralRatio(user.address);
    expect(ratioAfter).to.be.lt(ratioBefore); // minting reduces collateral ratio

    const bal = await equiAsset.balanceOf(user.address);
    expect(bal).to.equal(mintAmount);

    // Burn and repay
    await expect(vault.connect(user).burnEquiAsset(mintAmount)).to.not.be.reverted;
    expect(await equiAsset.balanceOf(user.address)).to.equal(0);
  });

  it("User becomes liquidatable after price rise", async function () {
    const amount = ethers.parseUnits("100", 6);
    await (pyUSD as any).connect(user).approve(vault, amount);
    await vault.connect(user).depositCollateral(amount);

    const mintAmount = ethers.parseUnits("0.1", 18);
    await vault.connect(user).mintEquiAsset(mintAmount);

    const liquidBefore = await vault.isLiquidatable(user.address);
    expect(liquidBefore).to.equal(false);

    // Increase oracle price dramatically
    await oracle.setPrice(ethers.parseUnits("1000", 18));

    const liquidAfter = await vault.isLiquidatable(user.address);
    expect(liquidAfter).to.equal(true);
  });

  it("Should execute liquidation and clear user position", async function () {
    const [liquidator] = await ethers.getSigners();

    // Setup: User deposits and mints, then becomes liquidatable
    const amount = ethers.parseUnits("100", 6);
    await (pyUSD as any).connect(user).approve(vault, amount);
    await vault.connect(user).depositCollateral(amount);

    const mintAmount = ethers.parseUnits("0.1", 18);
    await vault.connect(user).mintEquiAsset(mintAmount);

    // Make user liquidatable by increasing asset price
    await oracle.setPrice(ethers.parseUnits("1000", 18));

    expect(await vault.isLiquidatable(user.address)).to.equal(true);

    // Get user's position before liquidation
    const collateralBefore = await vault.userCollateral(user.address);
    const debtBefore = await vault.userDebt(user.address);

    expect(collateralBefore).to.be.gt(0);
    expect(debtBefore).to.be.gt(0);

    // Prepare liquidator with PYUSD
    await (pyUSD as any).mint(liquidator.address, ethers.parseUnits("10000", 6));
    await (pyUSD as any).connect(liquidator).approve(vault, ethers.parseUnits("10000", 6));

    const liquidatorPyusdBefore = await (pyUSD as any).balanceOf(liquidator.address);

    // Execute liquidation
    await expect(
      vault.connect(liquidator).liquidate(user.address)
    ).to.emit(vault, "Liquidated");

    // Verify user's position is cleared
    expect(await vault.userCollateral(user.address)).to.equal(0);
    expect(await vault.userDebt(user.address)).to.equal(0);

    // Verify liquidator received collateral
    const liquidatorPyusdAfter = await (pyUSD as any).balanceOf(liquidator.address);

    // Liquidator paid debt and received collateral
    // Since position is severely underwater (CR < 150%), liquidator should profit
    // The collateral seized should be more valuable than debt paid
    expect(liquidatorPyusdAfter).to.be.gt(liquidatorPyusdBefore - ethers.parseUnits("100", 6));
  });
});
