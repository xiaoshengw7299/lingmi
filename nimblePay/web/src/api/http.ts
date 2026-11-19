import axios, { type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';

const http = axios.create({ baseURL: '/api', timeout: 30000 });

/** 成功拦截器已解包 `{ code, data }`，调用方拿到的是 data。 */
export interface ApiClient {
  request<T = any>(config: AxiosRequestConfig): Promise<T>;
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>): Promise<T>;
  put<T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>): Promise<T>;
  patch<T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>): Promise<T>;
}

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('np_access');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (!(typeof body.code === 'number' && body.code >= 200 && body.code < 300)) {
        ElMessage.error(body.message || body.msg || '请求失败');
        return Promise.reject(body);
      }
      return body.data;
    }
    return body;
  },
  async (err) => {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.response?.data?.msg || err.message || '网络错误';
    if (status === 401 && !err.config?.url?.includes('/admin/auth/login')) {
      const refresh = localStorage.getItem('np_refresh');
      if (refresh && !err.config.__retried && !err.config.url?.includes('/admin/auth/refresh')) {
        try {
          const r = await axios.post('/api/admin/auth/refresh', { refreshToken: refresh });
          const data = r.data?.data || r.data;
          localStorage.setItem('np_access', data.accessToken);
          localStorage.setItem('np_refresh', data.refreshToken);
          err.config.__retried = true;
          err.config.headers.Authorization = `Bearer ${data.accessToken}`;
          return http.request(err.config);
        } catch {
          localStorage.removeItem('np_access');
          localStorage.removeItem('np_refresh');
          if (!location.pathname.startsWith('/login')) location.href = '/login';
        }
      } else if (!location.pathname.startsWith('/login')) {
        location.href = '/login';
      }
    }
    ElMessage.error(typeof msg === 'string' ? msg : '请求失败');
    return Promise.reject(err);
  },
);

export default http as unknown as ApiClient;
