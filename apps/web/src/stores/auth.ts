import { defineStore } from 'pinia';
import { api } from '../api/client';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    initialized: false,
    authenticated: false,
    owner: null as { id: string; username: string } | null,
  }),
  actions: {
    async refresh(): Promise<void> {
      try {
        const info = await api.session();
        this.authenticated = true;
        this.owner = info.owner;
      } catch {
        this.authenticated = false;
        this.owner = null;
      } finally {
        this.initialized = true;
      }
    },
    async login(username: string, password: string): Promise<void> {
      const info = await api.login(username, password);
      this.authenticated = true;
      this.owner = info.owner;
    },
    async logout(): Promise<void> {
      try {
        await api.logout();
      } catch {
        /* ignore */
      }
      this.authenticated = false;
      this.owner = null;
    },
  },
});
