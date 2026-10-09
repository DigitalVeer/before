# Before interface

The existing clinical implementation is the visual authority. This pass extends its forest green, neutral surfaces, amber uncertainty, system sans typography, and timeline mark to the showcase. The demo is an exploration of the clinical workflow; the live workspace supports operation.

## Tokens

The shared tokens live in `app/globals.css`: white surface `#ffffff`, neutral surface `#eef1ef`, ink `#17231f`, secondary ink `#5b6862`, action `#1e6a52`, action surface `#e8f2ed`, uncertainty `#8a5a17`, and uncertainty surface `#fbf1df`. Shared panel radii are 12px and 8px for controls. Typeface follows the incumbent platform sans stack. All timeline numbers use tabular figures.

## Structure

The overview pairs a short narrative with an interactive remember/check/confirm preview. The guided experience has two primary focuses: a dark green **Voice agent** panel with the spoken line, and **Doctor’s view** with the resulting interval. Large spoken captions lead; direct observation, anchor, and confirmation gates fill from exact turn timings. The timeline holds a candidate until the recorded yes finishes, then narrows in one authored motion. Phone layouts stack the conversation and evidence, with fixed playback controls and a compact current-interval display. All five sources use the shared evidence inspector, opened only when a source is selected. Chapters collapse beneath playback controls. Explore evidence contains transcripts, review actions, original handoff, and validator experiments; About this demo contains secondary context and live access. The live workspace retains its clinical time axis and chronological phone layout.

## Interaction

Green means source-linked evidence or an available action; amber means uncertainty. Preliminary status persists after simulated review. New evidence has one restrained entrance; reduced-motion users receive the full state without that entrance. Focus, selection, native audio controls, loading, and connection errors are part of the interface.

## Presentation truth

The guided demo is labeled prerecorded, synthetic, and local. It never points illustrative FHIR references at the live store. Bundled audio and visual state share one clock; a script hash guards caption drift. The four additional scripted accounts each have their own source, anchor, confirmation, and transcript. The live workspace never falls back to synthetic chart state after a connection failure.

## Call-to-chart sequence

Luis’s “normal” and “about lunch” phrases share emphasis with the doctor’s draft evidence. Draft observations appear only after the recorded witness turn completes; confirmation still gates the structured timeline. The final authored moment pulls the original call back into a compact lane and reveals four other callers. Each result lands in the same source list and carries its own inspectable transcript.

The pullback uses a bounded shared-element transform on the original quote, with a short clipped entrance for the additional call lanes. Evidence arrivals follow the audio clock and remain seekable. Routine controls stay immediate. No animation dependency or background polling is needed; reduced motion keeps the full narrative state without the spatial move.

## Guided story

The opening gives Rosa’s missing history one central focus before playback. Starting the audio replaces it with the agent and doctor views. The reveal names the four other callers, then ends with five source-linked accounts ready for the doctor’s review. This is a concept demonstration, not a claim of improved clinical outcomes. The medical premise is sourced in About this demo and SHOWCASE.md.

Both panels keep a viewport-aware fixed height during playback. The chart reserves five chronological source slots when the parallel reveal begins; each account fills its own position without moving the player or stretching either panel. Compact layouts keep the source region scrollable when required.
