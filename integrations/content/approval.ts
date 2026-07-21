export type GenerationApprovalIssue =
  | 'no_selected_generation'
  | 'stale_generation'
  | 'quality_warning_ack_required';

export function validateSelectedGeneration(args: {
  selectedGenerationId: string | null;
  itemRevision: number;
  run?: { id: string; status: string; quality_status: string; config_revision: number } | null;
  warningAcknowledged: boolean;
}): GenerationApprovalIssue | null {
  if (!args.selectedGenerationId) return 'no_selected_generation';
  if (!args.run || args.run.id !== args.selectedGenerationId || args.run.status !== 'completed'
    || args.run.config_revision !== args.itemRevision) return 'stale_generation';
  if (args.run.quality_status === 'warning' && !args.warningAcknowledged) return 'quality_warning_ack_required';
  return null;
}
