import { Game } from './game.js';

window.__sfBooted = true;
const game = new Game(document.getElementById('game'), document.getElementById('ui'));
window.game = game; // handy for debugging and automated playtests
game.boot();
