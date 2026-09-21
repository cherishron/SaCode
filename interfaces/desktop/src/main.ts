import { DesktopApp } from './app/service.ts';
import { mountApp } from './app/ui.ts';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app missing');

const app = new DesktopApp();
mountApp(root, app);
