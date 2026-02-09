(() => {
  "use strict";

  const config = window.BEER_DINO_CONFIG;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const State = {
    BOOT: "BOOT",
    TITLE: "TITLE",
    PLAYING: "PLAYING",
    GAME_OVER: "GAME_OVER",
    PAUSED: "PAUSED",
  };

  let state = State.BOOT;
  let paused = false;
  let lastTime = 0;
  let gameTime = 0;
  let speed = config.gameplay.difficulty.speed.startPxPerSec;
  let score = 0;
  let bestScore = 0;
  let drunkenness = config.drunkenness.level.start;

  const player = {
    x: config.physics.player.startX,
    y: config.physics.player.startY,
    width: config.physics.player.width,
    height: config.physics.player.height,
    vx: 0,
    vy: 0,
    lastOnGroundTime: 0,
  };

  let collectibles = [];
  let obstacles = [];
  let jumpQueue = [];
  let lastJumpInputTime = -Infinity;

  let nextBeerSpawn = 0;
  let nextWifeSpawn = 0;
  let nextHoleSpawn = 0;
  let groundOffset = 0;

  const images = {};
  const sounds = {};
  const imageStatus = {};
  let audioCtx = null;
  let bgmElement = null;
  let bgmSource = null;
  let bgmGain = null;
  let bgmFilter = null;
  let audioReady = false;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const randBetween = (min, max) => min + Math.random() * (max - min);
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

  const getBestScore = () => {
    if (config.gameplay.score.bestScorePersistence !== "localStorage") {
      return 0;
    }
    const stored = Number.parseInt(localStorage.getItem("beerBest") || "0", 10);
    return Number.isFinite(stored) ? stored : 0;
  };

  const setBestScore = (value) => {
    if (config.gameplay.score.bestScorePersistence !== "localStorage") {
      return;
    }
    localStorage.setItem("beerBest", String(value));
  };

  const loadImages = () => {
    const entries = Object.entries(config.assets.sprites);
    return Promise.all(
      entries.map(([key, src]) => {
        return new Promise((resolve) => {
          const img = new Image();
          images[key] = img;
          imageStatus[key] = "loading";
          img.onload = () => {
            imageStatus[key] = "ready";
            resolve();
          };
          img.onerror = () => {
            imageStatus[key] = "missing";
            resolve();
          };
          img.src = src;
        });
      })
    );
  };

  const loadSounds = () => {
    Object.entries(config.assets.sounds).forEach(([key, src]) => {
      if (key === "bgm") return;
      const audio = new Audio();
      audio.src = src;
      sounds[key] = audio;
    });
  };

  const initAudio = () => {
    if (audioReady) return;
    audioReady = true;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      bgmElement = new Audio(config.assets.sounds.bgm);
      bgmElement.loop = true;
      bgmElement.volume = 0.9;
      bgmSource = audioCtx.createMediaElementSource(bgmElement);
      bgmGain = audioCtx.createGain();
      bgmFilter = audioCtx.createBiquadFilter();
      bgmFilter.type = "lowpass";
      bgmFilter.frequency.value = 12000;
      bgmSource.connect(bgmFilter);
      bgmFilter.connect(bgmGain);
      bgmGain.connect(audioCtx.destination);
      bgmElement.play().catch(() => {});
    } catch (_) {
      audioReady = false;
    }
  };

  const updateBgmWobble = (now) => {
    if (!bgmFilter || !bgmGain || !audioCtx) return;
    const level = clamp(drunkenness / config.drunkenness.level.max, 0, 1);
    const wobble = Math.sin(now * 0.003) * level;
    const baseFreq = lerp(12000, 700, level);
    bgmFilter.frequency.value = baseFreq + wobble * 600;
    bgmFilter.detune.value = wobble * 200;
    bgmGain.gain.value = 0.95 + wobble * 0.1;
  };

  const playSound = (key) => {
    const audio = sounds[key];
    if (!audio) return;
    try {
      audio.currentTime = 0;
      audio.play();
    } catch (_) {
      // Autoplay制限を無視
    }
  };

  const resetGame = () => {
    speed = config.gameplay.difficulty.speed.startPxPerSec;
    score = 0;
    drunkenness = config.drunkenness.level.start;
    player.x = config.physics.player.startX;
    player.y = config.physics.player.startY;
    player.vx = 0;
    player.vy = 0;
    player.lastOnGroundTime = performance.now();
    collectibles = [];
    obstacles = [];
    jumpQueue = [];
    lastJumpInputTime = -Infinity;
    groundOffset = 0;
    const now = performance.now();
    nextBeerSpawn = now + 400;
    nextWifeSpawn = now + 800;
    nextHoleSpawn = now + 1200;
  };

  const scheduleJump = (now) => {
    lastJumpInputTime = now;
    const t = clamp(drunkenness / config.drunkenness.level.max, 0, 1);
    const delayBase = easeOutQuad(t) * config.drunkenness.jumpDelay.maxDelayMs;
    const jitter = easeOutQuad(t) * config.drunkenness.jumpDelay.maxJitterMs;
    const scheduledTime = now + delayBase + randBetween(-jitter, jitter);
    const expireTime = now + config.controls.jump.bufferMs;
    jumpQueue.push({ scheduledTime, expireTime });
  };

  const canJump = (now) => {
    const coyote = now - player.lastOnGroundTime <= config.controls.jump.coyoteTimeMs;
    const onGround = player.y >= config.physics.world.groundY - player.height - 0.5;
    return onGround || coyote;
  };

  const doJump = () => {
    player.vy = config.physics.player.jump.velocityPxPerSec;
    playSound("jump");
  };

  const updateJumpQueue = (now) => {
    if (jumpQueue.length === 0) return;
    const pending = [];
    for (const entry of jumpQueue) {
      if (now >= entry.scheduledTime) {
        if (canJump(now)) {
          doJump();
          continue;
        }
      }
      if (now <= entry.expireTime) {
        pending.push(entry);
      }
    }
    jumpQueue = pending;
  };

  const getSpawnMultiplier = () => {
    const speedCfg = config.gameplay.difficulty.speed;
    const t = clamp(
      (speed - speedCfg.startPxPerSec) / (speedCfg.maxPxPerSec - speedCfg.startPxPerSec),
      0,
      1
    );
    return lerp(1, config.gameplay.difficulty.spawn.dynamicAdjustment.minIntervalMultiplierAtMaxSpeed, t);
  };

  const hasSpacing = (spawnX, minDistance) => {
    const all = collectibles.concat(obstacles);
    for (const obj of all) {
      if (spawnX - obj.x < minDistance) {
        return false;
      }
    }
    return true;
  };

  const beerClear = (beer) => {
    for (const obs of obstacles) {
      const clearance = config.spawningRules.beerClearancePx;
      if (obs.type === "hole") {
        const gapStart = obs.x - clearance;
        const gapEnd = obs.x + obs.gapWidth + clearance;
        if (beer.x + beer.width > gapStart && beer.x < gapEnd) {
          return false;
        }
      } else {
        const overlapX = beer.x + beer.width > obs.x - clearance && beer.x < obs.x + obs.width + clearance;
        const overlapY = beer.y + beer.height > obs.y - clearance && beer.y < obs.y + obs.height + clearance;
        if (overlapX && overlapY) {
          return false;
        }
      }
    }
    return true;
  };

  const spawnBeer = (now) => {
    const spawnX = config.screen.width + config.entities.beer.spawn.xMargin;
    const minDistance = Math.max(
      config.spawningRules.minSpacingPx,
      (speed * config.spawningRules.minReactionTimeMs) / 1000
    );
    if (!hasSpacing(spawnX, minDistance)) return false;
    const beer = {
      id: config.entities.beer.id,
      type: "beer",
      x: spawnX,
      y: randBetween(config.entities.beer.spawn.yMin, config.entities.beer.spawn.yMax),
      width: config.entities.beer.size.w,
      height: config.entities.beer.size.h,
      spriteKey: config.entities.beer.spriteKey,
    };
    if (!beerClear(beer)) return false;
    collectibles.push(beer);
    return true;
  };

  const spawnWife = () => {
    const spawnX = config.screen.width + config.entities.wife.spawn.xMargin;
    const minDistance = Math.max(
      config.spawningRules.minSpacingPx,
      (speed * config.spawningRules.minReactionTimeMs) / 1000
    );
    if (!hasSpacing(spawnX, minDistance)) return false;
    obstacles.push({
      id: config.entities.wife.id,
      type: "wife",
      x: spawnX,
      y: config.entities.wife.spawn.y,
      width: config.entities.wife.size.w,
      height: config.entities.wife.size.h,
      spriteKey: config.entities.wife.spriteKey,
    });
    return true;
  };

  const spawnHole = () => {
    const spawnX = config.screen.width + config.entities.hole.spawn.xMargin;
    const minDistance = Math.max(
      config.spawningRules.minSpacingPx,
      (speed * config.spawningRules.minReactionTimeMs) / 1000
    );
    if (!hasSpacing(spawnX, minDistance)) return false;
    obstacles.push({
      id: config.entities.hole.id,
      type: "hole",
      x: spawnX,
      y: config.entities.hole.spawn.y,
      width: config.entities.hole.size.w,
      height: config.entities.hole.size.h,
      gapWidth: config.entities.hole.special.gapWidthPx,
      spriteKey: config.entities.hole.spriteKey,
    });
    return true;
  };

  const rectOverlap = (a, b) => {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  };

  const getPlayerHitbox = () => {
    const inset = config.physics.player.hitboxInset;
    return {
      x: player.x + inset.left,
      y: player.y + inset.top,
      width: player.width - inset.left - inset.right,
      height: player.height - inset.top - inset.bottom,
    };
  };

  const getWifeHitbox = (wife) => {
    const inset = config.entities.wife.hitboxInset;
    return {
      x: wife.x + inset.left,
      y: wife.y + inset.top,
      width: wife.width - inset.left - inset.right,
      height: wife.height - inset.top - inset.bottom,
    };
  };

  const getHoleHitbox = (hole) => {
    const height = config.entities.hole.special.hitboxHeightPx;
    return {
      x: hole.x,
      y: config.physics.world.groundY - height,
      width: hole.gapWidth,
      height,
    };
  };

  const update = (dt, now) => {
    if (state !== State.PLAYING || paused) return;

    gameTime += dt;
    speed = Math.min(
      config.gameplay.difficulty.speed.maxPxPerSec,
      speed + config.gameplay.difficulty.speed.accelPxPerSec2 * dt
    );

    if (config.drunkenness.decay.enabled) {
      drunkenness = clamp(
        drunkenness - config.drunkenness.decay.perSecond * dt,
        config.drunkenness.level.min,
        config.drunkenness.level.max
      );
    }

    updateJumpQueue(now);

    player.vy += config.physics.gravityPxPerSec2 * dt;
    player.y += player.vy * dt;

    const groundY = config.physics.world.groundY;
    if (player.y >= groundY - player.height) {
      player.y = groundY - player.height;
      player.vy = 0;
      player.lastOnGroundTime = now;
    }

    const spawnMultiplier = getSpawnMultiplier();

    if (now >= nextBeerSpawn) {
      const spawned = spawnBeer(now);
      nextBeerSpawn = now + randBetween(
        config.gameplay.difficulty.spawn.beerSpawnIntervalMs.min,
        config.gameplay.difficulty.spawn.beerSpawnIntervalMs.max
      ) * spawnMultiplier + (spawned ? 0 : 120);
    }

    if (now >= nextWifeSpawn) {
      const spawned = spawnWife();
      nextWifeSpawn = now + randBetween(
        config.gameplay.difficulty.spawn.wifeSpawnIntervalMs.min,
        config.gameplay.difficulty.spawn.wifeSpawnIntervalMs.max
      ) * spawnMultiplier + (spawned ? 0 : 120);
    }

    if (now >= nextHoleSpawn) {
      const spawned = spawnHole();
      nextHoleSpawn = now + randBetween(
        config.gameplay.difficulty.spawn.holeSpawnIntervalMs.min,
        config.gameplay.difficulty.spawn.holeSpawnIntervalMs.max
      ) * spawnMultiplier + (spawned ? 0 : 120);
    }

    const moveX = speed * dt;
    groundOffset = (groundOffset + moveX) % config.rendering.ground.tileSizePx;
    collectibles.forEach((obj) => {
      obj.x -= moveX;
    });
    obstacles.forEach((obj) => {
      obj.x -= moveX;
    });

    collectibles = collectibles.filter((obj) => obj.x + obj.width > -80);
    obstacles = obstacles.filter((obj) => obj.x + obj.width > -120);

    const hitbox = getPlayerHitbox();

    collectibles = collectibles.filter((beer) => {
      if (rectOverlap(hitbox, beer)) {
        score += config.gameplay.score.beerBonusPoints;
        drunkenness = clamp(
          drunkenness + config.drunkenness.increase.perBeer,
          config.drunkenness.level.min,
          config.drunkenness.level.max
        );
        playSound("burp");
        return false;
      }
      return true;
    });

    for (const obs of obstacles) {
      if (obs.type === "wife") {
        const wifeHitbox = getWifeHitbox(obs);
        if (rectOverlap(hitbox, wifeHitbox)) {
          triggerGameOver("hit");
          break;
        }
      } else if (obs.type === "hole") {
        const playerBottom = player.y + player.height;
        const overGround = playerBottom >= config.physics.world.groundY - 1;
        const holeHitbox = getHoleHitbox(obs);
        const overlapX = hitbox.x + hitbox.width > holeHitbox.x && hitbox.x < holeHitbox.x + holeHitbox.width;
        if (overGround && overlapX) {
          triggerGameOver("fall");
          break;
        }
      }
    }

    score += config.gameplay.score.distancePointsPerSecond * dt;
  };

  const triggerGameOver = (reason) => {
    if (state !== State.PLAYING) return;
    state = State.GAME_OVER;
    playSound(reason === "fall" ? "fall" : "scream");
    playSound("game_over");
    const current = Math.floor(score);
    if (current > bestScore) {
      bestScore = current;
      setBestScore(bestScore);
    }
  };

  const drawImageOrRect = (key, x, y, w, h, color, label) => {
    if (imageStatus[key] === "ready") {
      ctx.drawImage(images[key], x, y, w, h);
      return;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    if (label) {
      ctx.fillStyle = "#111";
      ctx.font = "14px system-ui";
      ctx.fillText(label, x + 6, y + h / 2);
    }
  };

  const render = (now) => {
    updateBgmWobble(now);
    ctx.save();

    const wobbleLevel = clamp(drunkenness / config.drunkenness.level.max, 0, 1);
    if (state === State.PLAYING && wobbleLevel > 0) {
      const wobble = Math.sin(now * 0.004) * wobbleLevel;
      const rotate = (config.drunkenness.visualFeedback.screenWobble.maxRotationDeg * wobble * Math.PI) / 180;
      const offset = config.drunkenness.visualFeedback.screenWobble.maxOffsetPx * wobble;
      ctx.translate(canvas.width / 2 + offset, canvas.height / 2 - offset);
      ctx.rotate(rotate);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = config.screen.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (imageStatus.background === "ready") {
      ctx.drawImage(images.background, 0, 0, canvas.width, canvas.height);
    }

    const groundY = config.screen.groundY;
    if (config.rendering.ground.useTiledSprite && imageStatus.ground_tile === "ready") {
      const tileSize = config.rendering.ground.tileSizePx;
      const startX = -groundOffset;
      for (let x = startX; x < canvas.width + tileSize; x += tileSize) {
        ctx.drawImage(images.ground_tile, x, groundY, tileSize, tileSize);
      }
    } else {
      ctx.fillStyle = "#d8d2c8";
      ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);
      ctx.fillStyle = "#b3aea5";
      const holes = obstacles
        .filter((obs) => obs.type === "hole")
        .map((hole) => ({ start: hole.x, end: hole.x + hole.gapWidth }))
        .sort((a, b) => a.start - b.start);
      let cursorX = 0;
      for (const hole of holes) {
        const lineEnd = Math.max(0, Math.min(hole.start, canvas.width));
        if (lineEnd > cursorX) {
          ctx.fillRect(cursorX, groundY - 2, lineEnd - cursorX, 2);
        }
        cursorX = Math.max(cursorX, hole.end);
        if (cursorX >= canvas.width) break;
      }
      if (cursorX < canvas.width) {
        ctx.fillRect(cursorX, groundY - 2, canvas.width - cursorX, 2);
      }
    }

    obstacles.forEach((obs) => {
      if (obs.type === "hole") {
        drawImageOrRect(obs.spriteKey, obs.x, obs.y, obs.width, obs.height, "#ffffff", "");
      } else {
        drawImageOrRect(obs.spriteKey, obs.x, obs.y, obs.width, obs.height, "#ffb6b6", "WIFE");
      }
    });

    collectibles.forEach((beer) => {
      drawImageOrRect(beer.spriteKey, beer.x, beer.y, beer.width, beer.height, "#f2d56b", "BEER");
    });

    ctx.save();
    if (state === State.PLAYING && wobbleLevel > 0) {
      const sway = Math.sin(now * 0.006) * wobbleLevel;
      const rotate = (config.drunkenness.visualFeedback.playerSway.maxRotationDeg * sway * Math.PI) / 180;
      ctx.translate(player.x + player.width / 2, player.y + player.height / 2);
      ctx.rotate(rotate);
      ctx.translate(-player.width / 2, -player.height / 2);
      drawImageOrRect("player", 0, 0, player.width, player.height, "#7cc8ff", "YOU");
    } else {
      drawImageOrRect("player", player.x, player.y, player.width, player.height, "#7cc8ff", "YOU");
    }
    ctx.restore();

    if (config.rendering.debug.showHitboxes) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 0, 0, 0.35)";
      const playerHitbox = getPlayerHitbox();
      ctx.fillRect(playerHitbox.x, playerHitbox.y, playerHitbox.width, playerHitbox.height);
      obstacles.forEach((obs) => {
        if (obs.type === "wife") {
          const wifeHitbox = getWifeHitbox(obs);
          ctx.fillRect(wifeHitbox.x, wifeHitbox.y, wifeHitbox.width, wifeHitbox.height);
        } else if (obs.type === "hole") {
          const holeHitbox = getHoleHitbox(obs);
          ctx.fillRect(holeHitbox.x, holeHitbox.y, holeHitbox.width, holeHitbox.height);
        }
      });
      ctx.restore();
    }

    ctx.fillStyle = "#222";
    ctx.font = `${config.screen.ui.fontSizePx}px ${config.screen.ui.fontFamily}`;
    ctx.fillText(`SCORE: ${Math.floor(score)}`, config.screen.ui.scorePosition.x, config.screen.ui.scorePosition.y);
    ctx.fillText(`BEST: ${bestScore}`, config.screen.ui.bestScorePosition.x, config.screen.ui.bestScorePosition.y);

    if (state === State.TITLE) {
      ctx.fillStyle = "#111";
    ctx.font = "36px \"Fredoka\", system-ui";
      ctx.textAlign = "center";
      ctx.fillText(config.meta.title, canvas.width / 2, 120);
    ctx.font = "20px \"Fredoka\", system-ui";
      ctx.fillText("SPACE / TAP でジャンプ。ビールをGET！", canvas.width / 2, 150);
      ctx.fillText("SPACE / ENTER でスタート", canvas.width / 2, 175);
      ctx.textAlign = "left";
    } else if (state === State.GAME_OVER) {
      ctx.fillStyle = "#111";
    ctx.font = "32px \"Fredoka\", system-ui";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", canvas.width / 2, 120);
    ctx.font = "20px \"Fredoka\", system-ui";
      ctx.fillText(`SCORE: ${Math.floor(score)} / BEST: ${bestScore}`, canvas.width / 2, 150);
      ctx.fillText("SPACE / ENTER でリトライ", canvas.width / 2, 175);
      ctx.textAlign = "left";
    }

    if (state === State.PLAYING && paused) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.font = "28px \"Fredoka\", system-ui";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "left";
    }

    ctx.restore();
  };

  const loop = (now) => {
    if (!lastTime) lastTime = now;
    const rawDt = (now - lastTime) / 1000;
    const dt = Math.min(rawDt, 0.05);
    lastTime = now;

    update(dt, now);
    render(now);

    requestAnimationFrame(loop);
  };

  const onJumpInput = () => {
    initAudio();
    if (state === State.TITLE) {
      state = State.PLAYING;
      resetGame();
      return;
    }
    if (state === State.GAME_OVER) {
      state = State.PLAYING;
      resetGame();
      return;
    }
    if (state !== State.PLAYING || paused) return;
    scheduleJump(performance.now());
  };

  const onPauseToggle = () => {
    if (!config.controls.pause.enabled) return;
    if (state !== State.PLAYING) return;
    paused = !paused;
  };

  const bindInputs = () => {
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        onJumpInput();
      } else if (event.code === "Enter") {
        onJumpInput();
      } else if (event.code === "KeyP") {
        onPauseToggle();
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      onJumpInput();
    });
  };

  const init = async () => {
    bestScore = getBestScore();
    loadSounds();
    await loadImages();
    state = State.TITLE;
    resetGame();
    canvas.width = config.screen.width;
    canvas.height = config.screen.height;
    canvas.style.width = `${config.screen.width}px`;
    canvas.style.height = `${config.screen.height}px`;
    bindInputs();
    requestAnimationFrame(loop);
  };

  init();
})();
const CONFIG = {
  meta: {
    durationSeconds: 30,
  },
  controls: {
    mobile: {
      tilt: {
        enabled: true,
        source: "deviceorientation",
        sensitivity: 1.0,
        deadzone: 0.03,
        maxTiltRadians: 0.9,
      },
      drink: {
        type: "pointer_hold",
      },
    },
    desktop: {
      tilt: {
        enabled: true,
        source: "keyboard",
        keys: {
          left: ["ArrowLeft", "KeyA"],
          right: ["ArrowRight", "KeyD"],
        },
        angularSpeedRadPerSec: 1.8,
        maxTiltRadians: 0.9,
      },
      drink: {
        type: "keyboard_hold",
        keys: ["Space"],
      },
    },
  },
  ui: {
    palette: {
      bgBlue: "#62A9E6",
      bgCream: "#FFF3DE",
      beer: "#F4B43A",
      beerDark: "#D98D22",
      foam: "#F7F3EA",
      ink: "#1F1B16",
      danger: "#E54B4B",
      success: "#3CB371",
      accent: "#FF7A59",
    },
    feedback: {
      successPop: { enabled: true, text: "+1", bubbleParticles: true, screenShake: 0.15 },
      spillAlert: { enabled: true, rimBlink: true, warningText: "!" },
    },
  },
  gameplay: {
    loopHz: 60,
    difficulty: {
      ramp: {
        everyDrinkCount: 3,
        increase: {
          baseFlowRate: 0.08,
          foamGrowth: 0.06,
          drunkGainMultiplier: 0.08,
        },
      },
    },
    scoring: {
      glassCompletedPoints: 1,
      combo: { enabled: true, resetOnSpill: true, bonusEvery: 5, bonusPoints: 1 },
    },
    penalties: {
      onSpill: { drunkAdd: 0.2, timeSubtractSeconds: 1, cancelCurrentGlass: false },
    },
  },
  physics: {
    tilt: { inertia: 0.12, autoCentering: 0.06 },
    liquid: {
      baseFlowRatePerSec: 0.55,
      flowCurve: { type: "sigmoid", k: 6.0, x0: 0.35 },
      tiltThresholdToPour: 0.18,
      spillThreshold: 0.78,
      stability: { sloshAmplitude: 0.08, sloshFrequency: 1.3 },
    },
    foam: {
      growthPerSecWhileDrinking: 0.28,
      growthPerSecWhileNotDrinking: 0.05,
      spillMultiplierWhenOverfilled: 1.8,
    },
  },
  drunkSystem: {
    enabled: true,
    valueRange: [0, 1],
    decayPerSec: 0.015,
    gain: { perGlassCompleted: 0.12, perSpill: 0.2 },
    levels: [
      {
        id: "sober",
        min: 0.0,
        max: 0.25,
        effects: {
          cameraWobble: 0.0,
          inputLagMs: 0,
          inputJitter: 0.0,
          invertChance: 0.0,
          uiWarp: 0.0,
          ghosting: 0.0,
        },
      },
      {
        id: "tipsy",
        min: 0.25,
        max: 0.5,
        effects: {
          cameraWobble: 0.12,
          inputLagMs: 25,
          inputJitter: 0.02,
          invertChance: 0.0,
          uiWarp: 0.08,
          ghosting: 0.0,
        },
      },
      {
        id: "buzzed",
        min: 0.5,
        max: 0.75,
        effects: {
          cameraWobble: 0.22,
          inputLagMs: 45,
          inputJitter: 0.05,
          invertChance: 0.03,
          uiWarp: 0.16,
          ghosting: 0.08,
        },
      },
      {
        id: "drunk",
        min: 0.75,
        max: 1.0,
        effects: {
          cameraWobble: 0.35,
          inputLagMs: 70,
          inputJitter: 0.09,
          invertChance: 0.06,
          uiWarp: 0.26,
          ghosting: 0.18,
        },
      },
    ],
  },
  glasses: [
    {
      id: "mug",
      label: "ジョッキ",
      weight: 1.2,
      capacity: 1.0,
      stability: 1.1,
      foaminess: 1.0,
      pourSensitivity: 0.85,
      spawnWeight: 0.35,
    },
    {
      id: "pint",
      label: "パイント",
      weight: 1.0,
      capacity: 0.85,
      stability: 1.0,
      foaminess: 0.9,
      pourSensitivity: 1.0,
      spawnWeight: 0.3,
    },
    {
      id: "pilsner",
      label: "ピルスナー",
      weight: 0.9,
      capacity: 0.75,
      stability: 0.9,
      foaminess: 1.05,
      pourSensitivity: 1.15,
      spawnWeight: 0.22,
    },
    {
      id: "flute",
      label: "フルート",
      weight: 0.8,
      capacity: 0.6,
      stability: 0.78,
      foaminess: 1.2,
      pourSensitivity: 1.25,
      spawnWeight: 0.13,
    },
  ],
  spawn: {
    rules: {
      earlyGameBiasSeconds: 8,
      earlyGameAllowed: ["mug", "pint"],
      lateGameAllowed: ["mug", "pint", "pilsner", "flute"],
    },
  },
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const hudTimer = document.getElementById("hud-timer");
const hudScore = document.getElementById("hud-score");
const meterFill = document.getElementById("meter-fill");
const screens = {
  title: document.getElementById("screen-title"),
  howto: document.getElementById("screen-howto"),
  result: document.getElementById("screen-result"),
};
const resultScore = document.getElementById("result-score");
const resultDrunk = document.getElementById("result-drunk");
const resultCombo = document.getElementById("result-combo");
const resultComment = document.getElementById("result-comment");

const btnStart = document.getElementById("btn-start");
const btnHowto = document.getElementById("btn-howto");
const btnHowtoStart = document.getElementById("btn-howto-start");
const btnHowtoBack = document.getElementById("btn-howto-back");
const btnRetry = document.getElementById("btn-retry");
const btnTitle = document.getElementById("btn-title");

const dpr = window.devicePixelRatio || 1;
const state = {
  mode: "title",
  timeLeft: CONFIG.meta.durationSeconds,
  score: 0,
  combo: 0,
  bestCombo: 0,
  maxDrunkLevel: "sober",
  drunkValue: 0,
  drinkCount: 0,
  tiltTarget: 0,
  tiltCurrent: 0,
  drinkHeld: false,
  pointerHeld: false,
  glass: null,
  spillCooldown: 0,
  rimFlash: 0,
  pops: [],
  elapsed: 0,
  inputQueue: [],
  lastKeyboardTime: 0,
};

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d");

const keyboard = {
  left: false,
  right: false,
  drink: false,
};

const deviceOrientation = {
  gamma: 0,
  beta: 0,
  available: false,
};

const commentPool = [
  "いい飲みっぷり！",
  "今日はほどほどで…",
  "完全に出来上がってる！",
  "泡の扱いがプロだね",
];

const isMobileLike =
  window.matchMedia &&
  window.matchMedia("(pointer: coarse)").matches;

function resize() {
  const { innerWidth, innerHeight } = window;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
}

window.addEventListener("resize", resize);
resize();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sigmoid(x, k, x0) {
  return 1 / (1 + Math.exp(-k * (x - x0)));
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.spawnWeight, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const item of items) {
    acc += item.spawnWeight;
    if (r <= acc) return item;
  }
  return items[items.length - 1];
}

