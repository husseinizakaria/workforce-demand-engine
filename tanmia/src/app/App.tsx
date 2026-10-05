import { BrowserRouter } from 'react-router';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AuthProvider } from './AuthProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Confirm';
import { AppRoutes } from '@/routes/AppRoutes';
import { ConfigurationRequiredPage } from '@/pages/MiscPages';
import { isConfigured, isServiceKeyMisconfigured } from '@/lib/supabase';
import { ErrorBoundary } from './ErrorBoundary';

export function App() {
  return (
    <I18nProvider>
      <ErrorBoundary>
        {!isConfigured || isServiceKeyMisconfigured ? <ConfigurationRequiredPage /> : (
          <ToastProvider>
            <ConfirmProvider>
              <BrowserRouter>
                <AuthProvider>
                  <AppRoutes />
                </AuthProvider>
              </BrowserRouter>
            </ConfirmProvider>
          </ToastProvider>
        )}
      </ErrorBoundary>
    </I18nProvider>
  );
}
