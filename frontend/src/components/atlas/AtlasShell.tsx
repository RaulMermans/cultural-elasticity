import type { ReactNode } from "react";

export function AtlasShell({ children, inspector = false }: { children: ReactNode; inspector?: boolean }) {
  return (
    <div className={inspector ? "atlas atlas--inspector" : "atlas"}>
      <a className="skip" href="#atlas-main">Skip to the investigation</a>
      <header className="mast">
        <p className="mast__mark">Cultural Elasticity</p>
        <p className="mast__edition">Living Atlas</p>
      </header>
      <main id="atlas-main">{children}</main>
    </div>
  );
}