function spawnGlass() {
  const rules = CONFIG.spawn.rules;
  const allowedIds =
    state.elapsed < rules.earlyGameBiasSeconds
      ? rules.earlyGameAllowed
      : rules.lateGameAllowed;
  const choices = CONFIG.glasses.filter((g) => allowedIds.includes(g.id));
  const picked = weightedPick(choices);
  state.glass = {
    spec: picked,
    inGlass: 0.1,
    foam: 0.05,
    consumed: 0,
    slosh: 0,
    sloshPhase: 0,
  };
}

function setMode(mode) {
  state.mode = mode;
  Object.values(screens).forEach((screen) => screen.classList.add("hidden"));
  hud.classList.add("hidden");
  if (mode === "title") screens.title.classList.remove("hidden");
  if (mode === "howto") screens.howto.classList.remove("hidden");
  if (mode === "result") screens.result.classList.remove("hidden");
  if (mode === "play") hud.classList.remove("hidden");
}

function resetGame() {
  state.timeLeft = CONFIG.meta.durationSeconds;
  state.score = 0;
  state.combo = 0;
  state.bestCombo = 0;
  state.maxDrunkLevel = "sober";
  state.drunkValue = 0;
  state.drinkCount = 0;
  state.tiltTarget = 0;
  state.tiltCurrent = 0;
  state.drinkHeld = false;
  state.spillCooldown = 0;
  state.rimFlash = 0;
  state.pops = [];
  state.elapsed = 0;
  state.inputQueue = [];
  spawnGlass();
}

