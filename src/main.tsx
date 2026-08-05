import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// Self-hosted fonts (replaces the Google Fonts CDN <link> tags that used to
// live in index.html) — this is what let helmet's CSP be turned on below,
// since the app no longer needs to allow an external font-CDN origin.
// Material Symbols is pinned to the static 400-weight cut, not the full
// variable-axis package: index.css's `.material-symbols-outlined` rule only
// ever sets a single fixed point (wght 400, FILL 0, GRAD 0, opsz 24), so the
// continuous variable axes the full package ships were never exercised.
// Each package's bare/index.css only ships the normal (non-italic) cut —
// the wght-italic.css import below is needed too since a few spots in the
// app (e.g. empty-state helper text) use italic.
import '@fontsource-variable/hanken-grotesk/wght.css';
import '@fontsource-variable/hanken-grotesk/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import '@fontsource/material-symbols-outlined/400.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
