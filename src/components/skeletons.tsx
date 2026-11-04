/** Static placeholders shown at once while a screen loads. They keep the real screen's framing so nothing jumps. */
export function ListSkeleton({ rows = 5, action = false }: { rows?: number; action?: boolean }) {
  return <section className="screen skeleton-screen" aria-busy="true" aria-live="polite">
    <div className="skeleton skeleton-title" />
    {action && <div className="skeleton skeleton-button" />}
    <div className="skeleton-list">{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-chip" /></div>)}</div>
  </section>;
}
export function FormSkeleton() {
  return <section className="screen skeleton-screen" aria-busy="true" aria-live="polite">
    <div className="skeleton skeleton-title" />
    <div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-button" />
  </section>;
}
export function DetailSkeleton() {
  return <section className="screen skeleton-screen" aria-busy="true" aria-live="polite">
    <div className="skeleton skeleton-title" /><div className="skeleton skeleton-chip" />
    <div className="skeleton skeleton-tabs" />
    <div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" />
  </section>;
}
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton-list" aria-busy="true" aria-live="polite">{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-chip" /></div>)}</div>;
}
