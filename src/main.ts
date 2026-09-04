import './style.css';
import { Game } from './game';

const game = new Game();
game.init().catch(error => {
  console.error('The game could not start:', error);
  const loading = document.getElementById('loading');
  if (loading) loading.innerHTML = '<strong>THE FIELD COULD NOT LOAD</strong><span>WebGL 2 is required. Try a current Chrome, Edge, or Firefox browser.</span><button onclick="location.reload()">TRY AGAIN</button>';
});
