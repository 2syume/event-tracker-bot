import { describe, expect, test } from 'bun:test';
import z from 'zod';

import { EventSchema, normalizeEventRecord, normalizeLocation } from '../schema';

const leakedLocation = JSON.stringify({
  completionState: 'incomplete',
  entries: [
    [
      'name',
      {
        completionState: 'incomplete',
        type: 'String',
        value: '横浜アリーナ',
      },
    ],
    [
      'address',
      {
        completionState: 'incomplete',
        type: 'String',
        value: '神奈川県横浜市港北区新横浜3-10',
      },
    ],
  ],
  type: 'Object',
});

describe('normalizeLocation', () => {
  test('keeps ordinary human-readable locations unchanged', () => {
    expect(normalizeLocation('横浜アリーナ')).toBe('横浜アリーナ');
  });

  test('converts leaked partial-object metadata into a readable location', () => {
    expect(normalizeLocation(leakedLocation)).toBe('横浜アリーナ, 神奈川県横浜市港北区新横浜3-10');
  });

  test('rejects incomplete-object metadata without usable string values', () => {
    expect(
      normalizeLocation(
        JSON.stringify({
          completionState: 'incomplete',
          entries: [['name', { completionState: 'incomplete', type: 'String', value: '' }]],
          type: 'Object',
        }),
      ),
    ).toBeUndefined();
  });
});

describe('EventSchema', () => {
  test('remains convertible to JSON Schema for OpenRouter structured output', () => {
    expect(() => z.toJSONSchema(EventSchema)).not.toThrow();
  });

  test('normalizes leaked location metadata after schema validation', () => {
    const parsed = EventSchema.parse({
      source: {
        platform: 'twitter',
        url: 'https://x.com/example/status/1',
        tweetId: '1',
      },
      isEvent: true,
      location: leakedLocation,
      images: [],
    });

    expect(normalizeEventRecord(parsed).location).toBe(
      '横浜アリーナ, 神奈川県横浜市港北区新横浜3-10',
    );
  });
});
