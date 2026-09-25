/* Regresiones de pausa y cargas de escenas. No requieren DOM ni recursos de red. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = async function (UG, h) {
  const { test, testAsync, A, section } = h;
  section('Ciclo de vida del juego y de las escenas');

  function withDocument(hidden, fn) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { hidden } });
    try { fn(); }
    finally {
      if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
      else delete globalThis.document;
    }
  }

  function makeLoop(pauseOnHidden, fixedStep) {
    const game = { config: { pauseOnHidden }, updates: 0, renders: 0,
      update() { this.updates++; }, render() { this.renders++; }, _reportError(e) { throw e; } };
    const loop = new UG.GameLoop(game, { fixedStep: fixedStep || 0 });
    loop.running = true;
    loop._schedule = function () {};
    const tick = () => { loop.lastTime = UG.Utils.now() - 25; loop.tick(); };
    return { game, loop, tick };
  }

  test('pauseOnHidden detiene el tiempo, updates y renders hasta volver a la pestaña', () => {
    withDocument(true, () => {
      const { game, loop, tick } = makeLoop(true, 0.01);
      loop._acc = 9; loop._limAcc = 9;
      for (let i = 0; i < 20; i++) tick();
      A.eq(game.updates, 0); A.eq(game.renders, 0); A.eq(loop.time, 0);
      A.eq(loop._acc, 0); A.eq(loop._limAcc, 0);
      document.hidden = false;
      tick();
      A.eq(game.updates, 2); A.eq(game.renders, 1); A.eq(loop.time, 20);
    });
  });

  test('volver a una pestaña no quita una pausa manual', () => {
    withDocument(true, () => {
      const { game, loop, tick } = makeLoop(true);
      loop.pause(); tick(); document.hidden = false; tick();
      A.eq(game.updates, 0); A.eq(loop.paused, true);
      loop.resume(); tick();
      A.eq(game.updates, 1);
    });
  });

  test('pauseOnHidden false permite simulación en segundo plano', () => {
    withDocument(true, () => {
      const { game, tick } = makeLoop(false);
      tick(); A.eq(game.updates, 1); A.eq(game.renders, 1);
    });
  });

  test('un error durante update no deja el juego marcado dentro de un frame', () => {
    const game = new UG.EventEmitter();
    game.frame = 0;
    game.input = { preUpdate() {} };
    game.scene = { update() { throw new Error('fallo de escena esperado'); } };
    game.anims = { update() {} };
    A.throws(() => UG.Game.prototype.update.call(game, 10, 10));
    A.eq(game._inStep, false);
  });

  function makeSceneGame(definition) {
    const game = Object.assign(new UG.EventEmitter(), {
      width: 800, height: 600, config: { loaderUI: false },
      cache: new UG.CacheManager(), textures: {}, sound: {},
      _reportError(e) { throw e; }
    });
    game.input = new UG.InputManager(game, {});
    game.scene = new UG.SceneManager(game, [definition]);
    game.scene.boot();
    return game;
  }

  await testAsync('reiniciar durante preload ignora la promesa de la carga cancelada', async () => {
    const loads = [];
    let creates = 0;
    const game = makeSceneGame({
      key: 'Play',
      preload() {
        this.load.json('pending', 'never-fetched.json');
        this.load._load = () => new Promise(resolve => loads.push(resolve));
      },
      create() { creates++; }
    });
    try {
      const scene = game.scene.getScene('Play');
      game.scene.start('Play'); game.scene.update(0, 16);
      A.eq(loads.length, 2);
      await Promise.resolve();
      A.eq(creates, 0, 'la promesa cancelada no debe crear la nueva escena');
      A.eq(scene.sys.status, 'loading');
      loads[0]();
      await new Promise(setImmediate);
      A.eq(creates, 0, 'tampoco debe crearla el recurso antiguo al terminar');
      loads[1]();
      await new Promise(setImmediate);
      A.eq(creates, 1); A.eq(scene.sys.status, 'running');
    } finally { game.scene.destroy(); game.input.destroy(); loads.forEach(resolve => resolve()); }
  });

  await testAsync('detener una escena en preload impide create al completar la carga', async () => {
    let finish, creates = 0;
    const game = makeSceneGame({
      key: 'Play',
      preload() {
        this.load.json('pending', 'never-fetched.json');
        this.load._load = () => new Promise(resolve => { finish = resolve; });
      },
      create() { creates++; }
    });
    try {
      game.scene.stop('Play'); game.scene.update(0, 16);
      finish(); await new Promise(setImmediate);
      A.eq(creates, 0); A.eq(game.scene.getScene('Play').sys.status, 'shutdown');
    } finally { game.scene.destroy(); game.input.destroy(); if (finish) finish(); }
  });

  function miniGames(api) {
    const context = { window: {}, location: { search: '' }, navigator: {}, URLSearchParams, UG: api || UG };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../minigames/common.js'), 'utf8'), context);
    const MG = context.window.MG;
    MG.text = () => ({ y: 0 });
    MG.best = () => 0;
    return MG;
  }

  function fakeUI(scene) {
    scene.buttons = [];
    scene.add = scene.add || {};
    scene.add.rectangle = scene.add.panel = () => ({ visible: true, destroy() {} });
    scene.add.button = (x, y, config) => { scene.buttons.push(config); return { visible: true, destroy() {} }; };
  }

  test('Menú y GameOver solicitan una sola transición por apertura, incluso con clic y teclado juntos', () => {
    const MG = miniGames(); MG.hudButtons = () => {};
    for (const definition of [MG.menu({ id: 'test' }), MG.gameOver({ id: 'test' })]) {
      const starts = [];
      const scene = { game: { width: 800, height: 600 },
        sound: { unlock() {}, playSfx() {} }, tweens: { add() {} },
        scene: { start(key) { starts.push(key); } } };
      for (let visit = 0; visit < 2; visit++) {
        fakeUI(scene); scene.input = { keyboard: new UG.EventEmitter() };
        definition.create.call(scene, { score: 0 });
        scene.buttons[0].onClick();
        scene.input.keyboard.emit('keydown-ENTER');
        scene.input.keyboard.emit('keydown-SPACE');
        scene.buttons[scene.buttons.length - 1].onClick();
        A.eq(starts.length, visit + 1); A.eq(starts[visit], 'Play');
      }
    }
  });

  test('pausa: solicitudes antes del frame no se duplican y P/ESC reanudan sin volver a pausar', () => {
    const MG = miniGames();
    let pauseCreates = 0;
    const game = makeSceneGame({ key: 'Play', create() {
      this.input.keyboard.on('keydown-P', () => MG.togglePause(this));
      this.input.keyboard.on('keydown-ESC', () => MG.togglePause(this));
    } });
    const play = game.scene.getScene('Play');
    game.scene.add('Pausa', { create(data) { pauseCreates++; fakeUI(this); MG.PauseScene.create.call(this, data); } });
    const press = code => game.input._dispatchKey('keydown', { code }, {});
    try {
      for (const code of ['KeyP', 'Escape']) {
        press(code); MG.togglePause(play);
        A.eq(game.scene._queue.length, 1, 'solo se lanza una pausa');
        game.scene.update(0, 16);
        A.eq(game.scene.isActive('Pausa'), true);
        A.eq(game.scene.isPaused('Play'), true);
        press(code); press(code);
        A.eq(game.scene._queue.length, 1, 'reanudar solo detiene la pausa una vez');
        game.scene.update(0, 16);
        A.eq(game.scene.isActive('Play'), true);
        A.eq(game.scene.isActive('Pausa'), false);
      }
      A.eq(pauseCreates, 2, 'la protección se reinicia al abrir otra pausa');
    } finally { game.scene.destroy(); game.input.destroy(); }
  });

  test('los botones del HUD ignoran clic derecho y central', () => {
    class GraphicsStub {
      fillStyle() { return this; } fillRoundedRect() { return this; }
      lineStyle() { return this; } strokeRoundedRect() { return this; }
    }
    class TextStub { setOrigin() { return this; } }
    const MG = miniGames(Object.assign({}, UG, { Graphics: GraphicsStub, Text: TextStub }));
    let pauses = 0, sounds = 0;
    MG.togglePause = () => pauses++;
    const scene = { game: { width: 800, sound: {} }, sound: { playSfx() { sounds++; } },
      input: { keyboard: new UG.EventEmitter() }, add: { hud: { container() {
        return Object.assign(new UG.EventEmitter(), { add() {}, setInteractive() {} });
      } } } };
    const pauseButton = MG.hudButtons(scene, { back: false })[0];
    pauseButton.emit('pointertap', { type: 'mouse', button: 2 });
    pauseButton.emit('pointertap', { type: 'mouse', button: 1 });
    A.eq(pauses, 0); A.eq(sounds, 0);
    pauseButton.emit('pointertap', { type: 'mouse', button: 0 });
    pauseButton.emit('pointertap', { type: 'touch', button: 0 });
    A.eq(pauses, 2); A.eq(sounds, 2);
  });
};
