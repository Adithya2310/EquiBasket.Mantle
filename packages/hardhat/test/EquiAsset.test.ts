import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { EquiAsset } from "../typechain-types";

describe("EquiAsset unit test", function () {
  let vault: Signer, user: Signer;
  let equiAsset: EquiAsset;

  beforeEach(async function () {
    [, vault, user] = await ethers.getSigners();

    const EquiAssetFactory = await ethers.getContractFactory("EquiAsset");
    equiAsset = (await EquiAssetFactory.deploy()) as EquiAsset;
    await equiAsset.waitForDeployment();

    await equiAsset.setVault(await vault.getAddress());
  });

  it("Only vault can mint or burn", async function () {
    const amount = ethers.parseUnits("1", 18);

    // Non-vault should revert
    await expect(equiAsset.connect(user).mint(await user.getAddress(), amount)).to.be.revertedWith("Only Vault");

    // Vault can mint successfully
    await expect(equiAsset.connect(vault).mint(await user.getAddress(), amount)).to.not.be.reverted;
  });
});
