import React from 'react';
import { createRoot } from 'react-dom/client';
import AccessGate from './AccessGate';
import App from './App';
import './styles.css';

const root = document.getElementById('root') as HTMLElement;
createRoot(root).render(
  <React.StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </React.StrictMode>
);
