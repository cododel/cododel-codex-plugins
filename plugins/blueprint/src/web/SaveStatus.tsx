import { useEffect, useRef, useState } from "react";

export function SaveStatus({
  pending,
  failed,
  connected,
}: {
  pending: boolean;
  failed: boolean;
  connected: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (pending) shownAt.current = performance.now();
        setVisible(pending);
      },
      pending ? 250 : Math.max(0, 500 - (performance.now() - shownAt.current)),
    );
    return () => clearTimeout(timer);
  }, [pending]);
  return (
    <span
      role="status"
      aria-live="polite"
      aria-busy={pending}
      data-save-status
      data-pending={pending}
      style={{ minWidth: 140, textAlign: "right" }}
      title={pending ? "Changes are being saved" : undefined}
    >
      {failed
        ? "Not saved"
        : !connected
          ? "Disconnected"
          : visible
            ? "Saving…"
            : "Saved"}
    </span>
  );
}
