import type { ReactNode } from "react";
import { admissionCopy, type AdmissionStatus } from "@/lib/admissions";

export function AtlasShell({
  children,
  inspector = false,
  admissions,
  recorded = false,
}: {
  children: ReactNode;
  inspector?: boolean;
  admissions: AdmissionStatus;
  recorded?: boolean;
}) {
  const copy = admissionCopy(admissions);
  return (
    <div className={inspector ? "atlas atlas--inspector" : "atlas"} data-testid="atlas-app" data-admissions={admissions} data-recorded={recorded ? "true" : "false"}>
      <a className="skip" href="#atlas-main">Skip to the investigation</a>
      <header className="mast">
        <div className="mast__brand">
          <p className="mast__mark">Cultural Elasticity</p>
          <p className="mast__edition">Cultural Observatory</p>
        </div>
        <p className="mast__meta">{copy.shortLabel}</p>
      </header>
      <main id="atlas-main">{children}</main>
    </div>
  );
}
