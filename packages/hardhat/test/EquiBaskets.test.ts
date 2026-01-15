import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { BasketRegistry, BasketOracle, BasketVault, EquiBasketToken, BasketLiquidityPool } from "../typechain-types";

/**
 * EquiBaskets End-to-End Test Suite
 *
 * This test suite validates the complete lifecycle of the EquiBaskets system:
 * - Basket creation by fund creators
 * - Correct basket price calculation from multiple assets
 * - Depositing NATIVE MNT collateral (msg.value)
 * - Minting basket tokens with proper collateral ratio
 * - Trading basket tokens via liquidity pool
 * - Collateral ratio updates when asset prices change
 * - Basket-specific liquidation triggering
 * - Multiple baskets per user without interference
 *
 * MIGRATED TO NATIVE MNT (uses msg.value instead of ERC20 MockMNT)
 * Uses small deposit amounts (50 MNT) to fit within test account limits.
 * All tests use mock price feeds and are deterministic.
 */
describe("EquiBaskets End-to-End Tests", function () {
  // ============================================================
  // ====================== TEST ACCOUNTS =======================
  // ============================================================

  let fundCreator: Signer;
  let user1: Signer;
  let liquidator: Signer;

  let fundCreatorAddr: string;
  let user1Addr: string;

  // ============================================================
  // ======================= CONTRACTS ==========================
  // ============================================================

  let basketRegistry: BasketRegistry;
  let basketOracle: BasketOracle;
  let basketVault: BasketVault;
  let basketToken1: EquiBasketToken;

  // ============================================================
  // ======================= CONSTANTS ==========================
  // ============================================================

  // Sample basket configurations
  const TECH_BASKET_ASSETS = ["AAPL", "NVDA", "MSFT"];
  const TECH_BASKET_WEIGHTS = [5000n, 3000n, 2000n]; // 50%, 30%, 20%

  const COMMODITY_BASKET_ASSETS = ["GOLD", "SILVER"];
  const COMMODITY_BASKET_WEIGHTS = [7000n, 3000n]; // 70%, 30%

  // Standard test amounts - balanced for 500% CR
  // 50 MNT @ $0.50 = $25 collateral
  // Max debt @ 500% CR = $5
  // At $310.5 basket price, max mint = ~0.016 tokens
  // Using 0.01 tokens for safe margin
  const DEPOSIT_AMOUNT = ethers.parseEther("50");
  const MINT_AMOUNT = ethers.parseEther("0.01");
  const SMALL_MINT = ethers.parseEther("0.005");

  // ============================================================
  // ====================== SETUP HOOKS =========================
  // ============================================================

  beforeEach(async function () {
    // Get signers
    const signers = await ethers.getSigners();
    fundCreator = signers[1];
    user1 = signers[2];
    liquidator = signers[4];

    fundCreatorAddr = await fundCreator.getAddress();
    user1Addr = await user1.getAddress();

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
    basketVault = await BasketVault.deploy(await basketRegistry.getAddress(), await basketOracle.getAddress());
    await basketVault.waitForDeployment();
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
    symbol: string,
  ): Promise<{ basketId: bigint; token: EquiBasketToken }> {
    // Create basket
    await basketRegistry.connect(creator).createBasket(assets, weights, name, symbol);
    const basketId = await basketRegistry.basketCount();

    // Deploy token
    const EquiBasketToken = await ethers.getContractFactory("EquiBasketToken");
    const token = await EquiBasketToken.deploy(basketId, name, symbol, await creator.getAddress());
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
      await basketRegistry
        .connect(fundCreator)
        .createBasket(TECH_BASKET_ASSETS, TECH_BASKET_WEIGHTS, "Tech Giants", "eTECH");

      const basketId = await basketRegistry.basketCount();
      expect(basketId).to.equal(1n);

      const [creator, assets, weights, active, name, symbol] = await basketRegistry.getBasket(basketId);

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
          "INV",
        ),
      ).to.be.revertedWithCustomError(basketRegistry, "ArrayLengthMismatch");
    });

    it("Should reject baskets with weights not summing to 10000", async function () {
      await expect(
        basketRegistry.connect(fundCreator).createBasket(
          ["AAPL", "NVDA"],
          [5000n, 4000n], // Sum = 9000, not 10000
          "Invalid Basket",
          "INV",
        ),
      ).to.be.revertedWithCustomError(basketRegistry, "InvalidWeightsSum");
    });

    it("Should reject baskets with zero weights", async function () {
      await expect(
        basketRegistry.connect(fundCreator).createBasket(
          ["AAPL", "NVDA"],
          [10000n, 0n], // Zero weight
          "Invalid Basket",
          "INV",
        ),
      ).to.be.revertedWithCustomError(basketRegistry, "ZeroWeight");
    });

    it("Should track creator's baskets correctly", async function () {
      await basketRegistry
        .connect(fundCreator)
        .createBasket(TECH_BASKET_ASSETS, TECH_BASKET_WEIGHTS, "Tech Giants", "eTECH");

      await basketRegistry
        .connect(fundCreator)
        .createBasket(COMMODITY_BASKET_ASSETS, COMMODITY_BASKET_WEIGHTS, "Commodities", "eCOMM");

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
      await basketRegistry
        .connect(fundCreator)
        .createBasket(TECH_BASKET_ASSETS, TECH_BASKET_WEIGHTS, "Tech Giants", "eTECH");
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
      await basketRegistry.connect(fundCreator).createBasket(["UNKNOWN"], [10000n], "Unknown Basket", "eUNK");
      const unknownBasketId = await basketRegistry.basketCount();

      await expect(basketOracle.getBasketPrice(unknownBasketId)).to.be.revertedWithCustomError(
        basketOracle,
        "AssetPriceNotAvailable",
      );
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
        "eTECH",
      );
      techBasketId = result.basketId;
      basketToken1 = result.token;
    });

    it("Should accept native MNT collateral deposit", async function () {
      await expect(basketVault.connect(user1).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT }))
        .to.emit(basketVault, "CollateralDeposited")
        .withArgs(user1Addr, techBasketId, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT);

      const collateral = await basketVault.userCollateral(user1Addr, techBasketId);
      expect(collateral).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should track collateral per basket independently", async function () {
      // Create second basket
      const result2 = await createBasketWithToken(
        fundCreator,
        COMMODITY_BASKET_ASSETS,
        COMMODITY_BASKET_WEIGHTS,
        "Commodities",
        "eCOMM",
      );
      const commodityBasketId = result2.basketId;

      const deposit1 = ethers.parseEther("30");
      const deposit2 = ethers.parseEther("20");

      await basketVault.connect(user1).depositCollateral(techBasketId, { value: deposit1 });
      await basketVault.connect(user1).depositCollateral(commodityBasketId, { value: deposit2 });

      expect(await basketVault.userCollateral(user1Addr, techBasketId)).to.equal(deposit1);
      expect(await basketVault.userCollateral(user1Addr, commodityBasketId)).to.equal(deposit2);
    });

    it("Should reject zero deposit amount", async function () {
      await expect(
        basketVault.connect(user1).depositCollateral(techBasketId, { value: 0 }),
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
        "eTECH",
      );
      techBasketId = result.basketId;
      basketToken1 = result.token;

      // User deposits native MNT collateral
      await basketVault.connect(user1).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT });
    });

    it("Should mint basket tokens with sufficient collateral", async function () {
      // 50 MNT @ $0.50 = $25 collateral
      // At 500% CR, max debt = $5
      // Basket price $310.5, so max ~0.016 tokens
      // Using 0.01 tokens

      await expect(basketVault.connect(user1).mintBasket(techBasketId, MINT_AMOUNT))
        .to.emit(basketVault, "BasketMinted")
        .withArgs(user1Addr, techBasketId, MINT_AMOUNT, MINT_AMOUNT);

      const tokenBalance = await basketToken1.balanceOf(user1Addr);
      expect(tokenBalance).to.equal(MINT_AMOUNT);

      const debt = await basketVault.userDebt(user1Addr, techBasketId);
      expect(debt).to.equal(MINT_AMOUNT);
    });

    it("Should reject minting when collateral ratio is insufficient", async function () {
      // Try to mint way more than allowed
      const excessiveMint = ethers.parseEther("1");

      await expect(basketVault.connect(user1).mintBasket(techBasketId, excessiveMint)).to.be.revertedWithCustomError(
        basketVault,
        "InsufficientCollateral",
      );
    });

    it("Should calculate correct collateral ratio after minting", async function () {
      await basketVault.connect(user1).mintBasket(techBasketId, MINT_AMOUNT);

      const ratio = await basketVault.getCollateralRatio(user1Addr, techBasketId);

      // Collateral: 50 MNT * $0.50 = $25
      // Debt: 0.01 * $310.5 = $3.105
      // Ratio: 25/3.105 ≈ 8.05 (805%)
      expect(ratio).to.be.gt(ethers.parseEther("5")); // > 500%
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
        "eTECH",
      );
      techBasketId = result.basketId;
      basketToken1 = result.token;

      // Deploy liquidity pool (native MNT - only 4 args)
      const LiquidityPool = await ethers.getContractFactory("BasketLiquidityPool");
      pool = await LiquidityPool.deploy(
        await basketToken1.getAddress(),
        await basketOracle.getAddress(),
        techBasketId,
        30, // 0.30% fee
      );
      await pool.waitForDeployment();

      // Deposit native MNT collateral for fund creator
      await basketVault.connect(fundCreator).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT });

      // Mint basket tokens for liquidity
      await basketVault.connect(fundCreator).mintBasket(techBasketId, MINT_AMOUNT);

      // Add liquidity to pool with native MNT
      await basketToken1.connect(fundCreator).approve(await pool.getAddress(), MINT_AMOUNT);
      await pool.connect(fundCreator).addLiquidity(MINT_AMOUNT, { value: ethers.parseEther("10") });
    });

    it("Should add liquidity and receive shares", async function () {
      const shares = await pool.getShares(fundCreatorAddr);
      expect(shares).to.be.gt(0);
    });

    it("Should swap MNT for basket tokens", async function () {
      const balanceBefore = await basketToken1.balanceOf(user1Addr);
      await pool.connect(user1).swapMntForBasket({ value: ethers.parseEther("1") });
      const balanceAfter = await basketToken1.balanceOf(user1Addr);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should swap basket tokens for MNT", async function () {
      // First get some basket tokens
      await basketVault.connect(user1).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT });
      await basketVault.connect(user1).mintBasket(techBasketId, SMALL_MINT);

      const basketIn = ethers.parseEther("0.001");
      await basketToken1.connect(user1).approve(await pool.getAddress(), basketIn);

      const mntBefore = await ethers.provider.getBalance(user1Addr);
      const tx = await pool.connect(user1).swapBasketForMnt(basketIn);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const mntAfter = await ethers.provider.getBalance(user1Addr);

      // Balance should increase (minus gas)
      expect(mntAfter + gasUsed).to.be.gt(mntBefore);
    });

    it("Should calculate correct swap amounts with fees", async function () {
      const mntIn = ethers.parseEther("1");

      const [previewOut, fee] = await pool.previewSwapMntForBasket(mntIn);

      expect(previewOut).to.be.gt(0);
      expect(fee).to.be.gt(0);
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
        "eTECH",
      );
      techBasketId = result.basketId;
      basketToken1 = result.token;

      // User deposits native MNT and mints
      await basketVault.connect(user1).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT });
      await basketVault.connect(user1).mintBasket(techBasketId, MINT_AMOUNT);
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
        "eTECH",
      );
      techBasketId = result.basketId;
      basketToken1 = result.token;

      // User deposits native MNT and mints
      await basketVault.connect(user1).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT });

      await basketVault.connect(user1).mintBasket(techBasketId, MINT_AMOUNT);
    });

    it("Should not be liquidatable above threshold", async function () {
      const isLiquidatable = await basketVault.isLiquidatable(user1Addr, techBasketId);
      expect(isLiquidatable).to.equal(false);
    });

    it("Should become liquidatable when CR drops below threshold", async function () {
      // 10x price increase for basket assets + drop MNT price
      await basketOracle.setAssetPrice("AAPL", ethers.parseEther("1750")); // 10x
      await basketOracle.setAssetPrice("NVDA", ethers.parseEther("4900")); // 10x
      await basketOracle.setAssetPrice("MSFT", ethers.parseEther("3800")); // 10x
      await basketOracle.setMntPrice(ethers.parseEther("0.1")); // Drop MNT price

      const isLiquidatable = await basketVault.isLiquidatable(user1Addr, techBasketId);
      expect(isLiquidatable).to.equal(true);
    });

    it("Should execute full liquidation correctly", async function () {
      // Make position liquidatable with dramatic price changes
      await basketOracle.setAssetPrice("AAPL", ethers.parseEther("1750"));
      await basketOracle.setAssetPrice("NVDA", ethers.parseEther("4900"));
      await basketOracle.setAssetPrice("MSFT", ethers.parseEther("3800"));
      await basketOracle.setMntPrice(ethers.parseEther("0.1"));

      expect(await basketVault.isLiquidatable(user1Addr, techBasketId)).to.equal(true);

      // Calculate MNT needed for liquidation
      const debt = await basketVault.userDebt(user1Addr, techBasketId);
      const basketPrice = ethers.parseEther("3105");
      const debtValue = (debt * basketPrice) / ethers.parseEther("1");
      const mntToPay = await basketOracle.getMntFromUsdValue(debtValue);

      await expect(
        basketVault.connect(liquidator).liquidate(user1Addr, techBasketId, { value: mntToPay * 2n }),
      ).to.emit(basketVault, "Liquidated");

      // User's position should be cleared
      expect(await basketVault.userCollateral(user1Addr, techBasketId)).to.equal(0);
      expect(await basketVault.userDebt(user1Addr, techBasketId)).to.equal(0);
    });

    it("Should reject liquidation when not liquidatable", async function () {
      await expect(
        basketVault.connect(liquidator).liquidate(user1Addr, techBasketId, { value: ethers.parseEther("10") }),
      ).to.be.revertedWithCustomError(basketVault, "PositionNotLiquidatable");
    });
  });

  // ============================================================
  // ============= TEST SUITE: MULTIPLE BASKETS =================
  // ============================================================

  describe("8. Multiple Baskets Per User", function () {
    let techBasketId: bigint;
    let commodityBasketId: bigint;

    beforeEach(async function () {
      // Create Tech basket
      const result1 = await createBasketWithToken(
        fundCreator,
        TECH_BASKET_ASSETS,
        TECH_BASKET_WEIGHTS,
        "Tech Giants",
        "eTECH",
      );
      techBasketId = result1.basketId;
      basketToken1 = result1.token;

      // Create Commodity basket
      const result2 = await createBasketWithToken(
        fundCreator,
        COMMODITY_BASKET_ASSETS,
        COMMODITY_BASKET_WEIGHTS,
        "Commodities",
        "eCOMM",
      );
      commodityBasketId = result2.basketId;
      basketToken2 = result2.token;
    });

    it("Should maintain independent positions per basket", async function () {
      const deposit1 = ethers.parseEther("40");
      const deposit2 = ethers.parseEther("30");

      await basketVault.connect(user1).depositCollateral(techBasketId, { value: deposit1 });
      await basketVault.connect(user1).depositCollateral(commodityBasketId, { value: deposit2 });

      await basketVault.connect(user1).mintBasket(techBasketId, SMALL_MINT);
      await basketVault.connect(user1).mintBasket(commodityBasketId, ethers.parseEther("0.001"));

      // Check positions are independent
      const techDebt = await basketVault.userDebt(user1Addr, techBasketId);
      const commDebt = await basketVault.userDebt(user1Addr, commodityBasketId);

      expect(techDebt).to.equal(SMALL_MINT);
      expect(commDebt).to.equal(ethers.parseEther("0.001"));

      const techCollateral = await basketVault.userCollateral(user1Addr, techBasketId);
      const commCollateral = await basketVault.userCollateral(user1Addr, commodityBasketId);

      expect(techCollateral).to.equal(deposit1);
      expect(commCollateral).to.equal(deposit2);
    });

    it("Should not affect other baskets when one is liquidated", async function () {
      const deposit = ethers.parseEther("30");

      await basketVault.connect(user1).depositCollateral(techBasketId, { value: deposit });
      await basketVault.connect(user1).depositCollateral(commodityBasketId, { value: deposit });

      await basketVault.connect(user1).mintBasket(techBasketId, SMALL_MINT);
      await basketVault.connect(user1).mintBasket(commodityBasketId, ethers.parseEther("0.001"));

      // Make only tech basket liquidatable
      await basketOracle.setAssetPrice("AAPL", ethers.parseEther("1750"));
      await basketOracle.setAssetPrice("NVDA", ethers.parseEther("4900"));
      await basketOracle.setAssetPrice("MSFT", ethers.parseEther("3800"));
      await basketOracle.setMntPrice(ethers.parseEther("0.1"));

      expect(await basketVault.isLiquidatable(user1Addr, techBasketId)).to.equal(true);

      // Calculate MNT for liquidation
      const debt = await basketVault.userDebt(user1Addr, techBasketId);
      const basketPrice = ethers.parseEther("3105");
      const debtValue = (debt * basketPrice) / ethers.parseEther("1");
      const mntToPay = await basketOracle.getMntFromUsdValue(debtValue);

      // Liquidate tech basket
      await basketVault.connect(liquidator).liquidate(user1Addr, techBasketId, { value: mntToPay * 2n });

      // Tech basket should be cleared
      expect(await basketVault.userCollateral(user1Addr, techBasketId)).to.equal(0);
      expect(await basketVault.userDebt(user1Addr, techBasketId)).to.equal(0);

      // Commodity basket should be unaffected
      expect(await basketVault.userCollateral(user1Addr, commodityBasketId)).to.equal(deposit);
      expect(await basketVault.userDebt(user1Addr, commodityBasketId)).to.equal(ethers.parseEther("0.001"));
    });

    it("Should calculate different collateral ratios per basket", async function () {
      await basketVault.connect(user1).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT });
      await basketVault.connect(user1).depositCollateral(commodityBasketId, { value: DEPOSIT_AMOUNT });

      await basketVault.connect(user1).mintBasket(techBasketId, SMALL_MINT);
      await basketVault.connect(user1).mintBasket(commodityBasketId, ethers.parseEther("0.001"));

      const techRatio = await basketVault.getCollateralRatio(user1Addr, techBasketId);
      const commRatio = await basketVault.getCollateralRatio(user1Addr, commodityBasketId);

      // Ratios should be different based on prices and positions
      expect(techRatio).to.not.equal(commRatio);
    });
  });

  // ============================================================
  // ============= TEST SUITE: BURN & WITHDRAWAL ================
  // ============================================================

  describe("9. Burning and Withdrawal", function () {
    let techBasketId: bigint;

    beforeEach(async function () {
      const result = await createBasketWithToken(
        fundCreator,
        TECH_BASKET_ASSETS,
        TECH_BASKET_WEIGHTS,
        "Tech Giants",
        "eTECH",
      );
      techBasketId = result.basketId;
      basketToken1 = result.token;

      await basketVault.connect(user1).depositCollateral(techBasketId, { value: DEPOSIT_AMOUNT });
      await basketVault.connect(user1).mintBasket(techBasketId, MINT_AMOUNT);
    });

    it("Should burn basket tokens and release collateral", async function () {
      const mntBefore = await ethers.provider.getBalance(user1Addr);

      const tx = await basketVault.connect(user1).burnBasket(techBasketId, MINT_AMOUNT);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const debtAfter = await basketVault.userDebt(user1Addr, techBasketId);
      const mntAfter = await ethers.provider.getBalance(user1Addr);

      expect(debtAfter).to.equal(0);
      expect(mntAfter + gasUsed).to.be.gt(mntBefore);
    });

    it("Should allow collateral withdrawal when no debt", async function () {
      // First burn all debt
      await basketVault.connect(user1).burnBasket(techBasketId, MINT_AMOUNT);

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
        basketVault.connect(user1).withdrawCollateral(techBasketId, ethers.parseEther("40")),
      ).to.be.revertedWithCustomError(basketVault, "InsufficientCollateral");
    });
  });
});
