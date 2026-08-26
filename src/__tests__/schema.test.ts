import { describe, expect, test } from 'bun:test';
import z from 'zod';

import { EventSchema, normalizeEventRecord, normalizeLocation } from '../schema';

const incompleteLocation = JSON.stringify({
  completionState: 'incomplete',
  entries: [
    [
      'name',
      {
        completionState: 'incomplete',
        type: 'String',
        value: '新宿丸井 MEN 8F',
      },
    ],
    ['address', { type: 'Null' }],
  ],
  type: 'Object',
});

const completeLocation = JSON.stringify({
  completionState: 'complete',
  entries: [
    [
      'name',
      {
        completionState: 'complete',
        type: 'String',
        value: '淳久堂书店池袋本店 9楼 画廊空间',
      },
    ],
    [
      'address',
      {
        completionState: 'complete',
        type: 'String',
        value: '东京都丰岛区南池袋2-15-5',
      },
    ],
  ],
  type: 'Object',
});

describe('normalizeLocation', () => {
  test('keeps ordinary human-readable locations unchanged', () => {
    expect(normalizeLocation('横浜アリーナ')).toBe('横浜アリーナ');
  });

  test('converts incomplete object metadata with a null address', () => {
    expect(normalizeLocation(incompleteLocation)).toBe('新宿丸井 MEN 8F');
  });

  test('converts complete object metadata into a readable location', () => {
    expect(normalizeLocation(completeLocation)).toBe(
      '淳久堂书店池袋本店 9楼 画廊空间, 东京都丰岛区南池袋2-15-5',
    );
  });

  test('rejects object metadata without usable string values', () => {
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

  test('normalizes complete location metadata after schema validation', () => {
    const parsed = EventSchema.parse({
      source: {
        platform: 'twitter',
        url: 'https://x.com/example/status/1',
        tweetId: '1',
      },
      isEvent: true,
      location: completeLocation,
      images: [],
    });

    expect(normalizeEventRecord(parsed).location).toBe(
      '淳久堂书店池袋本店 9楼 画廊空间, 东京都丰岛区南池袋2-15-5',
    );
  });
});
