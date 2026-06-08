import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermissionInRoute } from "@/lib/rbac/middleware";
import { PERMISSIONS } from "@/lib/rbac/constants";

type Row = Record<string, unknown>;

const CARD_BUCKET = "intake-card-images";
const MAX_CARD_BYTES = 5 * 1024 * 1024;
const MAX_DATA_URL_CHARS = Math.ceil((MAX_CARD_BYTES * 4) / 3) + 256;
const ALLOWED_IMAGE_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/webp;base64,",
  "data:image/gif;base64,",
];

type SanitizedCard = {
  name: string | null;
  type: string | null;
  bytes: Buffer;
  extension: string;
};

function sanitizeCard(input: unknown): SanitizedCard | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Row;
  const content = typeof obj.content === "string" ? obj.content : "";
  if (!content) return null;
  if (content.length > MAX_DATA_URL_CHARS) return null;
  const lower = content.toLowerCase();
  const matched = ALLOWED_IMAGE_PREFIXES.find((prefix) => lower.startsWith(prefix));
  if (!matched) return null;
  const commaIdx = content.indexOf(",");
  if (commaIdx < 0) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(content.slice(commaIdx + 1), "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_CARD_BYTES) return null;
  const type = typeof obj.type === "string" && obj.type.startsWith("image/") ? obj.type : null;
  const rawName = typeof obj.name === "string" ? obj.name : null;
  const name = rawName ? rawName.replace(/[\r\n<>"'`]/g, "").slice(0, 200) : null;
  const extension = matched.includes("png")
    ? "png"
    : matched.includes("webp")
      ? "webp"
      : matched.includes("gif")
        ? "gif"
        : "jpg";
  return { name, type, bytes, extension };
}

async function loadSubmission(submissionId: string, organizationId: string) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return { error: NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 }) } as const;
  const { data, error } = await supabase
    .from("intake_submissions")
    .select("id, organization_id, insurance")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: NextResponse.json({ success: false, error: "Submission not found" }, { status: 404 }) } as const;
  const row = data as Row;
  if (String(row.organization_id ?? "") !== organizationId) {
    return { error: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { supabase, row } as const;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ submissionId: string; side: string }> },
) {
  try {
    const auth = await requirePermissionInRoute(PERMISSIONS.VIEW_PATIENT_CHART);
    if (auth instanceof NextResponse) return auth;
    const { organizationId } = auth;

    const { submissionId, side } = await context.params;
    if (side !== "front" && side !== "back") {
      return NextResponse.json({ success: false, error: "Invalid side" }, { status: 400 });
    }

    const result = await loadSubmission(submissionId, organizationId);
    if ("error" in result) return result.error;
    const { supabase, row } = result;

    const insurance = (row.insurance ?? {}) as Row;
    const cardKey = side === "front" ? "cardFront" : "cardBack";
    const card = insurance[cardKey] as Row | null | undefined;
    if (!card || typeof card !== "object") {
      return NextResponse.json({ success: false, error: "No card on file" }, { status: 404 });
    }

    const path = typeof card.path === "string" ? card.path : "";
    const bucket = typeof card.bucket === "string" && card.bucket ? card.bucket : CARD_BUCKET;

    if (!path && typeof card.content === "string" && card.content.startsWith("data:image/")) {
      const commaIdx = card.content.indexOf(",");
      if (commaIdx < 0) {
        return NextResponse.json({ success: false, error: "Card content malformed" }, { status: 500 });
      }
      const header = card.content.slice(5, commaIdx);
      const mime = header.split(";")[0] || "image/jpeg";
      const bytes = Buffer.from(card.content.slice(commaIdx + 1), "base64");
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    if (!path) {
      return NextResponse.json({ success: false, error: "No card on file" }, { status: 404 });
    }

    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (dlErr || !blob) {
      return NextResponse.json(
        { success: false, error: dlErr?.message ?? "Card image unavailable" },
        { status: 404 },
      );
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const contentType = typeof card.type === "string" ? card.type : blob.type || "image/jpeg";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Intake card fetch error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load card image" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ submissionId: string; side: string }> },
) {
  try {
    const auth = await requirePermissionInRoute(PERMISSIONS.EDIT_PATIENT_DEMOGRAPHICS);
    if (auth instanceof NextResponse) return auth;
    const { organizationId, staffId } = auth;

    const { submissionId, side } = await context.params;
    if (side !== "front" && side !== "back") {
      return NextResponse.json({ success: false, error: "Invalid side" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as Row | null;
    if (!body) {
      return NextResponse.json({ success: false, error: "Request body required" }, { status: 400 });
    }
    const sanitized = sanitizeCard(body);
    if (!sanitized) {
      return NextResponse.json(
        { success: false, error: "Image must be a PNG/JPEG/WebP/GIF data URL under 5MB" },
        { status: 400 },
      );
    }

    const result = await loadSubmission(submissionId, organizationId);
    if ("error" in result) return result.error;
    const { supabase, row } = result;

    const insurance = ((row.insurance ?? {}) as Row);
    const cardKey = side === "front" ? "cardFront" : "cardBack";
    const existing = insurance[cardKey] as Row | null | undefined;
    const existingPath = existing && typeof existing.path === "string" ? existing.path : "";
    const existingBucket = existing && typeof existing.bucket === "string" && existing.bucket
      ? existing.bucket
      : CARD_BUCKET;

    const objectPath = `${organizationId}/${submissionId}/${side}.${sanitized.extension}`;
    const contentType = sanitized.type ?? `image/${sanitized.extension === "jpg" ? "jpeg" : sanitized.extension}`;
    const { error: uploadErr } = await supabase.storage
      .from(CARD_BUCKET)
      .upload(objectPath, sanitized.bytes, { contentType, upsert: true });
    if (uploadErr) {
      return NextResponse.json({ success: false, error: uploadErr.message }, { status: 500 });
    }

    // Update the DB pointer FIRST so a failure here never leaves the
    // submission pointing at a stale/deleted object. Only after the pointer
    // is durably updated do we delete the previous file from storage.
    const now = new Date().toISOString();
    const updatedInsurance = {
      ...insurance,
      [cardKey]: {
        bucket: CARD_BUCKET,
        path: objectPath,
        name: sanitized.name,
        type: contentType,
        uploadedAt: now,
        replacedByStaffId: staffId,
      },
    };
    const { error: updErr } = await supabase
      .from("intake_submissions")
      .update({ insurance: updatedInsurance })
      .eq("id", submissionId);
    if (updErr) {
      // Best-effort: remove the newly uploaded object so we don't orphan
      // the just-uploaded file when the DB pointer never moved.
      if (objectPath !== existingPath) {
        await supabase.storage.from(CARD_BUCKET).remove([objectPath]).catch(() => null);
      }
      throw updErr;
    }

    if (existingPath && existingPath !== objectPath) {
      const { error: removeErr } = await supabase.storage
        .from(existingBucket)
        .remove([existingPath]);
      if (removeErr) {
        console.warn(
          `[intake-card] failed to remove previous object ${existingBucket}/${existingPath}: ${removeErr.message}`,
        );
      }
    }

    console.log(
      `[audit] intake_card_replaced submissionId=${submissionId} side=${side} staffId=${staffId} org=${organizationId}`,
    );

    return NextResponse.json({ success: true, side, uploadedAt: now });
  } catch (error) {
    console.error("Intake card replace error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to replace card image" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ submissionId: string; side: string }> },
) {
  try {
    const auth = await requirePermissionInRoute(PERMISSIONS.EDIT_PATIENT_DEMOGRAPHICS);
    if (auth instanceof NextResponse) return auth;
    const { organizationId, staffId } = auth;

    const { submissionId, side } = await context.params;
    if (side !== "front" && side !== "back") {
      return NextResponse.json({ success: false, error: "Invalid side" }, { status: 400 });
    }

    const result = await loadSubmission(submissionId, organizationId);
    if ("error" in result) return result.error;
    const { supabase, row } = result;

    const insurance = ((row.insurance ?? {}) as Row);
    const cardKey = side === "front" ? "cardFront" : "cardBack";
    const existing = insurance[cardKey] as Row | null | undefined;

    // Null the DB pointer FIRST so a failed storage delete cannot leave the
    // submission referencing a deleted object.
    const updatedInsurance = { ...insurance, [cardKey]: null };
    const { error: updErr } = await supabase
      .from("intake_submissions")
      .update({ insurance: updatedInsurance })
      .eq("id", submissionId);
    if (updErr) throw updErr;

    if (existing && typeof existing === "object") {
      const path = typeof existing.path === "string" ? existing.path : "";
      const bucket = typeof existing.bucket === "string" && existing.bucket ? existing.bucket : CARD_BUCKET;
      if (path) {
        const { error: removeErr } = await supabase.storage.from(bucket).remove([path]);
        if (removeErr) {
          console.warn(
            `[intake-card] failed to remove object ${bucket}/${path} on delete: ${removeErr.message}`,
          );
        }
      }
    }

    console.log(
      `[audit] intake_card_removed submissionId=${submissionId} side=${side} staffId=${staffId} org=${organizationId}`,
    );

    return NextResponse.json({ success: true, side });
  } catch (error) {
    console.error("Intake card delete error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to remove card image" },
      { status: 500 },
    );
  }
}
