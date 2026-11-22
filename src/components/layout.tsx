import type { ReactNode } from "react";

export function AppBar({ children }: { children?: ReactNode }) {
  return (
    <header className="appbar">
      <div className="appbar__in">
        <span className="brand">
          <img className="brand__logo" src="/tenrai-logo-white.png" alt="Tenrai" width="960" height="224" />
          <span className="brand__name">Wallet</span>
        </span>
        {children}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-foot">
      <div className="site-foot__in">
        <img className="site-foot__logo" src="/tenrai-logo-technologies-white.png" alt="Tenrai Technologies" width="960" height="224" />
        <nav className="site-foot__links" aria-label="Tenrai">
          <a href="https://tenrai-technologies.org/">Website</a>
          <a href="https://explorer.tenrai-technologies.org/">Explorer</a>
          <a href="https://api.tenrai-technologies.org/">API</a>
          <a href="https://docs.tenrai-technologies.org/">Docs</a>
          <a href="https://github.com/tenrai-technologies/">GitHub</a>
        </nav>
        <p className="site-foot__copy">
          © <a href="https://tenrai-technologies.org/">Tenrai Technologies</a>
        </p>
      </div>
    </footer>
  );
}
