/**
 * One-time bootstrap against the self-hosted Medplum stack (selfhost/):
 *   1. login as the stack's default super admin (docker-compose default)
 *   2. find-or-create the "Before Demo" Project
 *   3. create agent + clinician ClientApplications via the admin API
 *   4. create the §32.6 AccessPolicy and bind it to the AGENT membership only
 *   5. run the real negative test with the agent credential and RETAIN the
 *      raw server rejections (run-evidence/) — the policy-proof flag is set
 *      true only if the rejection was actually observed (§13.12/§13.13)
 *   6. write .env.local
 *
 * Idempotent: safe to re-run. Swap MEDPLUM_BASE_URL + credentials in
 * .env.local to point the same app at a hosted Medplum project instead.
 */
import { MedplumClient } from "@medplum/core";
import type { AccessPolicy, ClientApplication, Project, ProjectMembership } from "@medplum/fhirtypes";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TIMELINE_EVENT_SYSTEM, FIELD_EVIDENCE_URL } from "../lib/medplum/codes";

const BASE_URL = process.env.SELFHOST_MEDPLUM_URL ?? "http://localhost:8103/";
const ADMIN_EMAIL = process.env.SELFHOST_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.SELFHOST_ADMIN_PASSWORD ?? "medplum_admin";
const PROJECT_NAME = "Before Demo";

async function loginSuperAdmin(): Promise<MedplumClient> {
  const medplum = new MedplumClient({ baseUrl: BASE_URL, cacheTime: 0 });
  const login = await medplum.startLogin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.code) {
    await medplum.processCode(login.code);
    return medplum;
  }
  if (login.memberships && login.login) {
    const membership =
      login.memberships.find((m) => m.project?.display === "Super Admin") ?? login.memberships[0];
    const res = (await medplum.post("auth/profile", {
      login: login.login,
      profile: membership.id,
    })) as { code?: string };
    if (!res.code) throw new Error("No auth code after profile selection");
    await medplum.processCode(res.code);
    return medplum;
  }
  throw new Error(`Unexpected login response: ${JSON.stringify(login)}`);
}

async function findOrCreateProject(medplum: MedplumClient): Promise<Project> {
  const existing = await medplum.searchOne("Project", `name=${encodeURIComponent(PROJECT_NAME)}`);
  if (existing) return existing;
  return medplum.createResource<Project>({
    resourceType: "Project",
    name: PROJECT_NAME,
    description: "Before — collateral stroke-timeline evidence (YC x Medplum hackathon demo)",
    features: ["bots", "websocket-subscriptions", "transaction-bundles"],
    strictMode: true,
  });
}

async function createClientApp(
  medplum: MedplumClient,
  projectId: string,
  name: string,
  description: string
): Promise<ClientApplication> {
  const existing = await medplum.searchOne("ClientApplication", {
    name,
    _project: projectId,
  } as never);
  if (existing?.secret) return existing;
  return (await medplum.post(`admin/projects/${projectId}/client`, {
    name,
    description,
  })) as ClientApplication;
}

function agentAccessPolicy(projectId: string): AccessPolicy {
  return {
    resourceType: "AccessPolicy",
    name: "Before voice evidence writer",
    meta: { project: projectId },
    resource: [
      {
        resourceType: "Observation",
        interaction: ["create", "read", "search"],
        writeConstraint: [
          { language: "text/fhirpath", expression: "%after.status = 'preliminary'" },
          {
            language: "text/fhirpath",
            expression: "%after.subject.exists() and %after.encounter.exists() and %after.performer.exists()",
          },
          {
            language: "text/fhirpath",
            expression: `%after.code.coding.where(system = '${TIMELINE_EVENT_SYSTEM}').exists()`,
          },
          {
            language: "text/fhirpath",
            expression: `%after.derivedFrom.exists() and %after.extension.where(url = '${FIELD_EVIDENCE_URL}').exists()`,
          },
        ],
      },
      { resourceType: "QuestionnaireResponse", interaction: ["create", "read", "search"] },
      { resourceType: "DocumentReference", interaction: ["create", "read", "search"] },
      { resourceType: "Provenance", interaction: ["create", "read", "search"] },
      { resourceType: "Task", interaction: ["create", "read", "search"] },
      { resourceType: "Patient", interaction: ["read", "search"] },
      { resourceType: "Encounter", interaction: ["read", "search"] },
      { resourceType: "RelatedPerson", interaction: ["read", "search"] },
      { resourceType: "Practitioner", interaction: ["read", "search"] },
      { resourceType: "Communication", interaction: ["read", "search"] },
    ],
  };
}

async function findOrCreatePolicy(medplum: MedplumClient, projectId: string): Promise<AccessPolicy> {
  const existing = await medplum.searchOne("AccessPolicy", {
    name: "Before voice evidence writer",
    _project: projectId,
  } as never);
  const desired = agentAccessPolicy(projectId);
  if (existing) {
    return medplum.updateResource<AccessPolicy>({ ...desired, id: existing.id, meta: existing.meta });
  }
  return medplum.createResource<AccessPolicy>(desired);
}