btnStart.addEventListener("click", () => {
  requestMotionPermission();
  resetGame();
  setMode("play");
});
btnHowto.addEventListener("click", () => setMode("howto"));
btnHowtoStart.addEventListener("click", () => {
  requestMotionPermission();
  resetGame();
  setMode("play");
});
btnHowtoBack.addEventListener("click", () => setMode("title"));
btnRetry.addEventListener("click", () => {
  resetGame();
  setMode("play");
});
btnTitle.addEventListener("click", () => setMode("title"));

function requestMotionPermission() {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
}

window.addEventListener("deviceorientation", (event) => {
  deviceOrientation.gamma = event.gamma || 0;
  deviceOrientation.beta = event.beta || 0;
  deviceOrientation.available = true;
});

window.addEventListener("keydown", (event) => {
  if (CONFIG.controls.desktop.tilt.keys.left.includes(event.code)) {
    keyboard.left = true;
    state.lastKeyboardTime = performance.now();
  }
  if (CONFIG.controls.desktop.tilt.keys.right.includes(event.code)) {
    keyboard.right = true;
    state.lastKeyboardTime = performance.now();
  }
  if (CONFIG.controls.desktop.drink.keys.includes(event.code)) {
    keyboard.drink = true;
    state.lastKeyboardTime = performance.now();
  }
  if (
    event.code === "Space" ||
    event.code === "ArrowLeft" ||
    event.code === "ArrowRight"
  ) {
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  if (CONFIG.controls.desktop.tilt.keys.left.includes(event.code)) {
    keyboard.left = false;
  }
  if (CONFIG.controls.desktop.tilt.keys.right.includes(event.code)) {
    keyboard.right = false;
  }
  if (CONFIG.controls.desktop.drink.keys.includes(event.code)) {
    keyboard.drink = false;
  }
});

canvas.addEventListener("pointerdown", () => {
  state.pointerHeld = true;
});
canvas.addEventListener("pointerup", () => {
  state.pointerHeld = false;
});
canvas.addEventListener("pointerleave", () => {
  state.pointerHeld = false;
});

function getDrunkLevel(value) {
  return CONFIG.drunkSystem.levels.find(
    (level) => value >= level.min && value < level.max
  );
}

function enqueueInput(value, time) {
  state.inputQueue.push({ value, time });
  if (state.inputQueue.length > 120) {
    state.inputQueue.shift();
  }
}

function consumeLaggedInput(lagMs, now) {
  if (lagMs <= 0) return state.tiltTarget;
  const targetTime = now - lagMs;
  let picked = state.tiltTarget;
  for (const entry of state.inputQueue) {
    if (entry.time <= targetTime) picked = entry.value;
  }
  return picked;
}

function addPop(text, x, y) {
  state.pops.push({
    text,
    x,
    y,
    life: 0.8,
    vy: -30,
    alpha: 1,
  });
}

function formatTime(seconds) {
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mm}:${ss}`;
}

function updateInput(dt) {
  const desktop = CONFIG.controls.desktop;
  const now = performance.now();
  const keyboardActive = now - state.lastKeyboardTime < 1200;
  const useDevice = isMobileLike && deviceOrientation.available && !keyboardActive;

  const maxTilt = desktop.tilt.maxTiltRadians;
  if (useDevice) {
    let tilt = clamp(deviceOrientation.gamma / 45, -1, 1);
    const deadzone = CONFIG.controls.mobile.tilt.deadzone;
    if (Math.abs(tilt) < deadzone) tilt = 0;
    tilt *= CONFIG.controls.mobile.tilt.sensitivity;
    state.tiltTarget = clamp(tilt, -1, 1) * maxTilt;
  } else {
    let direction = 0;
    if (keyboard.left) direction -= 1;
    if (keyboard.right) direction += 1;
    if (direction !== 0) {
      state.tiltTarget += direction * desktop.tilt.angularSpeedRadPerSec * dt;
    } else {
      state.tiltTarget = lerp(state.tiltTarget, 0, dt * 4);
    }
    state.tiltTarget = clamp(state.tiltTarget, -maxTilt, maxTilt);
  }

  enqueueInput(state.tiltTarget, performance.now());

  state.drinkHeld = keyboard.drink || state.pointerHeld;
}

function updateGame(dt) {
  if (state.mode !== "play") return;
  state.elapsed += dt;
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  if (state.timeLeft <= 0) {
    finishGame();
    return;
  }

  const level = getDrunkLevel(state.drunkValue);
  if (level) state.maxDrunkLevel = level.id;

  const effects = level ? level.effects : CONFIG.drunkSystem.levels[0].effects;
  const now = performance.now();
  const laggedTilt = consumeLaggedInput(effects.inputLagMs, now);

  let tilt = laggedTilt;
  if (Math.random() < effects.invertChance * dt) {
    tilt *= -1;
  }
  if (effects.inputJitter > 0) {
    tilt += (Math.random() * 2 - 1) * effects.inputJitter;
  }

  const smoothing = 1 - Math.exp(-dt * 6 / CONFIG.physics.tilt.inertia);
  state.tiltCurrent = lerp(state.tiltCurrent, tilt, smoothing);
  state.tiltCurrent *= 1 - CONFIG.physics.tilt.autoCentering * dt;

  const absTilt = Math.abs(state.tiltCurrent);
  const glass = state.glass;
  if (!glass) return;

  const rampCount = Math.floor(
    state.drinkCount / CONFIG.gameplay.difficulty.ramp.everyDrinkCount
  );
  const baseFlowRate =
    CONFIG.physics.liquid.baseFlowRatePerSec +
    rampCount * CONFIG.gameplay.difficulty.ramp.increase.baseFlowRate;
  const foamRamp =
    rampCount * CONFIG.gameplay.difficulty.ramp.increase.foamGrowth;
  const drunkRamp =
    rampCount * CONFIG.gameplay.difficulty.ramp.increase.drunkGainMultiplier;

  let pour = 0;
  if (absTilt >= CONFIG.physics.liquid.tiltThresholdToPour) {
    pour =
      baseFlowRate *
      sigmoid(absTilt, CONFIG.physics.liquid.flowCurve.k, CONFIG.physics.liquid.flowCurve.x0) *
      glass.spec.pourSensitivity;
  }

  let drinkRate = 0;
  if (state.drinkHeld) {
    drinkRate = 0.85 * (1 + glass.spec.weight * 0.1);
  }

  const poured = pour * dt;
  const drank = Math.min(glass.inGlass, drinkRate * dt);

  glass.inGlass = clamp(glass.inGlass + poured - drank, 0, 1.2);
  glass.consumed += drank;

  const foamGrowthBase = state.drinkHeld
    ? CONFIG.physics.foam.growthPerSecWhileDrinking
    : CONFIG.physics.foam.growthPerSecWhileNotDrinking;
  glass.foam +=
    foamGrowthBase * (1 + foamRamp) * glass.spec.foaminess * dt;
  glass.foam = clamp(glass.foam, 0, 1.2);
  if (state.drinkHeld) {
    glass.foam *= 1 - 0.35 * dt;
  }

  const overfill = Math.max(0, glass.inGlass + glass.foam - 1);
  const tiltSpill = Math.max(0, absTilt - CONFIG.physics.liquid.spillThreshold);
  const spillRate =
    overfill * CONFIG.physics.foam.spillMultiplierWhenOverfilled +
    tiltSpill * 1.4;

  if (spillRate > 0) {
    glass.inGlass = clamp(glass.inGlass - spillRate * dt, 0, 1.2);
    glass.foam = clamp(glass.foam - spillRate * dt, 0, 1.2);
  }

  if (spillRate > 0 && state.spillCooldown <= 0) {
    state.spillCooldown = 0.6;
    state.rimFlash = 0.5;
    state.combo = CONFIG.gameplay.scoring.combo.resetOnSpill ? 0 : state.combo;
    const penalty = CONFIG.gameplay.penalties.onSpill;
    state.timeLeft = Math.max(0, state.timeLeft - penalty.timeSubtractSeconds);
    state.drunkValue = clamp(
      state.drunkValue + (penalty.drunkAdd + CONFIG.drunkSystem.gain.perSpill) * (1 + drunkRamp),
      0,
      1
    );
  }

  state.spillCooldown = Math.max(0, state.spillCooldown - dt);
  state.rimFlash = Math.max(0, state.rimFlash - dt);

  glass.sloshPhase += dt * CONFIG.physics.liquid.stability.sloshFrequency;
  glass.slosh =
    Math.sin(glass.sloshPhase) * CONFIG.physics.liquid.stability.sloshAmplitude;

  if (glass.consumed >= glass.spec.capacity && glass.inGlass <= 0.05) {
    state.score += CONFIG.gameplay.scoring.glassCompletedPoints;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    state.drinkCount += 1;
    const bonus =
      CONFIG.gameplay.scoring.combo.enabled &&
      state.combo % CONFIG.gameplay.scoring.combo.bonusEvery === 0
        ? CONFIG.gameplay.scoring.combo.bonusPoints
        : 0;
    if (bonus > 0) state.score += bonus;
    if (CONFIG.ui.feedback.successPop.enabled) {
      addPop(`+${1 + bonus}`, canvas.width * 0.5, canvas.height * 0.35);
    }
    state.drunkValue = clamp(
      state.drunkValue +
        CONFIG.drunkSystem.gain.perGlassCompleted * (1 + drunkRamp),
      0,
      1
    );
    spawnGlass();
  }

  state.drunkValue = clamp(
    state.drunkValue - CONFIG.drunkSystem.decayPerSec * dt,
    0,
    1
  );

  updatePops(dt);
}

function updatePops(dt) {
  state.pops.forEach((pop) => {
    pop.life -= dt;
    pop.y += pop.vy * dt;
    pop.alpha = clamp(pop.life / 0.8, 0, 1);
  });
  state.pops = state.pops.filter((pop) => pop.life > 0);
}

function finishGame() {
  resultScore.textContent = `SCORE ${state.score}`;
  resultDrunk.textContent = `MAX DRUNK: ${state.maxDrunkLevel}`;
  resultCombo.textContent = `BEST COMBO: ${state.bestCombo}`;
  resultComment.textContent =
    commentPool[Math.floor(Math.random() * commentPool.length)];
  setMode("result");
}

function drawBackground(ctx, width, height) {
  ctx.fillStyle = CONFIG.ui.palette.bgBlue;
  ctx.fillRect(0, 0, width, height);
  const flagHeight = height * 0.12;
  ctx.fillStyle = CONFIG.ui.palette.accent;
  for (let i = 0; i < 6; i += 1) {
    const x = (width / 6) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + width / 12, flagHeight);
    ctx.lineTo(x + width / 6, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 12; i += 1) {
    const r = (Math.sin(i * 7.3) * 0.5 + 0.5) * 14 + 10;
    ctx.beginPath();
    ctx.arc(
      (width / 12) * i + 20,
      height * 0.65 + Math.cos(i) * 30,
      r,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function getGlassRect(width, height) {
  const size = Math.min(width, height) * 0.55;
  return {
    x: width * 0.5 - size * 0.32,
    y: height * 0.18,
    w: size * 0.64,
    h: size,
  };
}

function drawGlass(ctx, glass, rect) {
  const { x, y, w, h } = rect;
  ctx.save();
  ctx.lineWidth = 6 * dpr;
  ctx.strokeStyle = CONFIG.ui.palette.ink;
  ctx.fillStyle = CONFIG.ui.palette.bgCream;

  const path = new Path2D();
  if (glass.spec.id === "mug") {
    path.rect(x, y, w, h);
  } else if (glass.spec.id === "pint") {
    path.moveTo(x + w * 0.1, y);
    path.lineTo(x + w * 0.9, y);
    path.lineTo(x + w, y + h);
    path.lineTo(x, y + h);
    path.closePath();
  } else if (glass.spec.id === "pilsner") {
    path.moveTo(x + w * 0.2, y);
    path.lineTo(x + w * 0.8, y);
    path.lineTo(x + w * 0.6, y + h);
    path.lineTo(x + w * 0.4, y + h);
    path.closePath();
  } else {
    path.moveTo(x + w * 0.35, y);
    path.lineTo(x + w * 0.65, y);
    path.lineTo(x + w * 0.6, y + h * 0.75);
    path.lineTo(x + w * 0.4, y + h * 0.75);
    path.closePath();
  }

  ctx.fill(path);
  ctx.stroke(path);

  if (glass.spec.id === "mug") {
    ctx.beginPath();
    ctx.arc(x + w * 1.1, y + h * 0.4, w * 0.25, -0.6, 0.6);
    ctx.stroke();
  }

  ctx.save();
  ctx.clip(path);
  const liquidHeight = h * clamp(glass.inGlass, 0, 1);
  const foamHeight = h * clamp(glass.foam, 0, 0.3);
  ctx.fillStyle = CONFIG.ui.palette.beer;
  ctx.fillRect(x, y + h - liquidHeight, w, liquidHeight);
  ctx.fillStyle = CONFIG.ui.palette.beerDark;
  ctx.fillRect(x, y + h - liquidHeight, w, liquidHeight * 0.2);
  ctx.fillStyle = CONFIG.ui.palette.foam;
  ctx.fillRect(x, y + h - liquidHeight - foamHeight, w, foamHeight);

  const slosh = glass.slosh * h;
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(x, y + h - liquidHeight - slosh, w, h * 0.03);
  ctx.restore();
  ctx.restore();
}

function drawCharacter(ctx, width, height, levelId) {
  const baseX = width * 0.18;
  const baseY = height * 0.72;
  const headR = Math.min(width, height) * 0.08;

  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.fillStyle = CONFIG.ui.palette.bgCream;
  ctx.strokeStyle = CONFIG.ui.palette.ink;
  ctx.lineWidth = 6 * dpr;

  ctx.beginPath();
  ctx.arc(0, 0, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = CONFIG.ui.palette.beer;
  ctx.beginPath();
  ctx.arc(0, headR * 1.2, headR * 0.7, 0, Math.PI);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = CONFIG.ui.palette.ink;
  ctx.lineWidth = 4 * dpr;
  const eyeY = -headR * 0.2;
  const eyeOffset = headR * 0.35;
  if (levelId === "drunk") {
    ctx.beginPath();
    ctx.moveTo(-eyeOffset, eyeY);
    ctx.lineTo(-eyeOffset * 0.4, eyeY + headR * 0.2);
    ctx.moveTo(eyeOffset, eyeY);
    ctx.lineTo(eyeOffset * 0.4, eyeY + headR * 0.2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(-eyeOffset, eyeY, headR * 0.08, 0, Math.PI * 2);
    ctx.arc(eyeOffset, eyeY, headR * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.ui.palette.ink;
    ctx.fill();
  }

  ctx.strokeStyle = CONFIG.ui.palette.ink;
  ctx.beginPath();
  if (levelId === "buzzed" || levelId === "drunk") {
    ctx.arc(0, headR * 0.25, headR * 0.35, 0, Math.PI);
  } else {
    ctx.arc(0, headR * 0.35, headR * 0.25, 0, Math.PI);
  }
  ctx.stroke();

  if (levelId === "tipsy" || levelId === "buzzed" || levelId === "drunk") {
    ctx.fillStyle = CONFIG.ui.palette.accent;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(-headR * 0.5, headR * 0.1, headR * 0.15, 0, Math.PI * 2);
    ctx.arc(headR * 0.5, headR * 0.1, headR * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function render() {
  const width = canvas.width;
  const height = canvas.height;
  const level = getDrunkLevel(state.drunkValue);
  const effects = level ? level.effects : CONFIG.drunkSystem.levels[0].effects;
  ctx.save();

  if (effects.ghosting > 0) {
    ctx.globalAlpha = effects.ghosting * 0.6;
    ctx.drawImage(offscreen, 0, 0);
    ctx.globalAlpha = 1;
  }

  const wobble = effects.cameraWobble;
  const wobbleAngle = Math.sin(state.elapsed * 2.4) * wobble * 0.08;
  const wobbleX = Math.sin(state.elapsed * 1.7) * wobble * 12 * dpr;
  const wobbleY = Math.cos(state.elapsed * 1.2) * wobble * 8 * dpr;

  ctx.translate(wobbleX, wobbleY);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(wobbleAngle);
  ctx.translate(-width / 2, -height / 2);

  drawBackground(ctx, width, height);

  const rect = getGlassRect(width, height);
  drawGlass(ctx, state.glass, rect);
  drawCharacter(ctx, width, height, level ? level.id : "sober");

  if (state.rimFlash > 0) {
    ctx.strokeStyle = CONFIG.ui.palette.danger;
    ctx.lineWidth = 8 * dpr;
    ctx.strokeRect(12 * dpr, 12 * dpr, width - 24 * dpr, height - 24 * dpr);
  }

  ctx.restore();

  renderPops();

  offCtx.clearRect(0, 0, width, height);
  offCtx.drawImage(canvas, 0, 0);
}

function renderPops() {
  state.pops.forEach((pop) => {
    ctx.save();
    ctx.globalAlpha = pop.alpha;
    ctx.fillStyle = CONFIG.ui.palette.success;
    ctx.font = `${28 * dpr}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(pop.text, pop.x, pop.y);
    ctx.restore();
  });
}

function updateHud() {
  hudTimer.textContent = `TIME ${formatTime(state.timeLeft)}`;
  hudScore.textContent = `SCORE ${state.score}`;
  meterFill.style.width = `${Math.round(state.drunkValue * 100)}%`;
  const level = getDrunkLevel(state.drunkValue);
  const effects = level ? level.effects : CONFIG.drunkSystem.levels[0].effects;
  const warp = 1 + Math.sin(state.elapsed * 3.4) * effects.uiWarp * 0.15;
  hud.style.transform = `scale(${warp})`;
}

let lastTime = performance.now();
function tick(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  updateInput(dt);
  updateGame(dt);
  if (state.mode === "play") updateHud();
  render();
  requestAnimationFrame(tick);
}

setMode("title");
spawnGlass();
requestAnimationFrame(tick);
