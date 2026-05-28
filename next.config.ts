import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Оптимизация сборки для Docker-контейнера */
  output: "standalone",
};

export default nextConfig;
