"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { finalizeRecordedVoice } from "@/lib/recorded-voice";

export type VoiceRecordingPhase = "idle" | "recording" | "paused" | "processing" | "failed" | "ready";

const waveformSampleIntervalMs = 80;
const waveformSampleCount = 48;

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function recordingLevel(analyser: AnalyserNode, samples: Uint8Array<ArrayBuffer>) {
  analyser.getByteTimeDomainData(samples);
  let energy = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    energy += normalized * normalized;
  }
  const rootMeanSquare = Math.sqrt(energy / samples.length);
  return Math.min(1, Math.max(0.06, rootMeanSquare * 5.5));
}

export function useVoiceRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardOnStopRef = useRef(false);
  const recordingFailureRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const phaseRef = useRef<VoiceRecordingPhase>("idle");
  const elapsedBeforeSegmentRef = useRef(0);
  const segmentStartedAtRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const rawRecordingRef = useRef<File | null>(null);

  const [phase, setPhaseState] = useState<VoiceRecordingPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const setPhase = useCallback((nextPhase: VoiceRecordingPhase) => {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }, []);

  const clearAnalyser = useCallback(() => {
    if (analyserTimerRef.current !== null) {
      window.clearInterval(analyserTimerRef.current);
      analyserTimerRef.current = null;
    }
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
  }, []);

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFile(null);
  }, []);

  const resetDraft = useCallback(() => {
    rawRecordingRef.current = null;
    clearPreview();
    setElapsedMs(0);
    setWaveform([]);
    setError(null);
    elapsedBeforeSegmentRef.current = 0;
    segmentStartedAtRef.current = null;
    chunksRef.current = [];
    setPhase("idle");
  }, [clearPreview, setPhase]);

  const prepareDraft = useCallback(async () => {
    const recording = rawRecordingRef.current;
    if (!recording || phaseRef.current === "processing") return;
    setPhase("processing");
    setError(null);
    try {
      const prepared = await finalizeRecordedVoice(recording, elapsedBeforeSegmentRef.current);
      if (!mountedRef.current || rawRecordingRef.current !== recording) return;
      const nextPreviewUrl = URL.createObjectURL(prepared);
      previewUrlRef.current = nextPreviewUrl;
      setFile(prepared);
      setPreviewUrl(nextPreviewUrl);
      rawRecordingRef.current = null;
      chunksRef.current = [];
      setPhase("ready");
    } catch {
      if (!mountedRef.current || rawRecordingRef.current !== recording) return;
      setError("Не удалось подготовить голосовое. Запись сохранена в черновике — повторите подготовку.");
      setPhase("failed");
    }
  }, [setPhase]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle" || startingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Запись голоса не поддерживается этим браузером.");
      return;
    }

    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      setError("Браузер не поддерживает доступный формат голосовых сообщений.");
      return;
    }

    startingRef.current = true;
    setStarting(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Разрешите доступ к микрофону и повторите запись.");
      startingRef.current = false;
      setStarting(false);
      return;
    }
    if (!mountedRef.current) {
      stopMediaStream(stream);
      return;
    }

    clearPreview();
    setError(null);
    setElapsedMs(0);
    setWaveform([]);
    elapsedBeforeSegmentRef.current = 0;
    segmentStartedAtRef.current = null;
    discardOnStopRef.current = false;
    recordingFailureRef.current = null;
    chunksRef.current = [];
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      stopMediaStream(stream);
      streamRef.current = null;
      startingRef.current = false;
      setStarting(false);
      setError("Не удалось запустить запись в поддерживаемом формате.");
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      recordingFailureRef.current = "Не удалось записать голосовое сообщение. Попробуйте ещё раз.";
      discardOnStopRef.current = true;
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.onstop = () => {
      clearAnalyser();
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      if (!mountedRef.current) {
        chunksRef.current = [];
        return;
      }

      if (discardOnStopRef.current || chunksRef.current.length === 0) {
        const failure = recordingFailureRef.current;
        discardOnStopRef.current = false;
        recordingFailureRef.current = null;
        resetDraft();
        if (failure) setError(failure);
        return;
      }

      const normalizedMimeType = mimeType.startsWith("audio/mp4") ? "audio/mp4" : "audio/webm";
      const extension = normalizedMimeType === "audio/mp4" ? "m4a" : "webm";
      rawRecordingRef.current = new File(chunksRef.current, `voice-${Date.now()}.${extension}`, { type: normalizedMimeType });
      void prepareDraft();
    };

    const audioContext = new window.AudioContext();
    const analyser = audioContext.createAnalyser();
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
    } catch {
      await audioContext.close();
      stopMediaStream(stream);
      streamRef.current = null;
      recorderRef.current = null;
      startingRef.current = false;
      setStarting(false);
      setError("Не удалось запустить визуализацию записи. Попробуйте ещё раз.");
      return;
    }
    audioContextRef.current = audioContext;
    const samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    analyserTimerRef.current = window.setInterval(() => {
      if (phaseRef.current !== "recording") return;
      const segmentStartedAt = segmentStartedAtRef.current;
      if (segmentStartedAt !== null) setElapsedMs(elapsedBeforeSegmentRef.current + performance.now() - segmentStartedAt);
      const level = recordingLevel(analyser, samples);
      setWaveform((current) => [...current.slice(-(waveformSampleCount - 1)), level]);
    }, waveformSampleIntervalMs);

    recorder.start(250);
    segmentStartedAtRef.current = performance.now();
    setPhase("recording");
    startingRef.current = false;
    setStarting(false);
  }, [clearAnalyser, clearPreview, prepareDraft, resetDraft, setPhase]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    const segmentStartedAt = segmentStartedAtRef.current;
    if (segmentStartedAt !== null) elapsedBeforeSegmentRef.current += performance.now() - segmentStartedAt;
    segmentStartedAtRef.current = null;
    setElapsedMs(elapsedBeforeSegmentRef.current);
    setPhase("paused");
  }, [setPhase]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    segmentStartedAtRef.current = performance.now();
    setPhase("recording");
  }, [setPhase]);

  const finish = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") {
      const segmentStartedAt = segmentStartedAtRef.current;
      if (segmentStartedAt !== null) elapsedBeforeSegmentRef.current += performance.now() - segmentStartedAt;
      setElapsedMs(elapsedBeforeSegmentRef.current);
    }
    segmentStartedAtRef.current = null;
    recorder.stop();
  }, []);

  const discard = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      discardOnStopRef.current = true;
      recorder.stop();
      return;
    }
    resetDraft();
  }, [resetDraft]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      rawRecordingRef.current = null;
      discardOnStopRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      clearAnalyser();
      stopMediaStream(streamRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [clearAnalyser]);

  return { phase, starting, elapsedMs, waveform, file, previewUrl, error, start, pause, resume, finish, discard, resetDraft, prepareDraft };
}
