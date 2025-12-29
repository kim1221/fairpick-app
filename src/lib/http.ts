import axios from 'axios';

const http = axios.create({
  baseURL: process.env.API_BASE_URL ?? 'http://172.20.10.4:5001',
  timeout: 5000,
});

export default http;
