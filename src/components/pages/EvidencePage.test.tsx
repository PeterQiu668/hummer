import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EvidencePage from './EvidencePage';

describe('EvidencePage skill growth', () => {
  it('separates twin coaching, digital employee training, and team promotion', () => {
    render(<EvidencePage />);
    fireEvent.click(screen.getByRole('button', { name: '成长' }));

    expect(screen.getByText('谁在成长')).toBeInTheDocument();
    expect(screen.getByText('个人分身学习你的判断与协作偏好')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '数字员工' }));
    expect(screen.getByText('岗位数字员工训练可复用的 SOP 与工具能力')).toBeInTheDocument();
    expect(screen.getByText('通过项目验收后才能升版')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '团队方法' }));
    expect(screen.getByText('验证通过后再推广，绝不自动污染全组织')).toBeInTheDocument();
  });
});
