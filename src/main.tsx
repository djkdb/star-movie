import { App } from './App';
import { bootstrapApplication } from './bootstrap';
import {
  bootstrapPersistedState,
  seedDemoArchiveIfFirstRun,
} from './persistence/bootstrapPersistedState';
import { createBrowserPersistenceService } from './persistence/persistenceService';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Application root element was not found.');
}

void bootstrapApplication({
  rootElement,
  application: <App />,
  bootstrapPersistedState: async () => {
    const service = createBrowserPersistenceService();
    // First-ever visit starts with the built-in demo archive already loaded.
    seedDemoArchiveIfFirstRun(service);
    return bootstrapPersistedState(service);
  },
});
