# Homework Homers ⚾

A baseball game for ages 5–10. Answer math, spelling, and vocabulary
questions to earn a pitch, then time your swing to smash a homer.

Play it at https://slowms6.github.io/baseball-quiz-game/

## Develop

Needs Node 20.19+ or 22.12+.

```sh
npm install
npm run dev        # http://localhost:5173/baseball-quiz-game/
npm test           # unit tests (rules, question generators, level content)
npm run typecheck
npm run build      # production build in dist/
```

Pushing to `master` builds, tests, and deploys to GitHub Pages
(`.github/workflows/deploy.yml`).

## Where things live

- `src/levels.ts` — leagues and their questions. Add a new age tier here.
- `src/questions.ts` — question generators.
- `src/rules.ts` — base running, CPU at-bats, swing timing.
- `src/game.ts` — the game flow and screens.
- `src/swing3d.ts` — the 3D ballpark, players, and pitch clock.
- `src/styles/main.css` — the look.

Player model: "Cesium Man" by Cesium, CC BY 4.0.
