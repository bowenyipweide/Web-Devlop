import {
  createRoutesFromChildren,
  matchRoutes,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import {
  createReactRouterV6Options,
  getWebInstrumentations,
  initializeFaro,
  ReactIntegration,
  ConsoleTransport,
} from '@grafana/faro-react';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

const isProd = import.meta.env.PROD;

try {
  initializeFaro({
    app: {
      name: 'eventease-frontend',
      version: '1.0.0',
      environment: isProd ? 'production' : 'development',
    },
    // Production sends to Grafana Cloud; development only uses a console
    // transport so the router instrumentation is wired up without exporting data.
    ...(isProd
      ? { url: 'https://faro-collector-prod-ap-southeast-1.grafana.net/collect/af3295ace10d04cb825ff3c4eca74a01' }
      : { transport: new ConsoleTransport() }),
    instrumentations: [
      ...getWebInstrumentations(),
      new TracingInstrumentation(),
      new ReactIntegration({
        router: createReactRouterV6Options({
          createRoutesFromChildren,
          matchRoutes,
          Routes,
          useLocation,
          useNavigationType,
        }),
      }),
    ],
  });
} catch (e) {
  // Never let telemetry setup block the app from rendering.
  console.warn('[observability] Faro init skipped:', e.message);
}