import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class ExtensionTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.EXTENSION_TOKEN || '';
    if (!expected) return true;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const token = req.headers['x-extension-token'] || '';
    if (token !== expected) {
      throw new UnauthorizedException('扩展 Token 无效');
    }
    return true;
  }
}
