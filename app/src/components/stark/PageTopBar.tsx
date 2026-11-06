"use client";

import type { PropsWithChildren } from "react";

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

function TopBarSearchAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="home-header-action"
      aria-label="搜索"
      title="搜索"
      onClick={onClick}
    >
      <SearchIcon size={24} strokeWidth={1.8} />
    </button>
  );
}

export function PageTopBar({ title, onSearch }: { title: string; onSearch?: () => void }) {
  return (
    <header className="home-topbar">
      <span />
      <h1>{title}</h1>
      <div className="home-actions">
        {onSearch ? <TopBarSearchAction onClick={onSearch} /> : null}
      </div>
    </header>
  );
}
