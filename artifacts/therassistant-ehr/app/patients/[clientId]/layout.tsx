import type React from "react";
import PatientContextBanner from "@/components/layout/PatientContextBanner";
import PatientTabNav from "./PatientTabNav";
import styles from "@/components/layout/AppShell.module.css";

export default async function PatientChartLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  return (
    <>
      <div className={styles.patientStickyGroup}>
        <PatientContextBanner clientId={clientId} />
        <PatientTabNav clientId={clientId} />
      </div>
      {children}
    </>
  );
}
