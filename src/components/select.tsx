'use client';
import { useEffect, useId, useRef, useState } from 'react';

export type Choice = { value: string; label: string };

/** A dropdown that opens attached to its field. Native selects show a tap ring on iOS and look off brand. */
export function Select({ label, value, options, onChange, name, disabled = false }: {
  label: string; value: string; options: readonly Choice[]; onChange: (value: string) => void; name?: string; disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const current = options.find(option => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function show() { setIndex(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); }
  function pick(next: string) { setOpen(false); trigger.current?.focus(); if (next !== value) onChange(next); }
  function key(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { show(); return; }
      setIndex(position => (position + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
    if (open && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pick(options[index].value); }
    if (event.key === 'Tab') setOpen(false);
  }
  return <div className="select" ref={root} onKeyDown={key}>
    {name && <input type="hidden" name={name} value={value} />}
    <button type="button" ref={trigger} className="select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} disabled={disabled} onClick={() => open ? setOpen(false) : show()}>
      <span>{current?.label}</span><svg className="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
    </button>
    {open && <ul className="select-list" id={`${id}-list`} role="listbox" aria-label={label}>
      {options.map((option, position) => <li key={option.value} role="option" aria-selected={option.value === value} data-active={position === index ? 'true' : undefined} onPointerDown={event => event.preventDefault()} onClick={() => pick(option.value)}>
        <span>{option.label}</span>{option.value === value && <svg className="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      </li>)}
    </ul>}
  </div>;
}
