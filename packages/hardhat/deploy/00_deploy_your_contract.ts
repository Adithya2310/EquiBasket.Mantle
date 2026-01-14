import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * EquiBaskets Core Contract Deployment Script
 * 
 * Deploys only the core infrastructure:
 * 1. BasketRegistry - Basket metadata storage
 * 2. BasketOracle - Price aggregation for baskets
 * 3. BasketVault - Collateral management with native MNT
 * 4. BasketFactory - Creates baskets with tokens and pools automatically
 * 
 * NO sample baskets are created - users create baskets via the UI.
 */
const deployEquiBaskets: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const { ethers } = hre;
  const network = hre.network.name;

  console.log("🚀 Deploying EquiBaskets Core Infrastructure");
  console.log("📍 Network:", network);
  console.log("� Deployer:", deployer);
  console.log("� Collateral: Native MNT (msg.value)");

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

  console.log("\n📦 Deploying BasketVault...");
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

  // ============================================================
  // 5️⃣ Configure Factory Authorization
  // ============================================================

  console.log("\n🔧 Configuring factory authorization...");
  const vaultContract = await ethers.getContractAt("BasketVault", basketVault.address);
  const setFactoryTx = await vaultContract.setAuthorizedFactory(basketFactory.address);
  await setFactoryTx.wait();
  console.log("✅ Factory authorized to register basket tokens");

  // ============================================================
  // 6️⃣ Set MNT Price in Oracle
  // ============================================================

  console.log("\n💹 Setting MNT price in oracle...");
  const oracleContract = await ethers.getContractAt("BasketOracle", basketOracle.address);
  const mntPrice = ethers.parseEther("0.5"); // $0.50
  const mntPriceTx = await oracleContract.setMntPrice(mntPrice);
  await mntPriceTx.wait();
  console.log("✅ MNT price set to $0.50");

  // ============================================================
  // 🎯 Deployment Summary
  // ============================================================

  console.log("\n" + "=".repeat(60));
  console.log("🎯 EQUIBASKETS CORE DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\n📋 Contract Addresses:");
  console.log({
    Network: network,
    BasketRegistry: basketRegistry.address,
    BasketOracle: basketOracle.address,
    BasketVault: basketVault.address,
    BasketFactory: basketFactory.address,
  });

  console.log("\n� Next Steps:");
  console.log("  1. Create baskets via UI (Create Basket page)");
  console.log("  2. Factory auto-deploys token + liquidity pool");
  console.log("  3. Oracle prices should be set for basket assets");
  console.log("\n📝 To set asset prices, use BasketOracle.setAssetPrice(symbol, price)");
  console.log("=".repeat(60) + "\n");
};

export default deployEquiBaskets;
deployEquiBaskets.tags = ["EquiBaskets"];
