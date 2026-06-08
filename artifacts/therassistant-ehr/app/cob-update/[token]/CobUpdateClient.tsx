"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

type Policy = {
  id: string;
  priority: string;
  payerId: string | null;
  payerName: string | null;
  payerType: string | null;
  planName: string | null;
  policyNumber: string | null;
  effectiveDate: string | null;
  terminationDate: string | null;
};

type LinkData = {
  organization: { id: string; name: string };
  client: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
  };
  claim: { id: string; claimNumber: string | null };
  policies: Policy[];
  token: string;
  expiresAt: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: LinkData }
  | { kind: "done" };

function priorityRank(p: string) {
  return p === "primary" ? 0 : p === "secondary" ? 1 : p === "tertiary" ? 2 : 3;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

async function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

const MAX_CARD_EDGE = 1600;
const CARD_JPEG_QUALITY = 0.82;

/**
 * Decode the file with EXIF auto-orientation applied, downscale so the
 * longest edge is <= MAX_CARD_EDGE, and re-encode as a JPEG so the
 * upload is small enough to survive flaky mobile networks. Falls back
 * to the raw file if the browser can't decode it (e.g. HEIC on some
 * Androids — server-side sanitizer will reject those anyway).
 */
async function normalizeCardImage(
  file: File,
): Promise<{ blob: Blob; dataUrl: string }> {
  try {
    let bitmap: ImageBitmap | null = null;
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(file, {
          imageOrientation: "from-image",
        });
      } catch {
        bitmap = await createImageBitmap(file);
      }
    }
    if (!bitmap) throw new Error("no-bitmap");

    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    const scale = longest > MAX_CARD_EDGE ? MAX_CARD_EDGE / longest : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no-ctx");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        CARD_JPEG_QUALITY,
      );
    });
    const dataUrl = await fileToDataUrl(blob);
    return { blob, dataUrl };
  } catch {
    const dataUrl = await fileToDataUrl(file);
    return { blob: file, dataUrl };
  }
}

type CardSide = {
  blob: Blob;
  dataUrl: string;
  contentType: string;
};

async function blobToUploadPayload(
  side: CardSide,
  fileName: string,
): Promise<{ name: string; type: string; content: string }> {
  return {
    name: fileName,
    type: side.contentType,
    content: side.dataUrl,
  };
}

