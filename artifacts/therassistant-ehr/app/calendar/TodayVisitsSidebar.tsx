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
  checkInAt?: string | null;
  arrivalStatus?: string | null;
  checkInReviewNeeded?: boolean;
  checkInReviewReason?: string | null;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

type GroupKey = "review" | "arrived" | "en_route" | "upcoming" | "completed" | "blocked";

function statusGroup(appt: SidebarAppointment): GroupKey {
  if (appt.checkInReviewNeeded) return "review";
  if (appt.status === "completed") return "completed";
  if (appt.status === "cancelled" || appt.status === "no_show") return "blocked";
  if (appt.checkInAt || appt.status === "checked_in" || appt.status === "in_progress" || appt.arrivalStatus === "arrived") return "arrived";
  if (appt.arrivalStatus === "on_my_way") return "en_route";
  return "upcoming";
}

function statusText(appt: SidebarAppointment): string {
  if (appt.checkInReviewNeeded) return appt.checkInReviewReason || "Review needed";
  if (appt.checkInAt) return "Checked in";
  if (appt.arrivalStatus === "arrived") return "I'm here";
  if (appt.arrivalStatus === "on_my_way") return "On my way";
  return appt.status.replace(/_/g, " ");
}

const GROUP_ORDER: GroupKey[] = ["review", "arrived", "en_route", "upcoming", "completed", "blocked"];

const GROUP_LABELS: Record<GroupKey, string> = {
  review: "Review needed",
  arrived: "I'm here / checked in",
  en_route: "On my way",
  upcoming: "Not checked in",
  completed: "Completed",
  blocked: "No show / cancelled",
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
    items: todayAppts.filter((a) => statusGroup(a) === g),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className={styles.sidebar} aria-label="Today's visits">
      <div className={styles.sidebarHeader}>
        <div>
          <span className={styles.sidebarKicker}>Schedule</span>
          <span className={styles.sidebarTitle}>Today's Visits</span>
        </div>
        {todayAppts.length > 0 ? (
          <span className={styles.sidebarCount}>{todayAppts.length}</span>
        ) : null}
      </div>

      {todayAppts.length === 0 ? (
        <div className={styles.empty}>
          {today ? "No appointments today." : "Loading..."}
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
                const groupKey = statusGroup(appt);
                const isSelected = appt.id === selectedId;
                const typeLabel = appt.cptCode || appt.appointmentType || null;
                return (
                  <button
                    key={appt.id}
                    className={`${styles.apptRow} ${isSelected ? styles.apptRowSelected : ""} ${styles[`row_${groupKey}`]}`}
                    onClick={() => onSelect(appt.id)}
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <span className={styles.apptTime}>{fmtTime(appt.scheduledStartAt)}</span>
                    <span className={styles.apptInfo}>
                      <span className={styles.apptName}>{appt.clientName}</span>
                      <span className={styles.apptMeta}>{statusText(appt)}</span>
                      {typeLabel ? (
                        <span className={styles.apptType}>{typeLabel}</span>
                      ) : null}
                    </span>
                    <span className={`${styles.dot} ${styles[`dot_${groupKey}`]}`} aria-hidden="true" />
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
