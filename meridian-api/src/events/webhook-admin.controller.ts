import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhookQueueService } from './webhook-queue.service';

/**
 * Admin endpoints for the webhook dead-letter queue (issue #661): inspect
 * dead-lettered webhooks, replay one, and purge old dead letters.
 */
@ApiTags('Webhooks Admin')
@Controller('webhooks/admin')
export class WebhookAdminController {
  constructor(private readonly webhookQueue: WebhookQueueService) {}

  @Get('dlq')
  @ApiOperation({ summary: 'List dead-lettered webhooks' })
  @ApiResponse({ status: 200, description: 'Dead-lettered webhooks' })
  listDlq() {
    return this.webhookQueue.listDlq();
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replay (reactivate) a dead-lettered webhook' })
  @ApiResponse({ status: 200, description: 'Webhook reactivated' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  async replay(@Param('id') id: string) {
    const webhook = await this.webhookQueue.replay(id);
    if (!webhook) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }
    return webhook;
  }

  @Delete('dlq')
  @ApiOperation({ summary: 'Purge dead letters older than the configured TTL' })
  @ApiResponse({ status: 200, description: 'Number of purged dead letters' })
  purge() {
    return this.webhookQueue.purgeDlq();
  }
}
