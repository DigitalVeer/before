/** Rebuild the bundled synthetic interview. This is an authoring step, not a runtime dependency. */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { SPOUSE_TURNS } from "../lib/demo/scenario";

config({ path: ".env.local", quiet: true });
const key = process.env.DEEPGRAM_API_KEY;
if (!key) throw new Error("Set DEEPGRAM_API_KEY in .env.local to rebuild the synthetic interview.");
const rate = 24000;
const blocks: Buffer[] = [];
const cues: { turn: number; start: number; end: number }[] = [];
let samples = 0;
function silence(seconds: number) {
  const block = Buffer.alloc(Math.round(seconds * rate) * 2);
  blocks.push(block);
  samples += block.length / 2;
}
async function main() {
  silence(3);
  for (const [turn, line] of SPOUSE_TURNS.entries()) {
    const voice = line.role === "assistant" ? "aura-2-vesta-en" : "aura-2-apollo-en";
    const response = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&sample_rate=${rate}&container=none`, {
      method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: line.content }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Deepgram synthesis failed (${response.status}).`);
    const block = Buffer.from(await response.arrayBuffer());
    cues.push({ turn, start: samples / rate, end: (samples + block.length / 2) / rate });
    blocks.push(block);
    samples += block.length / 2;
    silence(turn === 7 ? 10 : 0.65);
    console.log(`Rendered turn ${turn + 1}/${SPOUSE_TURNS.length}`);
  }
  mkdirSync("public", { recursive: true });
  const pcm = Buffer.concat(blocks);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  const wav = "/tmp/before-guided-interview.wav";
  writeFileSync(wav, Buffer.concat([header, pcm]));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "96k", "public/demo-interview.mp3"]);
  writeFileSync("lib/demo/audio-cues.json", JSON.stringify({
    source: "Synthetic Deepgram TTS · vesta / apollo", duration: samples / rate,
    scriptSha256: createHash("sha256").update(JSON.stringify(SPOUSE_TURNS)).digest("hex"), cues,
  }, null, 2) + "\n");
  console.log(`Bundled ${Math.round(samples / rate)} seconds with exact turn timings.`);
}
main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
