# Run the live workflow locally

The public presentation at [before.veersingh.com/demo](https://before.veersingh.com/demo) uses bundled audio and synthetic evidence. The live operator workflow is intended for a controlled local environment.

## Setup

You need Docker Desktop, Node 24+, pnpm, and a Deepgram key with permission to create short-lived grants through `/v1/auth/grant`.

```sh
corepack enable
pnpm install --frozen-lockfile
cd selfhost
docker compose up -d
cd ..
pnpm tsx scripts/bootstrap-medplum.ts
```

The bootstrap creates a Medplum project, separate agent and clinician credentials, and the agent's access policy. It runs the forbidden-write probes and writes the resulting configuration into the ignored `.env.local`. Add `DEEPGRAM_API_KEY` there, then run:

```sh
pnpm demo:live --no-phone
```

1. Open `/clinician` and prepare the interview.
2. Record the outreach basis, recipient verification, and agreement to AI participation.
3. Begin the interview, then open `/witness` with a headset.
4. Answer as Luis. Give an approximate time first, check a call log when asked, describe the direct observation, and confirm the complete read-back.
5. Inspect the preliminary evidence and its provenance in the clinician workspace.

`/test` checks provider configuration. The guided presentation remains available at `/demo`. Stop the development server before building because both use `.next`.

The browser receives only a short-lived Deepgram grant. A rejected grant request fails closed; it never returns the server's API key. A key without grant permissions must be replaced with one that supports that endpoint.

## Optional phone interview

The optional Vapi leg uses the same source roles and transcript validator. Configure the `VAPI_*` variables in `.env.example`, plus `PUBLIC_BASE_URL` and a webhook secret, then run `pnpm demo:live`. The preflight prints the configured inbound number. Outbound calls additionally require a supported Twilio number and the corresponding `TWILIO_*` variables.

## Hosting boundary

The public guided deployment has no Medplum, Deepgram, Vapi, or Twilio credentials. Keep these integrations in a controlled environment. The existing operator routes do not authenticate callers; public live use requires authorization before session creation, review, reset, chart access, or provider token requests.

The agent creates preliminary evidence. The clinician identity adjudicates it. The deterministic validator checks the witness's own time anchor and confirmed read-back before the live workflow can write the claim.
