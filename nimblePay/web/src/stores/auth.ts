import { defineStore } from 'pinia';
import { profile } from '@/api';

export type AdminUser = {
  id: string;
  username: string;
  realName: string;
  isSuperAdmin: boolean;
  permissions: string[];
};

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null as AdminUser | null }),
  actions: {
    can(perm: string) {
      if (!this.user) return false;
      if (this.user.isSuperAdmin || this.user.permissions.includes('*')) return true;
      return this.user.permissions.includes(perm);
    },
    async loadProfile() {
      this.user = (await profile()) as AdminUser;
    },
    logout() {
      this.user = null;
      localStorage.removeItem('np_access');
      localStorage.removeItem('np_refresh');
    },
  },
});
