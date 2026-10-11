/// <reference types="jest" />
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CoverWorkController } from './cover-work.controller';

describe('CoverWorkController (the reader admin section\'s backend)', () => {
  const opus = { id: 3, path: 'eminescu/poezii', head: 'Poezii', coverUrl: 'http://minio.test/covers/eminescu/poezii-aaa.png', author: { strId: 'eminescu', displayName: 'Mihai Eminescu' } };

  function make(overrides: { getElemByPath?: any; generateNow?: any; storedRequest?: any } = {}) {
    const tbc = {
      getElemByPath: overrides.getElemByPath ?? jest.fn(async () => opus),
      getAuthor: jest.fn(async () => ({ imageUrls: [], image_href: null })),
    };
    const covers = {
      generateNow: overrides.generateNow ?? jest.fn(async (c: any) => ({ coverUrl: 'http://minio.test/covers/new.png', request: { title: c.title } })),
      storedRequest: overrides.storedRequest ?? jest.fn(async () => ({ title: 'Poezii', series: 'Scriptorium Classique' })),
    };
    return { controller: new CoverWorkController(tbc as any, covers as any), tbc, covers };
  }

  it('renders a cover for the work synchronously and returns it with its request JSON', async () => {
    const { controller, covers } = make();
    await expect(controller.generate({ path: 'eminescu/poezii' })).resolves.toEqual({ coverUrl: 'http://minio.test/covers/new.png', request: { title: 'Poezii' } });
    expect(covers.generateNow).toHaveBeenCalledWith(expect.objectContaining({ id: 3, path: 'eminescu/poezii', title: 'Poezii', author: 'Mihai Eminescu' }));
  });

  it('returns the current cover\'s stored request', async () => {
    const { controller, covers } = make();
    await expect(controller.request('eminescu/poezii')).resolves.toEqual({ coverUrl: opus.coverUrl, request: { title: 'Poezii', series: 'Scriptorium Classique' } });
    expect(covers.storedRequest).toHaveBeenCalledWith(opus.coverUrl);
  });

  it('rejects malformed paths, unknown works, and a work already being rendered', async () => {
    await expect(make().controller.generate({ path: 'no-slash' })).rejects.toBeInstanceOf(BadRequestException);
    const gone = make({ getElemByPath: jest.fn(async () => { throw Object.assign(new Error('nf'), { status: 404 }); }) });
    await expect(gone.controller.request('nobody/nothing')).rejects.toBeInstanceOf(NotFoundException);
    const busy = make({ generateNow: jest.fn(async () => { throw new Error('a cover for eminescu/poezii is already being rendered'); }) });
    await expect(busy.controller.generate({ path: 'eminescu/poezii' })).rejects.toBeInstanceOf(ConflictException);
  });
});
