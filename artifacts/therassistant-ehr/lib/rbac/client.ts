"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type TenantContextRow = {
  tenant_id?: string | null;
  tenant_name?: string | null;
  role_codes?: string[] | null;
  permission_codes?: string[] | null;
};

type RbacState = {
  tenantId: string | null;
  tenantName: string | null;
  roles: string[];
  permissions: string[];
  loading: boolean;
  error: string | null;
};

const EMPTY_RBAC_STATE: RbacState = {
  tenantId: null,
  tenantName: null,
  roles: [],
  permissions: [],
  loading: true,
  error: null,
};

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeTenantContext(data: unknown): Omit<RbacState, "loading" | "error"> {
  const row = Array.isArray(data) ? (data[0] as TenantContextRow | undefined) : (data as TenantContextRow | null);

  return {
    tenantId: row?.tenant_id ?? null,
    tenantName: row?.tenant_name ?? null,
    roles: normalizeArray(row?.role_codes),
    permissions: normalizeArray(row?.permission_codes),
  };
}

export function useRbac() {
  const [state, setState] = useState<RbacState>(EMPTY_RBAC_STATE);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setState({ ...EMPTY_RBAC_STATE, loading: false, error: userError?.message ?? "not_authenticated" });
      return;
    }

    const { data, error } = await supabase.rpc("get_current_tenant_context");
    if (error) {
      setState({ ...EMPTY_RBAC_STATE, loading: false, error: error.message });
      return;
    }

    setState({ ...normalizeTenantContext(data), loading: false, error: null });
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadMounted = async () => {
      await load();
      if (!mounted) return;
    };

    void loadMounted();

    const { data } = supabase.auth.onAuthStateChange(() => {
      if (!mounted) return;
      void load();
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [load]);

  const permissionSet = useMemo(() => new Set(state.permissions), [state.permissions]);
  const roleSet = useMemo(() => new Set(state.roles), [state.roles]);

  const hasPermission = useCallback(
    (permissionCode: string) => permissionSet.has(permissionCode),
    [permissionSet],
  );

  const hasAnyPermission = useCallback(
    (permissionCodes: string[]) => permissionCodes.some((permissionCode) => permissionSet.has(permissionCode)),
    [permissionSet],
  );

  const hasRole = useCallback(
    (roleCode: string) => roleSet.has(roleCode),
    [roleSet],
  );

  return {
    ...state,
    hasPermission,
    hasAnyPermission,
    hasRole,
    refresh: load,
  };
}
