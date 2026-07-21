type EmptyStateProps = {
  title: string;
  message: string;
};

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <div className="empty-state__mark" aria-hidden="true" />
      <h2 id="empty-state-title">{title}</h2>
      <p>{message}</p>
    </section>
  );
}
