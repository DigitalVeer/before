import Link from "next/link";
import { Icon, Wordmark } from "./components/icons";
import { LandingPreview } from "./components/landing-preview";
import "./showcase.css";

export default function IndexPage() {
  return <main className="showcase">
    <header className="site-header"><Link href="/" aria-label="Before home"><Wordmark /></Link><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="https://github.com/DigitalVeer/before">View source</a><Link className="nav-demo" href="/demo">Open demo <Icon name="arrow" size={16} /></Link></nav></header>
    <section className="showcase-hero">
      <div className="hero-copy">
        <h1>The story before<br />the hospital.</h1>
        <p>Rosa arrives unable to speak. A voice agent asks the people who were there and turns their words into evidence the care team can trace.</p>
        <div className="hero-actions"><Link className="showcase-primary" href="/demo"><Icon name="play" size={18} /> Open the voice demo</Link><span>One minute. Sound and captions included.</span></div>
      </div>
      <LandingPreview />
    </section>
    <div className="built-with"><span>Voice → evidence → clinical review</span><div><b>Deepgram</b><span>Voice Agent + TTS</span></div><div><b>Medplum</b><span>FHIR + provenance</span></div><span className="demo-disclosure">Synthetic demonstration</span></div>
    <section className="mechanism" id="how-it-works">
      <div className="mechanism-intro"><h2>A useful conversation<br />has a paper trail.</h2><p>The interesting part happens between “around eight-thirty” and a claim that can enter the record.</p><Link href="/demo">See the evidence gate in action <Icon name="arrow" size={17} /></Link></div>
      <ol className="mechanism-steps">
        <li><span>Ask</span><div><h3>Find the direct witness.</h3><p>Separate what someone personally observed from what they heard afterward.</p></div></li>
        <li><span>Anchor</span><div><h3>Check a record.</h3><p>A call log or text timestamp grounds a vague memory in something the witness can verify.</p></div></li>
        <li><span>Confirm</span><div><h3>Read the whole claim back.</h3><p>The witness’s explicit yes is required. The server validates the transcript before any live chart write.</p></div></li>
        <li><span>Review</span><div><h3>Keep the clinician in control.</h3><p>Evidence stays preliminary. Source quotes, transcript turns, and FHIR references travel with the claim.</p></div></li>
      </ol>
    </section>
    <section className="showcase-close"><div><h2>Hear the conversation.<br />Watch the evidence land.</h2><p>Play, pause, inspect each source, and try a claim the validator will reject.</p></div><Link className="showcase-primary" href="/demo">Explore Before <Icon name="arrow" size={18} /></Link></section>
    <footer className="site-footer"><Wordmark /><span>A voice workflow for collateral history. The clinician decides.</span><a href="https://github.com/DigitalVeer/before">View source <Icon name="arrow" size={14} /></a></footer>
  </main>;
}
