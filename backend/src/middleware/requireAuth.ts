import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthPayload {
  userId: string;   // users.id (UUID)
  userKey: number;  // users.toss_user_key (bigint)
}

// Express Request에 user 타입 추가
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * JWT 검증 미들웨어
 * Authorization: Bearer <token> 헤더에서 토큰을 읽어 req.user에 주입해요.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authorization 헤더가 없어요.' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.user = { userId: payload.userId, userKey: payload.userKey };
    next();
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    res.status(401).json({
      error: expired ? 'TokenExpired' : 'InvalidToken',
      message: expired ? '토큰이 만료됐어요. 다시 로그인해 주세요.' : '유효하지 않은 토큰이에요.',
    });
  }
}
