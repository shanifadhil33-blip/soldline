export default function Loading() {
  return <section className="screen skeleton-screen" aria-busy="true">
    <div className="skeleton skeleton-title" />
    <div className="skeleton skeleton-line" />
    <div className="skeleton skeleton-card" />
    <div className="skeleton skeleton-card" />
  </section>;
}
