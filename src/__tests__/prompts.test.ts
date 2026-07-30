import { describe, expect, test } from 'bun:test';

import { buildClassificationPrompt } from '../prompts';

describe('buildClassificationPrompt', () => {
  test('instructs OpenRouter to fetch webpage content when requested', () => {
    const sourceUrl = 'https://example.com/event';
    const { user } = buildClassificationPrompt('', [], {
      sourceLabel: 'Web page',
      sourceUrl,
      fetchSourceUrl: true,
    });

    expect(user).toContain(`Use web_fetch to fetch and read the Source URL: ${sourceUrl}`);
    expect(user).toContain('Use web_search only as a fallback');
  });
});
