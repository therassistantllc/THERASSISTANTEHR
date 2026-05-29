import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
const DEFAULT_BUCKET = "mailroom-documents";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function logCtx(label: string, ctx: Record<string, unknown>) {
  // Structured one-line log for grep-ability.
  // Example: [mailroom.file] download-failed itemId=... bucket=... path=... err=...
  const parts = Object.entries(ctx)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  console.log(`[mailroom.file] ${label} ${parts}`);
}

async function loadItem(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  itemId: string,
  organizationId: string,
) {
  if (!supabase) return { item: null, error: "no-supabase" as const };
  const { data, error } = await supabase
    .from("mailroom_items")
    .select("id, organization_id, file_name, mime_type, storage_path")
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { item: null, error: error.message };
  return { item: data as Record<string, unknown> | null, error: null };
}

/** Lightweight existence check used by the UI before mounting an iframe/img. */
async function probe(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  bucket: string,
  path: string,
) {
  if (!supabase) return { ok: false, error: "Database connection not available" };
  // createSignedUrl fails fast (no body transfer) and tells us if the object exists.
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    return { ok: false, error: error?.message || "Object not found in storage" };
  }
  return { ok: true, signedUrl: data.signedUrl };
}

function candidatePaths(rawPath: string, bucket: string) {
  const normalized = clean(rawPath);
  const noLeadingSlash = normalized.replace(/^\/+/, "");
  const withoutBucketPrefix = noLeadingSlash.replace(new RegExp(`^${bucket}/`), "");
  return [...new Set([normalized, noLeadingSlash, withoutBucketPrefix].filter(Boolean))];
}

async function resolveExistingPath(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  bucket: string,
  rawPath: string,
) {
  for (const p of candidatePaths(rawPath, bucket)) {
    const result = await probe(supabase, bucket, p);
    if (result.ok) return { path: p, signedUrl: result.signedUrl };
  }
  return { path: null as string | null, signedUrl: null as string | null };
}

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  const { searchParams } = new URL(request.url);
  const guard = await requireOrgAccess({
    requestedOrganizationId: searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;
  const organizationId = guard.organizationId;
  const isProbe = searchParams.get("probe") === "1";
  const bucket = DEFAULT_BUCKET;

  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available", bucket },
        { status: 500 },
      );
    }
    if (!itemId) {
      return NextResponse.json({ success: false, error: "itemId is required", bucket }, { status: 400 });
    }

    const { item, error: itemError } = await loadItem(supabase, itemId, organizationId);
    if (itemError) {
      logCtx("item-query-error", { itemId, organizationId, bucket, err: itemError });
      return NextResponse.json(
        { success: false, error: itemError, bucket, attemptedPath: null },
        { status: 422 },
      );
    }
    if (!item) {
      logCtx("item-not-found", { itemId, organizationId, bucket });
      return NextResponse.json(
        { success: false, error: "Mailroom item not found", bucket, attemptedPath: null },
        { status: 404 },
      );
    }

    const path = clean(item.storage_path);
    const mime = clean(item.mime_type) || "application/octet-stream";
    const fileName = clean(item.file_name) || "mailroom-document";

    if (!path) {
      logCtx("no-storage-path", { itemId, organizationId, bucket });
      if (isProbe) {
        return NextResponse.json(
          {
            success: false,
            error: "This mailroom item has no file attached.",
            bucket,
            attemptedPath: null,
            fileName,
            mimeType: mime,
          },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { success: false, error: "No file on this mailroom item", bucket, attemptedPath: null },
        { status: 404 },
      );
    }

    const resolved = await resolveExistingPath(supabase, bucket, path);

    // Probe-only response: don't transfer bytes, just confirm the object exists.
    if (isProbe) {
      if (!resolved.path) {
        logCtx("probe-missing", { itemId, organizationId, bucket, path, err: "Object not found in storage" });
        return NextResponse.json(
          {
            success: false,
            error: "Object not found in storage",
            bucket,
            attemptedPath: path,
            fileName,
            mimeType: mime,
          },
          { status: 404 },
        );
      }
      logCtx("probe-ok", { itemId, organizationId, bucket, path: resolved.path });
      return NextResponse.json({
        success: true,
        bucket,
        attemptedPath: resolved.path,
        fileName,
        mimeType: mime,
      });
    }

    // Full download.
    const downloadPath = resolved.path || path;
    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(downloadPath);
    if (dlErr || !blob) {
      logCtx("download-failed", {
        itemId,
        organizationId,
        bucket,
        path: downloadPath,
        err: dlErr?.message || "no-blob",
      });
      return NextResponse.json(
        {
          success: false,
          error: dlErr?.message || "File not available in storage",
          bucket,
          attemptedPath: downloadPath,
        },
        { status: 404 },
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    logCtx("download-ok", { itemId, organizationId, bucket, path: downloadPath, bytes: buffer.byteLength });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": blob.type || mime,
        "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    logCtx("unhandled-error", {
      itemId,
      organizationId,
      bucket,
      err: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch file",
        bucket,
      },
      { status: 500 },
    );
  }
}

// Lightweight existence check via HEAD — mirrors the probe path for callers that prefer HEAD.
export async function HEAD(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const url = new URL(request.url);
  url.searchParams.set("probe", "1");
  return GET(new Request(url.toString(), { method: "GET" }), context);
}
