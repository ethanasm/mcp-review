/**
 * Prompt templates for different review modes
 */

export interface TemplateContext {
  diff: string;
  commitMessages?: string[];
  focusAreas?: string[];
  conventions?: string[];
}

/**
 * Template for pre-commit (staged) reviews
 */
export function getStagedReviewPrompt(context: TemplateContext): string {
  return `You are reviewing staged changes before they are committed.

## Staged Changes

\`\`\`diff
${context.diff}
\`\`\`

This is a pre-commit review. Focus on catching issues before they enter the codebase.
Pay special attention to:
- Incomplete implementations (TODO comments, placeholder values)
- Debug code that shouldn't be committed (console.log, debugger statements)
- Sensitive data (API keys, passwords, tokens)

Use the available tools to understand the context, then provide your structured review.`;
}

/**
 * Template for reviewing a commit range
 */
export function getRangeReviewPrompt(context: TemplateContext): string {
  const commitSection =
    context.commitMessages && context.commitMessages.length > 0
      ? `
## Commit Messages

${context.commitMessages.map((m) => `- ${m}`).join('\n')}
`
      : '';

  return `You are reviewing a range of commits.

## Changes

\`\`\`diff
${context.diff}
\`\`\`
${commitSection}

Review these changes as if you were doing a pull request review. Consider:
- Whether the changes align with the commit messages
- Code consistency with the rest of the project
- Potential impacts on other parts of the codebase

Use the available tools to understand the context, then provide your structured review.`;
}

/**
 * Template for security-focused reviews
 */
export function getSecurityReviewPrompt(context: TemplateContext): string {
  return `You are performing a security-focused code review.

## Changes to Review

\`\`\`diff
${context.diff}
\`\`\`

Focus specifically on security concerns:
- Input validation and sanitization
- Authentication and authorization logic
- Data exposure risks
- Injection vulnerabilities (SQL, XSS, command injection)
- Cryptographic issues
- Sensitive data handling
- Access control

Use the available tools to understand the security context of the code, then provide your structured review with emphasis on security findings.`;
}

/**
 * Template for performance-focused reviews
 */
export function getPerformanceReviewPrompt(context: TemplateContext): string {
  return `You are performing a performance-focused code review.

## Changes to Review

\`\`\`diff
${context.diff}
\`\`\`

Focus specifically on performance concerns:
- N+1 queries or inefficient data fetching
- Unnecessary computations or re-renders
- Memory leaks or excessive memory usage
- Missing caching opportunities
- Algorithmic complexity issues
- Bundle size impacts
- Database query efficiency

Use the available tools to understand the performance context, then provide your structured review with emphasis on performance findings.`;
}
