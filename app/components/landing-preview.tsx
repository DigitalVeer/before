"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
import { SPOUSE_TURNS } from "../../lib/demo/scenario";

const MOMENTS = [
  { label: "Remember", turn: 1, status: "A recollection", note: "An approximate time stays out of the timeline." },
  { label: "Check", turn: 3, status: "Call log checked", note: "8:32 is held until the complete read-back is confirmed." },
  { label: "Confirm", turn: 7, status: "Witness confirmed", note: "The claim passes. The clinician can inspect its source." },
];

export function LandingPreview() {
  const [step, setStep] = useState(0);
  const moment = MOMENTS[step];
  return <section className={`hero-evidence preview-step-${step}`} aria-label="Interactive preview of Luis’s evidence">
    <div className="preview-heading"><span>Rosa M. <span>Synthetic case</span></span><Icon name="voice" size={18} /></div>
    <div className="preview-top"><span>From the EMS handoff</span><div><b>6:00</b><span className="preview-rule" /><b>9:10</b></div><p>Relayed baseline<span>Found with symptoms</span></p></div>
    <div className="preview-quote"><div className="quote-person"><span>LM</span><div><b>Luis M.</b><small>Rosa’s husband · {moment.status.toLowerCase()}</small></div></div><blockquote aria-live="polite">“{SPOUSE_TURNS[moment.turn].content}”</blockquote><span className="quote-confirmed"><Icon name={step === 2 ? "check" : "voice"} size={14} />{moment.note}</span></div>
    <div className="preview-bottom"><span>{step === 2 ? "Witness-confirmed evidence" : "Structured timeline"}</span><div className={`new-window ${step < 2 ? "preview-pending" : ""}`}><b>{step === 2 ? "8:32" : "6:00"}</b><span><i />{step === 2 ? "38 min" : "Unresolved"}<i /></span><b>9:10</b></div><p>{step === 2 ? "Direct baseline" : "Relayed baseline"}<span>Symptoms discovered</span></p></div>
    <div className="preview-controls" aria-label="Preview moments">{MOMENTS.map((item, index) => <button key={item.label} aria-pressed={step === index} className={step === index ? "active" : ""} onClick={() => setStep(index)}>{item.label}<Icon name={index === 2 ? "check" : "chevron"} size={13} /></button>)}</div>
    <Link href="/demo" className="preview-footer">Hear this exchange in the demo <Icon name="arrow" size={16} /></Link>
  </section>;
}
