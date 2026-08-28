import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthService } from './providers/auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token-dto';
import { LogoutDto } from './dto/logout.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Public } from './decorators/public/public.decorator';
import { RequireRoles } from './decorators/roles/roles.decorator';
import { Role } from './enums/role.enum';
import { REQUEST_USER_KEY } from './constant/auth-constant';
import { Request } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('/sign-in')
  @Public()
  @Throttle({ write: { limit: 5, ttl: 15000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with user credentials' })
  @ApiResponse({
    status: 200,
    description:
      'Successfully authenticated, returns access token and refresh token',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
  })
  public async signIn(@Body() signInDto: SignInDto, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.authService.SignIn(signInDto, ip);
  }

  @Post('/refresh-token')
  @Public()
  @Throttle({ write: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh Auth Token' })
  @ApiResponse({ status: 200, description: 'Successfully refreshed token' })
  @ApiResponse({
    status: 429,
    description: 'Too Many Requests - Limit 10 attempts per minute',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized / Invalid refresh token',
  })
  public async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto & { deviceName?: string },
    @Req() req: Request,
  ) {
    const userAgent = req.get('user-agent') ?? undefined;
    // Device tracking (issue #665): prefer the client-declared device name,
    // then the x-device-name header; IP comes from the socket.
    const bodyDevice =
      (refreshTokenDto as { deviceName?: string }).deviceName ?? undefined;
    const headerDevice = req.get('x-device-name') ?? undefined;
    const ip = req.ip ?? req.socket?.remoteAddress ?? undefined;
    return this.authService.RefreshToken(
      refreshTokenDto,
      userAgent,
      bodyDevice ?? headerDevice,
      ip,
      undefined,
    );
  }

  @Post('/logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Successfully revoked refresh token',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized / Invalid refresh token',
  })
  public async logout(@Body() logoutDto: LogoutDto) {
    return this.authService.logout(logoutDto);
  }

  // Authenticated via the global RbacGuard (default posture) — no @Public().
  @Post('/logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current user' })
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Successfully revoked all sessions',
  })
  public async logoutAll(@Req() req: Request) {
    const user = req[REQUEST_USER_KEY] as { sub?: string | number };
    const userId = Number(user?.sub);

    if (!Number.isFinite(userId)) {
      throw new Error('Invalid user payload');
    }

    return this.authService.logoutAll(userId);
  }

  // --- Self-service session management (issue #665) ---

  @Get('/sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "List the current user's active sessions",
  })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Active sessions for the user' })
  public async listSessions(@Req() req: Request) {
    const user = req[REQUEST_USER_KEY] as { sub?: string | number };
    const userId = Number(user?.sub);
    if (!Number.isFinite(userId)) {
      throw new Error('Invalid user payload');
    }
    return this.authService.listSessions(userId);
  }

  @Delete('/sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke one of your sessions by id' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  @ApiResponse({ status: 403, description: 'Session not found or not yours' })
  public async revokeSession(
    @Req() req: Request,
    @Param('id') sessionId: string,
  ) {
    const user = req[REQUEST_USER_KEY] as { sub?: string | number };
    const userId = Number(user?.sub);
    if (!Number.isFinite(userId)) {
      throw new Error('Invalid user payload');
    }
    return this.authService.revokeSession(userId, sessionId);
  }

  @Post('/verify-email')
  @Public()
  @Throttle({ write: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email with one-time token from signup mail',
  })
  @ApiResponse({ status: 200, description: 'Email verified' })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired verification token',
  })
  public async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    const user = await this.authService.verifyEmail(verifyEmailDto.token);
    return { verified: true, email: user.email };
  }

  @Post('/resend-verification')
  @Public()
  @Throttle({ write: { limit: 3, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the email verification mail' })
  @ApiResponse({
    status: 200,
    description:
      'Acknowledgement — never reveals whether the email is registered',
  })
  public async resendVerification(
    @Body() resendVerificationDto: ResendVerificationDto,
  ) {
    return this.authService.resendVerification(resendVerificationDto.email);
  }

  // --- Account lockout (issue #650) ---

  /**
   * Admin-only endpoint to manually unlock a user account that has been
   * locked due to repeated failed sign-in attempts.  Clears both the
   * Redis failure counters and the DB-persisted lockout state.
   */
  @Post('/admin/unlock/:userId')
  @RequireRoles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: unlock a locked user account' })
  @ApiResponse({
    status: 200,
    description: 'Account unlocked successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — admin role required',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  public async adminUnlock(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: Request,
  ) {
    const admin = req[REQUEST_USER_KEY] as { sub?: number; email?: string };

    this.logger.log(
      `Admin unlock: admin=${admin?.sub} target=${userId} ip=${req.ip}`,
    );

    return this.authService.adminUnlock(userId);
  }
}
