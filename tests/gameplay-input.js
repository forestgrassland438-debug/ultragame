'use strict';
(async function () {
  const log = document.getElementById('log'); log.textContent = '';
  let passed = 0, failed = 0;
  const report = (message) => { log.textContent += message + '\n'; };
  const check = (ok, message) => { if (!ok) throw new Error(message); passed++; report('OK: ' + message); };
  const delay = () => new Promise(resolve => setTimeout(resolve, 20));
  for (const id of ['shooter', 'city']) {
    const frame = document.createElement('iframe');
    frame.src = '../games3d/' + id + '/index.html?r=webgl2';
    const loaded = new Promise(resolve => { frame.onload = resolve; });
    document.getElementById('games').appendChild(frame);
    let game;
    try {
      await loaded;
      const w = frame.contentWindow;
      for (let i = 0; i < 500 && !(w.game && w.game.scene && w.game.scene.isActive('Menu')); i++) await delay();
      game = w.game;
      check(game && game.scene.isActive('Menu'), id + ': menú inicial');
      game.loop.stop(); game.sound.mute = true;
      let starts = 0;
      game.on('scenecreate', scene => { if (scene.key === 'Play') starts++; });
      const step = n => { for (let i = 0; i < n; i++) game.loop.step(16); };
      const key = code => {
        w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
        w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true }));
      };
      key('Enter'); step(1);
      for (let i = 0; i < 500 && !game.scene.isActive('Play'); i++) { await delay(); step(1); }
      check(game.scene.isActive('Play') && starts === 1, id + ': una sola partida al empezar');
      const play = game.scene.getScene('Play'), player = play.player || play.ch;
      const canvas = game.canvas, rect = canvas.getBoundingClientRect();
      const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true };
      const mouse = (type, button, buttons) => {
        const target = type === 'mousedown' ? canvas : w;
        target.dispatchEvent(new w.MouseEvent(type, Object.assign({}, point, { button, buttons })));
      };
      const context = new w.MouseEvent('contextmenu', Object.assign({}, point, { button: 2, buttons: 2 }));
      canvas.dispatchEvent(context);
      check(context.defaultPrevented, id + ': clic derecho no abre menú contextual');
      // El navegador sólo emite pointerdown para el primer botón; el segundo usa mousedown.
      canvas.dispatchEvent(new w.PointerEvent('pointerdown', Object.assign({}, point, { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2 })));
      mouse('mousedown', 2, 2); step(2);
      check(play.mouse.right && !play.mouse.left, id + ': botón derecho independiente');
      const ammo = id === 'shooter' ? play.player.A.mag : 0;
      mouse('mousedown', 0, 3); step(16);
      check(play.mouse.left && play.mouse.right, id + ': ambos botones simultáneos');
      if (id === 'shooter') check(play.player.aim > 0.5 && play.player.A.mag < ammo, 'shooter: dispara mientras apunta');
      mouse('mouseup', 0, 2); step(2);
      check(!play.mouse.left && play.mouse.right, id + ': soltar disparo conserva apuntado');
      mouse('mousedown', 0, 3); mouse('mouseup', 2, 1); step(2);
      check(play.mouse.left && !play.mouse.right, id + ': soltar apuntado conserva disparo');
      w.dispatchEvent(new w.Event('blur')); step(2);
      check(!play.mouse.left && !play.mouse.right, id + ': perder foco cancela botones');
      key('Space'); step(180);
      check(starts === 1 && game.scene.isActive('Play') && (play.player || play.ch) === player, id + ': saltar y avanzar no reinicia la partida');
      key('KeyP'); step(2);
      check(game.scene.isPaused('Play'), id + ': pausa');
      key('KeyP'); step(2);
      check(game.scene.isActive('Play') && starts === 1 && (play.player || play.ch) === player, id + ': reanudar conserva la partida');
    } catch (error) { failed++; report('FALLO ' + id + ': ' + error.message); }
    finally { if (game) game.destroy(true); frame.remove(); }
  }
  report('TERMINADO: ' + passed + ' correctas, ' + failed + ' fallidas');
})();