async function bindPolicy(
  medplum: MedplumClient,
  projectId: string,
  clientAppId: string,
  policyId: string
): Promise<void> {
  const membership = await medplum.searchOne("ProjectMembership", {
    profile: `ClientApplication/${clientAppId}`,
    _project: projectId,
  } as never);
  if (!membership) throw new Error(`No ProjectMembership for ClientApplication/${clientAppId}`);
  if (membership.accessPolicy?.reference === `AccessPolicy/${policyId}`) return;
  await medplum.updateResource<ProjectMembership>({
    ...membership,
    accessPolicy: { reference: `AccessPolicy/${policyId}` },
  });
}

interface NegativeTestRecord {
  name: string;
  request: unknown;
  outcome: unknown;
  rejected: boolean;
  at: string;
}

/** Real forbidden attempts with the real agent credential (§13.12). */
async function runNegativeTests(
  agentClientId: string,
  agentClientSecret: string
): Promise<{ allRejected: boolean; records: NegativeTestRecord[] }> {
  const agent = new MedplumClient({ baseUrl: BASE_URL, cacheTime: 0 });
  await agent.startClientLogin(agentClientId, agentClientSecret);
  const records: NegativeTestRecord[] = [];

  async function attempt(name: string, fn: () => Promise<unknown>, request: unknown): Promise<void> {
    try {
      const result = await fn();
      records.push({ name, request, outcome: result, rejected: false, at: new Date().toISOString() });
    } catch (err) {
      records.push({
        name,
        request,
        outcome: (err as { outcome?: unknown }).outcome ?? String(err),
        rejected: true,
        at: new Date().toISOString(),
      });
    }
  }

  const finalObservation = {
    resourceType: "Observation",
    status: "final",
    code: {
      coding: [
        { system: TIMELINE_EVENT_SYSTEM, code: "accepted-baseline", display: "Clinician-accepted last known baseline" },
      ],
    },
    subject: { display: "Rosa M." },
    effectiveDateTime: "2026-08-01T08:32:00-07:00",
  };
  await attempt(
    "agent-creates-final-accepted-observation",
    () => agent.createResource(finalObservation as never),
    finalObservation
  );

  const medicationRequest = {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    subject: { display: "Rosa M." },
    medicationCodeableConcept: { text: "alteplase" },
  };
  await attempt(
    "agent-creates-treatment-order",
    () => agent.createResource(medicationRequest as never),
    medicationRequest
  );

  const allRejected = records.every((r) => r.rejected);
  mkdirSync("run-evidence", { recursive: true });
  writeFileSync(
    "run-evidence/policy-rejections.json",
    JSON.stringify({ baseUrl: BASE_URL, agentClientId, records }, null, 2)
  );
  return { allRejected, records };
}

function updateEnvLocal(values: Record<string, string>): void {
  let content = "";
  try {
    content = readFileSync(".env.local", "utf8");
  } catch {
    content = readFileSync(".env.example", "utf8");
  }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    content = content.match(new RegExp(`^${key}=`, "m"))
      ? content.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : content + `\n${line}`;
  }
  writeFileSync(".env.local", content.trimEnd() + "\n");
}

async function main(): Promise<void> {
  console.log(`Bootstrapping Medplum at ${BASE_URL} ...`);
  const medplum = await loginSuperAdmin();
  console.log("✓ super admin login");

  const project = await findOrCreateProject(medplum);
  console.log(`✓ project: ${project.name} (${project.id})`);

  const agentApp = await createClientApp(
    medplum,
    project.id as string,
    "before-agent",
    "Before voice agent — preliminary evidence writer (policy-restricted)"
  );
  const clinicianApp = await createClientApp(
    medplum,
    project.id as string,
    "before-clinician",
    "Before clinician UI + adjudication credential"
  );
  console.log(`✓ client apps: agent=${agentApp.id} clinician=${clinicianApp.id}`);

  const policy = await findOrCreatePolicy(medplum, project.id as string);
  await bindPolicy(medplum, project.id as string, agentApp.id as string, policy.id as string);
  console.log(`✓ access policy bound to agent membership (${policy.id})`);

  const { allRejected, records } = await runNegativeTests(
    agentApp.id as string,
    agentApp.secret as string
  );
  for (const r of records) {
    console.log(`  negative test ${r.name}: ${r.rejected ? "REJECTED (good)" : "!! ACCEPTED (policy not enforcing)"}`);
  }

  updateEnvLocal({
    MEDPLUM_BASE_URL: BASE_URL,
    MEDPLUM_PROJECT_ID: project.id as string,
    MEDPLUM_AGENT_CLIENT_ID: agentApp.id as string,
    MEDPLUM_AGENT_CLIENT_SECRET: agentApp.secret as string,
    MEDPLUM_CLINICIAN_CLIENT_ID: clinicianApp.id as string,
    MEDPLUM_CLINICIAN_CLIENT_SECRET: clinicianApp.secret as string,
    ENABLE_MEDPLUM_POLICY_PROOF: String(allRejected),
  });
  console.log(`✓ .env.local updated (ENABLE_MEDPLUM_POLICY_PROOF=${allRejected})`);
  console.log("Done. Medplum admin app: http://localhost:3000 (project: Before Demo)");
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
