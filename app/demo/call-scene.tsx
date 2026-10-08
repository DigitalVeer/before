"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Icon } from "../components/icons";
import { DEMO_WITNESSES } from "../../lib/demo/scenario";

type Props = {
  seconds: number; parallel: boolean; task: string; speaker: string; quote: ReactNode;
  quoteText: string; speaking: boolean; longQuote: boolean; direct: boolean; anchored: boolean;
  confirmed: boolean; onInspect: (id: string) => void;
};

export function CallScene(props: Props) {
  const { seconds, parallel, task, speaker, quote, quoteText, speaking, longQuote, direct, anchored, confirmed, onInspect } = props;
  const quoteRef = useRef<HTMLQuoteElement>(null);
  const previousRef = useRef<{ rect: DOMRect; parallel: boolean } | null>(null);
  const animationRef = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const element = quoteRef.current;
    if (!element) return;
    animationRef.current?.cancel();
    const rect = element.getBoundingClientRect();
    const previous = previousRef.current;
    if (parallel && previous && !previous.parallel && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animationRef.current = element.animate([
        { transform: `translate(${previous.rect.x - rect.x}px, ${previous.rect.y - rect.y}px) scale(${previous.rect.width / rect.width})` },
        { transform: "none" },
      ], { duration: 700, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
    previousRef.current = { rect, parallel };
    return () => { animationRef.current?.cancel(); };
  }, [parallel, quoteText]);

  return <section className={`conversation-stage ${parallel ? "is-parallel" : ""}`} aria-labelledby="agent-heading">
    <header className="panel-heading"><h2 id="agent-heading">{parallel ? "Voice agents" : "Voice agent"}</h2><p>{parallel ? "5 calls. One chart." : task}</p></header>
    <div className={`conversation-focus ${longQuote ? "long-quote" : ""}`}>
      <div className="speaker-line"><span>{parallel ? "Luis M., husband" : speaker}</span>{!parallel && <span className={`speech-indicator ${speaking ? "speaking" : ""}`} aria-hidden="true">{[7, 14, 20, 11, 17].map((height, index) => <i key={index} style={{ height, animationDelay: `${index * -0.13}s` }} />)}</span>}{parallel && <Icon name="check" size={16} />}</div>
      <blockquote ref={quoteRef}>{quote}</blockquote>
    </div>
    {parallel ? <ol className="parallel-calls" aria-label="Four additional agents gathering accounts in parallel">{DEMO_WITNESSES.slice(1).map((witness, index) => {
      const filed = seconds >= witness.filedAt;
      return <li key={witness.key} style={{ "--lane-order": index } as React.CSSProperties}><button className={`parallel-call ${filed ? "is-filed" : ""}`} disabled={!filed} onClick={() => onInspect(witness.id)} aria-label={`Inspect ${witness.name.split(" ")[0]}’s evidence`}><span className="agent-person"><b>{witness.name}</b><span>{witness.role}</span></span><span className="agent-status">{filed ? "To chart" : "On call"}<Icon name={filed ? "arrow" : "voice"} size={17} /></span></button></li>;
    })}</ol> : <div className="evidence-gates" aria-label="Evidence required before the timeline changes">{[
      { label: "Direct source", done: direct }, { label: "Time anchor", done: anchored }, { label: "Confirmed", done: confirmed },
    ].map((gate) => <span className={`evidence-gate ${gate.done ? "done" : ""}`} key={gate.label} aria-label={`${gate.label}: ${gate.done ? "established" : "pending"}`}><span className="gate-symbol">{gate.done ? <Icon name="check" size={13} /> : <span />}</span>{gate.label}</span>)}</div>}
  </section>;
}
