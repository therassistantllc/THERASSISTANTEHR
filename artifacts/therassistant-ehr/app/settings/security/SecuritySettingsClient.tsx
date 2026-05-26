"use client";
/* eslint-disable react-hooks/set-state-in-effect -- standard "fetch on mount" pattern; load() is async and the effect just kicks it off. */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Member = {
  id: string;
  authUserId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  isActive: boolean;
  roles: Array<{ id: string; code: string; name: string }>;
  primaryRoleId: string | null;
};

type Role = { id: string; code: string; name: string };

type AuditEntry = {
  id: string;
  createdAt: string;
  action: string | null;
  objectType: string | null;
  objectId: string | null;
  summary: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  userRole: string | null;
  settingKey: string | null;
  field: string | null;
  fieldLabel: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  detail: Record<string, unknown>;
};

type AuditFilterOptions = {
  actions: string[];
  actors: Array<{ id: string; name: string; email: string | null }>;
};

type Pagination = {
  limit: number;
  offset: number;
  returned: number;
  totalCount: number | null;
  hasMore: boolean;
};

type Tab = "password" | "audit" | "roles";

const PAGE_SIZE = 50;

function fullName(member: { firstName: string | null; lastName: string | null; email: string | null }): string {
  return (
    [member.firstName, member.lastName].filter(Boolean).join(" ") ||
    member.email ||
    "Unnamed"
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatAction(action: string | null): string {
  if (!action) return "—";
  return action.replace(/_/g, " ");
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function SecuritySettingsClient() {
  const [tab, setTab] = useState<Tab>("password");

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Security &amp; Access</h1>
          <p className="hero-copy">
            Reset staff passwords, review the audit log, and manage roles.
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button button-secondary" href="/settings">← Settings</Link>
        </div>
      </section>

      <section className="panel" style={{ padding: 0 }}>
        <div
          role="tablist"
          aria-label="Security sections"
          style={{
            display: "flex",
            gap: "0.25rem",
            borderBottom: "1px solid var(--border-color, #e3e3e8)",
            padding: "0.5rem 0.75rem 0",
          }}
        >
          {(
            [
              { id: "password", label: "Password Reset" },
              { id: "audit", label: "Audit Log" },
              { id: "roles", label: "Roles" },
            ] as Array<{ id: Tab; label: string }>
          ).map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(entry.id)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "0.6rem 1rem",
                  borderBottom: active ? "2px solid #2b6cb0" : "2px solid transparent",
                  color: active ? "#1a365d" : "var(--text-secondary, #555)",
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "1.25rem" }}>
          {tab === "password" ? <PasswordResetPanel /> : null}
          {tab === "audit" ? <AuditLogPanel /> : null}
          {tab === "roles" ? <RolesPanel /> : null}
        </div>
      </section>
    </main>
  );
}

/* ─────────────────────────── Password Reset ─────────────────────────── */

function PasswordResetPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch("/api/admin/security/members", { cache: "no-store" });
        const json = await resp.json();
        if (!resp.ok || !json.success) {
          throw new Error(json.error ?? "Failed to load staff list");
        }
        setMembers(json.members as Member[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load staff list");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sendReset = useCallback(async () => {
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    setToast(null);
    try {
      const resp = await fetch("/api/admin/security/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: selectedId }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error ?? "Failed to send reset email");
      }
      setToast(json.message ?? "Recovery email sent.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reset email");
    } finally {
      setSubmitting(false);
    }
  }, [selectedId]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Send a password reset link</h2>
      <p style={{ color: "var(--text-secondary, #555)", marginTop: 0 }}>
        Choose a staff member and we will email them a Supabase Auth recovery link.
      </p>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {toast ? <Alert kind="success">{toast}</Alert> : null}

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 320 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Staff member</span>
          <select
            className="input"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={loading}
          >
            <option value="">{loading ? "Loading…" : "Select staff member"}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {fullName(m)}
                {m.email ? ` — ${m.email}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button button-primary"
          disabled={!selectedId || submitting}
          onClick={sendReset}
        >
          {submitting ? "Sending…" : "Send Reset Link"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Audit Log ─────────────────────────── */

function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [options, setOptions] = useState<AuditFilterOptions>({ actions: [], actors: [] });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (action) params.set("action", action);
      if (actorId) params.set("actorId", actorId);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      const resp = await fetch(`/api/admin/security/audit-log?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load audit log");
      }
      setEntries(json.entries as AuditEntry[]);
      setPagination(json.pagination as Pagination);
      setOptions(json.filterOptions as AuditFilterOptions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [from, to, action, actorId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalCount = pagination?.totalCount ?? null;
  const offset = pagination?.offset ?? page * PAGE_SIZE;
  const returned = pagination?.returned ?? entries.length;
  const hasMore = pagination?.hasMore ?? false;
  const rangeStart = returned === 0 ? 0 : offset + 1;
  const rangeEnd = offset + returned;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Audit log</h2>
      <p style={{ color: "var(--text-secondary, #555)", marginTop: 0 }}>
        Sensitive actions recorded across your organization. Read-only.
      </p>

      <section
        aria-label="Filters"
        style={{
          background: "#f7f7f9",
          border: "1px solid #e3e3e8",
          borderRadius: 8,
          padding: "1rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Action</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="input"
          >
            <option value="">All actions</option>
            {options.actions.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>User</span>
          <select
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="input"
          >
            <option value="">All users</option>
            {options.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email ? `${a.name} (${a.email})` : a.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "end", gap: "0.5rem" }}>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setFrom("");
              setTo("");
              setAction("");
              setActorId("");
              setPage(0);
            }}
          >
            Reset
          </button>
          <button type="button" className="button button-primary" onClick={() => load()}>
            Refresh
          </button>
        </div>
      </section>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          margin: "0.5rem 0",
          color: "#555",
          fontSize: "0.9rem",
        }}
      >
        <span>
          {loading
            ? "Loading…"
            : returned === 0
              ? "0 results"
              : totalCount !== null
                ? `Showing ${rangeStart}–${rangeEnd} of ${totalCount.toLocaleString()}`
                : `Showing ${rangeStart}–${rangeEnd}`}
        </span>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="button button-secondary"
            disabled={loading || page === 0}
            onClick={() => setPage((c) => Math.max(0, c - 1))}
          >
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button
            type="button"
            className="button button-secondary"
            disabled={loading || !hasMore}
            onClick={() => setPage((c) => c + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {loading ? (
        <p>Loading audit log…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: "#666" }}>No audit entries match the current filters.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
            <thead>
              <tr style={{ background: "#f0f0f4", textAlign: "left" }}>
                <th style={{ padding: "0.5rem 0.75rem" }}>When</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Actor</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Action</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Target</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #e5e5ea", verticalAlign: "top" }}>
                  <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                    {formatTimestamp(e.createdAt)}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <div>{e.actorName ?? e.actorEmail ?? "Unknown"}</div>
                    {e.userRole ? (
                      <div style={{ fontSize: "0.8rem", color: "#666" }}>{e.userRole}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>{formatAction(e.action)}</td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <div>{e.objectType ?? "—"}</div>
                    {e.objectId ? (
                      <div style={{ fontSize: "0.75rem", color: "#888", wordBreak: "break-all" }}>
                        {e.objectId}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#555" }}>
                    {e.summary ?? "—"}
                    {e.objectType === "system_setting" && e.field ? (
                      <div style={{ marginTop: 4, fontSize: "0.85rem" }}>
                        <span style={{ color: "#444", fontWeight: 600 }}>
                          {e.fieldLabel ?? e.field}:
                        </span>{" "}
                        <code>{formatAuditValue(e.beforeValue)}</code>{" "}
                        <span aria-hidden="true">→</span>{" "}
                        <code>{formatAuditValue(e.afterValue)}</code>
                        {e.settingKey ? (
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "#888",
                              fontFamily: "var(--font-mono, monospace)",
                              marginTop: 2,
                            }}
                          >
                            {e.settingKey}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Roles ─────────────────────────── */

function RolesPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteFirst, setInviteFirst] = useState("");
  const [inviteLast, setInviteLast] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/admin/security/members", { cache: "no-store" });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load members");
      }
      setMembers(json.members as Member[]);
      setRoles(json.roles as Role[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = useCallback(
    async (staffId: string, newRoleId: string) => {
      setSavingId(staffId);
      setError(null);
      setToast(null);
      try {
        const resp = await fetch(`/api/admin/security/members/${staffId}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role_id: newRoleId }),
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) {
          throw new Error(json.error ?? "Failed to update role");
        }
        setToast("Role updated.");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update role");
      } finally {
        setSavingId(null);
      }
    },
    [load],
  );

  const resetInviteForm = useCallback(() => {
    setInviteFirst("");
    setInviteLast("");
    setInviteEmail("");
    setInviteRoleId("");
  }, []);

  const submitInvite = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setToast(null);
      setInviting(true);
      try {
        const resp = await fetch("/api/admin/security/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: inviteFirst,
            last_name: inviteLast,
            email: inviteEmail,
            role_id: inviteRoleId,
          }),
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) {
          throw new Error(json.error ?? "Failed to send invitation");
        }
        setToast(json.message ?? `Invitation sent to ${inviteEmail}.`);
        resetInviteForm();
        setInviteOpen(false);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send invitation");
      } finally {
        setInviting(false);
      }
    },
    [inviteFirst, inviteLast, inviteEmail, inviteRoleId, load, resetInviteForm],
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ marginTop: 0 }}>Roles</h2>
          <p style={{ color: "var(--text-secondary, #555)", marginTop: 0 }}>
            Assign a role to each staff member. Changes are recorded in the audit log.
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            setInviteOpen((open) => !open);
            setError(null);
            setToast(null);
          }}
        >
          {inviteOpen ? "Close" : "Invite staff"}
        </button>
      </div>

      {inviteOpen ? (
        <form
          onSubmit={submitInvite}
          style={{
            background: "#f7f7f9",
            border: "1px solid #e3e3e8",
            borderRadius: 8,
            padding: "1rem",
            marginBottom: "1rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "1rem",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>First name</span>
            <input
              className="input"
              value={inviteFirst}
              onChange={(e) => setInviteFirst(e.target.value)}
              required
              disabled={inviting}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Last name</span>
            <input
              className="input"
              value={inviteLast}
              onChange={(e) => setInviteLast(e.target.value)}
              required
              disabled={inviting}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Email</span>
            <input
              type="email"
              className="input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              disabled={inviting}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Starting role</span>
            <select
              className="input"
              value={inviteRoleId}
              onChange={(e) => setInviteRoleId(e.target.value)}
              required
              disabled={inviting || roles.length === 0}
            >
              <option value="" disabled>
                {roles.length === 0 ? "No roles available" : "Select a role"}
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </label>
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              gap: "0.5rem",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                resetInviteForm();
                setInviteOpen(false);
              }}
              disabled={inviting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={
                inviting ||
                !inviteFirst.trim() ||
                !inviteLast.trim() ||
                !inviteEmail.trim() ||
                !inviteRoleId
              }
            >
              {inviting ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <Alert kind="error">{error}</Alert> : null}
      {toast ? <Alert kind="success">{toast}</Alert> : null}

      {loading ? (
        <p>Loading members…</p>
      ) : members.length === 0 ? (
        <p style={{ color: "#666" }}>No active staff members.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
            <thead>
              <tr style={{ background: "#f0f0f4", textAlign: "left" }}>
                <th style={{ padding: "0.5rem 0.75rem" }}>Name</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Email</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Job title</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} style={{ borderTop: "1px solid #e5e5ea" }}>
                  <td style={{ padding: "0.5rem 0.75rem" }}>{fullName(m)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#555" }}>{m.email ?? "—"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#555" }}>
                    {m.jobTitle ?? "—"}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <select
                      className="input"
                      value={m.primaryRoleId ?? ""}
                      disabled={savingId === m.id}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next && next !== m.primaryRoleId) {
                          changeRole(m.id, next);
                        }
                      }}
                    >
                      <option value="" disabled>
                        No role assigned
                      </option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.code})
                        </option>
                      ))}
                    </select>
                    {m.roles.length > 1 ? (
                      <div style={{ fontSize: "0.75rem", color: "#888", marginTop: 4 }}>
                        Other roles: {m.roles.slice(1).map((r) => r.code).join(", ")}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Shared ─────────────────────────── */

function Alert({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  const palette =
    kind === "error"
      ? { bg: "#fdecec", border: "#f5c2c2", color: "#8a1c1c" }
      : { bg: "#e8f6ee", border: "#b6e1c4", color: "#1a663a" };
  return (
    <div
      role="alert"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        padding: "0.75rem 1rem",
        borderRadius: 6,
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  );
}
