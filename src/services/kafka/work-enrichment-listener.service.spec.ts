/// <reference types="jest" />
import { WorkEnrichmentKafkaListenerService } from './work-enrichment-listener.service';

/**
 * enrichWorkTopic requests (published by biblioteca-server when it serves a
 * work without a cover) turn into a random cover - and only for works that
 * still lack one. Kafka itself is not involved: handleEnrichWork is what
 * each message runs.
 */
function makeListener(opus: any, author: any = { imageUrls: [], image_href: null }) {
  const enqueued: any[] = [];
  const tbc = {
    getElemByPath: jest.fn(async (path: string) => {
      if (opus instanceof Error) throw opus;
      return { ...opus, path };
    }),
    getAuthor: jest.fn(async () => author),
  };
  const covers = { enqueue: jest.fn(async (candidate: any) => { enqueued.push(candidate); return true; }) };
  const listener = new WorkEnrichmentKafkaListenerService({} as any, tbc as any, covers as any, { kafka: {} } as any);
  return { listener, tbc, covers, enqueued };
}

describe('WorkEnrichmentKafkaListenerService', () => {
  const work = { id: 7, head: 'Poezii', author: { strId: 'eminescu', displayName: 'Mihai Eminescu' } };

  it('enqueues a cover for a work without one, with one of its author\'s images as art', async () => {
    const { listener, enqueued } = makeListener(work, { imageUrls: ['https://img/a.jpg'], image_href: 'https://img/b.jpg' });
    expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ id: 7, path: 'eminescu/poezii', title: 'Poezii', author: 'Mihai Eminescu' });
    expect(['https://img/a.jpg', 'https://img/b.jpg']).toContain(enqueued[0].artUrl);
  });

  it('hands a work that already has a cover to enqueue, which verifies the stored cover still exists', async () => {
    const { listener, enqueued } = makeListener({ ...work, path: 'eminescu/poezii', id: 7, coverUrl: 'https://test.scriptorium.ro/biblioteca/covers/x.png' });
    expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(true);
    expect(enqueued[0]).toMatchObject({ coverUrl: 'https://test.scriptorium.ro/biblioteca/covers/x.png' });
  });

  it('drops requests for unknown works and malformed ids without asking for a cover', async () => {
    const gone = makeListener(Object.assign(new Error('not found'), { status: 404 }));
    expect(await gone.listener.handleEnrichWork('nobody/nothing')).toBe(false);
    expect(gone.covers.enqueue).not.toHaveBeenCalled();

    const bad = makeListener(work);
    expect(await bad.listener.handleEnrichWork('not-a-work-id')).toBe(false);
    expect(bad.tbc.getElemByPath).not.toHaveBeenCalled();
  });

  it('still renders a cover, without art, when the author media lookup fails', async () => {
    const { listener, tbc, enqueued } = makeListener(work);
    tbc.getAuthor.mockRejectedValueOnce(new Error('server busy'));
    expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(true);
    expect(enqueued[0].artUrl).toBeUndefined();
  });
});
