import { notImplemented } from "./_notImplemented";

/** Class name merge helper. */
export const cn = (...classes: Array<string | false | null | undefined>): string => classes.filter(Boolean).join(" ");

/** Maps status to badge style. */
export const getStatusBadgeVariant = (...args: unknown[]): never => notImplemented("getStatusBadgeVariant", args);

/** Maps priority to badge style. */
export const getPriorityBadgeVariant = (...args: unknown[]): never => notImplemented("getPriorityBadgeVariant", args);

/** Displays — for missing values. */
export const formatEmptyValue = (...args: unknown[]): never => notImplemented("formatEmptyValue", args);

/** Shortens long text. */
export const truncateText = (...args: unknown[]): never => notImplemented("truncateText", args);

/** Singular/plural labels. */
export const pluralize = (...args: unknown[]): never => notImplemented("pluralize", args);

/** Displays counts. */
export const formatCount = (...args: unknown[]): never => notImplemented("formatCount", args);

/** Displays percentages. */
export const formatPercentage = (...args: unknown[]): never => notImplemented("formatPercentage", args);

/** Consistent table formatting. */
export const formatTableColumn = (...args: unknown[]): never => notImplemented("formatTableColumn", args);

/** Page breadcrumb helper. */
export const buildBreadcrumbs = (...args: unknown[]): never => notImplemented("buildBreadcrumbs", args);

/** Consistent page titles. */
export const buildPageTitle = (...args: unknown[]): never => notImplemented("buildPageTitle", args);
