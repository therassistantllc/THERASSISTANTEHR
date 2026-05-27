export const CLAIM_DOC_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadClaimDocumentResult = { ok: boolean; error?: string };

export function uploadClaimDocumentWithProgress(
  claimId: string,
  organizationId: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadClaimDocumentResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/billing/claims/${claimId}/documents`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => resolve({ ok: false, error: "Network error" });
    xhr.onload = () => {
      let body: { success?: boolean; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.success !== false) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error: body.error || `Upload failed (${xhr.status})`,
        });
      }
    };
    const form = new FormData();
    form.set("file", file);
    form.set("organizationId", organizationId);
    xhr.send(form);
  });
}
