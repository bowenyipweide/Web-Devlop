import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Route } from 'react-router-dom';
import { FaroRoutes } from '@grafana/faro-react';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import HomePage from './pages/HomePage.jsx';
import { useLang } from './i18n/LanguageContext.jsx';

// HomePage stays eager: it is the landing route and owns the LCP element, so
// it must not wait on an extra chunk round trip. Everything else is split so
// no single bundle blocks the main thread during startup or the payment flow.
const EventPage = lazy(() => import('./pages/EventPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const RegisterPage = lazy(() => import('./pages/RegisterPage.jsx'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage.jsx'));
const PaymentSuccessPage = lazy(() => import('./pages/PaymentSuccessPage.jsx'));
const PaymentCancelPage = lazy(() => import('./pages/PaymentCancelPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const OrganizerDashboard = lazy(() => import('./pages/OrganizerDashboard.jsx'));
const OrganizerCreateEvent = lazy(() => import('./pages/OrganizerCreateEvent.jsx'));
const AdminPanel = lazy(() => import('./pages/AdminPanel.jsx'));
const ResaleMarket = lazy(() => import('./pages/ResaleMarket.jsx'));
const TransferClaim = lazy(() => import('./pages/TransferClaim.jsx'));
const ValidateTicket = lazy(() => import('./pages/ValidateTicket.jsx'));
const Chatbot = lazy(() => import('./components/Chatbot.jsx'));
const TermsOfUse = lazy(() => import('./pages/TermsOfUse.jsx'));
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions.jsx'));

export default function App() {
  const { t } = useLang();
  const [chatReady, setChatReady] = useState(false);

  // The chatbot is fixed-position and non-critical, so mount it only after
  // the browser goes idle. This keeps its evaluation off the first-paint and
  // checkout critical path without any layout shift.
  useEffect(() => {
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const handle = schedule(() => setChatReady(true));
    return () => cancel(handle);
  }, []);

  return (
    <div className="app-shell">
      <Navbar />
      <main className="app-main">
        <Suspense fallback={<div className="container center route-fallback">{t('common.loading')}</div>}>
          <FaroRoutes>
            <Route path="/" element={<HomePage />} />
            <Route path="/events/:slug" element={<EventPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/resale" element={<ResaleMarket />} />
            <Route path="/transfer/:transferCode" element={<TransferClaim />} />
            <Route path="/terms" element={<TermsOfUse />} />
            <Route path="/terms-and-conditions" element={<TermsAndConditions />} />

            <Route path="/checkout/:bookingId" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
            <Route path="/payment/success" element={<ProtectedRoute><PaymentSuccessPage /></ProtectedRoute>} />
            <Route path="/payment/cancel" element={<ProtectedRoute><PaymentCancelPage /></ProtectedRoute>} />

            <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
            <Route path="/organizer" element={<ProtectedRoute role="organizer"><OrganizerDashboard /></ProtectedRoute>} />
            <Route path="/organizer/new" element={<ProtectedRoute role="organizer"><OrganizerCreateEvent /></ProtectedRoute>} />
            <Route path="/organizer/edit/:id" element={<ProtectedRoute role="organizer"><OrganizerCreateEvent /></ProtectedRoute>} />
            <Route path="/organizer/validate" element={<ProtectedRoute role="organizer"><ValidateTicket /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute role="admin"><AdminPanel /></ProtectedRoute>} />

            <Route path="*" element={
              <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
                <h1>404</h1>
                <p>Page not found.</p>
              </div>
            } />
          </FaroRoutes>
        </Suspense>
      </main>
      <Footer />
      {chatReady && (
        <Suspense fallback={null}>
          <Chatbot />
        </Suspense>
      )}
    </div>
  );
}
