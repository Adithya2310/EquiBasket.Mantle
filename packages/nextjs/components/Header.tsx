"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon, CubeIcon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

type HeaderMenuLink = {
  label: string;
  href: string;
};

export const menuLinks: HeaderMenuLink[] = [
  {
    label: "Create Basket",
    href: "/create",
  },
  {
    label: "Mint & Burn",
    href: "/mint",
  },
  {
    label: "Trade",
    href: "/trade",
  },
  {
    label: "Dashboard",
    href: "/dashboard",
  },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              className={`${
                isActive ? "text-primary" : "text-white/70"
              } hover:text-primary transition-colors duration-200 py-2 px-4 text-sm font-medium`}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * EquiBaskets Header
 */
export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <div className="sticky top-0 navbar bg-base-100/80 backdrop-blur-md min-h-0 shrink-0 justify-between z-50 border-b border-white/10 px-4 sm:px-6 lg:px-8">
      <div className="navbar-start w-auto lg:w-1/2">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost lg:hidden hover:bg-transparent text-white">
            <Bars3Icon className="h-6 w-6" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content mt-3 p-2 bg-base-200 rounded-lg w-52 border border-white/10"
            onClick={() => {
              burgerMenuRef?.current?.removeAttribute("open");
            }}
          >
            <HeaderMenuLinks />
          </ul>
        </details>
        <Link href="/" className="flex items-center gap-3 ml-2 lg:ml-0">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center">
            <CubeIcon className="w-6 h-6 text-white" />
          </div>
          <div className="hidden sm:block">
            <span className="font-bold text-xl text-white">EquiBaskets</span>
            <span className="text-xs text-white/50 block">Powered by Mantle</span>
          </div>
        </Link>
        <ul className="hidden lg:flex lg:flex-nowrap menu menu-horizontal px-1 gap-1 ml-8">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end flex items-center gap-3">
        {/* Network indicator */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-full">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
          <span className="text-xs text-primary font-medium">Mantle</span>
        </div>
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
