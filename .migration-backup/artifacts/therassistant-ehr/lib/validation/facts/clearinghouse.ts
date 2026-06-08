import type { FactContext, FactLoader } from "../types";

export const clearinghouseFact: FactLoader = {
  name: "clearinghouse",
  async load({ organizationId, supabase }: FactContext) {
    const { data, error } = await supabase
      .from("clearinghouse_connections")
      .select(
        "id, vendor, connection_name, mode, submitter_id, receiver_id, isa_usage_indicator, eligibility_service_type_code, eligibility_transaction_set, encrypted_credentials, is_active"
      )
      .eq("organization_id", organizationId);

    if (error) throw new Error(`clearinghouse_connections query failed: ${error.message}`);
    const rows = data ?? [];
    const active = rows.find((c) => c.is_active === true) ?? null;

    const hasSubmitterId = !!active && typeof active.submitter_id === "string" && active.submitter_id.trim().length > 0;
    const hasReceiverId = !!active && typeof active.receiver_id === "string" && active.receiver_id.trim().length > 0;
    const hasVendor = !!active && typeof active.vendor === "string" && active.vendor.trim().length > 0;
    const hasEligibilityServiceType =
      !!active &&
      typeof active.eligibility_service_type_code === "string" &&
      active.eligibility_service_type_code.trim().length > 0;
    const usageIndicatorOk = !!active && (active.isa_usage_indicator === "T" || active.isa_usage_indicator === "P");
    const credsObj = active && active.encrypted_credentials && typeof active.encrypted_credentials === "object"
      ? (active.encrypted_credentials as Record<string, unknown>)
      : {};
    const hasCredentials = Object.keys(credsObj).length > 0;

    return {
      totalConnections: rows.length,
      hasActive: !!active,
      activeMode: active?.mode ?? null,
      hasSubmitterId,
      hasReceiverId,
      hasVendor,
      hasEligibilityServiceType,
      usageIndicatorOk,
      hasCredentials,
      isLiveModeWithoutCredentials: active?.mode === "live" && !hasCredentials,
      activeSummary: active
        ? {
            vendor: active.vendor,
            mode: active.mode,
            submitterId: active.submitter_id,
            receiverId: active.receiver_id,
            isaUsageIndicator: active.isa_usage_indicator,
          }
        : null,
    };
  },
};
