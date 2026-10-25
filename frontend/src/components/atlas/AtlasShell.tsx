import type { ReactNode } from "react";
import { admissionCopy, type AdmissionStatus } from "@/lib/admissions";

export function AtlasShell({
  children,
  inspector = false,
  admissions,
  recorded = false,
  nav,
  metaLabel,
  skipLabel = "Skip to the investigation",
}: {
  children: ReactNode;
  inspector?: boolean;
  admissions: AdmissionStatus;
  recorded?: boolean;
  nav?: ReactNode;
  metaLabel?: string;
  skipLabel?: string;
}) {
  const copy = admissionCopy(admissions);
  return (
    <div className={inspector ? "atlas atlas--inspector" : "atlas"} data-testid="atlas-app" data-admissions={admissions} data-recorded={recorded ? "true" : "false"}>
      <a className="skip" href="#atlas-main">{skipLabel}</a>
      <header className="mast">
        <div className="mast__brand">
          <p className="mast__mark">Cultural Elasticity</p>
          <p className="mast__edition">Cultural Observatory</p>
        </div>
        {nav}
        <p className="mast__meta">{metaLabel ?? copy.shortLabel}</p>
      </header>
      <main id="atlas-main">{children}</main>
    </div>
  );
}
