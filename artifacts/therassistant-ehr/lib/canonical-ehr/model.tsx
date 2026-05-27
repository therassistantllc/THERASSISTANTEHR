import type {
  CanonicalEhrState,
  ClinicalNote,
  Encounter,
  EncounterServiceLine,
  ID,
  WorkqueueItem,
} from "./types";
import { CURRENT_USER_ID, ORG_ID } from "./seed";

function makeId(prefix: string): ID {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function addAudit(state: CanonicalEhrState, entityType: string, entityId: ID, action: "view" | "create" | "update" | "delete" | "sign" | "submit" | "export", afterData: Record<string, unknown>): CanonicalEhrState {
  return {
    ...state,
    audit_logs: [
      {
        id: makeId("audit"),
        organization_id: ORG_ID,
        user_id: CURRENT_USER_ID,
        entity_type: entityType,
        entity_id: entityId,
        action,
        before_data: null,
        after_data: afterData,
        ip_address: "127.0.0.1",
        user_agent: "Therassistant canonical UI",
        created_at: isoNow(),
      },
      ...state.audit_logs,
    ],
  };
}

export function startEncounterFromAppointment(state: CanonicalEhrState, appointmentId: ID): CanonicalEhrState {
  const appointment = state.appointments.find((item) => item.id === appointmentId);
  if (!appointment) return state;
  const existing = state.encounters.find((item) => item.appointment_id === appointmentId);
  if (existing) return state;

  const encounterId = makeId("enc");
  const noteId = makeId("note");
  const serviceLineId = makeId("esl");
  const encounter: Encounter = {
    id: encounterId,
    organization_id: appointment.organization_id,
    patient_id: appointment.patient_id,
    appointment_id: appointment.id,
    clinician_id: appointment.clinician_id,
    supervisor_id: null,
    date_of_service: dateOnly(appointment.scheduled_start),
    start_time: appointment.scheduled_start,
    end_time: appointment.scheduled_end,
    duration_minutes: Math.max(1, Math.round((new Date(appointment.scheduled_end).getTime() - new Date(appointment.scheduled_start).getTime()) / 60000)),
    place_of_service_code: "10",
    service_location: "Telehealth; client located in Colorado",
    encounter_status: "draft",
    documentation_status: "in_progress",
    billing_status: "hold",
    primary_diagnosis_code: appointment.patient_id === "pat-sofia" ? "F43.23" : "F41.1",
    medical_necessity_summary: "Clinical documentation should support medical necessity, functional impairment, intervention, response, risk, and next steps.",
    created_at: isoNow(),
    updated_at: isoNow(),
  };
  const note: ClinicalNote = {
    id: noteId,
    encounter_id: encounterId,
    note_type: "progress",
    note_format: "dap",
    subjective: "Client presentation and subjective report documented during session.",
    objective: "Mental status, engagement, modality, and service location documented.",
    assessment: "Clinical assessment and medical necessity documented.",
    plan: "Plan and follow-up documented.",
    interventions: "Psychotherapy interventions documented.",
    client_response: "Client response documented.",
    risk_assessment: "Risk screen completed. No imminent risk documented in this seed workflow.",
    progress_toward_goals: "Progress toward active treatment plan goals documented.",
    next_steps: "Continue plan and review next appointment.",
    signed_by: null,
    signed_at: null,
    locked: false,
    created_at: isoNow(),
    updated_at: isoNow(),
  };
  const dx = {
    id: makeId("dx"),
    encounter_id: encounterId,
    diagnosis_code: encounter.primary_diagnosis_code,
    diagnosis_description: appointment.patient_id === "pat-sofia" ? "Adjustment disorder with mixed anxiety and depressed mood" : "Generalized anxiety disorder",
    diagnosis_order: 1,
    is_primary: true,
  };
  const serviceLine: EncounterServiceLine = {
    id: serviceLineId,
    encounter_id: encounterId,
    code_type: "CPT",
    procedure_code: appointment.appointment_type.includes("90837") ? "90837" : "90834",
    modifier_1: "95",
    modifier_2: "",
    modifier_3: "",
    modifier_4: "",
    units: 1,
    minutes: encounter.duration_minutes,
    charge_amount: appointment.appointment_type.includes("90837") ? 165 : 125,
    diagnosis_pointer: "A",
    documentation_support_status: "needs_review",
    billing_status: "hold",
    created_at: isoNow(),
    updated_at: isoNow(),
  };
  const wq: WorkqueueItem = {
    id: makeId("wq"),
    organization_id: appointment.organization_id,
    patient_id: appointment.patient_id,
    encounter_id: encounterId,
    claim_id: null,
    professional_claim_id: null,
    payer_id: state.insurance_policies.find((item) => item.id === appointment.insurance_policy_id)?.payer_id ?? null,
    queue_type: "documentation_hold",
    priority: "normal",
    status: "open",
    title: "Documentation hold",
    description: "Encounter created from appointment. Clinical note must be signed before billing.",
    assigned_to: appointment.clinician_id,
    due_date: dateOnly(appointment.scheduled_start),
    defer_until: null,
    resolution_note: null,
    created_at: isoNow(),
    updated_at: isoNow(),
  };

  const nextState: CanonicalEhrState = {
    ...state,
    appointments: state.appointments.map((item) => (item.id === appointment.id ? { ...item, status: "completed", updated_at: isoNow() } : item)),
    encounters: [encounter, ...state.encounters],
    clinical_notes: [note, ...state.clinical_notes],
    encounter_diagnoses: [dx, ...state.encounter_diagnoses],
    encounter_service_lines: [serviceLine, ...state.encounter_service_lines],
    workqueue_items: [wq, ...state.workqueue_items],
    workqueue_events: [
      {
        id: makeId("wqe"),
        workqueue_item_id: wq.id,
        event_type: "created",
        note: "Encounter started from appointment.",
        created_by: CURRENT_USER_ID,
        created_at: isoNow(),
      },
      ...state.workqueue_events,
    ],
  };
  return addAudit(nextState, "encounter", encounterId, "create", { appointment_id: appointment.id });
}
