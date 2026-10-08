"use client";

/**
 * The witness voice endpoint (offscreen during the demo). Connects the mic to
 * the Deepgram Voice Agent once the coordinator has recorded all three gates
 * and started the interview. Client-side function calls relay to the Before
 * server; ConversationText turns relay to the session transcript so the
 * read-back gate is server-observable.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Phase =
  | "waiting"
  | "connecting"
  | "live"
  | "agent-speaking"
  | "handed-to-human"
  | "complete"
  | "error";

interface Caption {
  role: string;
  content: string;
}

const DG_URL = "wss://agent.deepgram.com/v1/agent/converse";

function callIdFromUrl(): string {
  if (typeof window === "undefined") return "call-spouse-01";
  return new URLSearchParams(window.location.search).get("call") ?? "call-spouse-01";
}

export default function WitnessPage() {
  const [callId] = useState<string>(callIdFromUrl);
  const [witnessName, setWitnessName] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("waiting");
  const [detail, setDetail] = useState("Waiting for the coordinator to begin the interview…");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [readback, setReadback] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);
  const stopRef = useRef<() => void>(() => {});
  const startedRef = useRef(false);

  const relayTurn = useCallback(
    (role: string, content: string) => {
      void fetch("/api/session/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content, callId }),
      });
    },
    [callId]
  );

  const handleFunctionCall = useCallback(
    async (fn: { id: string; name: string; arguments: string }): Promise<string> => {
      const args = JSON.parse(fn.arguments || "{}") as Record<string, unknown>;
      if (fn.name === "recordWitnessConfirmedClaim") {
        const res = await fetch("/api/claims/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        return JSON.stringify(await res.json());
      }
      if (fn.name === "recordUnresolvedClaim") {
        const res = await fetch("/api/claims/unresolved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        return JSON.stringify(await res.json());
      }
      if (fn.name === "requestHuman") {
        await fetch("/api/session/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "handed-to-human", reason: (args.reason as string) ?? "witness asked for the coordinator", callId }),
        });
        setPhase("handed-to-human");
        setDetail("The coordinator has rejoined the call.");
        setTimeout(() => stopRef.current(), 2500);
        return JSON.stringify({ ok: true, message: "The human coordinator is rejoining the call now. Say a brief goodbye." });
      }
      if (fn.name === "completeInterview") {
        await fetch("/api/session/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "complete", reason: (args.summary as string) ?? "interview complete", callId }),
        });
        setPhase("complete");
        setDetail("Interview complete — evidence is with the care team.");
        setTimeout(() => stopRef.current(), 6000);
        return JSON.stringify({ ok: true });
      }
      return JSON.stringify({ ok: false, error: `Unknown function ${fn.name}` });
    },
    []
  );

  const connect = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("connecting");
    setDetail("Connecting to the voice assistant…");
    try {
      const tokenRes = await fetch("/api/deepgram-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId }),
      });
      if (!tokenRes.ok) {
        const err = (await tokenRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `token refused (${tokenRes.status})`);
      }
      const { token, scheme, settings } = (await tokenRes.json()) as {
        token: string;
        scheme: string;
        settings: Record<string, unknown>;
      };

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });

      const inCtx = new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = inCtx;
      const playCtx = new AudioContext({ sampleRate: 24000 });
      playCtxRef.current = playCtx;
      nextStartRef.current = 0;

      const ws = new WebSocket(DG_URL, [scheme, token]);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      const flushPlayback = () => {
        for (const src of scheduledRef.current) {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
        }
        scheduledRef.current = [];
        nextStartRef.current = playCtx.currentTime;
      };

      ws.onopen = async () => {
        ws.send(JSON.stringify(settings));

        const source = inCtx.createMediaStreamSource(mic);
        const workletUrl = URL.createObjectURL(
          new Blob(
            [
              `class PcmTap extends AudioWorkletProcessor {
                 process(inputs) {
                   const ch = inputs[0]?.[0];
                   if (ch) this.port.postMessage(ch.slice(0));
                   return true;
                 }
               }
               registerProcessor("pcm-tap", PcmTap);`,
            ],
            { type: "application/javascript" }
          )
        );
        await inCtx.audioWorklet.addModule(workletUrl);
        const tap = new AudioWorkletNode(inCtx, "pcm-tap");
        source.connect(tap);

        let pending: number[] = [];
        tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
          const f32 = e.data;
          let peak = 0;
          for (let i = 0; i < f32.length; i++) peak = Math.max(peak, Math.abs(f32[i]));
          setMicLevel((p) => p * 0.8 + peak * 0.2);
          for (let i = 0; i < f32.length; i++) {
            pending.push(Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767))));
          }
          if (pending.length >= 960 && ws.readyState === WebSocket.OPEN) {
            ws.send(new Int16Array(pending).buffer);
            pending = [];
          }
        };
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const i16 = new Int16Array(event.data);
          const f32 = new Float32Array(i16.length);
          for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
          const buf = playCtx.createBuffer(1, f32.length, 24000);
          buf.copyToChannel(f32, 0);
          const src = playCtx.createBufferSource();
          src.buffer = buf;
          src.connect(playCtx.destination);
          const startAt = Math.max(playCtx.currentTime + 0.02, nextStartRef.current);
          src.start(startAt);
          nextStartRef.current = startAt + buf.duration;
          scheduledRef.current.push(src);
          if (scheduledRef.current.length > 60) scheduledRef.current.splice(0, 20);
          return;
        }
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        switch (msg.type) {
          case "Welcome":
            setPhase("live");
            setDetail("Connected — Before is on the line.");
            break;
          case "ConversationText": {
            const role = String(msg.role);
            const content = String(msg.content ?? "");
            setCaptions((c) => [...c.slice(-5), { role, content }]);
            if (role === "assistant" && /to confirm/i.test(content)) setReadback(content);
            relayTurn(role, content);
            break;
          }
          case "UserStartedSpeaking":
            flushPlayback();
            setPhase("live");
            break;
          case "AgentStartedSpeaking":
            setPhase("agent-speaking");
            break;
          case "AgentAudioDone":
            setPhase((p) => (p === "agent-speaking" ? "live" : p));
            break;
          case "FunctionCallRequest": {
            const fns = (msg.functions ?? []) as { id: string; name: string; arguments: string; client_side?: boolean }[];
            for (const fn of fns) {
              if (fn.client_side === false) continue;
              const content = await handleFunctionCall(fn);
              ws.send(JSON.stringify({ type: "FunctionCallResponse", id: fn.id, name: fn.name, content }));
            }
            break;
          }
          case "Error":
          case "Warning":
            console.warn("[deepgram]", msg);
            if (msg.type === "Error") {
              setPhase("error");
              setDetail(`Voice error: ${String(msg.description ?? "unknown")}`);
            }
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        setPhase((p) => (p === "complete" || p === "handed-to-human" ? p : "error"));
        setDetail((d) => (d.startsWith("Voice error") ? d : "Connection error — the coordinator continues the call."));
      };
      ws.onclose = () => {
        setPhase((p) => (p === "complete" || p === "handed-to-human" || p === "error" ? p : "waiting"));
      };

      const keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
      }, 8000);

      stopRef.current = () => {
        clearInterval(keepAlive);
        try {
          ws.close();
        } catch {
          /* closed */
        }
        mic.getTracks().forEach((t) => t.stop());
        void inCtx.close();
        void playCtx.close();
        startedRef.current = false;
      };
    } catch (err) {
      startedRef.current = false;
      setPhase("error");
      setDetail(String((err as Error).message ?? err));
    }
  }, [handleFunctionCall, relayTurn]);

  // Poll the session: auto-connect when the coordinator starts the interview,
  // and end the agent leg when the coordinator takes the call back (the
  // witness is on a phone — all controls live on the hospital side or in
  // their voice: "can I talk to Maya?").
  useEffect(() => {
    const t = setInterval(async () => {
      if (phase === "complete" || phase === "handed-to-human" || phase === "error") return;
      try {
        const res = await fetch(`/api/session?call=${callId}`, { cache: "no-store" });
        const { session } = (await res.json()) as { session: { status: string; witnessName?: string } | null };
        if (session?.witnessName) setWitnessName(session.witnessName);
        if (!startedRef.current && session?.status === "interviewing") void connect();
        if (startedRef.current && session && session.status !== "interviewing") {
          setPhase(session.status === "complete" ? "complete" : "handed-to-human");
          setDetail(
            session.status === "complete"
              ? "Interview complete — evidence is with the care team."
              : "The coordinator has taken the call."
          );
          stopRef.current();
        }
      } catch {
        /* retry next tick */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [connect, phase, callId]);

  useEffect(() => () => stopRef.current(), []);

  const orbScale = 1 + Math.min(0.5, micLevel * 1.6);
  return (
    <main className="witness">
      <div className="w-hospital">Mercy Hospital · Emergency Department</div>
      <div className="w-title">{witnessName ? `${witnessName} — connected` : "Connected"} to Rosa&rsquo;s care team</div>
      <div className="w-status">Coordinator: Maya Torres · {detail}</div>

      <div className={`w-orb ${phase === "live" ? "listening" : ""}`}>
        <div
          className="core"
          style={{ transform: `scale(${phase === "agent-speaking" ? 1.25 : orbScale})` }}
        />
      </div>

      <div className="w-captions">
        {captions.map((c, i) => (
          <div key={i}>
            <span className="who">{c.role === "assistant" ? "Before" : "You"}</span>
            {c.content}
          </div>
        ))}
      </div>

      {readback && phase !== "complete" && (
        <div className="w-readback">
          <b>Awaiting your confirmation:</b> {readback}
        </div>
      )}

      <div className="w-disclosure">
        An AI assistant is collecting urgent timeline information; answers may enter Rosa&rsquo;s
        medical record. Say the word to return to the human coordinator. This call never asks for
        payment, insurance, or ID numbers. Synthetic demo — no real patient data.
      </div>
    </main>
  );
}
