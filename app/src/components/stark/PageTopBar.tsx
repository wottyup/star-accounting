"use client";

import type { PropsWithChildren } from "react";
import Link from "next/link";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

function IconBase({ children, size = 24, color = "currentColor", strokeWidth = 2 }: PropsWithChildren<IconProps>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </IconBase>
  );
}

export function TopBarSearchAction() {
  return (
    <Link
      href="/app/consumption#bill-search"
      className="home-header-action"
      aria-label="搜索"
      title="搜索"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!window.location.pathname.replace(/\/$/, "").endsWith("/app/consumption")) return;
        event.preventDefault();
        window.dispatchEvent(new Event("stark:focus-bill-search"));
      }}
    >
      <SearchIcon size={24} strokeWidth={1.8} />
    </Link>
  );
}

export function PageTopBar({ title }: { title: string }) {
  return (
    <header className="home-topbar">
      <span />
      <h1>{title}</h1>
      <div className="home-actions">
        <TopBarSearchAction />
      </div>
    </header>
  );
}
