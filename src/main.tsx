import { App } from './App';
import { bootstrapApplication } from './bootstrap';
import { bootstrapPersistedState } from './persistence/bootstrapPersistedState';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Application root element was not found.');
}

void bootstrapApplication({
  rootElement,
  application: <App />,
  bootstrapPersistedState,
});
