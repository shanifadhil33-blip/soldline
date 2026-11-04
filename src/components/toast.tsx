'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const Toast = createContext<(text: string, problem?: boolean) => void>(() => {});
export function useToast() { return useContext(Toast); }

/** A short message at the bottom of the screen that says what just happened. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [note, setNote] = useState<{ text: string; problem: boolean; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, problem = false) => {
    if (timer.current) clearTimeout(timer.current);
    setNote({ text, problem, id: Date.now() });
    timer.current = setTimeout(() => setNote(null), 6000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <Toast.Provider value={show}>{children}
    {note && <div className="toast" role={note.problem ? 'alert' : 'status'} data-problem={note.problem ? 'true' : undefined} key={note.id}>{note.text}</div>}
  </Toast.Provider>;
}
