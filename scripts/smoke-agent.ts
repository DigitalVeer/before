/** Agent-credential authority smoke test: create-preliminary succeeds; update and delete are forbidden. */
import { config } from "dotenv";
config({ path: [".env.local"] });
import { getAgentClient, getClinicianClient } from "../lib/medplum/client";
import { TIMELINE_EVENT_SYSTEM, FIELD_EVIDENCE_URL } from "../lib/medplum/codes";

async function main() {
  const agent = await getAgentClient();
  const patient = await agent.searchOne("Patient", "identifier=urn:before:demo-id|patient-rosa");
  const encounter = await agent.searchOne("Encounter", "identifier=urn:before:demo-id|encounter-stroke-code-001");
  const spouse = await agent.searchOne("RelatedPerson", "identifier=urn:before:demo-id|relatedperson-luis");
  const obs = await agent.createResource({
    resourceType: "Observation",
    status: "preliminary",
    code: { coding: [{ system: TIMELINE_EVENT_SYSTEM, code: "last-known-baseline" }] },
    subject: { reference: `Patient/${patient!.id}` },
    encounter: { reference: `Encounter/${encounter!.id}` },
    effectiveDateTime: "2026-08-01T08:32:00-07:00",
    performer: [{ reference: `RelatedPerson/${spouse!.id}` }],
    derivedFrom: [{ display: "smoke-test placeholder" }],
    extension: [{ url: FIELD_EVIDENCE_URL, extension: [{ url: "field", valueCode: "time" }] }],
  } as never);
  const obsId = (obs as { id: string }).id;
  console.log("agent CREATE preliminary: OK", `Observation/${obsId}`);

  try {
    await agent.updateResource({ ...(obs as object), status: "final" } as never);
    console.log("!! agent UPDATE accepted (should be forbidden)");
  } catch {
    console.log("agent UPDATE: forbidden (append-only holds)");
  }
  try {
    await agent.deleteResource("Observation", obsId);
    console.log("!! agent DELETE accepted (should be forbidden)");
  } catch {
    console.log("agent DELETE: forbidden");
  }
  const clinician = await getClinicianClient();
  await clinician.deleteResource("Observation", obsId);
  console.log("clinician cleanup: OK");
}
main().catch((e) => { console.error("SMOKE FAILED:", (e as {outcome?: unknown}).outcome ?? e); process.exit(1); });
