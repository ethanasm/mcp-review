import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.js';
import { getInitialPrompt, getSystemPrompt } from '../../src/prompts/system.js';

const baseConfig: Config = {
  model: 'claude-sonnet-4-20250514',
  focus: [],
  ignore: [],
  conventions: [],
  max_files: 20,
  context_lines: 5,
};

describe('getSystemPrompt', () => {
  it('includes general code quality when no focus areas set', () => {
    const prompt = getSystemPrompt(baseConfig);
    expect(prompt).toContain('general code quality');
  });

  it('includes specific focus areas when set', () => {
    const prompt = getSystemPrompt({ ...baseConfig, focus: ['security', 'performance'] });
    expect(prompt).toContain('security, performance');
    expect(prompt).not.toContain('general code quality');
  });

  it('includes conventions section when conventions exist', () => {
    const prompt = getSystemPrompt({ ...baseConfig, conventions: ['Use snake_case for files'] });
    expect(prompt).toContain('Project Conventions');
    expect(prompt).toContain('Use snake_case for files');
  });

  it('omits conventions section when empty', () => {
    const prompt = getSystemPrompt(baseConfig);
    expect(prompt).not.toContain('Project Conventions');
  });

  it('includes structured JSON output format', () => {
    const prompt = getSystemPrompt(baseConfig);
    expect(prompt).toContain('"critical"');
    expect(prompt).toContain('"suggestions"');
    expect(prompt).toContain('"positive"');
    expect(prompt).toContain('"confidence"');
  });
});

describe('getInitialPrompt', () => {
  it('includes the diff in a code block', () => {
    const prompt = getInitialPrompt('+ added line', baseConfig);
    expect(prompt).toContain('```diff');
    expect(prompt).toContain('+ added line');
  });

  it('includes ignore note when ignore patterns exist', () => {
    const prompt = getInitialPrompt('diff', { ...baseConfig, ignore: ['dist', '*.test.ts'] });
    expect(prompt).toContain('excluded from review');
    expect(prompt).toContain('dist');
    expect(prompt).toContain('*.test.ts');
  });

  it('omits ignore note when no ignore patterns', () => {
    const prompt = getInitialPrompt('diff', baseConfig);
    expect(prompt).not.toContain('excluded from review');
  });
});
