"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EvidenceDrawer } from "../clinician/screen";
import { Icon, Wordmark } from "../components/icons";
import { AUDIO_CUES, CHAPTERS, DEMO_DURATION, FULL_CHART_AT, SPOUSE_TURNS, chapterAt, demoMoment, demoPayloadAt, demoSession, DEMO_WITNESSES, witnessForEvent, witnessesAt, type DemoWitnessKey } from "../../lib/demo/scenario";
import { validateClaim } from "../../lib/claims/validate";
import { EvidenceTimeline } from "./evidence-timeline";
import { EvidenceLab } from "./evidence-lab";
import { CallScene } from "./call-scene";
import { parseExactTime } from "../../lib/claims/normalize";
import "./demo.css";

function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
function Quote({ text }: { text: string }) {
  return <>{text.split(/(8:32 AM|8:32|eight-thirty|normal|about lunch|Yes, that's correct\.)/g).map((part, index) => /^(8:32 AM|8:32|eight-thirty|normal|about lunch|Yes, that's correct\.)$/.test(part) ? <mark key={index}>{part}</mark> : part)}</>;
}

export default function DemoPage() {
  const [seconds, setSeconds] = useState(0);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sound, setSound] = useState(true);
  const [audioError, setAudioError] = useState(false);
  const [captionOnly, setCaptionOnly] = useState(false);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("demo-spouse");
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [transcriptSource, setTranscriptSource] = useState<DemoWitnessKey>("spouse");
  const audioRef = useRef<HTMLAudioElement>(null);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const startingRef = useRef(false);
  const requestRef = useRef(0);
  const positionRef = useRef(0);
  const chapter = chapterAt(seconds);
  const moment = demoMoment(seconds);
  const latestArrival = DEMO_WITNESSES.reduce((latest, witness) => seconds >= witness.filedAt ? Math.max(latest, witness.filedAt) : latest, 0);
  const data = useMemo(() => demoPayloadAt(latestArrival, acceptedIds), [latestArrival, acceptedIds]);
  const claims = data.timeline.events.filter((event) => event.evidence);
  const transcriptWitness = DEMO_WITNESSES.find((witness) => witness.key === transcriptSource)!;
  const complete = seconds >= DEMO_DURATION - 0.05;
  const turn = moment.currentTurn >= 0 ? SPOUSE_TURNS[moment.currentTurn] : null;
  const speaking = playing && moment.speaking;
  const agentTask = moment.confirmed ? "Evidence captured" : moment.currentTurn >= 6 ? "Confirming the full claim" : moment.currentTurn >= 4 ? "Checking direct observation" : moment.currentTurn >= 2 ? "Checking the call log" : "Interviewing Luis, Rosa’s husband";

  const moveTo = useCallback((position: number) => {
    requestRef.current += 1;
    positionRef.current = position;
    startingRef.current = false;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.currentTime = position; }
    setPlaying(false); setLoading(false); setSeconds(position); setStarted(position > 0); setAcceptedIds([]); setDrawerOpen(false); setTranscriptSource("spouse");
  }, []);
  const seek = useCallback((index: number) => moveTo(CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, index))].at), [moveTo]);
  const togglePlayback = useCallback(async () => {
    if (playing || loading) {
      requestRef.current += 1;
      startingRef.current = false;
      audioRef.current?.pause(); setPlaying(false); setLoading(false); return;
    }
    const position = complete ? 0 : positionRef.current;
    setStarted(true);
    if (complete) { positionRef.current = 0; setSeconds(0); setAcceptedIds([]); setDrawerOpen(false); setTranscriptSource("spouse"); }
    if (captionOnly) { setPlaying(true); return; }
    const audio = audioRef.current;
    if (!audio) return;
    startingRef.current = true;
    const request = ++requestRef.current;
    setLoading(true); audio.currentTime = position;
    try {
      await audio.play();
      if (request !== requestRef.current) return;
      setPlaying(true); setAudioError(false);
    } catch { if (request === requestRef.current) { setAudioError(true); setPlaying(false); } }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [playing, loading, complete, captionOnly]);

  useEffect(() => { setReady(true); }, []);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let previous = performance.now();
    let lastRender = previous;
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      positionRef.current = captionOnly ? Math.min(DEMO_DURATION, positionRef.current + delta)
        : Math.min(DEMO_DURATION, audioRef.current?.currentTime ?? positionRef.current);
      if (now - lastRender >= 80) { setSeconds(positionRef.current); lastRender = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, captionOnly]);
  useEffect(() => { if (complete) { setPlaying(false); audioRef.current?.pause(); } }, [complete]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea, summary, audio")) return;
      if (event.key === " ") { event.preventDefault(); void togglePlayback(); }
      if (event.key === "ArrowRight") { event.preventDefault(); seek(chapter + 1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); seek(chapter - 1); }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [chapter, seek, togglePlayback]);
  useEffect(() => {
    if (drawerOpen) document.querySelector<HTMLButtonElement>(".drawer-bar")?.focus();
    else if (inspectorTriggerRef.current?.isConnected) inspectorTriggerRef.current.focus();
  }, [drawerOpen]);
  useEffect(() => () => { startingRef.current = false; requestRef.current += 1; }, []);

  function pause() { requestRef.current += 1; startingRef.current = false; audioRef.current?.pause(); setPlaying(false); setLoading(false); }
  function inspect(id: string) { pause(); inspectorTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelectedId(id); setDrawerOpen(true); }
  function review(id: string) { pause(); setAcceptedIds((ids) => [...ids, id]); setNotice("Review recorded locally. Source evidence remains preliminary."); }
  async function share() {
    try { await navigator.clipboard.writeText(window.location.href); setNotice("Demo link copied"); }
    catch { setNotice("Copy the demo URL from your browser’s address bar."); }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setNotice("Use your browser’s full-screen command to present the demo."); }
  }
  function download() {
    const included = witnessesAt(seconds);
    const blob = new Blob([JSON.stringify({ mode: "synthetic-local-replay", chartWrites: false,
      timeline: data.timeline, transcripts: Object.fromEntries(included.map((witness) => [witness.key, demoSession(witness.key).transcript])),
      validation: included.map((witness) => ({ witness: witness.key, result: validateClaim(witness.claim, demoSession(witness.key)).result })) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "before-demo-evidence.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="demo-page">
    <header className="demo-topbar">
      <Link href="/" aria-label="Before home"><Wordmark /></Link>
      <span className="demo-mode">Guided demo</span>
      <div className="demo-tools"><button disabled={!ready} onClick={share} aria-label="Copy demo link" title="Copy demo link"><Icon name="link" /></button><button disabled={!ready} onClick={fullscreen} aria-label="Toggle full screen" title="Full screen"><Icon name="expand" /></button></div>
    </header>
    <div className="demo-case" aria-live="polite">
      {started ? <><h1>{seconds >= FULL_CHART_AT ? "Five accounts. One timeline." : moment.parallel ? "Luis wasn’t the only call." : "Rosa M."}</h1><span>{seconds >= FULL_CHART_AT ? "Ready for the doctor’s review." : moment.parallel ? "Four more agents were gathering Rosa’s story." : "Suspected stroke. Unable to speak."}</span></> : <span>Rosa M. is arriving at the hospital.</span>}
    </div>
    <div className="demo-experience">
      {!started ? <section className="story-opening" aria-labelledby="story-heading">
        <h1 id="story-heading">She can’t tell you what happened.</h1>
        <p>A stroke can take away someone’s speech. Fast treatment matters. But the people who know Rosa’s last normal moments aren’t in the room.</p>
        <p className="story-promise">Before calls them. Their answers build the doctor’s timeline.</p>
      </section> : <><CallScene seconds={seconds} parallel={moment.parallel} task={agentTask} speaker={!turn ? "EMS handoff" : turn.role === "assistant" ? "Before" : "Luis"} quote={turn ? <Quote text={turn.content} /> : "“She was last seen normal at six.”"} quoteText={turn?.content ?? "EMS handoff"} speaking={speaking} longQuote={!!turn && turn.content.length > 180} direct={moment.direct} anchored={moment.anchored} confirmed={moment.confirmed} onInspect={inspect} />
      <EvidenceTimeline data={data} anchored={moment.anchored} direct={moment.direct} parallel={moment.parallel} onInspect={inspect} /></>}
    </div>
    <div className="demo-player">
      <div className="mobile-window" aria-live="polite"><span>{data.timeline.interval ? parseExactTime(data.timeline.interval.startIso)!.spokenClock : "6:00"} <Icon name="arrow" size={12} /> {data.timeline.interval ? parseExactTime(data.timeline.interval.endIso)!.spokenClock : "9:10"}</span><b>{data.timeline.interval ? `${data.timeline.interval.minutes} min, preliminary` : "Unresolved"}</b></div>
      <div className="player-main"><button className="play-button" disabled={!ready} onClick={() => void togglePlayback()} aria-label={loading ? "Cancel audio loading" : undefined}><Icon name={playing || loading ? "pause" : complete ? "reset" : "play"} size={18} />{!ready || loading ? "Loading…" : playing ? "Pause" : complete ? "Replay" : !started ? "Meet Rosa’s witnesses" : seconds === 0 ? "Play with sound" : "Resume"}</button><button className="restart-button" disabled={!ready} aria-label="Restart demo" title="Restart demo" onClick={() => moveTo(0)}><Icon name="reset" size={18} /></button><button className="sound-button" aria-label={sound && !captionOnly ? "Mute sound" : "Enable sound"} aria-pressed={sound && !captionOnly} disabled={!ready || captionOnly} onClick={() => setSound((value) => !value)}><Icon name={sound ? "volume" : "muted"} size={18} /></button><span className="player-time">{formatTime(seconds)} <span>/ {formatTime(DEMO_DURATION)}</span></span><button className="chapters-toggle" disabled={!ready} aria-expanded={chaptersOpen} aria-controls="chapter-navigation" onClick={() => setChaptersOpen((value) => !value)}>Chapters <Icon name="chevron" size={14} /></button></div>
      {audioError && <div className="audio-error" role="alert">The bundled audio couldn’t play.<button onClick={() => { setCaptionOnly(true); setAudioError(false); setPlaying(true); }}>Continue with captions</button><button onClick={() => { audioRef.current?.load(); void togglePlayback(); }}>Retry audio</button></div>}
      <input className="playback-scrubber" disabled={!ready} type="range" min="0" max={DEMO_DURATION} step="0.1" value={seconds} aria-label="Demo playback position" aria-valuetext={`${formatTime(seconds)} of ${formatTime(DEMO_DURATION)}, ${CHAPTERS[chapter].short}`} onChange={(event) => moveTo(Number(event.target.value))} style={{ "--progress": `${seconds / DEMO_DURATION * 100}%` } as React.CSSProperties} />
      <nav id="chapter-navigation" className={`chapter-nav ${chaptersOpen ? "is-open" : ""}`} aria-label="Demo chapters">{CHAPTERS.map((item, index) => <button key={item.short} aria-label={`${index + 1}. ${item.short}`} aria-current={chapter === index ? "step" : undefined} className={chapter === index ? "current" : ""} onClick={() => { seek(index); setChaptersOpen(false); }}>{item.short}</button>)}</nav>
    </div>
    <div className="demo-extras">
      <details className="demo-explore" onToggle={(event) => { if (event.currentTarget.open) pause(); }}><summary>Explore evidence <Icon name="chevron" size={16} /></summary>
        <div className="explore-body">
          <div className="evidence-actions"><h2>Review sources</h2>{claims.length ? claims.map((claim) => <div key={claim.id}><button onClick={() => inspect(claim.id)}>{witnessForEvent(claim.id)!.name} <Icon name="arrow" size={16} /></button><button disabled={!!claim.acceptedBy} onClick={() => review(claim.id)}>{claim.acceptedBy ? "Reviewed locally" : "Mark reviewed"}</button></div>) : <p>Sources appear after witness confirmation.</p>}<button className="export-evidence" disabled={!moment.confirmed} onClick={download}><Icon name="download" size={16} /> Download evidence JSON</button></div>
          <details className="demo-transcript"><summary>Full transcript <Icon name="chevron" size={16} /></summary><label className="transcript-picker">Source <select value={transcriptSource} onChange={(event) => { pause(); setTranscriptSource(event.target.value as DemoWitnessKey); }}>{DEMO_WITNESSES.filter((witness) => witness.key === "spouse" || seconds >= witness.filedAt).map((witness) => <option key={witness.key} value={witness.key}>{witness.name}</option>)}</select></label><ol>{transcriptWitness.turns.map((line, index) => <li key={index}>{transcriptSource === "spouse" ? <button aria-label={`Jump to interview turn ${index + 1}`} onClick={() => moveTo(AUDIO_CUES[index].start)}>{formatTime(AUDIO_CUES[index].start)}</button> : <span className="transcript-index">{index + 1}</span>}<b>{line.role === "assistant" ? "Before" : transcriptWitness.name.split(" ")[0]}</b><p>{line.content}</p></li>)}</ol></details>
          <details className="retained-history"><summary>Original handoff <Icon name="chevron" size={16} /></summary><p><b>6:00</b> Relayed baseline from the daughter via EMS.</p><p><b>9:10</b> Found with symptoms, reported in the EMS handoff.</p></details>
          <EvidenceLab />
        </div>
      </details>
      <details className="demo-about"><summary>About this demo <Icon name="chevron" size={16} /></summary><div className="about-body">
        <p>Stroke can cause sudden difficulty speaking. Fast treatment can reduce brain damage. This is why the missing history matters: the doctor needs to know when Rosa was last observed at her usual baseline. <a href="https://www.cdc.gov/stroke/signs-symptoms/index.html">CDC: stroke signs and symptoms</a>.</p>
        <p>Before’s voice agent interviews witnesses. The doctor’s view receives source-linked evidence for clinical review.</p>
        <p>This synthetic case uses prerecorded Deepgram TTS voices and the live workflow’s validator. The parallel-call ending is a scripted concept with five synthetic accounts. Every account passes the same validator and keeps its own transcript; no additional live calls are placed. Discovery is separate from witnessed onset.</p>
        <p>Reviews are simulated locally. Evidence remains preliminary. The demo makes no chart writes; FHIR references are illustrative.</p>
        <p>Space plays or pauses. Arrow keys select chapters when focus is outside a control.</p>
        <div><a href="https://github.com/DigitalVeer/before/blob/main/LIVE-INTEGRATION.md">Run the live workflow locally <Icon name="arrow" size={16} /></a><Link href="/">Product overview <Icon name="arrow" size={16} /></Link></div>
      </div></details>
    </div>
    {drawerOpen && <EvidenceDrawer claims={claims} claim={claims.find((claim) => claim.id === selectedId) ?? claims[0] ?? null} onSelect={setSelectedId} open={drawerOpen} setOpen={(open) => { pause(); setDrawerOpen(open); }} mode="replay" />}
    <audio ref={audioRef} src="/demo-interview.mp3" preload="auto" muted={!sound} onEnded={() => { setSeconds(DEMO_DURATION); setPlaying(false); }} onWaiting={() => { if (startingRef.current) setLoading(true); }} onPlaying={() => setLoading(false)} onPause={() => setPlaying(false)} onError={() => { setAudioError(true); setPlaying(false); setLoading(false); }} />
    {notice && <div className="demo-notice" role="status">{notice}</div>}
  </main>;
}
