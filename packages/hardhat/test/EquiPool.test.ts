import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import type { EquiPool } from "../typechain-types/contracts/EquiPool";
import type { EquiAsset } from "../typechain-types/contracts/EquiAsset";
import type { EquiVault } from "../typechain-types/contracts/EquiVault";
import type { MockOracle } from "../typechain-types/contracts/mocks/MockOracle";
import type { Contract } from "ethers";

/**
 * COMPREHENSIVE TEST COVERAGE FOR EQUIPOOL
 * 
 * EquiPool is the legacy single-asset liquidity pool contract (PYUSD ↔ EquiAsset).
 * This test suite provides coverage for pool swap functions using EquiVault for minting.
 * 
 * Note: EquiPool is a simple liquidity pool that expects users to have EquiAssets already.
 * In production, users would get EquiAssets from EquiVault by depositing collateral.
 */
describe("EquiPool - Swap Test Coverage", function () {
    let owner: Signer;
    let user: Signer;

    let ownerAddr: string;
    let userAddr: string;

    let pyUSD: Contract;
    let equiAsset: EquiAsset;
    let vault: EquiVault;
    let oracle: MockOracle;
    let pool: EquiPool;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();
        ownerAddr = await owner.getAddress();
        userAddr = await user.getAddress();

        // Deploy mock PYUSD (6 decimals)
        const MockPyUSD = await ethers.getContractFactory("MockPyUSD");
        pyUSD = (await MockPyUSD.deploy()) as unknown as Contract;
        await pyUSD.waitForDeployment();

        // Deploy Oracle and set price to $100
        const MockOracle = await ethers.getContractFactory("MockOracle");
        oracle = (await MockOracle.deploy()) as unknown as MockOracle;
        await oracle.waitForDeployment();
        await oracle.setPrice(ethers.parseUnits("100", 18)); // $100 per EquiAsset

        // Deploy EquiAsset
        const EquiAsset = await ethers.getContractFactory("EquiAsset");
        equiAsset = (await EquiAsset.deploy()) as unknown as EquiAsset;
        await equiAsset.waitForDeployment();

        // Deploy EquiVault (needed to mint EquiAssets)
        const EquiVault = await ethers.getContractFactory("EquiVault");
        vault = (await EquiVault.deploy(
            await pyUSD.getAddress(),
            await oracle.getAddress()
        )) as unknown as EquiVault;
        await vault.waitForDeployment();

        // Link vault and asset
        await equiAsset.setVault(await vault.getAddress());
        await vault.setEquiAsset(await equiAsset.getAddress());

        // Deploy EquiPool
        const EquiPool = await ethers.getContractFactory("EquiPool");
        pool = (await EquiPool.deploy(
            await pyUSD.getAddress(),
            await equiAsset.getAddress(),
            await oracle.getAddress()
        )) as unknown as EquiPool;
        await pool.waitForDeployment();

        // Mint PYUSD to accounts
        await (pyUSD as any).mint(ownerAddr, ethers.parseUnits("100000", 6));
        await (pyUSD as any).mint(userAddr, ethers.parseUnits("100000", 6));

        // Owner mints some EquiAssets via vault for pool liquidity
        await (pyUSD as any).connect(owner).approve(vault, ethers.parseUnits("50000", 6));
        await vault.connect(owner).depositCollateral(ethers.parseUnits("50000", 6));
        await vault.connect(owner).mintEquiAsset(ethers.parseUnits("50", 18)); // Mint 50 assets

        // Owner adds liquidity to pool
        await (pyUSD as any).connect(owner).approve(await pool.getAddress(), ethers.parseUnits("10000", 6));
        await equiAsset.connect(owner).approve(await pool.getAddress(), ethers.parseUnits("50", 18));
        await pool.connect(owner).addLiquidity(
            ethers.parseUnits("10000", 6),
            ethers.parseUnits("50", 18)
        );
    });

    describe("PYUSD → EquiAsset Swaps", function () {
        it("Should swap PYUSD for EquiAsset correctly", async function () {
            const pyusdIn = ethers.parseUnits("100", 6); // 100 PYUSD

            // Oracle price is $100, so 100 PYUSD should get 1 EquiAsset
            const expectedAssetOut = ethers.parseUnits("1", 18);

            await (pyUSD as any).connect(user).approve(await pool.getAddress(), pyusdIn);

            const assetBalanceBefore = await equiAsset.balanceOf(userAddr);

            await pool.connect(user).swapPYUSDForAsset(pyusdIn);

            const assetBalanceAfter = await equiAsset.balanceOf(userAddr);
            const assetReceived = assetBalanceAfter - assetBalanceBefore;

            expect(assetReceived).to.equal(expectedAssetOut);
        });

        it("Should update pool balances after swap", async function () {
            const pyusdIn = ethers.parseUnits("100", 6);

            const poolPyusdBefore = await pool.pyUSDBalance();
            const poolAssetBefore = await pool.assetBalance();

            await (pyUSD as any).connect(user).approve(await pool.getAddress(), pyusdIn);
            await pool.connect(user).swapPYUSDForAsset(pyusdIn);

            expect(await pool.pyUSDBalance()).to.equal(poolPyusdBefore + pyusdIn);
            expect(await pool.assetBalance()).to.be.lt(poolAssetBefore);
        });

        it("Should reject swap with zero amount", async function () {
            await expect(
                pool.connect(user).swapPYUSDForAsset(0)
            ).to.be.revertedWith("Invalid amount");
        });

        it("Should handle price changes from oracle", async function () {
            // Initial swap at $100
            await (pyUSD as any).connect(user).approve(
                await pool.getAddress(),
                ethers.parseUnits("100", 6)
            );
            await pool.connect(user).swapPYUSDForAsset(ethers.parseUnits("100", 6));

            // Change oracle price to $200
            await oracle.setPrice(ethers.parseUnits("200", 18));

            // Now 100 PYUSD should only get 0.5 EquiAsset
            await (pyUSD as any).connect(user).approve(
                await pool.getAddress(),
                ethers.parseUnits("100", 6)
            );

            const assetBefore = await equiAsset.balanceOf(userAddr);
            await pool.connect(user).swapPYUSDForAsset(ethers.parseUnits("100", 6));
            const assetAfter = await equiAsset.balanceOf(userAddr);

            expect(assetAfter - assetBefore).to.equal(ethers.parseUnits("0.5", 18));
        });
    });

    describe("EquiAsset → PYUSD Swaps", function () {
        it("Should swap EquiAsset for PYUSD correctly", async function () {
            // First get some EquiAssets by buying them
            await (pyUSD as any).connect(user).approve(await pool.getAddress(), ethers.parseUnits("100", 6));
            await pool.connect(user).swapPYUSDForAsset(ethers.parseUnits("100", 6));

            const userAssets = await equiAsset.balanceOf(userAddr);
            expect(userAssets).to.be.gt(0);

            const assetIn = ethers.parseUnits("0.5", 18); // 0.5 EquiAsset

            // Oracle price is $100, so 0.5 EquiAsset should get 50 PYUSD
            const expectedPyusdOut = ethers.parseUnits("50", 6);

            await equiAsset.connect(user).approve(await pool.getAddress(), assetIn);

            const pyusdBalanceBefore = await (pyUSD as any).balanceOf(userAddr);

            await pool.connect(user).swapAssetForPYUSD(assetIn);

            const pyusdBalanceAfter = await (pyUSD as any).balanceOf(userAddr);
            const pyusdReceived = pyusdBalanceAfter - pyusdBalanceBefore;

            expect(pyusdReceived).to.equal(expectedPyusdOut);
        });

        it("Should update pool balances correctly", async function () {
            // Get some assets first
            await (pyUSD as any).connect(user).approve(await pool.getAddress(), ethers.parseUnits("100", 6));
            await pool.connect(user).swapPYUSDForAsset(ethers.parseUnits("100", 6));

            const assetIn = ethers.parseUnits("0.5", 18);

            const poolPyusdBefore = await pool.pyUSDBalance();
            const poolAssetBefore = await pool.assetBalance();

            await equiAsset.connect(user).approve(await pool.getAddress(), assetIn);
            await pool.connect(user).swapAssetForPYUSD(assetIn);

            expect(await pool.assetBalance()).to.equal(poolAssetBefore + assetIn);
            expect(await pool.pyUSDBalance()).to.be.lt(poolPyusdBefore);
        });
    });

    describe("View Functions", function () {
        it("Should return correct reserves", async function () {
            const [pyusdReserve, assetReserve] = await pool.getReserves();

            expect(pyusdReserve).to.equal(ethers.parseUnits("10000", 6));
            expect(assetReserve).to.equal(ethers.parseUnits("50", 18));
        });

        it("Should return oracle price", async function () {
            const oraclePrice = await pool.getOraclePrice();
            expect(oraclePrice).to.equal(ethers.parseUnits("100", 18));
        });
    });
});
