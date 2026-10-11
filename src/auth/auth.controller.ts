import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../common/app-error';
import { Public, Throttle } from '../common/decorators';
import { AppConfig } from '../config/app-config';
import { AuthService, SessionUser } from './auth.service';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto } from './auth.dto';

const REFRESH_COOKIE = 'docentia_rt';
const COOKIE_PATH = '/api/v1/auth';

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

// Refresh/logout are @Public at the JWT level (the access token may be expired);
// they are protected by the httpOnly cookie plus an Origin allow-list check.
@Controller('auth')
@Throttle()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const session = await this.auth.login(dto.email, dto.password, req.ip);
    this.setRefreshCookie(res, session.refreshToken);
    return this.toResponse(session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    this.assertAllowedOrigin(req);
    try {
      const session = await this.auth.refresh(this.readCookie(req), req.ip);
      this.setRefreshCookie(res, session.refreshToken);
      return this.toResponse(session);
    } catch (error) {
      this.clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    this.assertAllowedOrigin(req);
    await this.auth.logout(this.readCookie(req), req.ip);
    this.clearRefreshCookie(res);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.auth.forgotPassword(dto.email, req.ip);
    return {
      message:
        'Si el correo está registrado, recibirás instrucciones para recuperar tu contraseña.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.newPassword, req.ip);
  }

  private toResponse(session: SessionResponse): SessionResponse {
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }

  private setRefreshCookie(res: Response, token: string): void {
    const { NODE_ENV, REFRESH_TTL_DAYS } = this.config.values;
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.values.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
    });
  }

  private readCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      if (part.slice(0, index).trim() === REFRESH_COOKIE) {
        return decodeURIComponent(part.slice(index + 1).trim());
      }
    }
    return undefined;
  }

  /** CSRF defense in depth: a browser-sent Origin must be on the allow-list. */
  private assertAllowedOrigin(req: Request): void {
    const origin = req.headers.origin;
    if (origin && !this.config.values.CORS_ORIGINS.includes(origin)) {
      throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Origen no permitido.');
    }
  }
}
