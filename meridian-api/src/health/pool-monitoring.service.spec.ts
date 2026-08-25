import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PoolMonitoringService } from './pool-monitoring.service';

describe('PoolMonitoringService', () => {
  let service: PoolMonitoringService;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    // Create a mock DataSource with pool
    mockDataSource = {
      driver: {
        pool: {
          totalCount: 8,
          idleCount: 3,
          waitingCount: 2,
        },
      },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoolMonitoringService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<PoolMonitoringService>(PoolMonitoringService);

    // Mock the global prometheus register
    (global as any).prometheusRegister = {
      registerMetric: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should start monitoring interval', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
      clearInterval(service['monitoringInterval']);
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear monitoring interval', () => {
      service.onModuleInit();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('getCurrentMetrics', () => {
    it('should return current pool metrics', () => {
      const metrics = service.getCurrentMetrics();
      expect(metrics).toEqual({
        activeConnections: 5, // 8 total - 3 idle
        idleConnections: 3,
        waitingConnections: 2,
        saturation: 0.625, // 5 / 8
      });
    });

    it('should handle missing pool gracefully', () => {
      mockDataSource.driver.pool = null;
      const metrics = service.getCurrentMetrics();
      expect(metrics).toEqual({
        activeConnections: 0,
        idleConnections: 0,
        waitingConnections: 0,
        saturation: 0,
      });
    });

    it('should handle missing driver gracefully', () => {
      mockDataSource.driver = null;
      const metrics = service.getCurrentMetrics();
      expect(metrics).toEqual({
        activeConnections: 0,
        idleConnections: 0,
        waitingConnections: 0,
        saturation: 0,
      });
    });

    it('should calculate saturation correctly with zero total connections', () => {
      mockDataSource.driver.pool = {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
      };
      const metrics = service.getCurrentMetrics();
      expect(metrics.saturation).toBe(0);
    });
  });

  describe('isPoolHealthy', () => {
    it('should return true when waiting connections below threshold', () => {
      mockDataSource.driver.pool = {
        totalCount: 8,
        idleCount: 3,
        waitingCount: 5,
      };
      const isHealthy = service.isPoolHealthy(10);
      expect(isHealthy).toBe(true);
    });

    it('should return false when waiting connections exceed threshold', () => {
      mockDataSource.driver.pool = {
        totalCount: 8,
        idleCount: 3,
        waitingCount: 15,
      };
      const isHealthy = service.isPoolHealthy(10);
      expect(isHealthy).toBe(false);
    });

    it('should use default threshold of 10', () => {
      mockDataSource.driver.pool = {
        totalCount: 8,
        idleCount: 3,
        waitingCount: 5,
      };
      const isHealthy = service.isPoolHealthy();
      expect(isHealthy).toBe(true);
    });

    it('should handle missing pool gracefully', () => {
      mockDataSource.driver.pool = null;
      const isHealthy = service.isPoolHealthy(10);
      expect(isHealthy).toBe(true);
    });
  });

  describe('collectMetrics', () => {
    it('should update Prometheus gauges with pool metrics', async () => {
      const gaugeSetSpy = jest.fn();
      service['activeConnectionsGauge'] = { set: gaugeSetSpy } as any;
      service['idleConnectionsGauge'] = { set: gaugeSetSpy } as any;
      service['waitingConnectionsGauge'] = { set: gaugeSetSpy } as any;
      service['poolSaturationGauge'] = { set: gaugeSetSpy } as any;

      await service['collectMetrics']();

      expect(gaugeSetSpy).toHaveBeenCalledWith(5); // active
      expect(gaugeSetSpy).toHaveBeenCalledWith(3); // idle
      expect(gaugeSetSpy).toHaveBeenCalledWith(2); // waiting
      expect(gaugeSetSpy).toHaveBeenCalledWith(0.625); // saturation
    });

    it('should handle errors during metric collection', async () => {
      mockDataSource.driver = null;
      const errorSpy = jest.spyOn(service['logger'], 'error');
      await service['collectMetrics']();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
