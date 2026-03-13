import "./styles.css";

const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d");

const ui = {
  playerModeButton: document.querySelector("#player-mode-button"),
  aiModeButton: document.querySelector("#ai-mode-button"),
  soundToggle: document.querySelector("#sound-toggle"),
  modeLabel: document.querySelector("#mode-label"),
  modeHint: document.querySelector("#mode-hint"),
  parameterSlider: document.querySelector("#parameter-slider"),
  parameterLabel: document.querySelector("#parameter-label"),
  networkShape: document.querySelector("#network-shape"),
  generation: document.querySelector("#generation-stat"),
  score: document.querySelector("#score-stat"),
  bestScore: document.querySelector("#best-score-stat"),
  reward: document.querySelector("#reward-stat"),
  entropy: document.querySelector("#entropy-stat"),
  learningRate: document.querySelector("#lr-stat"),
  overlayTitle: document.querySelector("#overlay-title"),
  overlayText: document.querySelector("#overlay-text"),
  telemetryMode: document.querySelector("#telemetry-mode"),
  telemetryModel: document.querySelector("#telemetry-model"),
  telemetryGeneration: document.querySelector("#telemetry-generation"),
  telemetryRuns: document.querySelector("#telemetry-runs"),
  telemetryEvalAvg: document.querySelector("#telemetry-eval-avg"),
  telemetryBestAvg: document.querySelector("#telemetry-best-avg"),
  telemetryBestScore: document.querySelector("#telemetry-best-score"),
  telemetryWarmStart: document.querySelector("#telemetry-warm-start"),
  telemetryPreviewFlap: document.querySelector("#telemetry-preview-flap"),
  telemetryEvalCaption: document.querySelector("#telemetry-eval-caption"),
  evalChart: document.querySelector("#eval-chart"),
};

const GAME = {
  width: 288,
  height: 512,
  floorHeight: 112,
  pipeWidth: 52,
  basePipeGap: 112,
  minPipeGap: 92,
  pipeSpacing: 168,
  scrollSpeed: 118,
  gravity: 980,
  flapImpulse: -290,
  birdX: 68,
  birdW: 34,
  birdH: 24,
  fixedDt: 1 / 60,
};

canvas.width = GAME.width;
canvas.height = GAME.height;
ctx.imageSmoothingEnabled = false;

const appState = {
  mode: "player",
  score: 0,
  bestScore: 0,
  generation: 0,
  reward: 0,
  entropy: 0,
  lastTime: performance.now(),
  accumulator: 0,
};

