import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
console.log("VITE_API_BASE =", import.meta.env.VITE_API_BASE);
console.log("VITE_TENANT   =", import.meta.env.VITE_TENANT);
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
