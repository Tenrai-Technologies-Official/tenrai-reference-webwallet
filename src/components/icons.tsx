// The Tenrai web wallet's icons, 24 by 24 and filled with the text colour.

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M11 3h2v9.2l3.6-3.6L18 10l-6 6-6-6 1.4-1.4 3.6 3.6zM5 19h14v2H5z" />
    </svg>
  );
}

export function MergeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M17 20.41 18.41 19 15 15.59 13.59 17zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5z" />
    </svg>
  );
}

export function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 3h6v2H5v4H3zm12 0h6v6h-2V5h-4zM3 15h2v4h4v2H3zm16 0h2v6h-6v-2h4zM7 7h4v4H7zm6 0h4v4h-4zm-6 6h4v4H7zm8 0h2v2h-2zm-2 2h2v2h-2zm2 2h2v-2h-2z"
      />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9 3h10a2 2 0 0 1 2 2v12h-2V5H9zM5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2m0 2v10h10V9z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6L21 7.5l-1.4-1.4z" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 4 5 11l1.4 1.4L11 7.8V20h2V7.8l4.6 4.6L19 11z" />
    </svg>
  );
}

export function ReceiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="m12 20 7-7-1.4-1.4-4.6 4.6V4h-2v12.2l-4.6-4.6L5 13z" />
    </svg>
  );
}

export function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a1 1 0 0 1 0 2H6.5a.5.5 0 0 0 0 1H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 17.5zm12.5 7a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5"
      />
    </svg>
  );
}

export function StakingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3 2.5 8 12 13l9.5-5zM4.2 11.9 2.5 13 12 18l9.5-5-1.7-1.1L12 16zM4.2 15.9 2.5 17 12 22l9.5-5-1.7-1.1L12 20z" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.7a7 7 0 0 1 0 1.9l2 1.7-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.7h-3.4l-.5-2.7a7 7 0 0 1-1.7-.9l-2.5.9-1.7-2.9 2-1.7a7 7 0 0 1 0-1.9l-2-1.7 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7"
      />
    </svg>
  );
}

function Glyph({ path, label }: { path: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <path fill="currentColor" d={path} />
    </svg>
  );
}

export function ChatIcon() {
  return <Glyph path="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2" />;
}

export function LockIcon({ label }: { label?: string }) {
  return <Glyph label={label} path="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5m3 8H9V7a3 3 0 0 1 6 0z" />;
}

export function BackIcon() {
  return <Glyph path="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" />;
}

export function InfoIcon() {
  return <Glyph path="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16" />;
}

export function EmojiIcon() {
  return (
    <Glyph path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16M8.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M7 14a5 5 0 0 0 10 0z" />
  );
}

export function PlaneIcon() {
  return <Glyph path="M3 20.5v-7l9-1.5-9-1.5v-7L22 12z" />;
}

export function ClockIcon({ label }: { label?: string }) {
  return <Glyph label={label} path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16m.5 3H11v6l5.25 3.15.75-1.23-4.5-2.67z" />;
}

export function SentIcon({ label }: { label?: string }) {
  return <Glyph label={label} path="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6L21 7.5l-1.4-1.4z" />;
}

export function FinalIcon({ label }: { label?: string }) {
  return <Glyph label={label} path="M18 7l-1.4-1.4-6.3 6.3 1.4 1.4zm4.2-1.4L11.6 16.2 7.4 12 6 13.4l5.6 5.6 12-12zM.4 13.4 6 19l1.4-1.4L1.8 12z" />;
}

export function AlertIcon({ label }: { label?: string }) {
  return <Glyph label={label} path="M11 7h2v6h-2zm0 8h2v2h-2zm1-13a10 10 0 1 0 0 20 10 10 0 0 0 0-20" />;
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d="M12 2 4 5v6.1c0 5 3.4 9.5 8 10.9 4.6-1.4 8-5.9 8-10.9V5zm0 5a2.5 2.5 0 0 1 1 4.8V16h-2v-4.2A2.5 2.5 0 0 1 12 7" />
    </svg>
  );
}
