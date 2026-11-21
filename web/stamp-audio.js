const CLIPS = {
  stamp: "./audio/stamp.wav",
  undo: "./audio/paper.wav",
  jingle: "./audio/ready.wav",
};

export function createStampAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const sources = new Set();
  let context;
  let playback = 0;

  // Decode the short clips before a gesture without opening an audible audio context.
  const ready = Promise.all(Object.entries(CLIPS).map(async ([name, path]) => {
    if (!AudioContext || !OfflineAudioContext) return [name, null];
    try {
      const url = new URL(path, import.meta.url);
      url.search = new URL(import.meta.url).search;
      const response = await fetch(url);
      if (!response.ok) return [name, null];
      const decoder = new OfflineAudioContext(1, 1, 24_000);
      return [name, await decoder.decodeAudioData(await response.arrayBuffer())];
    } catch {
      return [name, null];
    }
  })).then(Object.fromEntries);

  function stop() {
    playback += 1;
    for (const source of sources) source.stop();
    sources.clear();
  }

  async function play(cues) {
    stop();
    if (!AudioContext || document.hidden) return;
    const token = playback;
    const pressedAt = performance.now();
    try {
      context ||= new AudioContext();
      // Call resume during the button gesture, including the first stamp after launch.
      const unlocked = context.state === "running" ? undefined : context.resume();
      const [, clips] = await Promise.all([unlocked, ready]);
      const elapsed = (performance.now() - pressedAt) / 1000;
      if (token !== playback || document.hidden || elapsed > 0.22) return;
      const now = context.currentTime;
      for (const [name, delay] of cues) {
        const buffer = clips[name];
        if (!buffer) continue;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
        };
        source.start(now + Math.max(0, delay - elapsed));
        sources.add(source);
      }
    } catch {
      // A suspended device or unavailable clip must not interrupt the routine.
      if (token === playback) stop();
    }
  }

  return {
    stamp: (jingle = false) => play(jingle ? [["stamp", 0.12], ["jingle", 0.25]] : [["stamp", 0.12]]),
    undo: () => play([["undo", 0]]),
    stop,
  };
}
