// Confetti bursts for big moments. canvas-confetti skips the animation for
// players who prefer reduced motion.

import confetti from "canvas-confetti";

const COLORS = ["#ffc928", "#1e6fd9", "#e53935", "#ffffff", "#4fb548", "#ff8a3d"];

export function celebrate(big = false) {
  const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 50 };
  confetti({ ...base, particleCount: big ? 160 : 90, spread: 80, origin: { y: 0.55 } });
  if (big) {
    setTimeout(() => confetti({ ...base, particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } }), 200);
    setTimeout(() => confetti({ ...base, particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } }), 200);
  }
}
