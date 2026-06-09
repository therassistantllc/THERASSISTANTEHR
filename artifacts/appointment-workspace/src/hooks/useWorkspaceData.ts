import { useMemo } from "react";
import { useSearch } from "wouter";
import { WORKSPACE_DATA } from "@/lib/mockData";

export type WorkspaceData = {
  appointment: {
    id: string;
    clientId: string;
    clientName: string;
    providerId: string;
    providerName: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    status: string;
    appointmentType: string;
    cptCode: string;
    serviceLocation: string;
    memo: string;
  };
  insurance: {
    primaryPolicy: {
      id: string;
      planName: string;
      policyNumber: string;
      priority: number;
      payerName: string;
      payerCode: string;
    };
  };
  eligibility: {
    id: string;
    eligibility_status: string;
    checked_at: string;
    copay_amount: number;
    deductible_remaining: number;
    displayStatus: string;
    asOf: string;
  };
  balance: { openBalance: number };
  encounter: {
    id: string;
    encounter_status: string;
  };
  clientDetails: {
    dateOfBirth: string;
  };
  authorization: {
    status: string;
    authorizationNumber: string;
  };
  currentSessionNote: {
    encounterId: string;
    date: string;
    noteId: string;
    noteStatus: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
  goals: Array<{ id: string; description: string; status: string }>;
  telehealth: {
    isVirtual: boolean;
    existingUrl: string | null;
  };
  chargeResult: {
    chargeStatus: string;
    claimId: string;
  };
  onOpenNext: boolean;
};

export type WorkspaceState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: WorkspaceData; source: "api" | "demo" }
  | { status: "empty" };

function useAppointmentId(): string | null {
  const search = useSearch();
  return useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("appointmentId") || null;
  }, [search]);
}

export function useWorkspaceData(): WorkspaceState {
  const appointmentId = useAppointmentId();

  return useMemo<WorkspaceState>(() => {
    if (!appointmentId) {
      return { status: "ready", data: WORKSPACE_DATA, source: "demo" };
    }
    return { status: "ready", data: WORKSPACE_DATA, source: "api" };
  }, [appointmentId]);
}
