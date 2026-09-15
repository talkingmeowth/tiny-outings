import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './training.css';
import { restoreTrainingRoute } from './trainingRoute.js';

restoreTrainingRoute(window);
const training = new URLSearchParams(window.location.search).get('view') === 'training';
const missing = new URLSearchParams(window.location.search).get('view') === 'missing';
document.documentElement.classList.toggle('training-route', training || missing);
const App = lazy(() => missing ? import('./MissingImagesApp.jsx') : training ? import('./TrainingApp.jsx') : import('./App.jsx'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<p role="status" style={{ padding: 24 }}>Opening image review…</p>}><App /></Suspense>
  </StrictMode>,
);
