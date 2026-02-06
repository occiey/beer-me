(() => {
  window.BEER_DINO_CONFIG = {
    meta: {
      title: "Beer Dino Runner",
      targetFps: 60,
      version: "0.1.0",
    },
    screen: {
      width: 1200,
      height: 400,
      groundY: 320,
      backgroundColor: "#ffffff",
      ui: {
        fontFamily: "\"Fredoka\", system-ui",
        fontSizePx: 24,
        scorePosition: { x: 24, y: 40 },
        bestScorePosition: { x: 24, y: 70 },
        tipsPosition: { x: 24, y: 100 },
      },
    },
    assets: {
      sprites: {
        player: "assets/placeholder_player_100.png",
        beer: "assets/placeholder_beer_100.png",
        wife_obstacle: "assets/placeholder_wife_100.png",
        hole: "assets/placeholder_hole_100.png",
        ground_tile: "assets/placeholder_ground_100.png",
        background: "assets/placeholder_bg.png",
      },
      sounds: {
        bgm: "assets/bgm_loop.mp3",
        jump: "assets/sfx_jump.wav",
        burp: "assets/sfx_burp.wav",
        scream: "assets/sfx_scream.wav",
        fall: "assets/sfx_fall.wav",
        game_over: "assets/sfx_gameover.wav",
      },
    },
    controls: {
      jump: {
        inputs: ["Space", "ArrowUp", "PointerTap"],
        bufferMs: 120,
        coyoteTimeMs: 90,
      },
      pause: {
        inputs: ["KeyP"],
        enabled: true,
      },
    },
    gameplay: {
      score: {
        distancePointsPerSecond: 10,
        beerBonusPoints: 50,
        displayRounding: "floor",
        bestScorePersistence: "localStorage",
      },
      difficulty: {
        speed: {
          startPxPerSec: 380,
          maxPxPerSec: 980,
          accelPxPerSec2: 28,
        },
        spawn: {
          beerSpawnIntervalMs: { min: 700, max: 1600 },
          wifeSpawnIntervalMs: { min: 1300, max: 2800 },
          holeSpawnIntervalMs: { min: 1600, max: 3200 },
          dynamicAdjustment: {
            minIntervalMultiplierAtMaxSpeed: 0.6,
          },
        },
      },
    },
    physics: {
      gravityPxPerSec2: 2800,
      player: {
        width: 140,
        height: 140,
        startX: 160,
        startY: 180,
        hitboxInset: { left: 35, right: 35, top: 35, bottom: 35 },
        jump: { velocityPxPerSec: -1040 },
      },
      world: { groundY: 320 },
    },
    drunkenness: {
      level: { min: 0, max: 100, start: 0 },
      increase: { perBeer: 12 },
      decay: { enabled: true, perSecond: 1.2 },
      jumpDelay: {
        maxDelayMs: 0,
        maxJitterMs: 0,
      },
      visualFeedback: {
        screenWobble: { maxRotationDeg: 1.5, maxOffsetPx: 6 },
        playerSway: { maxRotationDeg: 0 },
      },
    },
    entities: {
      beer: {
        id: "beer",
        type: "collectible",
        spriteKey: "beer",
        size: { w: 120, h: 120 },
        spawn: { yMin: 170, yMax: 200, xMargin: 120 },
      },
      wife: {
        id: "wife",
        type: "obstacle",
        spriteKey: "wife_obstacle",
        size: { w: 140, h: 140 },
        hitboxInset: { left: 20, right: 20, top: 20, bottom: 20 },
        spawn: { y: 180, xMargin: 170 },
      },
      hole: {
        id: "hole",
        type: "obstacle",
        spriteKey: "hole",
        size: { w: 140, h: 56 },
        spawn: { y: 320, xMargin: 200 },
        special: { gapWidthPx: 140, hitboxHeightPx: 20 },
      },
    },
    spawningRules: {
      minReactionTimeMs: 420,
      minSpacingPx: 300,
      beerClearancePx: 110,
    },
    rendering: {
      ground: {
        useTiledSprite: true,
        tileSizePx: 140,
        scrollsWithSpeed: true,
      },
      debug: {
        showHitboxes: true,
      },
    },
  };
})();
