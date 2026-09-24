"use client";

import { Pause, Play } from "lucide-react";
import { useMemo, useRef, useState, type MouseEvent } from "react";

const barCount = 42;
const playbackRates = [1, 1.5, 2] as const;

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—:—";
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function seededWaveform(seed: string) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return Array.from({ length: barCount }, (_, index) => {
    value = Math.imul(value ^ (index + 1), 2246822519);
    return 0.18 + ((value >>> 0) % 74) / 100;
  });
}

function normalizedWaveform(levels: number[] | undefined, seed: string) {
  if (!levels?.length) return seededWaveform(seed);
  return Array.from({ length: barCount }, (_, index) => {
    const sourceIndex = Math.min(levels.length - 1, Math.floor((index / barCount) * levels.length));
    return Math.max(0.08, Math.min(1, levels[sourceIndex] ?? 0.08));
  });
}

export function VoiceWaveform({ levels, progress = 0, seed, live = false }: { levels?: number[]; progress?: number; seed: string; live?: boolean }) {
  const waveform = useMemo(() => normalizedWaveform(levels, seed), [levels, seed]);
  return <span aria-hidden="true" data-voice-waveform className="flex h-9 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
    {waveform.map((height, index) => {
      const completed = index / waveform.length <= progress;
      return <span key={index} className={`w-[3px] shrink-0 rounded-full transition-[height,background-color] duration-75 ${completed || live ? "bg-current" : "bg-current opacity-25"}`} style={{ height: `${Math.max(4, Math.round(height * 28))}px` }} />;
    })}
  </span>;
}

export function VoiceMessagePlayer({ src, seed, mine = false, levels, durationHintMs }: { src: string; seed: string; mine?: boolean; levels?: number[]; durationHintMs?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(durationHintMs !== undefined && Number.isFinite(durationHintMs) && durationHintMs > 0 ? durationHintMs / 1000 : null);
  const [rateIndex, setRateIndex] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);
  const progress = duration !== null && duration > 0 ? Math.min(1, currentTime / duration) : 0;

  function updateDuration(audio: HTMLAudioElement) {
    if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      setPlaybackError(false);
      await audio.play();
    } catch {
      setPlaybackError(true);
    }
  }

  function seek(event: MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || duration === null || !Number.isFinite(duration) || duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(duration, ((event.clientX - bounds.left) / bounds.width) * duration));
    setCurrentTime(audio.currentTime);
  }

  function changePlaybackRate() {
    const nextIndex = (rateIndex + 1) % playbackRates.length;
    setRateIndex(nextIndex);
    if (audioRef.current) audioRef.current.playbackRate = playbackRates[nextIndex];
  }

  return <div data-voice-player className={`flex min-w-[12rem] max-w-full items-center gap-2.5 sm:min-w-[15rem] ${mine ? "text-[var(--on-accent)]" : "text-[var(--accent-ink)]"}`}>
    <audio ref={audioRef} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setPlaybackError(true)} onEnded={(event) => {
      setPlaying(false);
      setCurrentTime(0);
      if (!Number.isFinite(event.currentTarget.duration) && event.currentTarget.currentTime > 0) setDuration(event.currentTarget.currentTime);
    }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => updateDuration(event.currentTarget)} onDurationChange={(event) => updateDuration(event.currentTarget)} />
    <button type="button" onClick={() => void togglePlayback()} className={`focus-ring grid size-9 shrink-0 place-items-center rounded-full ${mine ? "bg-[var(--on-accent)] text-[var(--accent)]" : "bg-[var(--accent)] text-[var(--on-accent)]"}`} aria-label={playing ? "Поставить голосовое на паузу" : "Воспроизвести голосовое"}>{playing ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}</button>
    <div className="min-w-0 flex-1">
      <button type="button" onClick={seek} disabled={duration === null} title={duration === null ? "Длительность файла пока неизвестна" : undefined} className="focus-ring flex w-full items-center rounded-[6px] disabled:cursor-not-allowed" aria-label="Перемотать голосовое сообщение"><VoiceWaveform levels={levels} progress={progress} seed={seed} /></button>
      <div className={`mt-0.5 flex items-center justify-between text-[9px] ${mine ? "text-[var(--on-accent)]/75" : "text-[var(--muted)]"}`}><span role={playbackError ? "alert" : undefined}>{playbackError ? "Ошибка воспроизведения" : playing || currentTime > 0 ? formatDuration(currentTime) : duration === null ? "—:—" : formatDuration(duration)}</span><button type="button" onClick={changePlaybackRate} className="focus-ring rounded px-1 py-0.5 font-semibold" aria-label="Изменить скорость воспроизведения">{playbackRates[rateIndex]}×</button></div>
    </div>
  </div>;
}
