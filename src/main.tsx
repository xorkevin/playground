import '@fontsource-variable/inter/standard.css';
import '@/styles/main.css';
import '@xorkevin/nuke/styles/normalize.css';
import '@xorkevin/nuke/styles/typography.css';

import {createRoot} from 'react-dom/client';

import {
  BrowserColorSchemeManager,
  ColorSchemeProvider,
} from '@xorkevin/nuke/component/text';
import {
  BrowserBodyClassListManager,
  BrowserMediaMatcher,
} from '@xorkevin/nuke/dom';
import {Router} from '@xorkevin/nuke/router';
import {BrowserLocalStorage} from '@xorkevin/nuke/storage';

import App from './app.js';

const browserColorSchemeManager = new BrowserColorSchemeManager(
  new BrowserLocalStorage(),
  new BrowserMediaMatcher(),
  new BrowserBodyClassListManager(),
);

const controller = new AbortController();
browserColorSchemeManager.init(controller.signal);

const appelement = document.getElementById('app');
if (appelement) {
  const root = createRoot(appelement);
  root.render(
    <ColorSchemeProvider value={browserColorSchemeManager}>
      <Router>
        <App />
      </Router>
    </ColorSchemeProvider>,
  );
} else {
  console.error('Element with id app missing');
}
