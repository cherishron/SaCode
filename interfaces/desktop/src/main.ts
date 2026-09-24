import { DesktopApp } from './app/service.ts';
import { mountApp } from './app/ui.ts';

import './styles/base.css';
import './components/components.css';
import './app/app-shell.css';
import './app/top-bar.css';
import './app/rail.css';
import './app/sidebar.css';
import './app/conversation.css';
import './app/context-panel.css';
import './app/status-bar.css';
import './app/sadesign.css';
import './app/splash.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app missing');

const app = new DesktopApp();
mountApp(root, app);
