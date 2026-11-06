"use client";

export function PageTopBar({ title }: { title: string }) {
  return (
    <header className="home-topbar">
      <span />
      <h1>{title}</h1>
      <div className="home-actions" />
    </header>
  );
}
