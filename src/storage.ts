// localStorage persistence. Keys are unchanged from v1 so returning players
// keep their name, league, and lifetime stats. Every access is guarded:
// storage can throw or be empty in private browsing.

import type { Subject } from "./levels";

const LS_NAME = "hh_playerName";
const LS_LEVEL = "hh_level";
const LS_STATS = "hh_lifetime_stats";

export type SubjectStats = Record<Subject, { correct: number; total: number }>;

export function freshStats(): SubjectStats {
  return {
    math: { correct: 0, total: 0 },
    spelling: { correct: 0, total: 0 },
    vocab: { correct: 0, total: 0 },
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures (e.g. private browsing)
  }
}

export const loadName = () => read(LS_NAME) || "";
export const saveName = (name: string) => write(LS_NAME, name);
export const loadLevel = () => read(LS_LEVEL);
export const saveLevel = (level: string) => write(LS_LEVEL, level);

export function loadLifetimeStats(): SubjectStats {
  const stats = freshStats();
  try {
    const saved = JSON.parse(read(LS_STATS) || "{}");
    for (const subject of Object.keys(stats) as Subject[]) {
      const s = saved[subject];
      if (s && Number.isFinite(s.correct) && Number.isFinite(s.total)) stats[subject] = s;
    }
  } catch {
    // corrupt JSON: start fresh
  }
  return stats;
}

export function saveLifetimeStats(gameStats: SubjectStats): SubjectStats {
  const lifetime = loadLifetimeStats();
  for (const subject of Object.keys(gameStats) as Subject[]) {
    lifetime[subject].correct += gameStats[subject].correct;
    lifetime[subject].total += gameStats[subject].total;
  }
  write(LS_STATS, JSON.stringify(lifetime));
  return lifetime;
}
