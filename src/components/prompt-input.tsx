"use client";

import { useState } from "react";

type Props = {
  onSubmit: (prompt: string) => Promise<void>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function PromptInput({ onSubmit, value, onChange, disabled }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(trimmed);
      onChange("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to send prompt");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel" style={{ padding: "0.75rem" }}>
      <div className="stack">
        <textarea
          className="textarea"
          placeholder="Ask the agent about your graph..."
          value={value}
          disabled={disabled || submitting}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="button" onClick={handleSubmit} disabled={disabled || submitting || !value.trim()}>
            <span className="tab-label-with-spinner">
              {submitting ? <span className="spinner tab-spinner" /> : null}
              {submitting ? "Sending..." : "Send"}
            </span>
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
