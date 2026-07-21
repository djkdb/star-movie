import { useEffect, useRef, useState } from 'react';

import type { ArchiveStoreApi } from '../store/archiveStore';

/** The default free-view pose the recenter button eases the camera back to. */
const HOME_POSE = {
  position: { x: 0, y: 0, z: 80 },
  target: { x: 0, y: 0, z: 0 },
} as const;

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
        ⌂
      </button>
      <button
        aria-label={soundOn ? '우주 소리 끄기' : '우주 소리 켜기'}
        aria-pressed={soundOn}
        className="sky-utility-button"
        onClick={toggleSound}
        title="우주 소리"
        type="button"
      >
        {soundOn ? '♪' : '♪̸'}
      </button>
    </div>
  );
}
