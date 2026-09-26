import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { VectorizingJobService } from './services/vectorizing_job.service';
import { MilvusCollection } from './services/milvus/milvuscollection.service';

const packageInfo: { name: string; version: string } = require('../package.json');

describe('AppController', () => {
  let appController: AppController;
  const jobMock = {
    status: jest.fn(),
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  };
  const compact = jest.fn();

  beforeEach(async () => {
    jobMock.status.mockReset();
    jobMock.start.mockReset();
    jobMock.pause.mockReset();
    jobMock.resume.mockReset();
    compact.mockReset();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: VectorizingJobService,
          useValue: jobMock,
        },
        {
          provide: MilvusCollection,
          useValue: { compact },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

    it('controller should be defined', async () => {
      expect(appController).toBeDefined();
    });

    it('returns the application name and package version', () => {
      expect(appController.info()).toEqual({
        name: packageInfo.name,
        version: packageInfo.version,
      });
    });

    it('status embeds the vectorizing job status', () => {
      const jobStatus = { state: 'idle', canResume: false };
      jobMock.status.mockReturnValue(jobStatus);
      expect(appController.status()).toEqual({ vectorizing: jobStatus });
    });

    it('legacy revectorize_all delegates to the vectorizing job', async () => {
      await appController.revectorizeAll(true);
      expect(jobMock.start).toHaveBeenCalledWith(true);
    });

    it('legacy stop_vectorizing delegates to the vectorizing job pause', () => {
      expect(appController.stopVectorizing()).toEqual({ stopped: true });
      expect(jobMock.pause).toHaveBeenCalled();
    });

    it('optimize compacts the Milvus collection', async () => {
      compact.mockResolvedValue('compacted');
      expect(await appController.optimize()).toBe('compacted');
    });

    it('parseInt', () => {
      expect(parseInt('abc')).toBe(NaN);
      expect(parseInt(null)).toBe(NaN);
      expect(parseInt(undefined)).toBe(NaN);
      expect(parseInt('123')).toBe(123);
    });

  });
