"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { CubeIcon, CurrencyDollarIcon, ShieldCheckIcon, SparklesIcon } from "@heroicons/react/24/outline";

/**
 * EquiBaskets Landing Page
 *
 * As per UI Migration document Section 3️⃣:
 * "The landing page is a purely static marketing surface designed to explain
 * EquiBaskets and guide users into the application."
 *
 * No blockchain reads, writes, or wallet interactions.
 * All content is static UI-only.
 */
const Home: NextPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-base-200 to-black">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.1),transparent_50%)]" />
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 relative">
          <div className="text-center max-w-5xl mx-auto fade-in">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2 mb-6">
              <SparklesIcon className="w-4 h-4 text-primary" />
              <span className="text-sm text-primary font-medium">Built on Mantle</span>
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
              Trade Real-World <span className="gradient-text">Baskets</span>.
              <br />
              Instantly. On-Chain.
            </h1>
            <p className="text-xl sm:text-2xl text-white/70 mb-10 max-w-3xl mx-auto">
              Create and trade synthetic equity baskets backed by MNT collateral. Diversified exposure to real-world
              assets, powered by DeFi.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                href="/mint"
                className="btn btn-primary text-white px-8 py-4 text-lg rounded-lg min-w-[200px] shadow-lg shadow-primary/30"
              >
                Launch App
              </Link>
              <Link
                href="/create"
                className="btn bg-base-300 hover:bg-base-200 text-white px-8 py-4 text-lg rounded-lg min-w-[200px] border border-white/20"
              >
                Create Basket
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 sm:py-32">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-primary text-sm font-semibold tracking-wider uppercase mb-3">FEATURES</p>
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Why EquiBaskets?</h2>
            <p className="text-xl text-white/70 max-w-2xl mx-auto">
              The next evolution of synthetic asset trading — basket-based, MNT-backed, and fully decentralized.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Feature 1 */}
            <div className="card-glass p-8 hover:scale-105 transition-transform duration-300 fade-in">
              <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center mb-6">
                <ShieldCheckIcon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Decentralized & Secure</h3>
              <p className="text-white/70 leading-relaxed">
                Experience a trustless platform built on Mantle, ensuring security, low fees, and complete transparency.
              </p>
            </div>

            {/* Feature 2 */}
            <div
              className="card-glass p-8 hover:scale-105 transition-transform duration-300 fade-in"
              style={{ animationDelay: "0.1s" }}
            >
              <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center mb-6">
                <CubeIcon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Synthetic Equity Baskets</h3>
              <p className="text-white/70 leading-relaxed">
                Create or invest in baskets of tokenized equities — tech giants, commodities, or custom compositions.
              </p>
            </div>

            {/* Feature 3 */}
            <div
              className="card-glass p-8 hover:scale-105 transition-transform duration-300 fade-in"
              style={{ animationDelay: "0.2s" }}
            >
              <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center mb-6">
                <CurrencyDollarIcon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-4">MNT-Backed Collateral</h3>
              <p className="text-white/70 leading-relaxed">
                Utilize Mantle&apos;s native MNT token as collateral for a seamless, gas-efficient trading experience.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 sm:py-32 bg-base-200/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-primary text-sm font-semibold tracking-wider uppercase mb-3">PROCESS</p>
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">How It Works</h2>
          </div>

          <div className="max-w-4xl mx-auto space-y-8">
            {/* Step 1 */}
            <div className="flex flex-col md:flex-row items-start gap-6 fade-in">
              <div className="flex-shrink-0 w-16 h-16 rounded-full bg-primary flex items-center justify-center text-2xl font-bold">
                1
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-3">Deposit MNT</h3>
                <p className="text-white/70 text-lg">
                  Connect your wallet and deposit MNT as collateral into the BasketVault smart contract.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col md:flex-row items-start gap-6 fade-in" style={{ animationDelay: "0.1s" }}>
              <div className="flex-shrink-0 w-16 h-16 rounded-full bg-primary flex items-center justify-center text-2xl font-bold">
                2
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-3">Create or Choose a Basket</h3>
                <p className="text-white/70 text-lg">
                  Build your own custom basket with weighted assets, or select from existing community baskets.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col md:flex-row items-start gap-6 fade-in" style={{ animationDelay: "0.2s" }}>
              <div className="flex-shrink-0 w-16 h-16 rounded-full bg-primary flex items-center justify-center text-2xl font-bold">
                3
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-3">Mint Synthetic Baskets</h3>
                <p className="text-white/70 text-lg">
                  Mint basket tokens representing your share of the synthetic basket at a 500% collateral ratio.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex flex-col md:flex-row items-start gap-6 fade-in" style={{ animationDelay: "0.3s" }}>
              <div className="flex-shrink-0 w-16 h-16 rounded-full bg-primary flex items-center justify-center text-2xl font-bold">
                4
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-3">Trade or Redeem Anytime</h3>
                <p className="text-white/70 text-lg">
                  Buy, sell, or burn your basket tokens at any time. Your MNT collateral is always accessible.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <p className="text-4xl font-bold text-primary mb-2">500%</p>
              <p className="text-white/50 text-sm">Collateral Ratio</p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-bold text-primary mb-2">150%</p>
              <p className="text-white/50 text-sm">Liquidation Threshold</p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-bold text-primary mb-2">0.3%</p>
              <p className="text-white/50 text-sm">Swap Fee</p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-bold text-primary mb-2">∞</p>
              <p className="text-white/50 text-sm">Custom Baskets</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 sm:py-32">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="card-glass p-12 text-center max-w-4xl mx-auto">
            <h2 className="text-4xl font-bold mb-4">Ready to Build Your Basket?</h2>
            <p className="text-xl text-white/70 mb-8">Join the future of decentralized basket trading on Mantle.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/mint" className="btn btn-primary text-white px-8 py-4 text-lg rounded-lg min-w-[200px]">
                Start Trading
              </Link>
              <Link
                href="/create"
                className="btn bg-white/10 hover:bg-white/20 text-white px-8 py-4 text-lg rounded-lg min-w-[200px] border border-white/20"
              >
                Create a Basket
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center">
                <CubeIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-lg font-bold">EquiBaskets</span>
                <p className="text-xs text-white/50">© 2024 All rights reserved.</p>
              </div>
            </div>
            <div className="flex gap-8">
              <Link href="/create" className="text-white/70 hover:text-primary transition-colors">
                Create Basket
              </Link>
              <Link href="/mint" className="text-white/70 hover:text-primary transition-colors">
                Mint
              </Link>
              <Link href="/trade" className="text-white/70 hover:text-primary transition-colors">
                Trade
              </Link>
              <a
                href="https://github.com"
                className="text-white/70 hover:text-primary transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
