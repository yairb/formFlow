import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { sessions } from '@/app/sessions';
import { setupPdfjsForBrowser } from '@/pdf/browserSetup';
import { signatures } from '@/state/signatures';
import { ensureDocumentFonts } from '@/text/fontAssets';
import { App } from './App';
import './styles/index.css';

setupPdfjsForBrowser();
// Warm up in the background; opening a document awaits them anyway.
void ensureDocumentFonts().catch(() => {});
void sessions.init();
void signatures().load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
