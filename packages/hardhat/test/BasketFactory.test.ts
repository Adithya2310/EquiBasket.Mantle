import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
    BasketRegistry,
    BasketOracle,
    BasketVault,
    BasketFactory,
    EquiBasketToken,
} from "../typechain-types";

/**
 * BasketFactory Test Suite
 * 
 * Tests the new factory pattern with native MNT:
 * - Factory creates baskets with tokens automatically
 * - Native MNT deposits (no ERC20 approval needed)
 * - Token registration happens atomically
 * - Multiple baskets can be created via factory
 */
describe("BasketFactory with Native MNT", function () {
    let deployer: Signer;
    let fundCreator: Signer;
    let user1: Signer;
    let user2: Signer;

    let deployerAddr: string;
    let fundCreatorAddr: string;
    let user1Addr: string;
    let user2Addr: string;

    let basketRegistry: BasketRegistry;
    let basketOracle: BasketOracle;
    let basketVault: BasketVault;
    let basketFactory: BasketFactory;

    const TECH_BASKET_ASSETS = ["AAPL", "NVDA", "MSFT"];
    const TECH_BASKET_WEIGHTS = [5000n, 3000n, 2000n]; // 50%, 30%, 20%
    const COMMODITY_BASKET_ASSETS = ["GOLD", "SILVER"];
    const COMMODITY_BASKET_WEIGHTS = [7000n, 3000n]; // 70%, 30%

    beforeEach(async function () {
        [deployer, fundCreator, user1, user2] = await ethers.getSigners();
        deployerAddr = await deployer.getAddress();
        fundCreatorAddr = await fundCreator.getAddress();
        user1Addr = await user1.getAddress();
        user2Addr = await user2.getAddress();

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
            await basketRegistry.getAddress(),
            await basketOracle.getAddress()
        );
        await basketVault.waitForDeployment();

        // Deploy BasketFactory
        const BasketFactory = await ethers.getContractFactory("BasketFactory");
        basketFactory = await BasketFactory.deploy(
            await basketRegistry.getAddress(),
            await basketOracle.getAddress(),
            await basketVault.getAddress(),
            30n // 0.30% default swap fee
        );
        await basketFactory.waitForDeployment();

        // Authorize factory to register tokens
        await basketVault.setAuthorizedFactory(await basketFactory.getAddress());

        // Set up oracle prices
        await basketOracle.setMntPrice(ethers.parseEther("0.5")); // $0.50 per MNT

        // Update asset prices (assets are pre-registered in constructor)
        await basketOracle.setAssetPrice("AAPL", ethers.parseEther("150")); // $150
        await basketOracle.setAssetPrice("NVDA", ethers.parseEther("500")); // $500
        await basketOracle.setAssetPrice("MSFT", ethers.parseEther("300")); // $300
        await basketOracle.setAssetPrice("GOLD", ethers.parseEther("2000")); // $2000
        await basketOracle.setAssetPrice("SILVER", ethers.parseEther("25")); // $25
    });

    describe("Factory Deployment", function () {
        it("Should deploy with correct addresses", async function () {
            expect(await basketFactory.basketRegistry()).to.equal(await basketRegistry.getAddress());
            expect(await basketFactory.basketVault()).to.equal(await basketVault.getAddress());
        });

        it("Should be authorized in vault", async function () {
            expect(await basketVault.authorizedFactory()).to.equal(await basketFactory.getAddress());
        });
    });

    describe("Basket Creation via Factory", function () {
        it("Should create basket with token in one transaction", async function () {
            const tx = await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const receipt = await tx.wait();

            // Check event was emitted
            const factoryInterface = basketFactory.interface;
            const event = receipt?.logs
                .map((log: any) => {
                    try {
                        return factoryInterface.parseLog({ topics: log.topics as string[], data: log.data });
                    } catch {
                        return null;
                    }
                })
                .find((e: any) => e?.name === "BasketCreatedWithToken");

            expect(event).to.not.be.undefined;
            expect(event?.args?.basketId).to.equal(1n);
            expect(event?.args?.creator).to.equal(fundCreatorAddr);
        });

        it("Should register token in vault automatically", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const tokenAddress = await basketFactory.basketTokens(1n);
            expect(tokenAddress).to.not.equal(ethers.ZeroAddress);

            const vaultTokenAddress = await basketVault.basketTokens(1n);
            expect(vaultTokenAddress).to.equal(tokenAddress);
        });

        it("Should deploy token with correct parameters", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const tokenAddress = await basketFactory.basketTokens(1n);
            const token = await ethers.getContractAt("EquiBasketToken", tokenAddress);

            expect(await token.name()).to.equal("Tech Giants");
            expect(await token.symbol()).to.equal("eTECH");
            expect(await token.basketId()).to.equal(1n);
            expect(await token.vault()).to.equal(await basketVault.getAddress());
        });

        it("Should transfer token ownership to creator", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const tokenAddress = await basketFactory.basketTokens(1n);
            const token = await ethers.getContractAt("EquiBasketToken", tokenAddress);

            expect(await token.owner()).to.equal(fundCreatorAddr);
        });

        it("Should allow creating multiple baskets", async function () {
            // Create first basket
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            // Create second basket
            await basketFactory.connect(user1).createBasketWithToken(
                COMMODITY_BASKET_ASSETS,
                COMMODITY_BASKET_WEIGHTS,
                "Precious Metals",
                "eMETAL"
            );

            expect(await basketRegistry.basketCount()).to.equal(2n);

            const token1 = await basketFactory.basketTokens(1n);
            const token2 = await basketFactory.basketTokens(2n);

            expect(token1).to.not.equal(ethers.ZeroAddress);
            expect(token2).to.not.equal(ethers.ZeroAddress);
            expect(token1).to.not.equal(token2);
        });

        it("Should revert if vault not set", async function () {
            // Deploy new factory without vault
            const BasketFactory = await ethers.getContractFactory("BasketFactory");
            const newFactory = await BasketFactory.deploy(
                await basketRegistry.getAddress(),
                await basketOracle.getAddress(),
                ethers.ZeroAddress,
                30n
            );

            await expect(
                newFactory.createBasketWithToken(
                    TECH_BASKET_ASSETS,
                    TECH_BASKET_WEIGHTS,
                    "Tech Giants",
                    "eTECH"
                )
            ).to.be.revertedWithCustomError(newFactory, "VaultNotSet");
        });

        it("Should deploy liquidity pool automatically", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const poolAddress = await basketFactory.basketPools(1n);
            expect(poolAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should deploy pool with correct parameters", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const tokenAddress = await basketFactory.basketTokens(1n);
            const poolAddress = await basketFactory.basketPools(1n);
            const pool = await ethers.getContractAt("BasketLiquidityPool", poolAddress);

            expect(await pool.basketToken()).to.equal(tokenAddress);
            expect(await pool.oracle()).to.equal(await basketOracle.getAddress());
            expect(await pool.basketId()).to.equal(1n);
            expect(await pool.swapFeeBps()).to.equal(30n);
        });

        it("Should transfer pool ownership to creator", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const poolAddress = await basketFactory.basketPools(1n);
            const pool = await ethers.getContractAt("BasketLiquidityPool", poolAddress);

            expect(await pool.owner()).to.equal(fundCreatorAddr);
        });

        it("Should emit event with pool address", async function () {
            const tx = await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            const receipt = await tx.wait();
            const factoryInterface = basketFactory.interface;
            const event = receipt?.logs
                .map((log: any) => {
                    try {
                        return factoryInterface.parseLog({ topics: log.topics as string[], data: log.data });
                    } catch {
                        return null;
                    }
                })
                .find((e: any) => e?.name === "BasketCreatedWithToken");

            expect(event?.args?.poolAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should create unique pools for each basket", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            await basketFactory.connect(user1).createBasketWithToken(
                COMMODITY_BASKET_ASSETS,
                COMMODITY_BASKET_WEIGHTS,
                "Precious Metals",
                "eMETAL"
            );

            const pool1 = await basketFactory.basketPools(1n);
            const pool2 = await basketFactory.basketPools(2n);

            expect(pool1).to.not.equal(ethers.ZeroAddress);
            expect(pool2).to.not.equal(ethers.ZeroAddress);
            expect(pool1).to.not.equal(pool2);
        });
    });

    describe("Native MNT Deposits", function () {
        let basketId: bigint;
        let tokenAddress: string;

        beforeEach(async function () {
            // Create basket via factory
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
            basketId = 1n;
            tokenAddress = await basketFactory.basketTokens(basketId);
        });

        it("Should accept native MNT deposits", async function () {
            const depositAmount = ethers.parseEther("100"); // 100 MNT

            await expect(
                basketVault.connect(user1).depositCollateral(basketId, { value: depositAmount })
            ).to.changeEtherBalance(user1, -depositAmount);

            expect(await basketVault.userCollateral(user1Addr, basketId)).to.equal(depositAmount);
        });

        it("Should allow minting after depositing collateral", async function () {
            const depositAmount = ethers.parseEther("1000"); // 1000 MNT
            const mintAmount = ethers.parseEther("0.1"); // 0.1 basket tokens

            // Deposit collateral
            await basketVault.connect(user1).depositCollateral(basketId, { value: depositAmount });

            // Mint basket tokens
            await basketVault.connect(user1).mintBasket(basketId, mintAmount);

            const token = await ethers.getContractAt("EquiBasketToken", tokenAddress);
            expect(await token.balanceOf(user1Addr)).to.equal(mintAmount);
        });

        it("Should return native MNT on withdrawal", async function () {
            const depositAmount = ethers.parseEther("100");
            const withdrawAmount = ethers.parseEther("50");

            await basketVault.connect(user1).depositCollateral(basketId, { value: depositAmount });

            await expect(
                basketVault.connect(user1).withdrawCollateral(basketId, withdrawAmount)
            ).to.changeEtherBalance(user1, withdrawAmount);
        });

        it("Should return native MNT when burning tokens", async function () {
            const depositAmount = ethers.parseEther("1000");
            const mintAmount = ethers.parseEther("0.1");

            // Deposit and mint
            await basketVault.connect(user1).depositCollateral(basketId, { value: depositAmount });
            await basketVault.connect(user1).mintBasket(basketId, mintAmount);

            // Burn tokens
            const initialBalance = await ethers.provider.getBalance(user1Addr);
            const tx = await basketVault.connect(user1).burnBasket(basketId, mintAmount);
            const receipt = await tx.wait();
            const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
            const finalBalance = await ethers.provider.getBalance(user1Addr);

            // User should have received collateral back (minus gas)
            expect(finalBalance).to.be.gt(initialBalance - gasUsed);
        });
    });

    describe("Basket Price Calculation", function () {
        beforeEach(async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
        });

        it("Should calculate correct basket price", async function () {
            // Tech basket: 50% AAPL ($150), 30% NVDA ($500), 20% MSFT ($300)
            // Expected: 0.5 * 150 + 0.3 * 500 + 0.2 * 300 = 75 + 150 + 60 = $285
            const price = await basketOracle.getBasketPrice(1n);
            expect(price).to.equal(ethers.parseEther("285"));
        });

        it("Should update price when asset prices change", async function () {
            const initialPrice = await basketOracle.getBasketPrice(1n);

            // Double NVDA price
            await basketOracle.setAssetPrice("NVDA", ethers.parseEther("1000"));

            const newPrice = await basketOracle.getBasketPrice(1n);
            // New price: 0.5 * 150 + 0.3 * 1000 + 0.2 * 300 = 75 + 300 + 60 = $435
            expect(newPrice).to.equal(ethers.parseEther("435"));
            expect(newPrice).to.be.gt(initialPrice);
        });
    });

    describe("Collateral Ratio Management", function () {
        let basketId: bigint;

        beforeEach(async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );
            basketId = 1n;
        });

        it("Should enforce minimum collateral ratio for minting", async function () {
            const depositAmount = ethers.parseEther("100"); // 100 MNT = $50
            const tooMuchMint = ethers.parseEther("1"); // 1 basket token = $285

            await basketVault.connect(user1).depositCollateral(basketId, { value: depositAmount });

            await expect(
                basketVault.connect(user1).mintBasket(basketId, tooMuchMint)
            ).to.be.revertedWithCustomError(basketVault, "InsufficientCollateral");
        });

        it("Should allow minting with sufficient collateral", async function () {
            // Basket price: $285
            // To mint 0.1 tokens ($28.5), need $142.5 collateral (500% ratio)
            // At $0.50 per MNT, need 285 MNT
            const depositAmount = ethers.parseEther("300"); // 300 MNT = $150
            const mintAmount = ethers.parseEther("0.1");

            await basketVault.connect(user1).depositCollateral(basketId, { value: depositAmount });
            await basketVault.connect(user1).mintBasket(basketId, mintAmount);

            expect(await basketVault.userDebt(user1Addr, basketId)).to.equal(mintAmount);
        });

        it("Should calculate collateral ratio correctly", async function () {
            const depositAmount = ethers.parseEther("1000"); // 1000 MNT = $500
            const mintAmount = ethers.parseEther("0.1"); // 0.1 tokens = $28.5

            await basketVault.connect(user1).depositCollateral(basketId, { value: depositAmount });
            await basketVault.connect(user1).mintBasket(basketId, mintAmount);

            const position = await basketVault.getUserPosition(user1Addr, basketId);
            // Collateral ratio = ($500 / $28.5) * 100 = 1754%
            expect(position[2]).to.be.gt(1700n); // Should be > 1700%
        });
    });

    describe("Multi-Basket Isolation", function () {
        it("Should keep basket positions isolated", async function () {
            // Create two baskets
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            await basketFactory.connect(fundCreator).createBasketWithToken(
                COMMODITY_BASKET_ASSETS,
                COMMODITY_BASKET_WEIGHTS,
                "Precious Metals",
                "eMETAL"
            );

            // User deposits to basket 1
            await basketVault.connect(user1).depositCollateral(1n, { value: ethers.parseEther("1000") });
            await basketVault.connect(user1).mintBasket(1n, ethers.parseEther("0.1"));

            // User deposits to basket 2 (commodity basket price ~$1407.5)
            // To mint 0.05 tokens ($70.375), need $351.875 collateral (500% ratio)
            // At $0.50 per MNT, need ~704 MNT
            await basketVault.connect(user1).depositCollateral(2n, { value: ethers.parseEther("800") });
            await basketVault.connect(user1).mintBasket(2n, ethers.parseEther("0.05"));

            // Check positions are separate
            expect(await basketVault.userCollateral(user1Addr, 1n)).to.equal(ethers.parseEther("1000"));
            expect(await basketVault.userCollateral(user1Addr, 2n)).to.equal(ethers.parseEther("800"));
            expect(await basketVault.userDebt(user1Addr, 1n)).to.equal(ethers.parseEther("0.1"));
            expect(await basketVault.userDebt(user1Addr, 2n)).to.equal(ethers.parseEther("0.05"));
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero deposits gracefully", async function () {
            await basketFactory.connect(fundCreator).createBasketWithToken(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Tech Giants",
                "eTECH"
            );

            await expect(
                basketVault.connect(user1).depositCollateral(1n, { value: 0 })
            ).to.be.revertedWithCustomError(basketVault, "InvalidAmount");
        });

        it("Should prevent minting for non-existent baskets", async function () {
            await expect(
                basketVault.connect(user1).depositCollateral(999n, { value: ethers.parseEther("100") })
            ).to.be.revertedWithCustomError(basketVault, "BasketDoesNotExist");
        });

        it("Should prevent minting tokens without registered token", async function () {
            // Create basket directly in registry (bypassing factory)
            await basketRegistry.connect(fundCreator).createBasket(
                TECH_BASKET_ASSETS,
                TECH_BASKET_WEIGHTS,
                "Unregistered",
                "UNREG"
            );

            const basketId = await basketRegistry.basketCount();

            await basketVault.connect(user1).depositCollateral(basketId, { value: ethers.parseEther("1000") });

            await expect(
                basketVault.connect(user1).mintBasket(basketId, ethers.parseEther("0.1"))
            ).to.be.revertedWithCustomError(basketVault, "BasketTokenNotRegistered");
        });
    });
});
