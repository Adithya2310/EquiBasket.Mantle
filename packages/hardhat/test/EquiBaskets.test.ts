import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
    BasketRegistry,
    BasketOracle,
    BasketVault,
    EquiBasketToken,
    BasketLiquidityPool,
    MockMNT,
} from "../typechain-types";

/**
 * EquiBaskets End-to-End Test Suite
 * 
 * This test suite validates the complete lifecycle of the EquiBaskets system:
 * - Basket creation by fund creators
 * - Correct basket price calculation from multiple assets
 * - Depositing MNT collateral
 * - Minting basket tokens with proper collateral ratio
 * - Trading basket tokens via liquidity pool
 * - Collateral ratio updates when asset prices change
 * - Basket-specific liquidation triggering
 * - Partial and full liquidation scenarios
 * - Multiple baskets per user without interference
 * 
 * All tests use mock price feeds and are deterministic.
 */
describe("EquiBaskets End-to-End Tests", function () {
    // ============================================================
    // ====================== TEST ACCOUNTS =======================
    // ============================================================

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

    // ============================================================
    // ======================= CONTRACTS ==========================
    // ============================================================

    let mockMnt: MockMNT;
    let basketRegistry: BasketRegistry;
    let basketOracle: BasketOracle;
    let basketVault: BasketVault;
    let basketToken1: EquiBasketToken;
    let basketToken2: EquiBasketToken;
    let liquidityPool: BasketLiquidityPool;

    // ============================================================
    // ======================= CONSTANTS ==========================
    // ============================================================

    const PRECISION = ethers.parseEther("1"); // 1e18
    const COLLATERAL_RATIO = 500n; // 500%
    const LIQUIDATION_THRESHOLD = 150n; // 150%

    // Sample basket configurations
    const TECH_BASKET_ASSETS = ["AAPL", "NVDA", "MSFT"];
    const TECH_BASKET_WEIGHTS = [5000n, 3000n, 2000n]; // 50%, 30%, 20%

    const COMMODITY_BASKET_ASSETS = ["GOLD", "SILVER"];
    const COMMODITY_BASKET_WEIGHTS = [7000n, 3000n]; // 70%, 30%

    // ============================================================
    // ====================== SETUP HOOKS =========================
    // ============================================================

    beforeEach(async function () {
        // Get signers
        [deployer, fundCreator, user1, user2, liquidator] = await ethers.getSigners();
        deployerAddr = await deployer.getAddress();
        fundCreatorAddr = await fundCreator.getAddress();
        user1Addr = await user1.getAddress();
        user2Addr = await user2.getAddress();
        liquidatorAddr = await liquidator.getAddress();

        // Deploy MockMNT
        const MockMNT = await ethers.getContractFactory("MockMNT");
        mockMnt = await MockMNT.deploy();
        await mockMnt.waitForDeployment();

        // Deploy BasketRegistry
        const BasketRegistry = await ethers.getContractFactory("BasketRegistry");
        basketRegistry = await BasketRegistry.deploy();
        await basketRegistry.waitForDeployment();

        // Deploy BasketOracle
        const BasketOracle = await ethers.getContractFactory("BasketOracle");
        basketOracle = await BasketOracle.deploy(await basketRegistry.getAddress());
        await basketOracle.waitForDeployment();

        // Deploy BasketVault
        const BasketVault = await ethers.getContractFactory("BasketVault");
        basketVault = await BasketVault.deploy(
            await mockMnt.getAddress(),
            await basketRegistry.getAddress(),
            await basketOracle.getAddress()
        );
        await basketVault.waitForDeployment();

        // Mint MNT to users for testing
        const mintAmount = ethers.parseEther("10000"); // 10,000 MNT each
        await mockMnt.mint(user1Addr, mintAmount);
        await mockMnt.mint(user2Addr, mintAmount);
        await mockMnt.mint(liquidatorAddr, mintAmount);
        await mockMnt.mint(fundCreatorAddr, mintAmount);
    });

    // ============================================================
    // ============= HELPER FUNCTIONS =============================
    // ============================================================

    /**
     * Helper to create a basket and its token
     */
    async function createBasketWithToken(
        creator: Signer,
        assets: string[],
        weights: bigint[],
        name: string,
        symbol: string
    ): Promise<{ basketId: bigint; token: EquiBasketToken }> {
        // Create basket
        await basketRegistry.connect(creator).createBasket(
            assets,
            weights,
            name,
            symbol
        );
        const basketId = await basketRegistry.basketCount();

        // Deploy token
        const EquiBasketToken = await ethers.getContractFactory("EquiBasketToken");
        const token = await EquiBasketToken.deploy(
            basketId,
            name,
            symbol,
            await creator.getAddress()
        );
        await token.waitForDeployment();

        // Link token to vault
        await token.connect(creator).setVault(await basketVault.getAddress());
        await basketVault.registerBasketToken(basketId, await token.getAddress());

        return { basketId, token };
    }

    // ============================================================
    // ============= TEST SUITE: BASKET CREATION ==================
    // ============================================================

    describe("1. Basket Creation", function () {
        it("Should allow fund creator to create a basket", async function () {
            await basketRegistry.connect(fundCreator).createBasket(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const basketId = await basketRegistry.basketCount();
            expect(basketId).to.equal(1n);

            const [creator, assets, weights, active, name, symbol] =
                await basketRegistry.getBasket(basketId);

            expect(creator).to.equal(fundCreatorAddr);
            expect(assets).to.deep.equal(TECH_BASKET_ASSETS);
            expect(weights.map(w => w)).to.deep.equal(TECH_BASKET_WEIGHTS.map(w => w));
            expect(active).to.equal(true);
            expect(name).to.equal("Tech Giants");
            expect(symbol).to.equal("eTECH");
        });

        it("Should reject baskets with mismatched array lengths", async function () {
            await expect(
                basketRegistry.connect(fundCreator).createBasket(
                    ["AAPL", "NVDA"],
                    [10000n], // Only 1 weight for 2 assets
                    "Invalid Basket",
                    "INV"
                )
            ).to.be.revertedWithCustomError(basketRegistry, "ArrayLengthMismatch");
        });

        it("Should reject baskets with weights not summing to 10000", async function () {
            await expect(
                basketRegistry.connect(fundCreator).createBasket(
                    ["AAPL", "NVDA"],
                    [5000n, 4000n], // Sum = 9000, not 10000
                    "Invalid Basket",
                    "INV"
                )
            ).to.be.revertedWithCustomError(basketRegistry, "InvalidWeightsSum");
        });

        it("Should reject baskets with zero weights", async function () {
            await expect(
                basketRegistry.connect(fundCreator).createBasket(
                    ["AAPL", "NVDA"],
                    [10000n, 0n], // Zero weight
                    "Invalid Basket",
                    "INV"
                )
            ).to.be.revertedWithCustomError(basketRegistry, "ZeroWeight");
        });

        it("Should track creator's baskets correctly", async function () {
            await basketRegistry.connect(fundCreator).createBasket(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            await basketRegistry.connect(fundCreator).createBasket(
                COMMODITY_BASKET_ASSETS,
                COMMODITY_BASKET_WEIGHTS,
                "Commodities",
                "eCOMM"
            );

            const creatorBaskets = await basketRegistry.getBasketsByCreator(fundCreatorAddr);
            expect(creatorBaskets.length).to.equal(2);
            expect(creatorBaskets[0]).to.equal(1n);
            expect(creatorBaskets[1]).to.equal(2n);
        });
    });

    // ============================================================
    // ============= TEST SUITE: BASKET PRICING ===================
    // ============================================================

    describe("2. Basket Price Calculation", function () {
        let techBasketId: bigint;

        beforeEach(async function () {
            // Create tech basket
            await basketRegistry.connect(fundCreator).createBasket(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
            techBasketId = await basketRegistry.basketCount();
        });

        it("Should calculate correct weighted basket price", async function () {
            // Default prices from constructor:
            // AAPL: $175, NVDA: $490, MSFT: $380
            // Weights: 50%, 30%, 20%
            // Expected: 175*0.5 + 490*0.3 + 380*0.2 = 87.5 + 147 + 76 = $310.5

            const basketPrice = await basketOracle.getBasketPrice(techBasketId);
            const expectedPrice = ethers.parseEther("310.5");

            expect(basketPrice).to.equal(expectedPrice);
        });

        it("Should update basket price when asset prices change", async function () {
            const oldPrice = await basketOracle.getBasketPrice(techBasketId);

            // Double NVDA price (30% weight)
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("980"));

            const newPrice = await basketOracle.getBasketPrice(techBasketId);

            // New: 175*0.5 + 980*0.3 + 380*0.2 = 87.5 + 294 + 76 = $457.5
            expect(newPrice).to.equal(ethers.parseEther("457.5"));
            expect(newPrice).to.be.gt(oldPrice);
        });

        it("Should revert if asset price is not available", async function () {
            // Create basket with unknown asset
            await basketRegistry.connect(fundCreator).createBasket(
                ["UNKNOWN"],
                [10000n],
                "Unknown Basket",
                "eUNK"
            );
            const unknownBasketId = await basketRegistry.basketCount();

            await expect(
                basketOracle.getBasketPrice(unknownBasketId)
            ).to.be.revertedWithCustomError(basketOracle, "AssetPriceNotAvailable");
        });

        it("Should validate basket prices correctly", async function () {
            const [valid, missing] = await basketOracle.validateBasketPrices(techBasketId);
            expect(valid).to.equal(true);
            expect(missing).to.equal("");
        });
    });

    // ============================================================
    // ============= TEST SUITE: MNT COLLATERAL ===================
    // ============================================================

    describe("3. MNT Collateral Deposit", function () {
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
        });

        it("Should accept MNT collateral deposit", async function () {
            const depositAmount = ethers.parseEther("1000");

            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                depositAmount
            );

            await expect(
                basketVault.connect(user1).depositCollateral(techBasketId, depositAmount)
            ).to.emit(basketVault, "CollateralDeposited")
                .withArgs(user1Addr, techBasketId, depositAmount, depositAmount);

            const collateral = await basketVault.userCollateral(user1Addr, techBasketId);
            expect(collateral).to.equal(depositAmount);
        });

        it("Should track collateral per basket independently", async function () {
            // Create second basket
            const result2 = await createBasketWithToken(
                fundCreator,
                COMMODITY_BASKET_ASSETS,
                COMMODITY_BASKET_WEIGHTS,
                "Commodities",
                "eCOMM"
            );
            const commodityBasketId = result2.basketId;

            const deposit1 = ethers.parseEther("500");
            const deposit2 = ethers.parseEther("300");

            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                deposit1 + deposit2
            );

            await basketVault.connect(user1).depositCollateral(techBasketId, deposit1);
            await basketVault.connect(user1).depositCollateral(commodityBasketId, deposit2);

            expect(await basketVault.userCollateral(user1Addr, techBasketId)).to.equal(deposit1);
            expect(await basketVault.userCollateral(user1Addr, commodityBasketId)).to.equal(deposit2);
        });

        it("Should reject zero deposit amount", async function () {
            await expect(
                basketVault.connect(user1).depositCollateral(techBasketId, 0)
            ).to.be.revertedWithCustomError(basketVault, "InvalidAmount");
        });
    });

    // ============================================================
    // ============= TEST SUITE: BASKET MINTING ===================
    // ============================================================

    describe("4. Basket Token Minting", function () {
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

            // User deposits collateral
            const depositAmount = ethers.parseEther("1000");
            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                depositAmount
            );
            await basketVault.connect(user1).depositCollateral(techBasketId, depositAmount);
        });

        it("Should mint basket tokens with sufficient collateral", async function () {
            // MNT price: $0.50, Basket price: $310.5
            // Collateral: 1000 MNT = $500
            // Required CR: 500% means max debt value = $100
            // Max basket tokens: $100 / $310.5 ≈ 0.322 tokens

            const mintAmount = ethers.parseEther("0.1"); // Safe amount

            await expect(
                basketVault.connect(user1).mintBasket(techBasketId, mintAmount)
            ).to.emit(basketVault, "BasketMinted")
                .withArgs(user1Addr, techBasketId, mintAmount, mintAmount);

            const tokenBalance = await basketToken1.balanceOf(user1Addr);
            expect(tokenBalance).to.equal(mintAmount);

            const debt = await basketVault.userDebt(user1Addr, techBasketId);
            expect(debt).to.equal(mintAmount);
        });

        it("Should reject minting when collateral ratio is insufficient", async function () {
            // Try to mint way more than allowed
            const excessiveMint = ethers.parseEther("10");

            await expect(
                basketVault.connect(user1).mintBasket(techBasketId, excessiveMint)
            ).to.be.revertedWithCustomError(basketVault, "InsufficientCollateral");
        });

        it("Should calculate correct collateral ratio after minting", async function () {
            const mintAmount = ethers.parseEther("0.1");
            await basketVault.connect(user1).mintBasket(techBasketId, mintAmount);

            const ratio = await basketVault.getCollateralRatio(user1Addr, techBasketId);

            // Collateral: 1000 MNT * $0.50 = $500
            // Debt: 0.1 * $310.5 = $31.05
            // Ratio: 500/31.05 ≈ 16.1 (1610%)
            // In contract: ratio * 1e18

            expect(ratio).to.be.gt(ethers.parseEther("10")); // > 1000%
        });

        it("Should return infinite ratio when no debt", async function () {
            const ratio = await basketVault.getCollateralRatio(user1Addr, techBasketId);
            expect(ratio).to.equal(ethers.MaxUint256);
        });
    });

    // ============================================================
    // ============= TEST SUITE: LIQUIDITY POOL ===================
    // ============================================================

    describe("5. Liquidity Pool Trading", function () {
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

            // Deploy liquidity pool
            const LiquidityPool = await ethers.getContractFactory("BasketLiquidityPool");
            pool = await LiquidityPool.deploy(
                await mockMnt.getAddress(),
                await basketToken1.getAddress(),
                await basketOracle.getAddress(),
                techBasketId,
                30 // 0.30% fee
            );
            await pool.waitForDeployment();

            // Mint and deposit collateral for fund creator
            await mockMnt.connect(fundCreator).approve(
                await basketVault.getAddress(),
                ethers.parseEther("5000")
            );
            await basketVault.connect(fundCreator).depositCollateral(
                techBasketId,
                ethers.parseEther("5000")
            );

            // Mint basket tokens for liquidity
            await basketVault.connect(fundCreator).mintBasket(
                techBasketId,
                ethers.parseEther("1")
            );

            // Add liquidity to pool
            await mockMnt.connect(fundCreator).approve(
                await pool.getAddress(),
                ethers.parseEther("1000")
            );
            await basketToken1.connect(fundCreator).approve(
                await pool.getAddress(),
                ethers.parseEther("1")
            );
            await pool.connect(fundCreator).addLiquidity(
                ethers.parseEther("1000"),
                ethers.parseEther("1")
            );
        });

        it("Should add liquidity and receive shares", async function () {
            const shares = await pool.getShares(fundCreatorAddr);
            expect(shares).to.be.gt(0);
        });

        it("Should swap MNT for basket tokens", async function () {
            const mntIn = ethers.parseEther("100");

            await mockMnt.connect(user1).approve(await pool.getAddress(), mntIn);

            const balanceBefore = await basketToken1.balanceOf(user1Addr);
            await pool.connect(user1).swapMntForBasket(mntIn);
            const balanceAfter = await basketToken1.balanceOf(user1Addr);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should swap basket tokens for MNT", async function () {
            // First get some basket tokens
            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                ethers.parseEther("5000")
            );
            await basketVault.connect(user1).depositCollateral(
                techBasketId,
                ethers.parseEther("5000")
            );
            await basketVault.connect(user1).mintBasket(
                techBasketId,
                ethers.parseEther("0.1")
            );

            const basketIn = ethers.parseEther("0.05");
            await basketToken1.connect(user1).approve(await pool.getAddress(), basketIn);

            const mntBefore = await mockMnt.balanceOf(user1Addr);
            await pool.connect(user1).swapBasketForMnt(basketIn);
            const mntAfter = await mockMnt.balanceOf(user1Addr);

            expect(mntAfter).to.be.gt(mntBefore);
        });

        it("Should calculate correct swap amounts with fees", async function () {
            const mntIn = ethers.parseEther("100");

            const [previewOut, fee] = await pool.previewSwapMntForBasket(mntIn);

            expect(previewOut).to.be.gt(0);
            expect(fee).to.be.gt(0);

            // Fee should be ~0.3% of output
            const grossOut = previewOut + fee;
            const expectedFee = grossOut * 30n / 10000n;
            expect(fee).to.be.closeTo(expectedFee, ethers.parseEther("0.0001"));
        });
    });

    // ============================================================
    // ============= TEST SUITE: COLLATERAL RATIO UPDATES =========
    // ============================================================

    describe("6. Collateral Ratio Updates on Price Changes", function () {
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

            // User deposits and mints
            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                ethers.parseEther("1000")
            );
            await basketVault.connect(user1).depositCollateral(
                techBasketId,
                ethers.parseEther("1000")
            );
            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));
        });

        it("Should decrease CR when basket price increases", async function () {
            const ratioBefore = await basketVault.getCollateralRatio(user1Addr, techBasketId);

            // Increase NVDA price from $490 to $1000
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("1000"));

            const ratioAfter = await basketVault.getCollateralRatio(user1Addr, techBasketId);

            // Debt value increased (basket price up), so CR decreased
            expect(ratioAfter).to.be.lt(ratioBefore);
        });

        it("Should increase CR when basket price decreases", async function () {
            const ratioBefore = await basketVault.getCollateralRatio(user1Addr, techBasketId);

            // Decrease all prices by half
            await basketOracle.setAssetPrice("AAPL", ethers.parseEther("87.5"));
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("245"));
            await basketOracle.setAssetPrice("MSFT", ethers.parseEther("190"));

            const ratioAfter = await basketVault.getCollateralRatio(user1Addr, techBasketId);

            // Debt value decreased (basket price down), so CR increased
            expect(ratioAfter).to.be.gt(ratioBefore);
        });

        it("Should decrease CR when MNT price drops", async function () {
            const ratioBefore = await basketVault.getCollateralRatio(user1Addr, techBasketId);

            // Decrease MNT price from $0.50 to $0.25
            await basketOracle.setMntPrice(ethers.parseEther("0.25"));

            const ratioAfter = await basketVault.getCollateralRatio(user1Addr, techBasketId);

            // Collateral value decreased, so CR decreased
            expect(ratioAfter).to.be.lt(ratioBefore);
        });
    });

    // ============================================================
    // ============= TEST SUITE: LIQUIDATION ======================
    // ============================================================

    describe("7. Basket-Specific Liquidation", function () {
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

            // User deposits and mints near max capacity
            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                ethers.parseEther("500")
            );
            await basketVault.connect(user1).depositCollateral(
                techBasketId,
                ethers.parseEther("500")
            );

            // Mint as much as possible (just under 500% CR)
            // Collateral: 500 MNT * $0.50 = $250
            // At 500% CR, max debt = $50
            // Basket price: $310.5
            // Max tokens: ~0.16
            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));
        });

        it("Should not be liquidatable above threshold", async function () {
            const isLiquidatable = await basketVault.isLiquidatable(user1Addr, techBasketId);
            expect(isLiquidatable).to.equal(false);
        });

        it("Should become liquidatable when CR drops below threshold", async function () {
            // Current CR calculation:
            // Collateral: 500 MNT * $0.50 = $250
            // Debt: 0.1 tokens * $310.5 = $31.05
            // CR = 250 / 31.05 = ~805%
            // Need to drop below 150%

            // Strategy: Increase basket price to >$1666 AND drop MNT price
            // This will make debt value high and collateral value low

            // 10x price increase for basket assets
            await basketOracle.setAssetPrice("AAPL", ethers.parseEther("1750")); // 10x
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("4900")); // 10x
            await basketOracle.setAssetPrice("MSFT", ethers.parseEther("3800")); // 10x
            // New basket price: 1750*0.5 + 4900*0.3 + 3800*0.2 = 875 + 1470 + 760 = $3105

            // Also drop MNT price to make collateral worth less
            await basketOracle.setMntPrice(ethers.parseEther("0.1")); // from $0.50 to $0.10
            // New collateral value: 500 * 0.1 = $50
            // New debt value: 0.1 * 3105 = $310.5
            // CR = 50 / 310.5 = 16% (well below 150%)

            const isLiquidatable = await basketVault.isLiquidatable(user1Addr, techBasketId);
            expect(isLiquidatable).to.equal(true);
        });

        it("Should execute full liquidation correctly", async function () {
            // Make position liquidatable with dramatic price changes
            await basketOracle.setAssetPrice("AAPL", ethers.parseEther("1750")); // 10x
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("4900")); // 10x
            await basketOracle.setAssetPrice("MSFT", ethers.parseEther("3800")); // 10x
            await basketOracle.setMntPrice(ethers.parseEther("0.1")); // Drop MNT price

            expect(await basketVault.isLiquidatable(user1Addr, techBasketId)).to.equal(true);

            // Prepare liquidator
            await mockMnt.connect(liquidator).approve(
                await basketVault.getAddress(),
                ethers.parseEther("50000")
            );

            const liquidatorMntBefore = await mockMnt.balanceOf(liquidatorAddr);

            await expect(
                basketVault.connect(liquidator).liquidate(user1Addr, techBasketId)
            ).to.emit(basketVault, "Liquidated");

            // User's position should be cleared
            expect(await basketVault.userCollateral(user1Addr, techBasketId)).to.equal(0);
            expect(await basketVault.userDebt(user1Addr, techBasketId)).to.equal(0);

            // Liquidator balance changed (paid for debt, received collateral)
            const liquidatorMntAfter = await mockMnt.balanceOf(liquidatorAddr);
            // Since position is underwater, liquidator should have gained collateral
            expect(liquidatorMntAfter).to.not.equal(liquidatorMntBefore);
        });

        it("Should reject liquidation when not liquidatable", async function () {
            await expect(
                basketVault.connect(liquidator).liquidate(user1Addr, techBasketId)
            ).to.be.revertedWithCustomError(basketVault, "PositionNotLiquidatable");
        });
    });

    // ============================================================
    // ============= TEST SUITE: PARTIAL LIQUIDATION ==============
    // ============================================================

    describe("8. Partial Liquidation Scenarios", function () {
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

            // User deposits and mints
            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                ethers.parseEther("500")
            );
            await basketVault.connect(user1).depositCollateral(
                techBasketId,
                ethers.parseEther("500")
            );
            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));

            // Make liquidatable with aggressive price changes
            await basketOracle.setAssetPrice("AAPL", ethers.parseEther("1750")); // 10x
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("4900")); // 10x
            await basketOracle.setAssetPrice("MSFT", ethers.parseEther("3800")); // 10x
            await basketOracle.setMntPrice(ethers.parseEther("0.1")); // Drop MNT price
        });

        it("Should execute partial liquidation correctly", async function () {
            const debtBefore = await basketVault.userDebt(user1Addr, techBasketId);
            const partialDebt = debtBefore / 2n;

            await mockMnt.connect(liquidator).approve(
                await basketVault.getAddress(),
                ethers.parseEther("5000")
            );

            await basketVault.connect(liquidator).partialLiquidate(
                user1Addr,
                techBasketId,
                partialDebt
            );

            const debtAfter = await basketVault.userDebt(user1Addr, techBasketId);
            expect(debtAfter).to.be.lt(debtBefore);
            expect(debtAfter).to.be.closeTo(debtBefore - partialDebt, ethers.parseEther("0.001"));
        });

        it("Should include liquidation penalty in partial liquidation", async function () {
            const collateralBefore = await basketVault.userCollateral(user1Addr, techBasketId);
            const debtBefore = await basketVault.userDebt(user1Addr, techBasketId);
            const halfDebt = debtBefore / 2n;

            await mockMnt.connect(liquidator).approve(
                await basketVault.getAddress(),
                ethers.parseEther("5000")
            );

            await basketVault.connect(liquidator).partialLiquidate(
                user1Addr,
                techBasketId,
                halfDebt
            );

            const collateralAfter = await basketVault.userCollateral(user1Addr, techBasketId);
            const collateralLost = collateralBefore - collateralAfter;

            // Should have lost more than half due to 10% penalty
            const proportionalCollateral = (halfDebt * collateralBefore) / debtBefore;
            expect(collateralLost).to.be.gt(proportionalCollateral);
        });
    });

    // ============================================================
    // ============= TEST SUITE: MULTIPLE BASKETS =================
    // ============================================================

    describe("9. Multiple Baskets Per User", function () {
        let techBasketId: bigint;
        let commodityBasketId: bigint;

        beforeEach(async function () {
            // Create Tech basket
            const result1 = await createBasketWithToken(
                fundCreator,
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
            techBasketId = result1.basketId;
            basketToken1 = result1.token;

            // Create Commodity basket
            const result2 = await createBasketWithToken(
                fundCreator,
                COMMODITY_BASKET_ASSETS,
                COMMODITY_BASKET_WEIGHTS,
                "Commodities",
                "eCOMM"
            );
            commodityBasketId = result2.basketId;
            basketToken2 = result2.token;

            // User deposits into both baskets
            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                ethers.parseEther("2000")
            );
        });

        it("Should maintain independent positions per basket", async function () {
            await basketVault.connect(user1).depositCollateral(techBasketId, ethers.parseEther("1000"));
            await basketVault.connect(user1).depositCollateral(commodityBasketId, ethers.parseEther("500"));

            // Tech basket: 1000 MNT * $0.50 = $500 collateral
            // At 500% CR: max debt = $100, basket price ~$310.5, max mint = ~0.32
            // Commodity basket: GOLD at $2050 * 0.7 + SILVER at $24 * 0.3 = $1435 + $7.2 = $1442.2/token
            // 500 MNT * $0.50 = $250 collateral, at 500% CR: max debt = $50
            // Max commodity tokens: $50 / $1442.2 = ~0.035

            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));
            await basketVault.connect(user1).mintBasket(commodityBasketId, ethers.parseEther("0.01"));

            // Check positions are independent
            const techDebt = await basketVault.userDebt(user1Addr, techBasketId);
            const commDebt = await basketVault.userDebt(user1Addr, commodityBasketId);

            expect(techDebt).to.equal(ethers.parseEther("0.1"));
            expect(commDebt).to.equal(ethers.parseEther("0.01"));

            const techCollateral = await basketVault.userCollateral(user1Addr, techBasketId);
            const commCollateral = await basketVault.userCollateral(user1Addr, commodityBasketId);

            expect(techCollateral).to.equal(ethers.parseEther("1000"));
            expect(commCollateral).to.equal(ethers.parseEther("500"));
        });

        it("Should not affect other baskets when one is liquidated", async function () {
            await basketVault.connect(user1).depositCollateral(techBasketId, ethers.parseEther("500"));
            await basketVault.connect(user1).depositCollateral(commodityBasketId, ethers.parseEther("500"));

            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));
            await basketVault.connect(user1).mintBasket(commodityBasketId, ethers.parseEther("0.01"));

            // Make only tech basket liquidatable by increasing tech prices AND dropping MNT
            await basketOracle.setAssetPrice("AAPL", ethers.parseEther("1750")); // 10x
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("4900")); // 10x
            await basketOracle.setAssetPrice("MSFT", ethers.parseEther("3800")); // 10x
            await basketOracle.setMntPrice(ethers.parseEther("0.1")); // Drop MNT price

            expect(await basketVault.isLiquidatable(user1Addr, techBasketId)).to.equal(true);
            // Commodity might also be affected by MNT price drop, so we don't assert on it

            // Liquidate tech basket
            await mockMnt.connect(liquidator).approve(
                await basketVault.getAddress(),
                ethers.parseEther("50000")
            );
            await basketVault.connect(liquidator).liquidate(user1Addr, techBasketId);

            // Tech basket should be cleared
            expect(await basketVault.userCollateral(user1Addr, techBasketId)).to.equal(0);
            expect(await basketVault.userDebt(user1Addr, techBasketId)).to.equal(0);

            // Commodity basket should be unaffected (position intact)
            expect(await basketVault.userCollateral(user1Addr, commodityBasketId)).to.equal(ethers.parseEther("500"));
            expect(await basketVault.userDebt(user1Addr, commodityBasketId)).to.equal(ethers.parseEther("0.01"));
        });

        it("Should calculate different collateral ratios per basket", async function () {
            await basketVault.connect(user1).depositCollateral(techBasketId, ethers.parseEther("1000"));
            await basketVault.connect(user1).depositCollateral(commodityBasketId, ethers.parseEther("500"));

            // Use smaller mint amounts that work with the collateral
            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));
            await basketVault.connect(user1).mintBasket(commodityBasketId, ethers.parseEther("0.01"));

            const techRatio = await basketVault.getCollateralRatio(user1Addr, techBasketId);
            const commRatio = await basketVault.getCollateralRatio(user1Addr, commodityBasketId);

            // Ratios should be different based on prices and positions
            expect(techRatio).to.not.equal(commRatio);
        });
    });

    // ============================================================
    // ============= TEST SUITE: BURN & WITHDRAWAL ================
    // ============================================================

    describe("10. Burning and Withdrawal", function () {
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

            await mockMnt.connect(user1).approve(
                await basketVault.getAddress(),
                ethers.parseEther("1000")
            );
            await basketVault.connect(user1).depositCollateral(techBasketId, ethers.parseEther("1000"));
            await basketVault.connect(user1).mintBasket(techBasketId, ethers.parseEther("0.1"));
        });

        it("Should burn basket tokens and release collateral", async function () {
            const debtBefore = await basketVault.userDebt(user1Addr, techBasketId);
            const mntBefore = await mockMnt.balanceOf(user1Addr);

            await basketVault.connect(user1).burnBasket(techBasketId, ethers.parseEther("0.1"));

            const debtAfter = await basketVault.userDebt(user1Addr, techBasketId);
            const mntAfter = await mockMnt.balanceOf(user1Addr);

            expect(debtAfter).to.equal(0);
            expect(mntAfter).to.be.gt(mntBefore);
        });

        it("Should allow collateral withdrawal when no debt", async function () {
            // First burn all debt
            await basketVault.connect(user1).burnBasket(techBasketId, ethers.parseEther("0.1"));

            // Now can withdraw remaining collateral
            const remainingCollateral = await basketVault.userCollateral(user1Addr, techBasketId);

            if (remainingCollateral > 0n) {
                await basketVault.connect(user1).withdrawCollateral(techBasketId, remainingCollateral);
            }

            expect(await basketVault.userCollateral(user1Addr, techBasketId)).to.equal(0);
        });

        it("Should reject withdrawal that would break collateral ratio", async function () {
            // Try to withdraw most collateral while having debt
            await expect(
                basketVault.connect(user1).withdrawCollateral(techBasketId, ethers.parseEther("900"))
            ).to.be.revertedWithCustomError(basketVault, "InsufficientCollateral");
        });
    });
});
