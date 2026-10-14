import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';

export default function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  const { t } = useLang();
  const location = useLocation();

  if (loading) return <div className="container center" style={{ padding: '5rem 0' }}>{t('protectedRoute.loading')}</div>;

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (role && user.role !== role)
    return <Navigate to={user.role === 'admin' ? '/admin' : user.role === 'organizer' ? '/organizer' : '/account'} replace />;
  return children;
}