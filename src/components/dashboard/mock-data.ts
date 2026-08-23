/**
 * Shared shape for the dashboard's member-growth chart. The series itself is
 * now built from real member join dates in the org-overview page; there is no
 * activity telemetry yet, so cumulative members (`active`) + new joins per week
 * (`joined`) is the honest signal. Swap for richer metrics once telemetry lands.
 */

export type ActivityPoint = { label: string; active: number; joined: number };
