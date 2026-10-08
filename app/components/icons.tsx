import type { CSSProperties } from "react";

export function Icon({ name, size = 18, style }: { name: "play" | "pause" | "reset" | "arrow" | "expand" | "link" | "check" | "chevron" | "download" | "voice" | "close" | "volume" | "muted"; size?: number; style?: CSSProperties }) {
  const paths: Record<typeof name, React.ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    link: <><path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    voice: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    volume: <><path d="m11 4-6 5H2v6h3l6 5V4Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    muted: <><path d="m11 4-6 5H2v6h3l6 5V4Z" /><path d="m16 9 6 6m0-6-6 6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}

export function Wordmark() {
  return <span className="brand"><svg width="32" height="16" viewBox="0 0 32 16" fill="none" aria-hidden="true"><path d="M1 8h30" stroke="currentColor" opacity=".4" /><circle cx="7" cy="8" r="4" stroke="currentColor" strokeWidth="1.7" /><circle cx="24" cy="8" r="4" fill="currentColor" /></svg>Before<span className="brand-period">.</span></span>;
}
