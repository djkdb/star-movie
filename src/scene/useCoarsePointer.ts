import { useEffect, useState } from 'react';

function readCoarsePointer(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

/** Whether the primary pointer is a finger, so camera gestures can be gentler. */
export function useCoarsePointer(): boolean {
  const [coarsePointer, setCoarsePointer] = useState(readCoarsePointer);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return coarsePointer;
}
