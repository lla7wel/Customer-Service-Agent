import { describe, expect, it } from 'vitest';
import { validateSelectedGeneration } from '../../integrations/content/approval';

const complete = { id: 'run-1', status: 'completed', quality_status: 'verified', config_revision: 4 };

describe('content approval safety', () => {
  it('rejects missing and stale generated previews', () => {
    expect(validateSelectedGeneration({ selectedGenerationId: null, itemRevision: 4, run: null, warningAcknowledged: false }))
      .toBe('no_selected_generation');
    expect(validateSelectedGeneration({ selectedGenerationId: 'run-1', itemRevision: 5, run: complete, warningAcknowledged: false }))
      .toBe('stale_generation');
  });

  it('requires explicit acknowledgement for a warning result', () => {
    const warning = { ...complete, quality_status: 'warning' };
    expect(validateSelectedGeneration({ selectedGenerationId: 'run-1', itemRevision: 4, run: warning, warningAcknowledged: false }))
      .toBe('quality_warning_ack_required');
    expect(validateSelectedGeneration({ selectedGenerationId: 'run-1', itemRevision: 4, run: warning, warningAcknowledged: true }))
      .toBeNull();
  });
});
