import { App } from './App';
import { bootstrapApplication } from './bootstrap';
import {
  bootstrapPersistedState,
  seedDemoArchiveIfFirstRun,
} from './persistence/bootstrapPersistedState';
import { createBrowserPersistenceService } from './persistence/persistenceService';
import { reloadOnServiceWorkerUpdate } from './registerServiceWorker';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Application root element was not found.');
}

// Pick up a freshly deployed build the moment its service worker takes over,
// so a cached older version never lingers on screen after an update.
reloadOnServiceWorkerUpdate();

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
