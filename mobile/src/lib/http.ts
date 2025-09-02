// src/lib/http.ts
import axios, { AxiosInstance } from "axios";
import { requireApiBase } from "./config";

let client: AxiosInstance | null = null;

export function http(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: requireApiBase(),
      timeout: 10000,
    });

    client.interceptors.response.use(
      r => r,
      err => {
        const url = err.config?.baseURL
          ? `${err.config.baseURL}${err.config.url ?? ""}`
          : err.config?.url;
        console.log("HTTP ERROR:", {
          url,
          status: err.response?.status,
          data: err.response?.data,
          message: err.message,
        });
        return Promise.reject(err);
      }
    );
  }
  return client;
}
