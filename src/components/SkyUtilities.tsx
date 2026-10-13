import { useEffect, useRef, useState, type ReactNode } from 'react';

import { SPACE_CAMERA_HOME_POSE } from '../scene/backgroundModel';
import type { ArchiveStoreApi } from '../store/archiveStore';

/**
 * The default free-view pose the recenter button eases the camera back to —
 * the same framing the opening arrival flight lands on.
 */
const HOME_POSE = SPACE_CAMERA_HOME_POSE;

interface AmbientAudio {
  context: AudioContext;
  master: GainNode;
}

/**
 * A slow procedural space pad: two softly detuned oscillators breathing
 * through a lowpass filter. Synthesized on demand, so no audio asset ships.
 */
function startAmbient(): AmbientAudio | null {
  try {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.connect(master);
    master.connect(context.destination);

    for (const [frequency, level] of [[55, 0.5], [55.7, 0.35], [110.3, 0.18]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = level;
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
    }
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    master.gain.linearRampToValueAtTime(0.05, context.currentTime + 2.5);
    return { context, master };
  } catch {
    return null;
  }
}

/**
 * A drawn mark, on the same 24-grid and stroke weight as the dock icons.
 * These two buttons used to carry `⌂` and `♪̸` — characters, not shapes, so
 * the platform picked the font and the barred note in particular landed as a
 * note plus a stray combining slash.
 */
function UtilityGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="18"
    >
      {children}
    </svg>
  );
}

/** Crosshair over a ring: put the view back where it started. */
const RECENTER_ICON = (
  <UtilityGlyph>
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" fill="currentColor" r="1.4" stroke="none" />
    <path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5" />
  </UtilityGlyph>
);

/** A speaker, with waves when sound is on and a slash across it when off. */
function SoundIcon({ on }: { on: boolean }) {
  return (
    <UtilityGlyph>
      <path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14.5 H4 Z" />
      {on ? (
        <path d="M15.5 9.2 a4 4 0 0 1 0 5.6 M18.3 6.6 a7.6 7.6 0 0 1 0 10.8" />
      ) : (
        <path d="M15.5 9.8 L20.5 14.2 M20.5 9.8 L15.5 14.2" />
      )}
    </UtilityGlyph>
  );
}

/** Corner utilities over the sky: recenter home, and an ambient sound toggle. */
export function SkyUtilities({ store }: { store: ArchiveStoreApi }) {
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<AmbientAudio | null>(null);

  useEffect(() => () => {
    void audioRef.current?.context.close();
    audioRef.current = null;
  }, []);

  const toggleSound = () => {
    if (soundOn) {
      const audio = audioRef.current;
      if (audio !== null) {
        audio.master.gain.linearRampToValueAtTime(0, audio.context.currentTime + 0.6);
        window.setTimeout(() => {
          void audio.context.close();
        }, 800);
      }
      audioRef.current = null;
      setSoundOn(false);
      return;
    }
    audioRef.current = startAmbient();
    setSoundOn(audioRef.current !== null);
  };

  const recenter = () => {
    store.getState().commands.requestCameraHome(HOME_POSE);
  };

  return (
    <div className="sky-utilities">
      <button
        aria-label="처음 위치로 돌아가기"
        className="sky-utility-button"
        onClick={recenter}
        title="처음 위치로"
        type="button"
      >
        {RECENTER_ICON}
      </button>
      <button
        aria-label={soundOn ? '우주 소리 끄기' : '우주 소리 켜기'}
        aria-pressed={soundOn}
        className="sky-utility-button"
        onClick={toggleSound}
        title="우주 소리"
        type="button"
      >
        <SoundIcon on={soundOn} />
      </button>
    </div>
  );
}
