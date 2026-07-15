// Shared live audio level for the Jarvis orb.
//
// `orbAudio.level` is a smoothed 0..1 loudness value written ONLY while Jarvis
// himself is speaking (from the synthesized voice waveform below) and read every
// frame by the orb render loop, which maps it to how much the orb expands. The
// user's own microphone deliberately does NOT feed this — the orb reacts to
// Jarvis' voice, not to the person talking to him.
export const orbAudio = { level: 0 };
let stopActiveSpeech: (() => void) | null = null;

export function stopJarvisSpeech() {
  stopActiveSpeech?.();
}

/**
 * Play a synthesized-speech Blob (Jarvis' voice) while driving `orbAudio.level`
 * from its real waveform, so the orb expands with Jarvis' actual voice instead
 * of guessing from word boundaries. Resolves when playback finishes (or fails).
 *
 * Routes the audio element through an analyser AND to the speakers, so the
 * loudness the orb sees is exactly what the user hears.
 */
export function playSpeechThroughOrb(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let ctx: AudioContext | null = null;
    let raf = 0;
    let done = false;
    let stop: () => void = () => {};

    const cleanup = (error?: unknown) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      orbAudio.level = 0;
      ctx?.close().catch(() => {});
      URL.revokeObjectURL(url);
      if (stopActiveSpeech === stop) stopActiveSpeech = null;
      if (error) reject(error);
      else resolve();
    };

    stop = () => {
      audio.pause();
      cleanup();
    };
    stopActiveSpeech?.();
    stopActiveSpeech = stop;

    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      const data = new Uint8Array(analyser.fftSize);

      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Gentle gain + slow smoothing so the level eases up and down instead
        // of tracking every syllable. The orb loop smooths this again on top.
        const target = Math.min(1, rms * 2.2);
        orbAudio.level += (target - orbAudio.level) * 0.09;
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // Web Audio unavailable — still play the audio, just without reactivity.
    }

    audio.onended = cleanup;
    audio.onerror = () => cleanup(new Error('Synthesized audio could not be decoded'));
    void (async () => {
      if (ctx?.state === 'suspended') await ctx.resume();
      await audio.play();
    })().catch(cleanup);
  });
}
