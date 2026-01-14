import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
    BasketRegistry,
    BasketOracle,
    BasketVault,
    EquiBasketToken,
    BasketLiquidityPool,
} from "../typechain-types";

/**
 * EXTENDED TEST COVERAGE FOR EQUIBASKETS
 * 
 * This test file covers scenarios missing from EquiBaskets.test.ts:
 * 1. BasketLiquidityPool: removeLiquidity, collectFees, setSwapFee, previewSwapBasketForMnt
 * 2. BasketRegistry: deactivateBasket, reactivateBasket
 * 3. BasketVault: InsufficientDebt reverts, edge cases
 * 4. Additional error scenarios and boundary conditions
 * 
 * MIGRATED TO NATIVE MNT (uses msg.value instead of ERC20 MockMNT)
 */
describe("EquiBaskets Extended Test Coverage", function () {
    // Test accounts
    let deployer: Signer;
    let fundCreator: Signer;
    let user1: Signer;
    let user2: Signer;
    let liquidator: Signer;

    let deployerAddr: string;
    let fundCreatorAddr: string;
    let user1Addr: string;
    let user2Addr: string;
    let liquidatorAddr: string;

    // Contract instances
    let basketRegistry: BasketRegistry;
    let basketOracle: BasketOracle;
    let basketVault: BasketVault;
    let basketToken1: EquiBasketToken;

    const TECH_BASKET_ASSETS = ["AAPL", "NVDA", "MSFT"];
    const TECH_BASKET_WEIGHTS = [5000n, 3000n, 2000n];

    beforeEach(async function () {
        [deployer, fundCreator, user1, user2, liquidator] = await ethers.getSigners();
        deployerAddr = await deployer.getAddress();
        fundCreatorAddr = await fundCreator.getAddress();
        user1Addr = await user1.getAddress();
        user2Addr = await user2.getAddress();
        liquidatorAddr = await liquidator.getAddress();

        // Deploy BasketRegistry
        const BasketRegistry = await ethers.getContractFactory("BasketRegistry");
        basketRegistry = await BasketRegistry.deploy();
        await basketRegistry.waitForDeployment();

        // Deploy BasketOracle
        const BasketOracle = await ethers.getContractFactory("BasketOracle");
        basketOracle = await BasketOracle.deploy(await basketRegistry.getAddress());
        await basketOracle.waitForDeployment();

        // Deploy BasketVault (native MNT - no MockMNT parameter)
        const BasketVault = await ethers.getContractFactory("BasketVault");
        basketVault = await BasketVault.deploy(
            await basketRegistry.getAddress(),
            await basketOracle.getAddress()
        );
        await basketVault.waitForDeployment();
    });

    // Helper to create basket with token
    async function createBasketWithToken(
        creator: Signer,
        assets: string[],
        weights: bigint[],
        name: string,
        symbol: string
    ): Promise<{ basketId: bigint; token: EquiBasketToken }> {
        await basketRegistry.connect(creator).createBasket(assets, weights, name, symbol);
        const basketId = await basketRegistry.basketCount();

        const EquiBasketToken = await ethers.getContractFactory("EquiBasketToken");
        const token = await EquiBasketToken.deploy(
            basketId,
            name,
            symbol,
            await creator.getAddress()
        );
        await token.waitForDeployment();

        await token.connect(creator).setVault(await basketVault.getAddress());
        await basketVault.registerBasketToken(basketId, await token.getAddress());

        return { basketId, token };
    }

    // ============================================================
    // =========== LIQUIDITY POOL EXTENDED TESTS ==================
    // ============================================================

    describe("Liquidity Pool - Extended Coverage", function () {
        let techBasketId: bigint;
        let pool: BasketLiquidityPool;

        beforeEach(async function () {
            const result = await createBasketWithToken(
                fundCreator,
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
            techBasketId = result.basketId;
            basketToken1 = result.token;

            // Deploy liquidity pool (native MNT - no MockMNT parameter, only 4 args)
            const LiquidityPool = await ethers.getContractFactory("BasketLiquidityPool");
            pool = await LiquidityPool.deploy(
                await basketToken1.getAddress(),
                await basketOracle.getAddress(),
                techBasketId,
                30 // 0.30% fee
            );
            await pool.waitForDeployment();

            // Setup initial liquidity - deposit enough native MNT for CR
            // Need: 0.1 tokens * $310.5 basket price * 5 (500% CR) = $155.25 required collateral
            // At $0.50/MNT = 310.5 MNT minimum, using 400 MNT to be safe
            await basketVault.connect(fundCreator).depositCollateral(
                techBasketId,
                { value: ethers.parseEther("400") }
            );
            await basketVault.connect(fundCreator).mintBasket(techBasketId, ethers.parseEther("0.1"));

            // Add liquidity to pool with native MNT
            await basketToken1.connect(fundCreator).approve(
                await pool.getAddress(),
                ethers.parseEther("0.1")
            );
            await pool.connect(fundCreator).addLiquidity(
                ethers.parseEther("0.1"),
                { value: ethers.parseEther("50") }
            );
        });

        it("Should allow removing liquidity", async function () {
            const shares = await pool.getShares(fundCreatorAddr);
            expect(shares).to.be.gt(0);

            const mntBalanceBefore = await ethers.provider.getBalance(fundCreatorAddr);
            const basketBalanceBefore = await basketToken1.balanceOf(fundCreatorAddr);

            const tx = await pool.connect(fundCreator).removeLiquidity(shares);
            const receipt = await tx.wait();
            const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

            const mntBalanceAfter = await ethers.provider.getBalance(fundCreatorAddr);
            const basketBalanceAfter = await basketToken1.balanceOf(fundCreatorAddr);

            // Should have received tokens back (accounting for gas)
            expect(mntBalanceAfter + gasUsed).to.be.gt(mntBalanceBefore);
            expect(basketBalanceAfter).to.be.gt(basketBalanceBefore);

            // Shares should be zero
            expect(await pool.getShares(fundCreatorAddr)).to.equal(0);
        });

        it("Should reject removing more shares than owned", async function () {
            const shares = await pool.getShares(fundCreatorAddr);
            const excessShares = shares + ethers.parseEther("100");

            await expect(
                pool.connect(fundCreator).removeLiquidity(excessShares)
            ).to.be.revertedWithCustomError(pool, "InvalidShares");
        });

        it("Should reject removing zero shares", async function () {
            await expect(
                pool.connect(fundCreator).removeLiquidity(0)
            ).to.be.revertedWithCustomError(pool, "InvalidAmount");
        });

        it("Should allow owner to collect fees", async function () {
            // Generate fees via swap - pool has 0.1 basket at ~$310 = $31, keep swap small
            // 5 MNT = $2.50, which should get ~0.008 basket tokens (within pool capacity)
            await pool.connect(user1).swapMntForBasket({ value: ethers.parseEther("5") });

            const feesBefore = await pool.accumulatedFeesBasket();
            expect(feesBefore).to.be.gt(0);

            await expect(
                pool.connect(deployer).collectFees()
            ).to.emit(pool, "FeesCollected");

            // Fees should be cleared
            expect(await pool.accumulatedFeesBasket()).to.equal(0);
        });

        it("Should allow owner to update swap fee", async function () {
            const currentFee = await pool.swapFeeBps();
            expect(currentFee).to.equal(30);

            await pool.connect(deployer).setSwapFee(50);

            expect(await pool.swapFeeBps()).to.equal(50);
        });

        it("Should reject fee above 10%", async function () {
            await expect(
                pool.connect(deployer).setSwapFee(1001) // 10.01%
            ).to.be.revertedWithCustomError(pool, "FeeTooHigh");
        });

        it("Should preview basket-to-MNT swap correctly", async function () {
            const basketIn = ethers.parseEther("0.01");

            const [mntOut, fee] = await pool.previewSwapBasketForMnt(basketIn);

            expect(mntOut).to.be.gt(0);
            expect(fee).to.be.gt(0);
        });

        it("Should revert swap if pool has insufficient MNT", async function () {
            // Drain most of the pool
            const shares = await pool.getShares(fundCreatorAddr);
            await pool.connect(fundCreator).removeLiquidity(shares);

            // Mint basket tokens for user1
            await basketVault.connect(user1).depositCollateral(
                techBasketId,
                { value: ethers.parseEther("400") }
            );
            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.05"));

            const basketIn = ethers.parseEther("0.05");
            await basketToken1.connect(user1).approve(await pool.getAddress(), basketIn);

            await expect(
                pool.connect(user1).swapBasketForMnt(basketIn)
            ).to.be.revertedWithCustomError(pool, "InsufficientPoolMnt");
        });

        it("Should revert swap if pool has insufficient basket tokens", async function () {
            // Drain basket tokens from pool
            const shares = await pool.getShares(fundCreatorAddr);
            await pool.connect(fundCreator).removeLiquidity(shares);

            await expect(
                pool.connect(user1).swapMntForBasket({ value: ethers.parseEther("10") })
            ).to.be.revertedWithCustomError(pool, "InsufficientPoolBasket");
        });
    });

    // ============================================================
    // ========== BASKET REGISTRY EXTENDED TESTS ==================
    // ============================================================

    describe("Basket Registry - Deactivation/Reactivation", function () {
        let techBasketId: bigint;

        beforeEach(async function () {
            await basketRegistry.connect(fundCreator).createBasket(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
            techBasketId = await basketRegistry.basketCount();
        });

        it("Should allow creator to deactivate basket", async function () {
            expect(await basketRegistry.isBasketActive(techBasketId)).to.equal(true);

            await expect(
                basketRegistry.connect(fundCreator).deactivateBasket(techBasketId)
            ).to.emit(basketRegistry, "BasketActiveStateChanged")
                .withArgs(techBasketId, false);

            expect(await basketRegistry.isBasketActive(techBasketId)).to.equal(false);
        });

        it("Should allow owner to deactivate basket", async function () {
            await expect(
                basketRegistry.connect(deployer).deactivateBasket(techBasketId)
            ).to.emit(basketRegistry, "BasketActiveStateChanged")
                .withArgs(techBasketId, false);

            expect(await basketRegistry.isBasketActive(techBasketId)).to.equal(false);
        });

        it("Should reject deactivation by non-creator/non-owner", async function () {
            await expect(
                basketRegistry.connect(user1).deactivateBasket(techBasketId)
            ).to.be.revertedWithCustomError(basketRegistry, "NotBasketCreator");
        });

        it("Should allow reactivating a deactivated basket", async function () {
            await basketRegistry.connect(fundCreator).deactivateBasket(techBasketId);
            expect(await basketRegistry.isBasketActive(techBasketId)).to.equal(false);

            await expect(
                basketRegistry.connect(fundCreator).reactivateBasket(techBasketId)
            ).to.emit(basketRegistry, "BasketActiveStateChanged")
                .withArgs(techBasketId, true);

            expect(await basketRegistry.isBasketActive(techBasketId)).to.equal(true);
        });

        it("Should prevent minting from deactivated basket", async function () {
            const result = await createBasketWithToken(
                fundCreator,
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants 2",
                "eTECH2"
            );
            techBasketId = result.basketId;

            // Deposit collateral with native MNT
            await basketVault.connect(user1).depositCollateral(
                techBasketId,
                { value: ethers.parseEther("400") }
            );

            // Deactivate basket
            await basketRegistry.connect(fundCreator).deactivateBasket(techBasketId);

            // Try to mint - should fail
            await expect(
                basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"))
            ).to.be.revertedWithCustomError(basketVault, "BasketNotActive");
        });
    });

    // ============================================================
    // ============ BASKET VAULT EXTENDED TESTS ===================
    // ============================================================

    describe("Basket Vault - Edge Cases", function () {
        let techBasketId: bigint;

        beforeEach(async function () {
            const result = await createBasketWithToken(
                fundCreator,
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
            techBasketId = result.basketId;
            basketToken1 = result.token;

            // Deposit native MNT and mint
            await basketVault.connect(user1).depositCollateral(
                techBasketId,
                { value: ethers.parseEther("400") }
            );
            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));
        });

        it("Should reject burning more than user's debt", async function () {
            const userDebt = await basketVault.userDebt(user1Addr, techBasketId);
            const excessiveBurn = userDebt + ethers.parseEther("1");

            await expect(
                basketVault.connect(user1).burnBasket(techBasketId, excessiveBurn)
            ).to.be.revertedWithCustomError(basketVault, "InsufficientDebt");
        });

        it("Should reject withdrawing more collateral than available", async function () {
            const userCollateral = await basketVault.userCollateral(user1Addr, techBasketId);
            const excessWithdraw = userCollateral + ethers.parseEther("1");

            await expect(
                basketVault.connect(user1).withdrawCollateral(techBasketId, excessWithdraw)
            ).to.be.revertedWithCustomError(basketVault, "InsufficientCollateral");
        });

        it("Should calculate max mintable correctly", async function () {
            const maxMintable = await basketVault.getMaxMintable(user1Addr, techBasketId);
            expect(maxMintable).to.be.gt(0);
        });

        it("Should return zero max mintable with no collateral", async function () {
            const maxMintable = await basketVault.getMaxMintable(user2Addr, techBasketId);
            expect(maxMintable).to.equal(0);
        });

        it("Should allow setting liquidator address", async function () {
            expect(await basketVault.liquidator()).to.equal(ethers.ZeroAddress);

            await expect(
                basketVault.connect(deployer).setLiquidator(liquidatorAddr)
            ).to.emit(basketVault, "LiquidatorUpdated")
                .withArgs(ethers.ZeroAddress, liquidatorAddr);

            expect(await basketVault.liquidator()).to.equal(liquidatorAddr);
        });

        it("Should track user positions correctly", async function () {
            const position = await basketVault.getUserPosition(user1Addr, techBasketId);

            expect(position.collateral).to.equal(ethers.parseEther("400"));
            expect(position.debt).to.equal(ethers.parseEther("0.1"));
            expect(position.collateralRatio).to.be.gt(0);
            expect(position.liquidatable).to.equal(false);
        });

        it("Should handle partial burns correctly", async function () {
            const initialDebt = await basketVault.userDebt(user1Addr, techBasketId);
            const burnAmount = initialDebt / 2n;

            await basketVault.connect(user1).burnBasket(techBasketId, burnAmount);

            const remainingDebt = await basketVault.userDebt(user1Addr, techBasketId);
            expect(remainingDebt).to.be.closeTo(
                initialDebt - burnAmount,
                ethers.parseEther("0.0001")
            );
        });
    });

    // ============================================================
    // ============= ORACLE FUNCTION COVERAGE =====================
    // ============================================================

    describe("Basket Oracle - Utility Functions", function () {
        it("Should calculate MNT value correctly", async function () {
            const mntAmount = ethers.parseEther("100");
            const mntValue = await basketOracle.getMntValue(mntAmount);

            // MNT price is $0.50, so 100 MNT = $50
            expect(mntValue).to.equal(ethers.parseEther("50"));
        });

        it("Should convert USD value to MNT amount", async function () {
            const usdValue = ethers.parseEther("50");
            const mntAmount = await basketOracle.getMntFromUsdValue(usdValue);

            // $50 / $0.50 = 100 MNT
            expect(mntAmount).to.equal(ethers.parseEther("100"));
        });

        it("Should handle zero amounts", async function () {
            expect(await basketOracle.getMntValue(0)).to.equal(0);
            expect(await basketOracle.getMntFromUsdValue(0)).to.equal(0);
        });
    });
});
