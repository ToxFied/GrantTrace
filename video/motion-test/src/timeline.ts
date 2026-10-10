// 120 BPM at 30 fps: one beat is 15 frames, one bar is 60 frames.
// scripts/audio.py builds the soundtrack on the same grid.
export const BEAT = 15;
export const BAR = 60;
export const bar = (n: number, beat = 0) => n * BAR + beat * BEAT;

export const SCENES = {
  hook: [bar(0), bar(2)],
  question: [bar(2), bar(4)],
  logo: [bar(4), bar(5)],
  record: [bar(5), bar(8)],
  pipeline: [bar(8), bar(10)],
  drift: [bar(10), bar(11)],
  review: [bar(11), bar(13)],
  inspect: [bar(13), bar(16)],
  outro: [bar(16), bar(19)],
} as const;

export const TOTAL_FRAMES = bar(19);
