/**
 * RBAC Module - Role-Based Access Control
 *
 * Public barrel for the small set of symbols consumed across packages.
 * Most callers import directly from the sibling modules
 * (`./auth`, `./middleware`, `./constants`, `./validators`); this barrel
 * exists only for the cross-package consumers that already use it.
 */

export {
  PERMISSIONS,
  STAFF_ROLES,
  type PermissionCode,
  type StaffRoleCode,
} from "./constants";

export {
  enforcePermission,
  getStaffContext,
  type StaffContextData,
} from "./server";
