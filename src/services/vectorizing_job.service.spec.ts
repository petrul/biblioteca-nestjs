import { VectorizingJobService } from './vectorizing_job.service';
import { BibliotecaClient } from './biblioteca_client.service';
import { VectorizerService } from './vectorizer.service';

describe('VectorizingJobService', () => {
  let job: VectorizingJobService;
  let stopRequested = false;
  const vectorizeMock = jest.fn();
  const opera: any[] = [];
  let tbcMock: any;

  beforeEach(() => {
    stopRequested = false;
    opera.length = 0;
    vectorizeMock.mockReset();
    vectorizeMock.mockResolvedValue(0);
    tbcMock = {
      allOperaGen: async function* () {
        for (const op of opera) {
          yield op;
        }
      },
    };
    job = new VectorizingJobService(tbcMock, {
      clearStop: () => {
        stopRequested = false;
      },
      requestStop: () => {
        stopRequested = true;
      },
      isStopRequested: () => stopRequested,
      vectorize: vectorizeMock,
    } as unknown as VectorizerService);
  });

  it('status is idle before any run', () => {
    expect(job.status()).toEqual({
      state: 'idle',
      pauseRequested: false,
      canResume: false,
      running: false,
      totalOpera: null,
      completedOpera: 0,
      currentOpus: null,
      processedParas: 0,
      startedAt: null,
      updatedAt: null,
      finishedAt: null,
    });
  });

  it('pause is visible in the status', () => {
    expect(job.pause()).toEqual({ paused: true });
    const st = job.status();
    expect(st.pauseRequested).toBe(true);
    expect(st.state).toBe('idle');
  });

  it('status exposes run progress usable for a progress bar', async () => {
    opera.push(
      { id: 1, head: 'Opus One', completePath: '/one', author: { visualName: 'A' } },
      { id: 2, head: 'Opus Two', completePath: '/two', author: { visualName: 'B' } },
    );
    // hold the run inside the first vectorize() call so the mid-run
    // status snapshot below is deterministic, not a timing race
    let releaseRun: () => void;
    const gate = new Promise<void>(resolve => (releaseRun = resolve));
    vectorizeMock.mockImplementation(() => gate.then(() => 5));

    const run = job.start(false);

    for (let i = 0; i < 100 && !job.status().currentOpus; i++) {
      await new Promise(r => setImmediate(r));
    }
    const mid = job.status();
    expect(mid).toMatchObject({
      state: 'running',
      running: true,
      pauseRequested: false,
      canResume: false,
      totalOpera: 2,
      completedOpera: 0,
    });
    expect(mid.currentOpus).toEqual({ id: 1, head: 'Opus One', path: '/one' });

    releaseRun();
    await run;

    const st = job.status();
    expect(st).toMatchObject({
      state: 'finished',
      pauseRequested: false,
      canResume: false,
      running: false,
      totalOpera: 2,
      completedOpera: 2,
      currentOpus: null,
      processedParas: 10,
    });
    expect(st.startedAt).not.toBeNull();
    expect(st.updatedAt).not.toBeNull();
    expect(st.finishedAt).not.toBeNull();
  });

  it('a pause request halts the run and leaves it resumable', async () => {
    opera.push({ id: 1 }, { id: 2 });
    vectorizeMock.mockImplementation(() => {
      stopRequested = true;
      return Promise.resolve(3);
    });

    const final = await job.start(false);

    expect(final).toMatchObject({
      state: 'paused',
      pauseRequested: true,
      canResume: true,
      running: false,
      totalOpera: 2,
      completedOpera: 1,
      processedParas: 3,
    });
  });

  it('resume continues a paused run from where it halted', async () => {
    opera.push({ id: 1 }, { id: 2 }, { id: 3 });
    vectorizeMock.mockImplementation(() => {
      stopRequested = true;
      return Promise.resolve(2);
    });

    await job.start(false);
    const halted = job.status();
    expect(halted).toMatchObject({
      state: 'paused',
      canResume: true,
      completedOpera: 1,
      totalOpera: 3,
    });

    stopRequested = false;
    vectorizeMock.mockReset();
    vectorizeMock.mockResolvedValue(7);

    const res = await job.resume();

    expect(res).toEqual({ resumed: true, remaining: 2 });
    expect(vectorizeMock.mock.calls.map(c => c[0])).toEqual([2, 3]);
    expect(job.status()).toMatchObject({
      state: 'finished',
      pauseRequested: false,
      canResume: false,
      running: false,
      totalOpera: 3,
      completedOpera: 3,
      processedParas: 16,
    });
  });

  it('resume refuses when there is no previous run', async () => {
    expect(await job.resume()).toEqual({
      resumed: false,
      reason: 'no previous vectorizing run to resume',
    });
  });

  it('resume refuses while a run is in progress', async () => {
    opera.push({ id: 1 });
    let releaseRun: () => void;
    const gate = new Promise<void>(resolve => (releaseRun = resolve));
    vectorizeMock.mockImplementation(() => gate.then(() => 5));

    const run = job.start(false);
    for (let i = 0; i < 100 && !job.status().currentOpus; i++) {
      await new Promise(r => setImmediate(r));
    }

    expect(await job.resume()).toEqual({
      resumed: false,
      reason: 'a vectorizing run is already in progress',
    });

    releaseRun();
    await run;
  });
});
