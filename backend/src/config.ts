import dotenv from 'dotenv';

dotenv.config();

export const config = {
  tourApiKey: process.env.TOUR_API_KEY ?? '',
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? '5432'),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'fairpick',
  },
};

if (!config.tourApiKey) {
  console.warn('[config] TOUR_API_KEY is not set. TourAPI collector will skip fetching.');
}

