"use client";

export function AlternativeConfirmation({ explanation, offer, onConfirm, onDismiss }: { explanation: string; offer: string; onConfirm: () => void; onDismiss: () => void }) {
  return (
    <div className="dialog-back">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="alternative-title" data-testid="alternative-dialog">
        <h2 id="alternative-title">Only part of this can be investigated</h2>
        <p>{explanation}</p>
        <p>{offer}</p>
        <div className="actions">
          <button className="primary" type="button" data-testid="alternative-confirm" onClick={onConfirm}>
            Run the smaller investigation
          </button>
          <button className="ghost" type="button" onClick={onDismiss}>
            Leave it
          </button>
        </div>
      </div>
    </div>
  );
}
