# Before

## Platform

web

## Users

The clinical workflow serves a stroke coordinator and clinician gathering collateral history from family witnesses. The showcase serves a presenter and voice technology teams, including ElevenLabs and Deepgram, evaluating the mechanism.

## Product Purpose

Reconstruct the last-known-baseline and symptom-discovery timeline from source-linked witness accounts. Preserve uncertainty, verify spoken claims, and leave clinical adjudication to a human.

## Operating Context

The guided presentation runs from synthetic local fixtures. The local live workflow connects Deepgram Voice Agent to Medplum FHIR, with optional Vapi telephony. Live interviews require three coordinator gates before transfer.

## Capabilities and Constraints

Exact claims require a witness-origin time, a checkable anchor, and an affirmative spoken read-back. Claims remain preliminary. The showcase runs the production validator but makes no chart writes. Simulated reviews and illustrative FHIR IDs are labeled. A bundled synthetic Deepgram TTS interview drives captions, gates, and timeline changes from its exact audio clock. The final concept reveal shows four more agents gathering independent synthetic accounts in parallel; each passes the same validator. Text contact adds context without establishing a normal baseline. Other voice providers are not integrated.

## Brand Commitments

Keep the Before name, existing timeline mark, and restrained green clinical identity. All cases in this demo are synthetic.

## Evidence on Hand

Deterministic validator tests, timeline-layout tests, token-grant tests, and the synthetic recorded conversation in `public/demo-interview.mp3`. The current guided presentation has been verified locally; a new live provider run is not implied.

## Product Principles

- Direct observation and hearsay remain distinct.
- Precision requires spoken evidence.
- The source travels with the claim.
- The clinician decides what the evidence means.
- A demo should be easy to start, replay, and inspect.
