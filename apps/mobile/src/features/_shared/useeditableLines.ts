// apps/mobile/src/features/_shared/useEditableLines.ts
import * as React from "react";

export type AnyLine = {
  id?: string;        // server id (optional for new)
  lineId?: string;    // local stable id (client)
  itemId?: string;
  qty?: number;
  price?: number;
  name?: string;
  sku?: string;
  // ...any other fields you carry on lines
};

function makeLocalId() {
  return `ln_${Math.random().toString(36).slice(2, 10)}`;
}

export function useEditableLines<T extends AnyLine>(initial: T[] = []) {
  const [lines, setLines] = React.useState<T[]>(
    initial.map(l => ({ lineId: l.lineId ?? makeLocalId(), ...l }))
  );
  const editingIndexRef = React.useRef<number | null>(null);

  const beginEdit = React.useCallback((index: number) => {
    editingIndexRef.current = index;
  }, []);

  const cancelEdit = React.useCallback(() => {
    editingIndexRef.current = null;
  }, []);

  const upsertAtIndex = React.useCallback((index: number, patch: Partial<T>) => {
    setLines(prev => {
      if (index < 0 || index >= prev.length) return prev;
      const curr = prev[index];
      const next: T = { ...curr, ...patch } as T;
      // Preserve stable lineId, don’t create new entry
      next.lineId = curr.lineId ?? makeLocalId();
      const clone = prev.slice();
      clone[index] = next;
      return clone;
    });
    editingIndexRef.current = null;
  }, []);

  const replaceFromSelector = React.useCallback((selected: Partial<T> & { itemId?: string }) => {
    const idx = editingIndexRef.current;
    if (idx == null) {
      // Safety: if somehow no edit index, append but ensure stable id
      setLines(prev => [
        ...prev,
        { lineId: makeLocalId(), qty: 1, ...selected } as T,
      ]);
    } else {
      upsertAtIndex(idx, selected);
    }
  }, [upsertAtIndex]);

  const removeAtIndex = React.useCallback((index: number) => {
    setLines(prev => prev.filter((_, i) => i !== index));
    editingIndexRef.current = null;
  }, []);

  const addBlank = React.useCallback((defaults: Partial<T> = {}) => {
    setLines(prev => [...prev, { lineId: makeLocalId(), qty: 1, ...defaults } as T]);
  }, []);

  return {
    lines,
    setLines,
    beginEdit,
    cancelEdit,
    upsertAtIndex,
    replaceFromSelector,
    removeAtIndex,
    addBlank,
    editingIndexRef,
  };
}
