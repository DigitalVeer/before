"use client";

import { useState } from "react";
import { Icon } from "../components/icons";
import { validateClaim } from "../../lib/claims/validate";
import { demoSession, SPOUSE_CLAIM } from "../../lib/demo/scenario";

const REASONS: Record<string, string> = {
  "time-not-spoken-by-witness": "Luis said 8:32. A claim for 8:30 cannot pass.",
  "exact-time-missing-anchor": "An exact time needs a checkable record, such as the call log.",
  "readback-not-observed": "The complete read-back needs the witness’s explicit yes.",
};

export function EvidenceLab() {
  const [clock, setClock] = useState("8:30");
  const [anchor, setAnchor] = useState(true);
  const [confirmation, setConfirmation] = useState(true);
  const [result, setResult] = useState<{ accepted: boolean; reason: string } | null>(null);
  function validate() {
    const claim = { ...SPOUSE_CLAIM, time: SPOUSE_CLAIM.time.replace("08:32", clock === "8:30" ? "08:30" : "08:32"),
      anchor: anchor ? SPOUSE_CLAIM.anchor : { type: "none" as const, description: "memory only" } };
    const outcome = validateClaim(claim, demoSession("spouse", confirmation ? undefined : 7));
    setResult({ accepted: outcome.result.accepted, reason: outcome.result.reason ?? "All evidence gates passed" });
  }
  return <section className="evidence-lab" id="evidence-lab" aria-labelledby="lab-title">
    <div className="lab-intro"><h2 id="lab-title">Test the validator</h2><p>Luis said <b>8:32 AM</b>. Try changing the time or removing its evidence.</p></div>
    <div className="lab-controls">
      <fieldset><legend>Claimed time</legend><div className="time-options">{["8:30", "8:32"].map((time) => <button key={time} className={clock === time ? "selected" : ""} aria-pressed={clock === time} onClick={() => { setClock(time); setResult(null); }}>{time} AM</button>)}</div></fieldset>
      <div className="lab-switches"><label><input type="checkbox" checked={anchor} onChange={(event) => { setAnchor(event.target.checked); setResult(null); }} /> Call log checked</label><label><input type="checkbox" checked={confirmation} onChange={(event) => { setConfirmation(event.target.checked); setResult(null); }} /> Witness said yes</label></div>
      <button className="lab-submit" onClick={validate}>Test this claim <Icon name="arrow" size={17} /></button>
    </div>
    <output className={`lab-result ${result ? result.accepted ? "passed" : "rejected" : "empty"}`} aria-live="polite">
      {result ? <><Icon name={result.accepted ? "check" : "close"} size={23} /><b>{result.accepted ? "Evidence accepted" : "Claim blocked"}</b><p>{result.accepted ? "The spoken time, call log, and confirmation support this claim." : REASONS[result.reason] ?? result.reason}</p></> : <p>Choose a claim to test.</p>}
    </output>
  </section>;
}
