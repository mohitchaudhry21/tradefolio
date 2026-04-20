import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import * as XLSX from 'xlsx';

// Expose XLSX globally so Journal export can use it without re-bundling
window._XLSX = XLSX;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
