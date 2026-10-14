import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_MODEL, type DocModel } from '@/model/types';
import { editor } from './editor';

const withTitle = (n: number) => (m: DocModel): DocModel => ({ ...m, fieldOrder: [...m.fieldOrder, `f${n}`] });

describe('editor history', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    editor().reset(EMPTY_MODEL);
  });
  afterEach(() => vi.useRealTimers());

  it('commits, undoes and redoes with labels', () => {
    expect(editor().commit('Add one', withTitle(1))).toBe(true);
    editor().commit('Add two', withTitle(2));
    expect(editor().model.fieldOrder).toEqual(['f1', 'f2']);
    expect(editor().undo()).toBe('Add two');
    expect(editor().model.fieldOrder).toEqual(['f1']);
    expect(editor().redo()).toBe('Add two');
    expect(editor().model.fieldOrder).toEqual(['f1', 'f2']);
    editor().undo();
    editor().commit('Add three', withTitle(3));
    expect(editor().redo()).toBeNull();
  });

  it('ignores no-op commits', () => {
    expect(editor().commit('Nothing', (m) => m)).toBe(false);
    expect(editor().past.length).toBe(0);
    expect(editor().revision).toBe(0);
  });

  it('merges rapid commits with the same key into one entry', () => {
    editor().commit('Type', withTitle(1), { mergeKey: 'a' });
    vi.advanceTimersByTime(300);
    editor().commit('Type', withTitle(2), { mergeKey: 'a' });
    vi.advanceTimersByTime(2000);
    editor().commit('Type', withTitle(3), { mergeKey: 'a' });
    expect(editor().past.length).toBe(2);
    editor().undo();
    expect(editor().model.fieldOrder).toEqual(['f1', 'f2']);
    editor().undo();
    expect(editor().model.fieldOrder).toEqual([]);
  });

  it('records a whole gesture as one entry and can cancel it', () => {
    editor().beginGesture();
    for (let i = 0; i < 10; i++) editor().updateGesture(withTitle(i));
    expect(editor().endGesture('Move')).toBe(true);
    expect(editor().past.length).toBe(1);
    expect(editor().undo()).toBe('Move');
    expect(editor().model).toBe(EMPTY_MODEL);

    editor().beginGesture();
    editor().updateGesture(withTitle(1));
    editor().cancelGesture();
    expect(editor().model).toBe(EMPTY_MODEL);
    expect(editor().past.length).toBe(0);
    // A gesture that changes nothing records nothing.
    editor().beginGesture();
    expect(editor().endGesture('Move')).toBe(false);
  });

  it('undo during a gesture first closes it', () => {
    editor().beginGesture();
    editor().updateGesture(withTitle(1));
    editor().undo();
    expect(editor().model).toBe(EMPTY_MODEL);
    expect(editor().gestureBase).toBeNull();
    expect(editor().future.length).toBe(1);
  });
});

describe('dirty tracking', () => {
  it('is clean after reset, dirty after edits, clean again after undo or markClean', async () => {
    const { selectIsDirty } = await import('./editor');
    editor().reset(EMPTY_MODEL);
    expect(selectIsDirty(editor())).toBe(false);
    editor().commit('Add', withTitle(1));
    expect(selectIsDirty(editor())).toBe(true);
    editor().undo();
    expect(selectIsDirty(editor())).toBe(false);
    editor().redo();
    editor().markClean();
    expect(selectIsDirty(editor())).toBe(false);
  });
});
