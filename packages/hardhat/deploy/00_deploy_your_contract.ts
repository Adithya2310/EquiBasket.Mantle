import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * EquiBaskets Deployment Script (with Factory)
 * 
 * This script deploys the complete EquiBaskets contract infrastructure
 * including the BasketFactory for automatic token creation.
 * 
 * Contracts deployed:
 * 1. BasketRegistry - Basket metadata storage
 * 2. BasketOracle - Price aggregation for baskets
 * 3. BasketVault - Collateral management with native MNT
 * 4. BasketFactory - Creates baskets with tokens automatically
 * 5. Sample basket created via factory (fully configured)
 * 
 * With the factory, users can create new baskets through the UI
 * and the token will be automatically deployed and registered!
 */
const deployEquiBaskets: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const { ethers } = hre;
  const network = hre.network.name;

  console.log("🚀 Deploying EquiBaskets (with Factory) deployer:", deployer);
  console.log("📍 Network:", network);
  console.log("💎 Using NATIVE MNT as collateral");
  console.log("🏭 Factory will auto-create tokens when baskets are created!");

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
  const basketFactory = await deploy("BasketFactory", {
    from: deployer,
    args: [basketRegistry.address, basketVault.address],
    log: true,
  });
  console.log("✅ BasketFactory deployed at:", basketFactory.address);

  // ============================================================
  // 5️⃣ Configure Factory Authorization
  // ============================================================

  console.log("\n🔧 Configuring factory authorization...");
  const vaultContract = await ethers.getContractAt("BasketVault", basketVault.address);
  const setFactoryTx = await vaultContract.setAuthorizedFactory(basketFactory.address);
  await setFactoryTx.wait();
  console.log("✅ Factory authorized to register basket tokens");

  // ============================================================
  // 6️⃣ Create Sample Basket via Factory
  // ============================================================

  console.log("\n🧺 Creating sample basket via Factory: E-Commerce Giants...");

  const factoryContract = await ethers.getContractAt("BasketFactory", basketFactory.address);

  // E-Commerce basket: AMZN, SHOP, EBAY, MELI
  const sampleAssets = ["AMZN", "SHOP", "EBAY", "MELI"];
  const sampleWeights = [4000, 2500, 2000, 1500]; // Basis points (sum = 10000)

  const createTx = await factoryContract.createBasketWithToken(
    sampleAssets,
    sampleWeights,
    "E-Commerce Giants",
    "ECOMM"
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

  console.log("✅ Created basket ID:", basketId.toString());
  console.log("✅ Token automatically deployed at:", tokenAddress);
  console.log("✅ Token automatically registered in vault");

  // ============================================================
  // 🎯 Deployment Summary
  // ============================================================

  console.log("\n" + "=".repeat(60));
  console.log("🎯 EQUIBASKETS DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\n📋 Contract Addresses:");
  console.log({
    Network: network,
    Collateral: "NATIVE MNT (msg.value)",
    BasketRegistry: basketRegistry.address,
    BasketOracle: basketOracle.address,
    BasketVault: basketVault.address,
    BasketFactory: basketFactory.address,
    SampleBasketId: basketId.toString(),
    SampleToken: tokenAddress,
  });

  console.log("\n📊 Sample Basket Details:");
  console.log({
    Name: "E-Commerce Giants",
    Symbol: "ECOMM",
    Assets: sampleAssets.join(", "),
    Weights: sampleWeights.map(w => (w / 100) + "%").join(", "),
  });

  console.log("\n💡 How It Works Now:");
  console.log("1. Create baskets via BasketFactory.createBasketWithToken() - token auto-created!");
  console.log("2. Call depositCollateral(basketId) with { value: amount } - deposit native MNT");
  console.log("3. Call mintBasket(basketId, amount) - mint basket tokens");
  console.log("4. Call burnBasket(basketId, amount) - burn tokens and get MNT back");
  console.log("=".repeat(60) + "\n");
};

export default deployEquiBaskets;
deployEquiBaskets.tags = ["EquiBaskets"];
