import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { IdentityProvider } from './features/identity/IdentityProvider';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <IdentityProvider>
      <App />
    </IdentityProvider>
  </React.StrictMode>,
);
