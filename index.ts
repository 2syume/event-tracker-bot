import { startBot } from './src/bot';
import { setDebug } from './src/debug';

if (process.argv.includes('--debug')) setDebug(true);

startBot();