class SoundEngine {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.muted = false;
  }

  unlock() {
    if (!this.enabled) {
      return;
    }
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.enabled = false;
        return;
      }
      this.context = new AudioContextClass();
    }
    if (this.context.state === "suspended") {
      this.context.resume();
    }
  }

  play(type) {
    if (!this.enabled || this.muted || !this.context) {
      return;
    }

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.connect(gain);
    gain.connect(this.context.destination);

    if (type === "flap") {
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(620, now);
      oscillator.frequency.exponentialRampToValueAtTime(360, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.03, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      oscillator.start(now);
      oscillator.stop(now + 0.09);
      return;
    }

    if (type === "score") {
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(760, now);
      oscillator.frequency.exponentialRampToValueAtTime(1080, now + 0.14);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.start(now);
      oscillator.stop(now + 0.16);
      return;
    }

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(210, now);
    oscillator.frequency.exponentialRampToValueAtTime(90, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  setMuted(nextMuted) {
    this.muted = nextMuted;
  }
}

const sound = new SoundEngine();
const chartCtx = ui.evalChart.getContext("2d");
chartCtx.imageSmoothingEnabled = false;

function hashNoise(seed, index) {
  const value = Math.sin(seed * 19.19 + index * 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function createPipe(index, seed) {
  const minGapY = 64;
  const pipeGap = currentPipeGap(index);
  const maxGapY = GAME.height - GAME.floorHeight - pipeGap - 36;
  const gapY = Math.round(lerp(minGapY, maxGapY, hashNoise(seed, index)));
  return {
    index,
    x: GAME.width + 56 + index * GAME.pipeSpacing,
    gapY,
    gap: pipeGap,
    passed: false,
  };
}

function currentPipeGap(score) {
  return Math.max(GAME.minPipeGap, GAME.basePipeGap - Math.min(score, 14) * 1.6);
}

class GameWorld {
  constructor({ seed = 1, autoplay = false } = {}) {
    this.autoplay = autoplay;
    this.reset(seed, autoplay);
  }

  reset(seed = 1, autoplay = this.autoplay) {
    this.seed = seed;
    this.autoplay = autoplay;
    this.phase = autoplay ? "running" : "ready";
    this.time = 0;
    this.spawnIndex = 0;
    this.spawnAccumulator = 0;
    this.score = 0;
    this.reward = 0;
    this.bird = {
      x: GAME.birdX,
      y: 230,
      vy: 0,
      angle: 0,
      flapCooldown: 0,
      wingTimer: 0,
      wingFrame: 0,
    };
    this.pipes = [];
    for (let i = 0; i < 3; i += 1) {
      this.pipes.push(createPipe(this.spawnIndex, this.seed));
      this.spawnIndex += 1;
    }
  }

  start() {
    if (this.phase === "ready") {
      this.phase = "running";
      return this.flap();
    }
    return false;
  }

  flap() {
    if (this.phase !== "running") {
      return false;
    }
    if (this.bird.flapCooldown > 0) {
      return false;
    }
    this.bird.vy = GAME.flapImpulse;
    this.bird.flapCooldown = 0.1;
    this.bird.wingTimer = 0;
    this.bird.wingFrame = 2;
    return true;
  }

  getNextPipe() {
    return this.pipes.find((pipe) => pipe.x + GAME.pipeWidth > this.bird.x - 10) ?? this.pipes[0];
  }

  getObservation() {
    const nextPipe = this.getNextPipe();
    const gapCenter = nextPipe.gapY + nextPipe.gap * 0.5;
    return [
      (this.bird.y - gapCenter) / GAME.height,
      this.bird.vy / 300,
      (nextPipe.x - this.bird.x) / GAME.width,
      (nextPipe.gapY - this.bird.y) / GAME.height,
      (nextPipe.gapY + nextPipe.gap - this.bird.y) / GAME.height,
      this.score / 20,
    ];
  }

  step(dt) {
    this.time += dt;
    this.reward = 0;
    let scored = false;

    if (this.phase === "ready") {
      this.bird.y = 230 + Math.sin(this.time * 4.6) * 6;
      this.bird.angle = Math.sin(this.time * 4.6) * 0.05;
      this.bird.wingTimer += dt;
      this.bird.wingFrame = Math.floor(this.bird.wingTimer * 8) % 3;
      return { ended: false, reward: 0, scored: false, crashed: false };
    }

    if (this.phase === "dead") {
      return { ended: true, reward: 0, scored: false, crashed: false };
    }

    this.bird.flapCooldown = Math.max(0, this.bird.flapCooldown - dt);
    this.bird.wingTimer += dt;
    this.bird.wingFrame = Math.floor(this.bird.wingTimer * 14) % 3;

    this.spawnAccumulator += GAME.scrollSpeed * dt;
    if (this.spawnAccumulator >= GAME.pipeSpacing) {
      this.spawnAccumulator -= GAME.pipeSpacing;
      this.pipes.push(createPipe(this.spawnIndex, this.seed));
      this.spawnIndex += 1;
    }

    for (const pipe of this.pipes) {
      pipe.x -= GAME.scrollSpeed * dt;
      if (!pipe.passed && pipe.x + GAME.pipeWidth < this.bird.x) {
        pipe.passed = true;
        this.score += 1;
        this.reward += 4;
        scored = true;
      }
    }

    this.pipes = this.pipes.filter((pipe) => pipe.x + GAME.pipeWidth > -32);

    this.bird.vy += GAME.gravity * dt;
    this.bird.y += this.bird.vy * dt;
    this.bird.angle = clamp(this.bird.vy / 320, -0.55, 1.2);

    const nextPipe = this.getNextPipe();
    const gapCenter = nextPipe.gapY + nextPipe.gap * 0.5;
    const distancePenalty = Math.abs(this.bird.y - gapCenter) / 180;
    this.reward += 0.08 - distancePenalty * 0.035;

    if (this.hasCollision()) {
      this.phase = "dead";
      this.reward -= 6;
      return { ended: true, reward: this.reward, scored, crashed: true };
    }

    return { ended: false, reward: this.reward, scored, crashed: false };
  }

  hasCollision() {
    const top = this.bird.y - GAME.birdH * 0.5;
    const bottom = this.bird.y + GAME.birdH * 0.5;
    if (top < 0 || bottom > GAME.height - GAME.floorHeight + 2) {
      return true;
    }

    const birdLeft = this.bird.x - GAME.birdW * 0.5 + 3;
    const birdRight = this.bird.x + GAME.birdW * 0.5 - 3;

    return this.pipes.some((pipe) => {
      const overlapsX = birdRight > pipe.x && birdLeft < pipe.x + GAME.pipeWidth;
      if (!overlapsX) {
        return false;
      }
      return top < pipe.gapY || bottom > pipe.gapY + pipe.gap;
    });
  }
}

class NeuralNet {
  constructor(inputSize, targetParams, weights) {
    this.inputSize = inputSize;
    this.targetParams = targetParams;
    const arch = resolveArchitecture(inputSize, targetParams);
    this.hiddenA = arch.hiddenA;
    this.hiddenB = arch.hiddenB;
    this.baseParams = arch.params;
    this.extraParams = targetParams - arch.params;
    this.params = targetParams;
    this.weightCount =
      inputSize * this.hiddenA +
      this.hiddenA +
      (this.hiddenB > 0 ? this.hiddenA * this.hiddenB + this.hiddenB : 0) +
      (this.hiddenB > 0 ? this.hiddenB : this.hiddenA) +
      1 +
      this.extraParams;
    this.weights = weights ? Float32Array.from(weights) : randomWeights(this.weightCount);
  }

  clone() {
    return new NeuralNet(this.inputSize, this.targetParams, this.weights);
  }

  mutate(scale) {
    const next = this.clone();
    for (let i = 0; i < next.weights.length; i += 1) {
      if (Math.random() < 0.72) {
        next.weights[i] += gaussianRandom() * scale;
      }
    }
    return next;
  }

  crossover(other) {
    const child = this.clone();
    for (let i = 0; i < child.weights.length; i += 1) {
      if (Math.random() < 0.5) {
        child.weights[i] = other.weights[i];
      }
    }
    return child;
  }

  get label() {
    return this.hiddenB > 0
      ? `${this.inputSize} → ${this.hiddenA} → ${this.hiddenB} → 1`
      : `${this.inputSize} → ${this.hiddenA} → 1`;
  }

  predict(input) {
    let cursor = 0;
    const hiddenA = new Array(this.hiddenA);
    for (let i = 0; i < this.hiddenA; i += 1) {
      let sum = 0;
      for (let j = 0; j < this.inputSize; j += 1) {
        sum += this.weights[cursor] * input[j];
        cursor += 1;
      }
      sum += this.weights[cursor];
      cursor += 1;
      hiddenA[i] = Math.tanh(sum);
    }

    let features = hiddenA;
    if (this.hiddenB > 0) {
      const hiddenB = new Array(this.hiddenB);
      for (let i = 0; i < this.hiddenB; i += 1) {
        let sum = 0;
        for (let j = 0; j < this.hiddenA; j += 1) {
          sum += this.weights[cursor] * hiddenA[j];
          cursor += 1;
        }
        sum += this.weights[cursor];
        cursor += 1;
        hiddenB[i] = Math.tanh(sum);
      }
      features = hiddenB;
    }

    let logit = 0;
    for (let i = 0; i < features.length; i += 1) {
      logit += this.weights[cursor] * features[i];
      cursor += 1;
    }
    logit += this.weights[cursor];
    cursor += 1;

    for (let i = 0; i < this.extraParams; i += 1) {
      logit += this.weights[cursor] * extraFeature(input, i);
      cursor += 1;
    }

    return sigmoid(logit);
  }
}

function createHeuristicNetwork(inputSize, targetParams) {
  const net = new NeuralNet(inputSize, targetParams);
  net.weights.fill(0);
  const layout = getNetworkLayout(net);

  const setW1 = (neuron, input, value) => {
    if (neuron < net.hiddenA) {
      net.weights[layout.w1 + neuron * (net.inputSize + 1) + input] = value;
    }
  };
  const setB1 = (neuron, value) => {
    if (neuron < net.hiddenA) {
      net.weights[layout.w1 + neuron * (net.inputSize + 1) + net.inputSize] = value;
    }
  };
  const setW2 = (neuron, source, value) => {
    if (net.hiddenB > 0 && neuron < net.hiddenB && source < net.hiddenA) {
      net.weights[layout.w2 + neuron * (net.hiddenA + 1) + source] = value;
    }
  };
  const setB2 = (neuron, value) => {
    if (net.hiddenB > 0 && neuron < net.hiddenB) {
      net.weights[layout.w2 + neuron * (net.hiddenA + 1) + net.hiddenA] = value;
    }
  };

  // input[0] = bird offset from gap center
  // input[1] = vertical velocity
  // input[2] = horizontal distance to next pipe
  // input[4] = distance to the lower edge of the gap
  setW1(0, 0, 3.3);
  setW1(0, 1, 1.7);
  setW1(0, 2, -1.4);
  setB1(0, -0.2);

  setW1(1, 4, -3.6);
  setW1(1, 1, 0.9);
  setB1(1, -0.05);

  setW1(2, 0, -2.9);
  setW1(2, 1, -0.9);
  setB1(2, -0.12);

  setW1(3, 0, 1.8);
  setW1(3, 1, 1.2);
  setW1(3, 2, -2.1);
  setB1(3, -0.08);

  if (net.hiddenB > 0) {
    for (let i = 0; i < Math.min(net.hiddenB, 4); i += 1) {
      setW2(i, i, 1.35);
    }
    setW2(4, 0, 0.9);
    setW2(4, 1, 0.7);
    setB2(4, 0);
  }

  const outOffset = layout.output;
  const featureCount = net.hiddenB > 0 ? net.hiddenB : net.hiddenA;
  const setOut = (feature, value) => {
    if (feature < featureCount) {
      net.weights[outOffset + feature] = value;
    }
  };

  setOut(0, 2.7);
  setOut(1, 2.2);
  setOut(2, -2.1);
  setOut(3, 1.6);
  setOut(4, 1.1);
  net.weights[outOffset + featureCount] = -0.18;

  return net;
}

function getNetworkLayout(net) {
  const w1 = 0;
  const afterW1 = net.hiddenA * (net.inputSize + 1);
  const w2 = afterW1;
  const afterW2 = net.hiddenB > 0 ? afterW1 + net.hiddenB * (net.hiddenA + 1) : afterW1;
  const output = afterW2;
  const featureCount = net.hiddenB > 0 ? net.hiddenB : net.hiddenA;
  const extras = output + featureCount + 1;
  return { w1, w2, output, extras };
}

function resolveArchitecture(inputSize, targetParams) {
  let best = { hiddenA: 4, hiddenB: 0, params: inputSize * 4 + 4 + 4 + 1 };
  for (let hiddenA = 4; hiddenA <= 96; hiddenA += 1) {
    const oneLayer = inputSize * hiddenA + hiddenA + hiddenA + 1;
    if (oneLayer <= targetParams && oneLayer > best.params) {
      best = { hiddenA, hiddenB: 0, params: oneLayer };
    }
    for (let hiddenB = 4; hiddenB <= 96; hiddenB += 1) {
      const twoLayer =
        inputSize * hiddenA +
        hiddenA +
        hiddenA * hiddenB +
        hiddenB +
        hiddenB +
        1;
      if (twoLayer <= targetParams && twoLayer > best.params) {
        best = { hiddenA, hiddenB, params: twoLayer };
      }
    }
  }
  return best;
}

function extraFeature(input, index) {
  const a = input[index % input.length];
  const b = input[(index * 3 + 1) % input.length];
  const c = input[(index * 5 + 2) % input.length];
  return Math.tanh((Math.sin(a * (index + 1.2) * 1.7) + Math.cos(b * (index + 1.8) * 1.4) + c) * 0.7);
}

function randomWeights(count) {
  const weights = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    weights[i] = gaussianRandom() * 0.45;
  }
  return weights;
}

let gaussianSpare = null;
function gaussianRandom() {
  if (gaussianSpare !== null) {
    const value = gaussianSpare;
    gaussianSpare = null;
    return value;
  }
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const magnitude = Math.sqrt(-2 * Math.log(u));
  gaussianSpare = magnitude * Math.sin(2 * Math.PI * v);
  return magnitude * Math.cos(2 * Math.PI * v);
}

class EvolutionTrainer {
  constructor(paramBudget) {
    this.inputSize = 6;
    this.populationSize = 36;
    this.eliteCount = 6;
    this.warmStartRatio = 0.7;
    this.paramBudget = paramBudget;
    this.generation = 0;
    this.bestFitness = -Infinity;
    this.bestScore = 0;
    this.averageFitness = 0;
    this.evalAverage = 0;
    this.bestEvalAverage = 0;
    this.totalRuns = 0;
    this.evalHistory = [];
    this.actionConfidence = 0;
    this.previewFlap = 0;
    this.bestNetwork = createHeuristicNetwork(this.inputSize, paramBudget);
    this.demoWorld = new GameWorld({ seed: 7, autoplay: true });
    this.simStepsPerFrame = 10;
    this.startGeneration();
    this.resetDemo();
  }

  setParamBudget(paramBudget) {
    this.paramBudget = paramBudget;
    this.bestFitness = -Infinity;
    this.bestScore = 0;
    this.averageFitness = 0;
    this.evalAverage = 0;
    this.bestEvalAverage = 0;
    this.totalRuns = 0;
    this.evalHistory = [];
    this.actionConfidence = 0;
    this.previewFlap = 0;
    this.parents = null;
    this.generation = 0;
    this.bestNetwork = createHeuristicNetwork(this.inputSize, paramBudget);
    this.startGeneration();
    this.resetDemo();
  }

  createGenerationSeed() {
    return 97 + this.generation * 53;
  }

  startGeneration() {
    const seed = this.createGenerationSeed();
    if (!this.parents) {
      this.population = Array.from({ length: this.populationSize }, (_, index) => ({
        net:
          index === 0
            ? this.bestNetwork.clone()
            : index < this.populationSize * this.warmStartRatio
              ? this.bestNetwork.mutate(0.12)
              : new NeuralNet(this.inputSize, this.paramBudget),
        world: new GameWorld({ seed, autoplay: true }),
        fitness: 0,
        alive: true,
        steps: 0,
      }));
      return;
    }

    const elites = this.parents.slice(0, this.eliteCount);
    const mutationScale = clamp(0.26 - this.paramBudget / 8000, 0.08, 0.22);

    this.population = [];
    this.population.push({
      net: elites[0].net.clone(),
      world: new GameWorld({ seed, autoplay: true }),
      fitness: 0,
      alive: true,
      steps: 0,
    });

    while (this.population.length < this.populationSize) {
      const parentA = elites[Math.floor(Math.random() * elites.length)].net;
      const parentB = elites[Math.floor(Math.random() * elites.length)].net;
      let child = Math.random() < 0.35 ? parentA.crossover(parentB) : parentA.clone();
      child = child.mutate(mutationScale);
      this.population.push({
        net: child,
        world: new GameWorld({ seed, autoplay: true }),
        fitness: 0,
        alive: true,
        steps: 0,
      });
    }
  }

  evolve() {
    this.population.sort((a, b) => b.fitness - a.fitness);
    this.parents = this.population.slice(0, this.eliteCount).map((agent) => ({
      net: agent.net.clone(),
      fitness: agent.fitness,
      score: agent.world.score,
    }));

    const generationBest = this.population[0];
    this.totalRuns += this.population.length;
    this.averageFitness =
      this.population.reduce((sum, agent) => sum + agent.fitness, 0) / this.population.length;
    this.evalAverage =
      this.population.slice(0, this.eliteCount).reduce((sum, agent) => sum + agent.world.score, 0) /
      this.eliteCount;
    this.bestEvalAverage = Math.max(this.bestEvalAverage, this.evalAverage);
    this.evalHistory.push(this.evalAverage);
    if (this.evalHistory.length > 24) {
      this.evalHistory.shift();
    }
    this.bestScore = Math.max(this.bestScore, generationBest.world.score);

    if (generationBest.fitness >= this.bestFitness) {
      this.bestFitness = generationBest.fitness;
      this.bestNetwork = generationBest.net.clone();
      this.resetDemo();
    }

    this.generation += 1;
    this.startGeneration();
  }

  updateTraining() {
    for (let step = 0; step < this.simStepsPerFrame; step += 1) {
      let living = 0;
      for (const agent of this.population) {
        if (!agent.alive) {
          continue;
        }
        living += 1;
        const observation = agent.world.getObservation();
        const flapProb = agent.net.predict(observation);
        if (flapProb > 0.5) {
          agent.world.flap();
        }
        const { ended, reward } = agent.world.step(GAME.fixedDt);
        agent.fitness += reward;
        agent.steps += 1;
        if (ended || agent.steps > 60 * 24) {
          agent.alive = false;
        }
      }

      if (living === 0) {
        this.evolve();
        return;
      }
    }
  }

  resetDemo() {
    this.demoWorld.reset(this.createGenerationSeed() + 11, true);
    this.demoWorld.flap();
  }

  updateDemo() {
    const observation = this.demoWorld.getObservation();
    const flapProb = this.bestNetwork.predict(observation);
    this.actionConfidence = flapProb;
    this.previewFlap = flapProb;
    let flapped = false;
    if (flapProb > 0.52) {
      flapped = this.demoWorld.flap();
      if (flapped) {
        sound.play("flap");
      }
    }
    const { ended, reward, scored, crashed } = this.demoWorld.step(GAME.fixedDt);
    if (scored) {
      sound.play("score");
    }
    if (crashed) {
      sound.play("hit");
    }
    if (ended) {
      this.resetDemo();
      this.demoReward = 0;
      this.actionConfidence = 0;
      this.previewFlap = 0;
      return;
    }
    this.demoReward = reward;
  }
}

const playerWorld = new GameWorld({ seed: 5, autoplay: false });
const trainer = new EvolutionTrainer(Number(ui.parameterSlider.value));

function setMode(mode) {
  appState.mode = mode;
  ui.playerModeButton.classList.toggle("is-active", mode === "player");
  ui.aiModeButton.classList.toggle("is-active", mode === "ai");
  ui.modeLabel.textContent = mode === "ai" ? "AI" : "Player";
  ui.modeHint.textContent =
    mode === "ai"
      ? "Watch the current best agent play while the trainer evolves the next generations."
      : "Press space, click, or tap to flap.";
  ui.overlayTitle.textContent = mode === "ai" ? "AI training mode" : "Player mode";
  ui.overlayText.textContent =
    mode === "ai"
      ? "A reward-driven evolutionary policy trains offscreen while the current champion plays live."
      : "Space / click / tap to flap. Stay centered, clear the pipes, and restart fast on crash.";
  playerWorld.reset(5, false);
}

function activeWorld() {
  return appState.mode === "ai" ? trainer.demoWorld : playerWorld;
}

function onPrimaryAction() {
  sound.unlock();
  if (appState.mode === "ai") {
    return;
  }

  if (playerWorld.phase === "ready") {
    if (playerWorld.start()) {
      sound.play("flap");
    }
    return;
  }

  if (playerWorld.phase === "running") {
    if (playerWorld.flap()) {
      sound.play("flap");
    }
    return;
  }

  playerWorld.reset(5, false);
}

function updatePlayer() {
  const result = playerWorld.step(GAME.fixedDt);
  if (result.scored) {
    sound.play("score");
  }
  if (result.crashed) {
    sound.play("hit");
  }
}

function updateAi() {
  trainer.updateTraining();
  trainer.updateDemo();
}

function drawEvalChart() {
  const { width, height } = ui.evalChart;
  chartCtx.clearRect(0, 0, width, height);

  chartCtx.fillStyle = "#142532";
  chartCtx.fillRect(0, 0, width, height);

  chartCtx.strokeStyle = "rgba(255,255,255,0.08)";
  chartCtx.lineWidth = 1;
  for (let i = 1; i <= 3; i += 1) {
    const y = Math.round((height / 4) * i) + 0.5;
    chartCtx.beginPath();
    chartCtx.moveTo(0, y);
    chartCtx.lineTo(width, y);
    chartCtx.stroke();
  }

  const values = trainer.evalHistory;
  if (values.length === 0) {
    chartCtx.fillStyle = "#91a9b7";
    chartCtx.font = '10px "Avenir Next", sans-serif';
    chartCtx.fillText("Waiting for generations...", 14, 52);
    return;
  }

  const maxValue = Math.max(...values, 1);
  chartCtx.strokeStyle = "#f6d469";
  chartCtx.lineWidth = 3;
  chartCtx.beginPath();
  values.forEach((value, index) => {
    const x = values.length === 1 ? 14 : 14 + (index / (values.length - 1)) * (width - 28);
    const y = height - 14 - (value / maxValue) * (height - 28);
    if (index === 0) {
      chartCtx.moveTo(x, y);
    } else {
      chartCtx.lineTo(x, y);
    }
  });
  chartCtx.stroke();
}

function drawPixelRect(x, y, w, h, fill, outline) {
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2);
  }
}

function drawBackground(world) {
  drawPixelRect(0, 0, GAME.width, GAME.height, "#70c5ce");

  ctx.fillStyle = "#d8f0ef";
  for (let i = 0; i < 10; i += 1) {
    const x = (i * 31 - (world.time * 10) % 31) | 0;
    const skyline = [20, 34, 24, 42, 26, 30];
    for (let j = 0; j < skyline.length; j += 1) {
      const width = j % 2 === 0 ? 5 : 7;
      const left = x + j * 5;
      ctx.fillRect(left, 360 - skyline[j], width, skyline[j]);
      if (j % 2 === 1) {
        ctx.fillRect(left + 1, 360 - skyline[j] - 4, width - 2, 4);
      }
    }
  }

  ctx.fillStyle = "#84d85d";
  for (let x = -18; x < GAME.width + 18; x += 18) {
    const offset = ((world.time * 16) % 18) | 0;
    ctx.beginPath();
    ctx.arc(x - offset, 370, 14, Math.PI, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(0, 370, GAME.width, 22);

  ctx.fillStyle = "#ded895";
  ctx.fillRect(0, GAME.height - GAME.floorHeight + 12, GAME.width, GAME.floorHeight);
  ctx.fillStyle = "#8fd35f";
  ctx.fillRect(0, GAME.height - GAME.floorHeight, GAME.width, 16);
  ctx.fillStyle = "#73bf2c";
  for (let x = 0; x < GAME.width + 24; x += 24) {
    ctx.fillRect(x - ((world.time * 118) % 24), GAME.height - GAME.floorHeight, 14, 16);
  }
  ctx.fillStyle = "#c8b868";
  for (let x = 0; x < GAME.width + 24; x += 24) {
    ctx.fillRect(x - ((world.time * 58) % 24), GAME.height - 28, 2, 28);
  }

  ctx.fillStyle = "#f3f7de";
  for (let i = 0; i < 4; i += 1) {
    const baseX = (i * 90 - (world.time * 18) % 90) | 0;
    drawCloud(baseX + 20, 86 + (i % 2) * 18);
  }
}

function drawCloud(x, y) {
  ctx.fillRect(x, y + 6, 20, 10);
  ctx.fillRect(x + 8, y, 24, 16);
  ctx.fillRect(x + 28, y + 5, 16, 11);
}

function drawPipes(world) {
  for (const pipe of world.pipes) {
    const topHeight = pipe.gapY;
    const bottomY = pipe.gapY + pipe.gap;
    const bottomHeight = GAME.height - GAME.floorHeight - bottomY;
    drawPipe(pipe.x, 0, topHeight, true);
    drawPipe(pipe.x, bottomY, bottomHeight, false);
  }
}

function drawPipe(x, y, height, top) {
  drawPixelRect(x, y, GAME.pipeWidth, height, "#73bf2c", "#4f7d1e");
  ctx.fillStyle = "#9de65b";
  ctx.fillRect(x + 4, y + 4, 6, Math.max(0, height - 8));
  ctx.fillRect(x + GAME.pipeWidth - 10, y + 4, 4, Math.max(0, height - 8));
  const lipY = top ? y + height - 24 : y;
  drawPixelRect(x - 2, lipY, GAME.pipeWidth + 4, 24, "#73bf2c", "#4f7d1e");
  ctx.fillStyle = "#9de65b";
  ctx.fillRect(x + 4, lipY + 4, 8, 16);
}

function drawBird(world) {
  const { x, y, angle, wingFrame } = world.bird;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);

  const wingOffsets = [
    [
      [-10, 0, 8, 4],
      [-6, 4, 10, 4],
    ],
    [
      [-10, 4, 8, 4],
      [-6, 8, 10, 4],
    ],
    [
      [-8, -4, 8, 4],
      [-4, 0, 10, 4],
    ],
  ];

  ctx.fillStyle = "#d35400";
  ctx.fillRect(-15, -2, 22, 12);
  ctx.fillStyle = "#f1c40f";
  ctx.fillRect(-15, -8, 24, 14);
  ctx.fillRect(-11, 6, 18, 4);

  ctx.fillStyle = "#f39c12";
  for (const part of wingOffsets[wingFrame]) {
    ctx.fillRect(part[0], part[1], part[2], part[3]);
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(3, -8, 8, 8);
  ctx.fillStyle = "#2c3e50";
  ctx.fillRect(7, -5, 3, 3);
  ctx.fillStyle = "#e74c3c";
  ctx.fillRect(10, -1, 10, 4);
  ctx.fillRect(12, 3, 6, 2);

  ctx.restore();
}

function drawScore(world) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#5b3a17";
  ctx.lineWidth = 4;
  ctx.font = '24px "Press Start 2P", monospace';
  const value = String(world.score);
  ctx.strokeText(value, GAME.width / 2, 52);
  ctx.fillText(value, GAME.width / 2, 52);
  ctx.restore();
}

function drawBanner(title, subtitle, y) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#f8e76a";
  ctx.strokeStyle = "#6a3d0d";
  ctx.lineWidth = 6;
  ctx.font = '22px "Press Start 2P", monospace';
  ctx.strokeText(title, GAME.width / 2, y);
  ctx.fillText(title, GAME.width / 2, y);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4;
  ctx.font = '10px "Press Start 2P", monospace';
  ctx.strokeText(subtitle, GAME.width / 2, y + 32);
  ctx.fillText(subtitle, GAME.width / 2, y + 32);
  ctx.restore();
}

function drawModeSpecificOverlay(world) {
  if (appState.mode === "player") {
    if (world.phase === "ready") {
      drawBanner("GET READY", "PRESS SPACE", 154);
      drawHintSprite();
    } else if (world.phase === "dead") {
      drawBanner("GAME OVER", "PRESS TO RETRY", 154);
      drawGameOverCard(world);
    }
    return;
  }

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(8, 8, 140, 50);
  ctx.fillStyle = "#ffffff";
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.fillText(`GEN ${trainer.generation}`, 16, 26);
  ctx.fillText(`P ${trainer.bestNetwork.params}`, 16, 40);
  ctx.fillText(`ACT ${trainer.actionConfidence.toFixed(2)}`, 16, 54);
  ctx.restore();
}

function drawHintSprite() {
  ctx.save();
  ctx.translate(GAME.width / 2, 256);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-8, 20, 16, 24);
  ctx.fillRect(-14, 26, 28, 10);
  ctx.fillStyle = "#e74c3c";
  ctx.fillRect(16, 18, 34, 14);
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.fillStyle = "#ffffff";
  ctx.fillText("TAP", 21, 28);
  ctx.restore();
}

