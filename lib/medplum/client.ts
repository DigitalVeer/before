/**
 * Two Medplum identities (§13.11): the agent writes preliminary evidence; the
 * clinician adjudicates. They are never the same credential.
 */
import { MedplumClient } from "@medplum/core";

export interface MedplumEnv {
  baseUrl: string;
  projectId: string;
  agentClientId: string;
  agentClientSecret: string;
  clinicianClientId: string;
  clinicianClientSecret: string;
}

export function readMedplumEnv(): MedplumEnv {
  const env = {
    baseUrl: process.env.MEDPLUM_BASE_URL ?? "",
    projectId: process.env.MEDPLUM_PROJECT_ID ?? "",
    agentClientId: process.env.MEDPLUM_AGENT_CLIENT_ID ?? "",
    agentClientSecret: process.env.MEDPLUM_AGENT_CLIENT_SECRET ?? "",
    clinicianClientId: process.env.MEDPLUM_CLINICIAN_CLIENT_ID ?? "",
    clinicianClientSecret: process.env.MEDPLUM_CLINICIAN_CLIENT_SECRET ?? "",
  };
  const missing = Object.entries(env)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Medplum environment incomplete: missing ${missing.join(", ")} (see .env.example)`);
  }
  return env;
}

interface ClientCache {
  agent?: MedplumClient;
  clinician?: MedplumClient;
}

const g = globalThis as unknown as { __beforeMedplum?: ClientCache };
const cache: ClientCache = (g.__beforeMedplum ??= {});

async function makeClient(baseUrl: string, clientId: string, clientSecret: string): Promise<MedplumClient> {
  const client = new MedplumClient({ baseUrl, clientId, cacheTime: 0 });
  await client.startClientLogin(clientId, clientSecret);
  return client;
}

/** Agent-scoped identity — preliminary evidence only. */
export async function getAgentClient(): Promise<MedplumClient> {
  if (!cache.agent) {
    const env = readMedplumEnv();
    cache.agent = await makeClient(env.baseUrl, env.agentClientId, env.agentClientSecret);
  }
  return cache.agent;
}

/** Clinician identity — reads for the UI, adjudication writes. */
export async function getClinicianClient(): Promise<MedplumClient> {
  if (!cache.clinician) {
    const env = readMedplumEnv();
    cache.clinician = await makeClient(env.baseUrl, env.clinicianClientId, env.clinicianClientSecret);
  }
  return cache.clinician;
}
