export function InvestigationProgress({ label, stopping, onCancel }: { label: string; stopping: boolean; onCancel: () => void }) {
  return (
    <div className="progress" role="status" data-testid="progress" aria-live="polite">
      <p>{stopping ? "Stopping the investigation." : label}</p>
      <button className="ghost" type="button" data-testid="progress-stop" onClick={onCancel} disabled={stopping}>
        Stop
      </button>
    </div>
  );
}
