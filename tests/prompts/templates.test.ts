import { describe, expect, it } from 'vitest';
import {
  getPerformanceReviewPrompt,
  getRangeReviewPrompt,
  getSecurityReviewPrompt,
  getStagedReviewPrompt,
} from '../../src/prompts/templates.js';

const baseDiff = '+ const x = 1;';

describe('getStagedReviewPrompt', () => {
  it('includes diff and pre-commit focus', () => {
    const prompt = getStagedReviewPrompt({ diff: baseDiff });
    expect(prompt).toContain(baseDiff);
    expect(prompt).toContain('pre-commit');
    expect(prompt).toContain('TODO comments');
    expect(prompt).toContain('Sensitive data');
  });
});

describe('getRangeReviewPrompt', () => {
  it('includes diff in output', () => {
    const prompt = getRangeReviewPrompt({ diff: baseDiff });
    expect(prompt).toContain(baseDiff);
  });

  it('includes commit messages when provided', () => {
    const prompt = getRangeReviewPrompt({
      diff: baseDiff,
      commitMessages: ['fix: resolve null check', 'feat: add validation'],
    });
    expect(prompt).toContain('Commit Messages');
    expect(prompt).toContain('fix: resolve null check');
    expect(prompt).toContain('feat: add validation');
  });

  it('omits commit section when no messages', () => {
    const prompt = getRangeReviewPrompt({ diff: baseDiff });
    expect(prompt).not.toContain('Commit Messages');
  });
});

describe('getSecurityReviewPrompt', () => {
  it('focuses on security concerns', () => {
    const prompt = getSecurityReviewPrompt({ diff: baseDiff });
    expect(prompt).toContain(baseDiff);
    expect(prompt).toContain('Injection vulnerabilities');
    expect(prompt).toContain('Authentication');
  });
});

describe('getPerformanceReviewPrompt', () => {
  it('focuses on performance concerns', () => {
    const prompt = getPerformanceReviewPrompt({ diff: baseDiff });
    expect(prompt).toContain(baseDiff);
    expect(prompt).toContain('N+1');
    expect(prompt).toContain('Memory leaks');
  });
});
