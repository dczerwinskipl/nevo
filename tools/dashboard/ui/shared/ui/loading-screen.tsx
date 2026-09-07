export function LoadingScreen() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-5 py-16 sm:px-9">
      <div className="h-3 w-28 rounded bg-fg-primary/8" />
      <div className="mt-8 h-12 max-w-2xl rounded-xl bg-fg-primary/8" />
      <div className="mt-4 h-4 max-w-xl rounded bg-fg-primary/5" />
      <div className="mt-12 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-32 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <div className="mt-12 h-64 rounded-2xl border border-border bg-surface" />
    </div>
  );
}
