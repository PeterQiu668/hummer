import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkbenchComposer from './WorkbenchComposer';

describe('WorkbenchComposer engine availability', () => {
  it('does not submit with an engine whose credential is not configured', () => {
    const onSubmit = vi.fn();
    render(<WorkbenchComposer
      value="summarize files"
      onChange={vi.fn()}
      onSubmit={onSubmit}
      assignee="auto"
      onAssigneeChange={vi.fn()}
      approvalMode="L2"
      onApprovalModeChange={vi.fn()}
      attachmentNames={[]}
      onAttachmentNamesChange={vi.fn()}
      modelProfile={'\u6807\u51c6'}
      engineProfiles={[{
        id: 'deepseek-standard', tier: 'standard', label: '\u6807\u51c6', available: false,
        dataDomain: 'api.deepseek.com', credentialStatus: 'not_configured', compatibilityNote: '\u672a\u914d\u7f6e\u5bc6\u94a5',
      }]}
      onModelProfileChange={vi.fn()}
      workContext="workspace"
      onWorkContextChange={vi.fn()}
    />);

    const submit = screen.getByRole('button', { name: '\u63d0\u4ea4\u4efb\u52a1' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
