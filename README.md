# Flappy Bird AI Trainer

A browser-based Flappy Bird clone with two play modes:

- `Player mode` for normal play with keyboard, mouse, or touch input
- `AI mode` where a neural-network agent trains in real time and plays live on screen

The project is intentionally lightweight: plain JavaScript, HTML, CSS, and a canvas-based game loop powered by Vite for local development.

Inspired in part by an X/Twitter post from [@chatgpt21](https://x.com/chatgpt21).

## Preview

This project focuses on three things:

- a playable retro-style Flappy Bird web clone
- a visible training loop you can watch while the AI improves
- a tunable neural network budget from small models up to `1,000` parameters

## Features

- Mode toggle between human play and AI play
- Live AI stats including generation, score, reward, confidence, and parameter count
- Dedicated AI telemetry panel with recent evaluation averages
- Adjustable model-size slider with architecture readout
- Sound toggle for both player mode and AI preview mode
- Progressive difficulty curve during player runs
- Fast local setup with no framework overhead

## Tech Stack

- `Vite`
- `HTML5 Canvas`
- `Vanilla JavaScript`
- `CSS`

## Getting Started

### Prerequisites

- `Node.js 20+`
- `npm`

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
npm run build
```

## How It Works

### Player Mode

In player mode, the game behaves like a standard Flappy Bird clone:

- press `Space`
- click the canvas
- tap on touch devices

The early game is slightly more forgiving, then the pipe gap tightens as the score increases.

### AI Mode

In AI mode, the project runs an evolutionary training loop:

- a population of neural-network policies is evaluated
- stronger agents are kept as elites
- new generations are created by mutation and crossover
- the current best-performing policy is shown live in the visible game

The AI is warm-started from a hand-shaped policy so it learns from a usable baseline instead of spending early generations falling immediately.

### Sound

The game includes lightweight browser-generated sound effects for flap, score, and crash events, plus a sound toggle so audio can be enabled or disabled at any time.

This repo does not bundle ripped "original Flappy Bird" sound assets. For a public GitHub project, that is the safer choice from a licensing standpoint. If you want to swap in licensed audio later, the project is structured so that can be added cleanly.

## Model Scaling

The slider changes the parameter budget of the policy network from very small models to a `1,000` parameter model.

Each setting updates:

- the number of trainable parameters
- the displayed architecture shape
- the policy capacity used by the AI trainer

## Project Structure

```text
.
├── index.html
├── package.json
├── src
│   ├── main.js
│   └── styles.css
└── README.md
```

## Current Status

This version is a solid playable baseline with visible AI training, but the training system still has headroom. The agent improves meaningfully, though it does not yet consistently push to the long-run performance ceiling you would want from a more advanced RL setup.

Planned future improvements could include:

- stronger reward shaping
- a more advanced reinforcement-learning algorithm
- better visual fidelity closer to the original mobile game
- richer UI polish and optional licensed audio assets

## Scripts

```bash
npm run dev
npm run build
npm run preview
```

## License

No license has been added yet. If you plan to publish this on GitHub, add the license you want before making the repository public.
