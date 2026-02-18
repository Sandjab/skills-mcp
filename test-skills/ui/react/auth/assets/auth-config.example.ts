export const authConfig = {
  provider: 'custom',
  tokenStorage: 'cookie',
  refreshThreshold: 300, // seconds before expiry
  endpoints: {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    refresh: '/api/auth/refresh',
    me: '/api/auth/me',
  },
};
