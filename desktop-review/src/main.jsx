import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReviewApp from './ReviewApp.jsx';
import './review.css';
import './mobile.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReviewApp />
  </StrictMode>,
);