export default function CobUpdateClient({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [hasOtherCoverage, setHasOtherCoverage] = useState<"" | "yes" | "no">("");
  const [otherCoverageNote, setOtherCoverageNote] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [cardFront, setCardFront] = useState<CardSide | null>(null);
  const [cardBack, setCardBack] = useState<CardSide | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [processingSide, setProcessingSide] = useState<"front" | "back" | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const res = await fetch(`/api/cob-update/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as
          | { success: true } & LinkData
          | { success: false; error: string };
        if (cancelled) return;
        if (!res.ok || !("success" in json) || !json.success) {
          setState({
            kind: "error",
            message:
              (json as { error?: string }).error ??
              "We could not load this link.",
          });
          return;
        }
        const sortedPolicies = [...json.policies].sort(
          (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
        );
        setOrderedIds(sortedPolicies.map((p) => p.id));
        setState({
          kind: "ready",
          data: { ...json, policies: sortedPolicies },
        });
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Failed to load",
        });
      }
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const policiesById = useMemo(() => {
    if (state.kind !== "ready") return new Map<string, Policy>();
    return new Map(state.data.policies.map((p) => [p.id, p]));
  }, [state]);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setOrderedIds((prev) => {
      const i = prev.indexOf(id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const onCardSideChange = useCallback(
    async (side: "front" | "back", e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      // Reset the input so re-selecting the same file still fires change.
      e.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setCardError("That doesn't look like an image. Please choose a photo.");
        return;
      }
      setCardError(null);
      setProcessingSide(side);
      try {
        const { blob, dataUrl } = await normalizeCardImage(file);
        const next: CardSide = {
          blob,
          dataUrl,
          contentType: "image/jpeg",
        };
        if (side === "front") setCardFront(next);
        else setCardBack(next);
      } catch {
        setCardError("We couldn't read that photo. Please try again.");
      } finally {
        setProcessingSide(null);
      }
    },
    [],
  );

  const clearCardSide = useCallback((side: "front" | "back") => {
    if (side === "front") setCardFront(null);
    else setCardBack(null);
  }, []);

  const onSubmit = useCallback(async () => {
    if (state.kind !== "ready") return;
    setError(null);
    if (!signatureName.trim()) {
      setError("Please type your name to sign.");
      return;
    }
    if (!hasOtherCoverage) {
      setError("Please answer whether you have any other insurance coverage.");
      return;
    }
    setSubmitting(true);
    try {
      const cardPhotoFront = cardFront
        ? await blobToUploadPayload(cardFront, "insurance-card-front.jpg")
        : null;
      const cardPhotoBack = cardBack
        ? await blobToUploadPayload(cardBack, "insurance-card-back.jpg")
        : null;
      const res = await fetch(`/api/cob-update/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedPolicyIds: orderedIds,
          hasOtherCoverage: hasOtherCoverage === "yes",
          otherCoverageNote: otherCoverageNote.trim(),
          signatureName: signatureName.trim(),
          cardPhotoFront,
          cardPhotoBack,
          // Back-compat: older API revisions only knew about a single
          // cardPhoto field. Send the front as cardPhoto so a stale
          // server still captures something.
          cardPhoto: cardPhotoFront,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Submit failed");
      }
      setState({ kind: "done" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }, [
    state,
    signatureName,
    hasOtherCoverage,
    otherCoverageNote,
    orderedIds,
    cardFront,
    cardBack,
    token,
  ]);

  if (state.kind === "loading") {
    return <Shell><p>Loading your secure form…</p></Shell>;
  }
  if (state.kind === "error") {
    return (
      <Shell>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Link unavailable</h1>
        <p style={{ color: "#b91c1c" }}>{state.message}</p>
        <p style={{ marginTop: 16, color: "#64748b", fontSize: 14 }}>
          If you believe this is a mistake, please contact your provider and
          ask them to send a fresh link.
        </p>
      </Shell>
    );
  }
  if (state.kind === "done") {
    return (
      <Shell>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Thank you</h1>
        <p>
          Your insurance information was sent securely to your care team. You
          can close this window — no further action is needed.
        </p>
      </Shell>
    );
  }

  const data = state.data;
  const greetingName =
    data.client.preferredName || data.client.firstName || "there";

  return (
    <Shell>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>
        Confirm your insurance
      </h1>
      <p style={{ color: "#475569", margin: "0 0 24px" }}>
        Hi {greetingName}, {data.organization.name} needs you to confirm your
        current insurance so your recent visit can be billed to the correct
        payer. This takes about a minute.
      </p>

      <Section title="1. Which insurance is primary?">
        {data.policies.length === 0 ? (
          <p style={{ color: "#64748b" }}>
            We don't have any insurance on file yet. Please contact your
            provider and we'll add it together.
          </p>
        ) : (
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {orderedIds.map((id, idx) => {
              const p = policiesById.get(id);
              if (!p) return null;
              const slot =
                idx === 0
                  ? "Primary"
                  : idx === 1
                    ? "Secondary"
                    : idx === 2
                      ? "Tertiary"
                      : `Other (${idx + 1})`;
              return (
                <li
                  key={id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "white",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#2563eb", fontWeight: 700 }}>
                      {slot}
                    </div>
                    <div style={{ fontWeight: 600 }}>
                      {p.payerName ?? p.planName ?? "Insurance plan"}
                    </div>
                    {p.policyNumber ? (
                      <div style={{ color: "#64748b", fontSize: 13 }}>
                        Member ID: {p.policyNumber}
                      </div>
                    ) : null}
                    {p.effectiveDate ? (
                      <div style={{ color: "#94a3b8", fontSize: 12 }}>
                        Effective {formatDate(p.effectiveDate)}
                        {p.terminationDate
                          ? ` – ${formatDate(p.terminationDate)}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => move(id, -1)}
                      disabled={idx === 0}
                      style={btnStyle(idx === 0)}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(id, 1)}
                      disabled={idx === orderedIds.length - 1}
                      style={btnStyle(idx === orderedIds.length - 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          Use the arrows to put your primary insurance at the top.
        </p>
      </Section>

      <Section title="2. Do you have any other insurance?">
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="hasOther"
              value="no"
              checked={hasOtherCoverage === "no"}
              onChange={() => setHasOtherCoverage("no")}
            />
            No, the plan(s) above are all I have
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="hasOther"
              value="yes"
              checked={hasOtherCoverage === "yes"}
              onChange={() => setHasOtherCoverage("yes")}
            />
            Yes, I have other coverage
          </label>
        </div>
        {hasOtherCoverage === "yes" ? (
          <textarea
            value={otherCoverageNote}
            onChange={(e) => setOtherCoverageNote(e.target.value)}
            placeholder="Tell us the plan name, member ID, and whether it's primary or secondary. (Or just upload a card photo below.)"
            rows={4}
            style={{
              marginTop: 8,
              width: "100%",
              padding: 8,
              fontSize: 14,
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontFamily: "inherit",
            }}
          />
        ) : null}
      </Section>

      <Section title="3. (Optional) Take a photo of your insurance card">
        <p style={{ fontSize: 13, color: "#475569", margin: "0 0 12px" }}>
          Hold the card flat against a dark background. Your phone camera
          opens automatically — snap the front, then the back.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <CardSideCapture
            label="Front of card"
            side="front"
            value={cardFront}
            processing={processingSide === "front"}
            onChange={onCardSideChange}
            onClear={() => clearCardSide("front")}
          />
          <CardSideCapture
            label="Back of card"
            side="back"
            value={cardBack}
            processing={processingSide === "back"}
            onChange={onCardSideChange}
            onClear={() => clearCardSide("back")}
          />
        </div>
        {cardError ? (
          <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 8 }}>
            {cardError}
          </p>
        ) : null}
      </Section>

      <Section title="4. Sign to confirm">
        <label style={{ display: "block", fontSize: 13, color: "#475569", marginBottom: 4 }}>
          Type your full name
        </label>
        <input
          type="text"
          value={signatureName}
          onChange={(e) => setSignatureName(e.target.value)}
          placeholder="Your full name"
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: 15,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
          }}
        />
        <p style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
          By typing your name, you confirm the information above is accurate
          to the best of your knowledge.
        </p>
      </Section>

      {error ? (
        <div
          style={{
            background: "#fef2f2",
            color: "#b91c1c",
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void onSubmit()}
        disabled={submitting}
        style={{
          background: submitting ? "#93c5fd" : "#2563eb",
          color: "white",
          padding: "12px 18px",
          fontSize: 15,
          fontWeight: 600,
          border: "none",
          borderRadius: 8,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        {submitting ? "Sending…" : "Send to my care team"}
      </button>
    </Shell>
  );
}

function CardSideCapture({
  label,
  side,
  value,
  processing,
  onChange,
  onClear,
}: {
  label: string;
  side: "front" | "back";
  value: CardSide | null;
  processing: boolean;
  onChange: (
    side: "front" | "back",
    e: ChangeEvent<HTMLInputElement>,
  ) => void | Promise<void>;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = `card-${side}`;
  const openPicker = () => inputRef.current?.click();
  const hasImage = !!value;
  return (
    <div
      style={{
        border: "1px dashed #cbd5e1",
        borderRadius: 10,
        padding: 12,
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 180,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <label
          htmlFor={inputId}
          style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}
        >
          {label}
        </label>
        {hasImage ? (
          <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
            ✓ Captured
          </span>
        ) : null}
      </div>

      {hasImage ? (
        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 6,
            display: "flex",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value!.dataUrl}
            alt={`Insurance card ${side}`}
            style={{
              maxWidth: "100%",
              maxHeight: 180,
              borderRadius: 4,
              objectFit: "contain",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: 13,
            textAlign: "center",
            padding: 12,
          }}
        >
          {processing ? "Processing photo…" : "No photo yet"}
        </div>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void onChange(side, e)}
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={openPicker}
          disabled={processing}
          style={{
            flex: 1,
            minWidth: 120,
            padding: "10px 12px",
            background: hasImage ? "white" : "#2563eb",
            color: hasImage ? "#0f172a" : "white",
            border: hasImage ? "1px solid #cbd5e1" : "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: processing ? "wait" : "pointer",
          }}
        >
          {processing
            ? "Working…"
            : hasImage
              ? "Retake photo"
              : `Take photo of ${side}`}
        </button>
        {hasImage ? (
          <button
            type="button"
            onClick={onClear}
            disabled={processing}
            style={{
              padding: "10px 12px",
              background: "white",
              color: "#b91c1c",
              border: "1px solid #fecaca",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    background: disabled ? "#f1f5f9" : "white",
    cursor: disabled ? "default" : "pointer",
    color: disabled ? "#94a3b8" : "#0f172a",
    fontSize: 14,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>{title}</h2>
      {children}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "32px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        color: "#0f172a",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 24,
        }}
      >
        {children}
      </div>
    </div>
  );
}
