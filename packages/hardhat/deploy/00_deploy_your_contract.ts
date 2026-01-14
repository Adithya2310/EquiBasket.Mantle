import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * EquiBaskets Complete Deployment Script
 * 
 * This script deploys the complete EquiBaskets contract infrastructure:
 * 
 * Core Contracts:
 * 1. BasketRegistry - Basket metadata storage
 * 2. BasketOracle - Price aggregation for baskets
 * 3. BasketVault - Collateral management with native MNT
 * 4. BasketFactory - Creates baskets with tokens automatically
 * 
 * Trading Infrastructure:
 * 5. MockMNT - ERC20 MNT for liquidity pool trading
 * 6. BasketLiquidityPool - Trading pool for MNT ↔ BasketToken swaps
 * 
 * Sample Data:
 * 7. Sample "AI Focus" basket created via factory
 * 8. Asset prices registered for AI basket
 */
const deployEquiBaskets: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const { ethers } = hre;
  const network = hre.network.name;

  console.log("🚀 Deploying EquiBaskets (Complete) deployer:", deployer);
  console.log("📍 Network:", network);
  console.log("💎 Using NATIVE MNT as collateral for minting");
  console.log("💱 Using ERC20 MockMNT for liquidity pool trading");

  // ============================================================
  // 1️⃣ Deploy BasketRegistry
  // ============================================================

  console.log("\n📦 Deploying BasketRegistry...");
  const basketRegistry = await deploy("BasketRegistry", {
    from: deployer,
    args: [],
    log: true,
  });
  console.log("✅ BasketRegistry deployed at:", basketRegistry.address);

  // ============================================================
  // 2️⃣ Deploy BasketOracle
  // ============================================================

  console.log("\n📦 Deploying BasketOracle...");
  const basketOracle = await deploy("BasketOracle", {
    from: deployer,
    args: [basketRegistry.address],
    log: true,
  });
  console.log("✅ BasketOracle deployed at:", basketOracle.address);

  // ============================================================
  // 3️⃣ Deploy BasketVault (uses native MNT)
  // ============================================================

  console.log("\n📦 Deploying BasketVault (uses native MNT via msg.value)...");
  const basketVault = await deploy("BasketVault", {
    from: deployer,
    args: [basketRegistry.address, basketOracle.address],
    log: true,
  });
  console.log("✅ BasketVault deployed at:", basketVault.address);

  // ============================================================
  // 4️⃣ Deploy BasketFactory
  // ============================================================

  console.log("\n📦 Deploying BasketFactory...");
  const defaultSwapFeeBps = 30; // 0.30% default swap fee for pools
  const basketFactory = await deploy("BasketFactory", {
    from: deployer,
    args: [basketRegistry.address, basketOracle.address, basketVault.address, defaultSwapFeeBps],
    log: true,
  });
  console.log("✅ BasketFactory deployed at:", basketFactory.address);
  console.log("✅ Default swap fee set to:", defaultSwapFeeBps / 100, "%");

  // ============================================================
  // 5️⃣ Configure Factory Authorization
  // ============================================================

  console.log("\n🔧 Configuring factory authorization...");
  const vaultContract = await ethers.getContractAt("BasketVault", basketVault.address);
  const setFactoryTx = await vaultContract.setAuthorizedFactory(basketFactory.address);
  await setFactoryTx.wait();
  console.log("✅ Factory authorized to register basket tokens");

  // ============================================================
  // 6️⃣ Create Sample Basket via Factory: AI Focus
  // ============================================================

  console.log("\n🧺 Creating sample basket via Factory: AI Focus...");

  const factoryContract = await ethers.getContractAt("BasketFactory", basketFactory.address);

  // AI Focus basket: NVDA, MSFT, GOOGL, AMZN
  const sampleAssets = ["NVDA", "MSFT", "GOOGL", "AMZN"];
  const sampleWeights = [4000, 2500, 2000, 1500]; // Basis points (sum = 10000)

  const createTx = await factoryContract.createBasketWithToken(
    sampleAssets,
    sampleWeights,
    "AI Focus",
    "AIBASKET"
  );
  const receipt = await createTx.wait();

  // Parse event to get basketId and token address
  const factoryInterface = (await ethers.getContractFactory("BasketFactory")).interface;
  const event = receipt?.logs
    .map((log: any) => {
      try {
        return factoryInterface.parseLog({ topics: log.topics as string[], data: log.data });
      } catch {
        return null;
      }
    })
    .find((e: any) => e?.name === "BasketCreatedWithToken");

  const basketId = event?.args?.basketId || 1n;
  const tokenAddress = event?.args?.tokenAddress || "N/A";
  const poolAddress = event?.args?.poolAddress || "N/A";

  console.log("✅ Created basket ID:", basketId.toString());
  console.log("✅ Token automatically deployed at:", tokenAddress);
  console.log("✅ Pool automatically deployed at:", poolAddress);
  console.log("✅ Token automatically registered in vault");

  // ============================================================
  // 8️⃣ Update Asset Prices in Oracle
  // ============================================================

  console.log("\n💹 Updating asset prices in oracle...");
  const oracleContract = await ethers.getContractAt("BasketOracle", basketOracle.address);

  // Set MNT price: $0.50 (in 1e18 format)
  const mntPrice = ethers.parseEther("0.5");
  const mntPriceTx = await oracleContract.setMntPrice(mntPrice);
  await mntPriceTx.wait(); // Wait for transaction to be mined
  console.log("✅ MNT price set to $0.50");

  // Update prices for AI Focus assets (already registered in constructor)
  // Using setAssetPrice which auto-registers if needed and updates if already registered
  // IMPORTANT: Wait for each transaction to be mined to avoid nonce issues
  const assetPrices = {
    "NVDA": ethers.parseEther("140"),   // $140
    "MSFT": ethers.parseEther("420"),   // $420
    "GOOGL": ethers.parseEther("175"),  // $175
    "AMZN": ethers.parseEther("190"),   // $190
  };

  for (const [asset, price] of Object.entries(assetPrices)) {
    const tx = await oracleContract.setAssetPrice(asset, price);
    await tx.wait(); // Wait for transaction to be mined before next one
    console.log(`✅ Updated ${asset} price to $${Number(price) / 1e18}`);
  }

  // NOTE: BasketLiquidityPool is now automatically deployed by the factory
  // when createBasketWithToken is called. No separate deployment needed.

  // ============================================================
  // 🎯 Deployment Summary
  // ============================================================

  console.log("\n" + "=".repeat(60));
  console.log("🎯 EQUIBASKETS COMPLETE DEPLOYMENT DONE!");
  console.log("=".repeat(60));
  console.log("\n📋 Core Contract Addresses:");
  console.log({
    Network: network,
    BasketRegistry: basketRegistry.address,
    BasketOracle: basketOracle.address,
    BasketVault: basketVault.address,
    BasketFactory: basketFactory.address,
  });

  console.log("\n📋 Trading Infrastructure:");
  console.log({
    BasketLiquidityPool: poolAddress,
    Collateral: "Native MNT (msg.value)",
    SwapFee: `${defaultSwapFeeBps / 100}%`,
  });

  console.log("\n📊 Sample Basket - AI Focus:");
  console.log({
    BasketId: basketId.toString(),
    TokenAddress: tokenAddress,
    Symbol: "AIBASKET",
    Assets: sampleAssets.join(", "),
    Weights: sampleWeights.map(w => (w / 100) + "%").join(", "),
  });

  console.log("\n💹 Registered Prices:");
  console.log({
    MNT: "$0.50",
    NVDA: "$140",
    MSFT: "$420",
    GOOGL: "$175",
    AMZN: "$190",
  });

  console.log("\n💡 How To Use:");
  console.log("MINTING (uses native MNT):");
  console.log("  1. depositCollateral(basketId) with { value: amount }");
  console.log("  2. mintBasket(basketId, amount)");
  console.log("  3. burnBasket(basketId, amount)");
  console.log("");
  console.log("TRADING (uses native MNT):");
  console.log("  1. addLiquidity(basketAmount) with { value: mntAmount }");
  console.log("  2. swapMntForBasket() with { value: amount }");
  console.log("  3. swapBasketForMnt(amount)");
  console.log("=".repeat(60) + "\n");
};

export default deployEquiBaskets;
deployEquiBaskets.tags = ["EquiBaskets"];
