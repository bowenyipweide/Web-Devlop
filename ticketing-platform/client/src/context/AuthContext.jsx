import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, clearToken } from '../api/client';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      if (!getToken()) return setLoading(false);
      try {
        const { data } = await api.get('/api/auth/me');
        setUser(data.user);
      } catch (e) {
        clearToken();
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/api/auth/login', { email, password }, { _auth: false });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await api.post('/api/auth/register', payload, { _auth: false });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/api/auth/me');
      setUser(data.user);
      return data.user;
    } catch (e) {
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};