function drawGameOverCard(world) {
  ctx.save();
  ctx.fillStyle = "#ded895";
  ctx.fillRect(72, 228, 144, 88);
  ctx.strokeStyle = "#7d6a2b";
  ctx.lineWidth = 4;
  ctx.strokeRect(72, 228, 144, 88);
  ctx.fillStyle = "#5b3a17";
  ctx.font = '9px "Press Start 2P", monospace';
  ctx.fillText(`SCORE ${world.score}`, 96, 260);
  ctx.fillText(`BEST ${appState.bestScore}`, 96, 286);
  ctx.restore();
}

function render(world) {
  drawBackground(world);
  drawPipes(world);
  drawBird(world);
  drawScore(world);
  drawModeSpecificOverlay(world);
}

function syncUi() {
  const world = activeWorld();
  appState.score = world.score;
  appState.bestScore = Math.max(appState.bestScore, world.score, trainer.bestScore);
  appState.generation = trainer.generation;
  appState.reward = appState.mode === "ai" ? trainer.demoReward ?? 0 : world.reward;
  appState.entropy = Math.abs((trainer.actionConfidence ?? 0.5) - 0.5) * 2;

  ui.parameterLabel.textContent = `${trainer.bestNetwork.params} params`;
  ui.networkShape.textContent = trainer.bestNetwork.label;
  ui.generation.textContent = String(trainer.generation);
  ui.score.textContent = String(world.score);
  ui.bestScore.textContent = String(appState.bestScore);
  ui.reward.textContent = appState.reward.toFixed(2);
  ui.entropy.textContent = appState.entropy.toFixed(2);
  ui.learningRate.textContent = `${trainer.populationSize} agents`;
  ui.soundToggle.textContent = sound.muted ? "Sound Off" : "Sound On";
  ui.soundToggle.setAttribute("aria-pressed", String(!sound.muted));

  ui.telemetryMode.textContent = appState.mode === "ai" ? "Live training" : "Player preview";
  ui.telemetryModel.textContent = `${trainer.bestNetwork.params} params`;
  ui.telemetryGeneration.textContent = String(trainer.generation);
  ui.telemetryRuns.textContent = String(trainer.totalRuns);
  ui.telemetryEvalAvg.textContent = trainer.evalAverage.toFixed(2);
  ui.telemetryBestAvg.textContent = trainer.bestEvalAverage.toFixed(2);
  ui.telemetryBestScore.textContent = String(trainer.bestScore);
  ui.telemetryWarmStart.textContent = `${Math.round(trainer.warmStartRatio * 100)}%`;
  ui.telemetryPreviewFlap.textContent = `${Math.round(trainer.previewFlap * 100)}%`;
  ui.telemetryEvalCaption.textContent = `Last ${Math.max(trainer.evalHistory.length, 1)} generations`;
  drawEvalChart();
}

function updateFrame() {
  if (appState.mode === "ai") {
    updateAi();
  } else {
    updatePlayer();
  }
}

function frame(now) {
  const delta = Math.min(0.05, (now - appState.lastTime) / 1000);
  appState.lastTime = now;
  appState.accumulator += delta;

  while (appState.accumulator >= GAME.fixedDt) {
    updateFrame();
    appState.accumulator -= GAME.fixedDt;
  }

  render(activeWorld());
  syncUi();
  requestAnimationFrame(frame);
}

ui.playerModeButton.addEventListener("click", () => {
  setMode("player");
});

ui.aiModeButton.addEventListener("click", () => {
  sound.unlock();
  setMode("ai");
});

ui.soundToggle.addEventListener("click", () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  syncUi();
});

ui.parameterSlider.addEventListener("input", (event) => {
  trainer.setParamBudget(Number(event.target.value));
  playerWorld.reset(5, false);
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    onPrimaryAction();
  }
});

canvas.addEventListener("pointerdown", () => {
  onPrimaryAction();
});

setMode("player");
requestAnimationFrame((time) => {
  appState.lastTime = time;
  frame(time);
});
