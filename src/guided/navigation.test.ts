import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestFonts } from '../../tests/helpers/fonts';
import { addField, createManualField, setFieldText, updateField } from '@/model/fields';
import { EMPTY_MODEL, type DocModel } from '@/model/types';
import { fieldPosition, firstOpenField, nextOpenField, stepField } from './navigation';

const D = { fontFamily: 'sans' as const, color: '#000', dateFormat: 'DD/MM/YYYY' as const, maxFontSize: 12 };

beforeAll(async () => {
  await loadTestFonts();
});

function model(n: number): { m: DocModel; ids: string[] } {
  let m = EMPTY_MODEL;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = createManualField(0, { x: 10, y: 10 + i * 30, width: 100, height: 14 }, 'text');
    m = addField(m, f);
    ids.push(f.id);
  }
  return { m, ids };
}

describe('guided navigation', () => {
  it('steps forward and backward, skipping N/A fields', () => {
    const built = model(4);
    const { ids } = built;
    let { m } = built;
    m = updateField(m, ids[1]!, { notApplicable: true });
    expect(stepField(m, null, 1)).toBe(ids[0]);
    expect(stepField(m, ids[0]!, 1)).toBe(ids[2]);
    expect(stepField(m, ids[2]!, -1)).toBe(ids[0]);
    expect(stepField(m, ids[3]!, 1)).toBeNull();
    expect(stepField(m, null, -1)).toBe(ids[3]);
  });

  it('continues from the old index when the current field disappears', () => {
    const { m, ids } = model(3);
    const without = { ...m, fieldOrder: m.fieldOrder.filter((id) => id !== ids[1]) };
    expect(stepField(without, ids[1]!, 1, 1)).toBe(ids[2]);
    expect(stepField(without, ids[1]!, -1, 1)).toBe(ids[0]);
  });

  it('finds open fields, wrapping around', () => {
    const built = model(3);
    const { ids } = built;
    let { m } = built;
    m = setFieldText(m, m.fields[ids[0]!]!, 'done', D);
    expect(firstOpenField(m)).toBe(ids[1]);
    m = setFieldText(m, m.fields[ids[2]!]!, 'done', D);
    expect(nextOpenField(m, ids[2]!)).toBe(ids[1]);
    expect(nextOpenField(m, ids[1]!)).toBeNull();
    expect(fieldPosition(m, ids[2]!)).toEqual({ index: 2, total: 3 });
  });
});
