# EquiBaskets 🌍📊

> Invest in global markets through on-chain baskets — no brokers, no borders.

Ever wanted exposure to global stocks, indices, or themes like *Tech*, *AI*, or *Emerging Markets* without dealing with brokers, paperwork, or geographic restrictions?

**EquiBaskets** makes it simple.

We let you create, mint, and trade **EquiBaskets** — on-chain basket tokens that represent a collection of real-world assets. Each basket tracks the combined price of multiple global assets, all accessible 24/7 directly from your crypto wallet.

No banks. No brokers. Just transparent, on-chain investing.

---

## 🚀 What Makes EquiBaskets Special?

* **Basket-Based Investing**
  Invest in multiple assets at once through a single token (like an on-chain index or fund)

* **Fund Creator Model**
  Anyone can create and publish a basket by selecting assets and assigning weights

* **MNT-Backed Security**
  Every basket position is overcollateralized using **MNT**, Mantle’s native token

* **Real-Time Global Prices**
  Powered by **Pyth Network**, delivering fast and reliable price feeds for global assets

* **Trade Anytime**
  Buy and sell basket tokens 24/7 — no market hours, no intermediaries

* **Automated Risk Protection**
  Vincent continuously monitors positions and triggers liquidations when needed to keep the system healthy

* **Permissionless & Global**
  Anyone, anywhere can participate with just a wallet

---

## 🏗️ How Does It Work?

### 1. **Creating an EquiBasket**

Fund creators define a basket by:

* Choosing multiple real-world assets
* Assigning weights to each asset
* Publishing the basket on-chain

This creates a new **EquiBasket token** that represents the basket’s combined value.

---

### 2. **Minting Basket Tokens**

Users deposit **MNT** as collateral and mint basket tokens based on the basket’s live price.

We require **high overcollateralization** to ensure safety — this protects the system even during volatile market moves.

```
Deposit MNT → Mint EquiBasket tokens → Trade or hold
```

---

### 3. **Accurate Pricing with Pyth**

Each basket’s price is calculated dynamically using **Pyth Network** price feeds.

The oracle:

* Fetches prices for every asset in the basket
* Applies the basket weights
* Returns a single, accurate basket price on-chain

This ensures basket values always reflect real global markets.

---

### 4. **Trading Baskets**

Once minted, EquiBasket tokens can be traded directly using **MNT** through on-chain liquidity pools.

Think of it like a global index exchange that never sleeps.

---

### 5. **Automated Safety with Vincent**

Vincent acts as the system’s guardian.

It:

* Continuously monitors collateral ratios
* Detects risky positions
* Automatically executes liquidations when needed

This keeps the protocol solvent and protects all participants.

---

## 💡 EquiBaskets vs Traditional Investing

| Traditional Funds & Brokers | EquiBaskets                   |
| --------------------------- | ----------------------------- |
| Geographic restrictions     | Accessible globally           |
| Manual fund management      | On-chain, transparent baskets |
| High fees & commissions     | Minimal protocol fees         |
| Limited trading hours       | Trade 24/7                    |
| Custodial ownership         | Non-custodial                 |
| Slow settlement             | Instant on-chain settlement   |

---

## 🔐 How We Keep Things Safe

* **Overcollateralization**
  All positions are backed by excess MNT collateral

* **Reliable Price Feeds**
  Pyth aggregates data from institutional-grade sources

* **Automated Liquidations**
  Vincent prevents bad debt before it spreads

* **Full Transparency**
  All logic lives on-chain and is publicly verifiable

* **Security First**
  Smart contracts designed with clear separation of concerns

---

## 🛠️ Tech Stack

* **Blockchain**: Mantle Network
* **Collateral Token**: MNT
* **Price Feeds**: Pyth Network
* **Automation**: Vincent
* **Smart Contracts**: Solidity
* **Frontend**: React / Next.js
* **Wallet Integration**: EVM-compatible wallets

---

## 📦 Getting Started

### Prerequisites

* A crypto wallet (MetaMask or similar)
* Some MNT tokens
* Access to Mantle network

### Setup

```bash
# Clone the repo
git clone https://github.com/Adithya2310/EquiBlock.git

# Move into project directory
cd EquiBlock

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

# Run locally
npm run dev
```

---

## 📖 Using EquiBaskets

### Minting Basket Tokens

1. Connect your wallet
2. Select a basket
3. Deposit MNT as collateral
4. Mint basket tokens
5. Track your position health in the dashboard

---

### Trading Basket Tokens

1. Navigate to the Trade page
2. Choose a basket
3. Buy or sell using MNT
4. Confirm the transaction in your wallet

---

### Managing Risk

* Monitor your collateral ratio
* Add more MNT to stay safe
* Burn basket tokens to redeem collateral anytime

---

## 🤝 Contributing

We welcome contributors!

1. Fork the repository
2. Create a new branch
3. Make your changes
4. Open a pull request

See `CONTRIBUTING.md` for more details.

---

## 📄 License

MIT License — see `LICENSE` for details.

---

## 🔗 Links

* **Website**: [https://equiblock.vercel.app/](https://equiblock.vercel.app/)
* **Mantle Global Hackathon 2025 Submission**: Coming soon

---

**Built with ❤️ for the Mantle Global Hackathon 2025**