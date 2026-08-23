import { Badge } from "@/components/ui/badge";
import { SPRINT_STATE_LABELS, type SprintState } from "@/db/schema/sprints";

// v0.3 lozenge: neutral surface, ink label, colour carried by the dot — the
// shared Badge owns the geometry so every lozenge in the app matches. The
// label is always present, so state never depends on colour alone.
const VARIANTS: Record<SprintState, "warning" | "success" | "neutral"> = {
  planning: "warning",
  active: "success",
  completed: "neutral",
};

export function SprintStateBadge({
  state,
  className,
}: {
  state: SprintState;
  className?: string;
}) {
  return (
    <Badge variant={VARIANTS[state]} className={className}>
      {SPRINT_STATE_LABELS[state]}
    </Badge>
  );
}
