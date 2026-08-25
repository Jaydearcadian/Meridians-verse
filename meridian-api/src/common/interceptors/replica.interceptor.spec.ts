import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler } from '@nestjs/common';
import { of, Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  ReplicaInterceptor,
  UseReplica,
  UseMaster,
} from './replica.interceptor';

describe('ReplicaInterceptor', () => {
  let interceptor: ReplicaInterceptor;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    // Create a mock DataSource
    mockDataSource = {
      driver: {
        replication: {
          slaves: [{ url: 'postgresql://replica:5432/db' }],
        },
      },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplicaInterceptor,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    interceptor = module.get<ReplicaInterceptor>(ReplicaInterceptor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('intercept', () => {
    it('should set replica routing metadata in request when replica is configured', (done) => {
      // Mock execution context
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            method: 'GET',
            url: '/test',
          }),
        }),
        getHandler: jest.fn().mockReturnValue(() => {}),
      } as any;

      // Mock call handler
      const mockCallHandler: CallHandler = {
        handle: jest.fn().mockReturnValue(of({ data: 'test' })),
      };

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          const request = mockExecutionContext.switchToHttp().getRequest();
          expect(request.replicaRouting).toBeDefined();
          expect(request.replicaRouting.useReplica).toBe(true);
          expect(request.replicaRouting.forceReplica).toBe(false);
          expect(request.replicaRouting.forceMaster).toBe(false);
          done();
        },
      });
    });

    it('should force replica usage when @UseReplica decorator is applied', (done) => {
      const mockHandler = () => {};
      Reflect.defineMetadata('USE_REPLICA', true, mockHandler);

      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            method: 'GET',
            url: '/test',
          }),
        }),
        getHandler: jest.fn().mockReturnValue(mockHandler),
      } as any;

      const mockCallHandler: CallHandler = {
        handle: jest.fn().mockReturnValue(of({ data: 'test' })),
      };

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          const request = mockExecutionContext.switchToHttp().getRequest();
          expect(request.replicaRouting.useReplica).toBe(true);
          expect(request.replicaRouting.forceReplica).toBe(true);
          expect(request.replicaRouting.forceMaster).toBe(false);
          done();
        },
      });
    });

    it('should force master usage when @UseMaster decorator is applied', (done) => {
      const mockHandler = () => {};
      Reflect.defineMetadata('USE_MASTER', true, mockHandler);

      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            method: 'GET',
            url: '/test',
          }),
        }),
        getHandler: jest.fn().mockReturnValue(mockHandler),
      } as any;

      const mockCallHandler: CallHandler = {
        handle: jest.fn().mockReturnValue(of({ data: 'test' })),
      };

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          const request = mockExecutionContext.switchToHttp().getRequest();
          expect(request.replicaRouting.useReplica).toBe(false);
          expect(request.replicaRouting.forceReplica).toBe(false);
          expect(request.replicaRouting.forceMaster).toBe(true);
          done();
        },
      });
    });

    it('should handle errors gracefully', (done) => {
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            method: 'GET',
            url: '/test',
          }),
        }),
        getHandler: jest.fn().mockReturnValue(() => {}),
      } as any;

      const mockCallHandler: CallHandler = {
        handle: jest.fn().mockReturnValue(
          new Observable((subscriber) => {
            subscriber.error(new Error('Test error'));
          }),
        ),
      };

      const errorSpy = jest.spyOn(interceptor['logger'], 'error');

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        error: () => {
          expect(errorSpy).toHaveBeenCalled();
          done();
        },
      });
    });
  });

  describe('without replica configuration', () => {
    beforeEach(async () => {
      // Mock DataSource without replication
      const mockDataSourceNoReplica = {
        driver: {},
      } as any;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReplicaInterceptor,
          {
            provide: DataSource,
            useValue: mockDataSourceNoReplica,
          },
        ],
      }).compile();

      interceptor = module.get<ReplicaInterceptor>(ReplicaInterceptor);
    });

    it('should set useReplica to false when no replica is configured', (done) => {
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            method: 'GET',
            url: '/test',
          }),
        }),
        getHandler: jest.fn().mockReturnValue(() => {}),
      } as any;

      const mockCallHandler: CallHandler = {
        handle: jest.fn().mockReturnValue(of({ data: 'test' })),
      };

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          const request = mockExecutionContext.switchToHttp().getRequest();
          expect(request.replicaRouting.useReplica).toBe(false);
          done();
        },
      });
    });
  });

  describe('decorators', () => {
    it('should set USE_REPLICA metadata', () => {
      const mockHandler = () => {};
      UseReplica()(mockHandler);
      expect(Reflect.getMetadata('USE_REPLICA', mockHandler)).toBe(true);
    });

    it('should set USE_MASTER metadata', () => {
      const mockHandler = () => {};
      UseMaster()(mockHandler);
      expect(Reflect.getMetadata('USE_MASTER', mockHandler)).toBe(true);
    });
  });

  describe('getReplicaRouting', () => {
    it('should return replica routing from request', () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            replicaRouting: {
              useReplica: true,
              forceReplica: false,
              forceMaster: false,
            },
          }),
        }),
      } as any;

      const routing =
        ReplicaInterceptor.getReplicaRouting(mockExecutionContext);
      expect(routing).toEqual({
        useReplica: true,
        forceReplica: false,
        forceMaster: false,
      });
    });

    it('should return null when no routing metadata exists', () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({}),
        }),
      } as any;

      const routing =
        ReplicaInterceptor.getReplicaRouting(mockExecutionContext);
      expect(routing).toBeNull();
    });
  });
});
