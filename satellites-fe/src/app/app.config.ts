import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import * as Sentry from '@sentry/angular';
import { routes } from './app.routes';
import { environment } from '../environments/environment';

if (environment.sentryDsn) {
  Sentry.init({
    dsn:         environment.sentryDsn,
    environment: environment.production ? 'production' : 'development',
    // Keep trace sampling low — adjust per-environment as needed
    tracesSampleRate: environment.production ? 0.1 : 1.0,
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideRouter(routes),
    {
      provide:  ErrorHandler,
      useValue: Sentry.createErrorHandler(),
    },
  ],
};
