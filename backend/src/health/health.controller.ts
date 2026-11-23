import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  checkHealth(): {
    status: string;
    service: string;
    timestamp: string;
  } {
    return {
      status: 'ok',
      service: 'zos-backend',
      timestamp: new Date().toISOString(),
    };
  }
}