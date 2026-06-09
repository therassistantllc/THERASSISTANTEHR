"use client";

import styles from "./TodayVisitsSidebar.module.css";

export type SidebarAppointment = {
  id: string;
  clientName: string;
  scheduledStartAt: string;
  status: string;
  appointmentType: string | null;
  cptCode: string | null;
  providerName: string;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

type GroupKey = "in_progress" | "upcoming" | "completed" | "blocked";

function statusGroup(status: string): GroupKey {
  if (status === "checked_in" || status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "no_show") return "blocked";
  return "upcoming";
}

const GROUP_ORDER: GroupKey[] = ["in_progress", "upcoming", "completed", "blocked"];

const GROUP_LABELS: Record<GroupKey, string> = {
  in_progress: "In Progress",
  upcoming: "Not Checked In",
  completed: "Completed",
  blocked: "No Show / Cancelled",
};

export default function TodayVisitsSidebar({
  appointments,
  selectedId,
  onSelect,
  today,
}: {
  appointments: SidebarAppointment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  today: Date | null;
}) {
  const todayStr = today
    ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
    : null;

  const todayAppts = (todayStr
    ? appointments.filter((a) => a.scheduledStartAt.slice(0, 10) === todayStr)
    : []
  ).sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));

  const groups = GROUP_ORDER.map((g) => ({
    key: g,
    label: GROUP_LABELS[g],
    items: todayAppts.filter((a) => statusGroup(a.status) === g),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className={styles.sidebar} aria-label="Today's visits">
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarTitle}>Today&rsquo;s Visits</span>
        {todayAppts.length > 0 ? (
          <span className={styles.sidebarCount}>{todayAppts.length}</span>
        ) : null}
      </div>

      {todayAppts.length === 0 ? (
        <div className={styles.empty}>
          {today ? "No appointments today." : "Loading…"}
        </div>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <div key={group.key} className={styles.group}>
              <div className={`${styles.groupLabel} ${styles[`label_${group.key}`]}`}>
                <span className={styles.groupLabelText}>{group.label}</span>
                <span className={styles.groupCount}>{group.items.length}</span>
              </div>
              {group.items.map((appt) => {
                const isSelected = appt.id === selectedId;
                const typeLabel = appt.cptCode || appt.appointmentType || null;
                return (
                  <button
                    key={appt.id}
                    className={`${styles.apptRow} ${isSelected ? styles.apptRowSelected : ""} ${styles[`row_${statusGroup(appt.status)}`]}`}
                    onClick={() => onSelect(appt.id)}
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <span className={styles.apptTime}>{fmtTime(appt.scheduledStartAt)}</span>
                    <span className={styles.apptInfo}>
                      <span className={styles.apptName}>{appt.clientName}</span>
                      {typeLabel ? (
                        <span className={styles.apptType}>{typeLabel}</span>
                      ) : null}
                    </span>
                    <span className={`${styles.dot} ${styles[`dot_${statusGroup(appt.status)}`]}`} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
