export type AppointmentStatus =
  | "scheduled"
  | "checked_in"
  | "in_session"
  | "needs_signature"
  | "completed"
  | "no_show"
  | "cancelled";

export interface ScheduleAppointment {
  id: string;
  clientId: string;
  patientName: string;
  dob: string;
  timeStart: string;
  timeEnd: string;
  startMinutes: number;
  durationMin: number;
  type: string;
  cpt: string;
  provider: string;
  location: "Office" | "Telehealth";
  insurance: string;
  status: AppointmentStatus;
  alerts: { text: string; tone: "amber" | "red" | "blue" | "purple" }[];
  recentNote: string | null;
  diagnoses: string[];
  tasks: { text: string; priority: "high" | "med" | "low" }[];
  copay: string | null;
}

export const DATE_LABEL = "Tuesday, May 19, 2026";
export const DATE_SHORT = "Tue, May 19";

export const APPOINTMENTS: ScheduleAppointment[] = [
  {
    id: "appt-a1",
    clientId: "c1",
    patientName: "Elena Rodriguez",
    dob: "1989-03-14",
    timeStart: "8:30 AM",
    timeEnd: "9:20 AM",
    startMinutes: 8 * 60 + 30,
    durationMin: 50,
    type: "Intake",
    cpt: "90791",
    provider: "Lena Ortiz, LPC",
    location: "Office",
    insurance: "BCBS Colorado",
    status: "checked_in",
    alerts: [
      { text: "Consent forms unsigned", tone: "amber" },
      { text: "Insurance not verified", tone: "red" },
    ],
    recentNote: null,
    diagnoses: ["F41.1 – Generalized Anxiety Disorder"],
    tasks: [
      { text: "Complete intake paperwork", priority: "high" },
      { text: "Verify BCBS eligibility", priority: "high" },
    ],
    copay: "$30",
  },
  {
    id: "appt-a2",
    clientId: "c2",
    patientName: "Avery Morgan",
    dob: "1995-07-22",
    timeStart: "9:00 AM",
    timeEnd: "9:53 AM",
    startMinutes: 9 * 60,
    durationMin: 53,
    type: "Individual Therapy",
    cpt: "90837",
    provider: "Lena Ortiz, LPC",
    location: "Telehealth",
    insurance: "Aetna",
    status: "scheduled",
    alerts: [{ text: "Telehealth – verify location", tone: "purple" }],
    recentNote:
      "Client reported significant improvement in sleep and daily functioning. Continuing CBT techniques.",
    diagnoses: ["F33.1 – Major Depressive Disorder, recurrent"],
    tasks: [{ text: "Confirm telehealth link sent", priority: "med" }],
    copay: "$20",
  },
  {
    id: "appt-a3",
    clientId: "c3",
    patientName: "Sofia Martinez",
    dob: "2009-11-05",
    timeStart: "10:30 AM",
    timeEnd: "11:23 AM",
    startMinutes: 10 * 60 + 30,
    durationMin: 53,
    type: "Individual Therapy",
    cpt: "90837",
    provider: "Noah Kim, LCSW",
    location: "Office",
    insurance: "BCBS Colorado",
    status: "in_session",
    alerts: [
      { text: "Minor – guardian in waiting room", tone: "blue" },
      { text: "School ROI pending", tone: "amber" },
    ],
    recentNote:
      "Session focused on school-related stressors. Family dynamics improving. Guardian engaged and supportive.",
    diagnoses: ["F43.23 – Adjustment Disorder with mixed anxiety and depressed mood"],
    tasks: [
      { text: "Send school ROI to guardian", priority: "high" },
      { text: "Review treatment plan (due this week)", priority: "high" },
    ],
    copay: null,
  },
  {
    id: "appt-a4",
    clientId: "c4",
    patientName: "James Rivera",
    dob: "1973-01-30",
    timeStart: "11:00 AM",
    timeEnd: "11:45 AM",
    startMinutes: 11 * 60,
    durationMin: 45,
    type: "Individual Therapy",
    cpt: "90834",
    provider: "Priya Shah, PsyD",
    location: "Office",
    insurance: "Medicare",
    status: "needs_signature",
    alerts: [{ text: "Note unsigned – required for billing", tone: "amber" }],
    recentNote:
      "Client discussed employment transition. Mood stable. Sleep improved with behavioral changes.",
    diagnoses: ["F41.1 – Generalized Anxiety Disorder", "Z56.0 – Problems with employment"],
    tasks: [
      { text: "Sign clinical note", priority: "high" },
      { text: "Submit claim to Medicare", priority: "low" },
    ],
    copay: "$0",
  },
  {
    id: "appt-a5",
    clientId: "c5",
    patientName: "Marcus Thompson",
    dob: "1984-09-18",
    timeStart: "1:00 PM",
    timeEnd: "2:00 PM",
    startMinutes: 13 * 60,
    durationMin: 60,
    type: "Intake",
    cpt: "90791",
    provider: "Priya Shah, PsyD",
    location: "Telehealth",
    insurance: "Colorado Medicaid",
    status: "needs_signature",
    alerts: [
      { text: "Encounter open – note not started", tone: "amber" },
      { text: "Telehealth – verify Colorado location", tone: "purple" },
    ],
    recentNote: null,
    diagnoses: ["Pending – intake assessment needed"],
    tasks: [
      { text: "Complete intake documentation", priority: "high" },
      { text: "Submit prior auth for ongoing therapy", priority: "med" },
    ],
    copay: "$3",
  },
  {
    id: "appt-a6",
    clientId: "c6",
    patientName: "Dana Patel",
    dob: "1991-05-27",
    timeStart: "2:30 PM",
    timeEnd: "3:15 PM",
    startMinutes: 14 * 60 + 30,
    durationMin: 45,
    type: "Treatment Plan Review",
    cpt: "H0032",
    provider: "Lena Ortiz, LPC",
    location: "Office",
    insurance: "United Behavioral Health",
    status: "scheduled",
    alerts: [{ text: "Treatment plan expires in 3 days", tone: "red" }],
    recentNote:
      "Strong session — client identifying triggers for depressive episodes. Setting behavioral activation goals.",
    diagnoses: ["F32.1 – Major Depressive Episode, moderate"],
    tasks: [
      { text: "Update and sign treatment plan", priority: "high" },
      { text: "Collect copay $40", priority: "low" },
    ],
    copay: "$40",
  },
  {
    id: "appt-a7",
    clientId: "c7",
    patientName: "Sarah Johnson",
    dob: "1968-12-03",
    timeStart: "3:45 PM",
    timeEnd: "4:38 PM",
    startMinutes: 15 * 60 + 45,
    durationMin: 53,
    type: "Individual Therapy",
    cpt: "90837",
    provider: "Noah Kim, LCSW",
    location: "Office",
    insurance: "Aetna",
    status: "no_show",
    alerts: [{ text: "No-show – 2nd occurrence this month", tone: "red" }],
    recentNote:
      "Client expressed ambivalence about therapy goals. Recommended adding structure between sessions.",
    diagnoses: ["F33.0 – Major Depressive Disorder, recurrent, mild"],
    tasks: [
      { text: "Send no-show follow-up message", priority: "high" },
      { text: "Review no-show policy with client", priority: "med" },
    ],
    copay: null,
  },
];

export const SUMMARY = {
  total: 7,
  unsigned: 2,
  pending: 4,
  noShow: 1,
  messages: 3,
};
