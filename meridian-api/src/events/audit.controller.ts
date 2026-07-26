import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { EventsService } from './events.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('Audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List audit log entries with cursor pagination and filters',
  })
  @ApiResponse({ status: 200, description: 'Paginated audit log entries' })
  async findAll(@Query() query: AuditQueryDto) {
    const result = await this.eventsService.findAuditLogs({
      cursor: query.cursor,
      limit: query.limit,
      contract: query.contract,
      action: query.action,
      address: query.address,
      auditAction: query.auditAction,
    });

    return {
      data: result.data,
      meta: {
        total: result.total,
        limit: query.limit,
        nextCursor: result.nextCursor,
      },
    };
  }

  @Get('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the audit hash chain for all contract events' })
  @ApiResponse({ status: 200, description: 'Hash-chain verification result' })
  async verifyChain() {
    return this.eventsService.verifyHashChain();
  }

  @Get('leaderboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Build Merkle proofs for the latest leaderboard audit entries' })
  @ApiResponse({ status: 200, description: 'Merkle proof bundle for public leaderboard verification' })
  async leaderboardProofs(@Query('limit') limit?: number) {
    return this.eventsService.getLeaderboardProofs(limit ?? 10);
  }

  @Get(':txHash')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single audit log entry by transaction hash' })
  @ApiParam({ name: 'txHash', description: 'Transaction hash' })
  @ApiResponse({ status: 200, description: 'Audit log entry' })
  @ApiResponse({ status: 404, description: 'Entry not found' })
  async findByTxHash(@Param('txHash') txHash: string) {
    const entry = await this.eventsService.findByTxHash(txHash);
    if (!entry) {
      throw new NotFoundException(`No audit entry found for txHash: ${txHash}`);
    }
    return entry;
  }
}
